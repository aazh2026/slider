/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 导出路由（docs/backend-design.md §5.2 / §7 / §8）
 * ---------------------------------------------------------------------------
 *   POST /api/exports            创建导出任务 → 立即返回 jobId
 *   GET  /api/exports/:id        任务状态
 *   GET  /api/exports/:id/events SSE 进度流
 *   GET  /api/exports/:id/download 下载产物
 *
 * **与文档的差异（已知）**：文档设计的是独立 Worker 进程消费 `jobs` 表。
 * 这里改成「进程内后台执行」—— 任务仍然落 `jobs` 表、有完整状态机与产物记录，
 * 但没有独立的 worker 进程。规模上来后把执行部分换成 `FOR UPDATE SKIP LOCKED`
 * 拉取即可，接口不变。
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { streamSSE } from 'hono/streaming';

import type { PresentationProject } from '@ppt/core';

import { ApiError } from '../errors';
import { requireAuth } from '../middleware/auth';
import { artifacts, jobs, projects, slides } from '../db/schema';
import { renderExport, type ExportFormat } from '../services/exportService';
import { isUuid } from '../utils/uuid';
import { respond, requireUserId } from './_helpers';
import type { AppEnv } from '../types';

export const exportRoutes = new Hono<AppEnv>();

const CreateExportSchema = z.object({
  projectId: z.string().min(1),
  format: z.enum(['pptx', 'pdf', 'png', 'svg', 'json']),
  scope: z
    .object({ slideIds: z.array(z.string()).optional() })
    .optional(),
});

function storageDir(): string {
  return process.env['STORAGE_DIR'] ?? '.data/artifacts';
}

/**
 * 任务 id 必须是 UUID
 * ---------------------------------------------------------------------------
 * `jobs.id` 是 uuid 列。传一个非 UUID 会让 Postgres 在类型转换时抛错 ——
 * 那条异常会变成 500，而"这个任务不存在"应该是 404。
 */
function requireJobId(c: { req: { param: (k: string) => string | undefined } }): string {
  const jobId = c.req.param('id');
  if (!jobId || !isUuid(jobId)) throw ApiError.notFound('任务不存在');
  return jobId;
}

async function loadProjectForExport(
  db: import('../db/client').DbHandle,
  userId: string,
  projectId: string
): Promise<PresentationProject> {
  const rows = await db.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  const project = rows[0];
  if (!project) throw ApiError.notFound('项目不存在');

  const slideRows = await db.db
    .select()
    .from(slides)
    .where(eq(slides.projectId, projectId))
    .orderBy(slides.orderIndex);

  return {
    id: project.id,
    name: project.name,
    requirement: project.requirement,
    template: project.template,
    outline: project.outline ?? [],
    slides: slideRows.map((s) => s.ir),
    versions: {},
    qualityReport: project.qualityReport ?? undefined,
    createdAt: project.createdAt?.getTime() ?? Date.now(),
    updatedAt: project.updatedAt?.getTime() ?? Date.now(),
  };
}

exportRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const body = CreateExportSchema.parse(await c.req.json().catch(() => null));
  const db = c.get('db');

  const project = await loadProjectForExport(db, userId, body.projectId);

  const [job] = await db
    .db.insert(jobs)
    .values({
      userId,
      projectId: project.id,
      type: `export.${body.format}`,
      status: 'queued',
      progress: 0,
      payload: { format: body.format, scope: body.scope ?? null },
    })
    .returning();

  if (!job) throw ApiError.jobFailed('导出任务创建失败');

  // 后台执行 —— 不阻塞响应
  void runExportJob(db, job.id, project, body.format as ExportFormat, body.scope).catch(
    async (err) => {
      await db.db
        .update(jobs)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
    }
  );

  return respond(c, { job }, 202);
});

async function runExportJob(
  db: import('../db/client').DbHandle,
  jobId: string,
  project: PresentationProject,
  format: ExportFormat,
  scope?: { slideIds?: string[] }
): Promise<void> {
  await db.db.update(jobs).set({ status: 'running', progress: 10, updatedAt: new Date() }).where(eq(jobs.id, jobId));

  const rendered = await renderExport(project, format, scope);

  await db.db.update(jobs).set({ status: 'running', progress: 70, updatedAt: new Date() }).where(eq(jobs.id, jobId));

  const dir = storageDir();
  await Bun.write(`${dir}/${jobId}-${rendered.filename}`, rendered.bytes);

  const [artifact] = await db
    .db.insert(artifacts)
    .values({
      jobId,
      projectId: project.id,
      format,
      storageKey: `${jobId}-${rendered.filename}`,
      filename: rendered.filename,
      mime: rendered.mime,
      sizeBytes: rendered.bytes.byteLength,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();

  await db.db
    .update(jobs)
    .set({
      status: 'succeeded',
      progress: 100,
      result: { artifactId: artifact?.id ?? null, filename: rendered.filename },
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

exportRoutes.get('/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const jobId = requireJobId(c);

  const rows = await c
    .get('db')
    .db.select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);

  const job = rows[0];
  if (!job) throw ApiError.notFound('任务不存在');

  return respond(c, { job });
});

exportRoutes.get('/:id/download', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const jobId = requireJobId(c);

  const jobRows = await c
    .get('db')
    .db.select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  const job = jobRows[0];
  if (!job) throw ApiError.notFound('任务不存在');
  if (job.status !== 'succeeded') throw ApiError.jobFailed('产物尚未就绪');

  const artifactRows = await c
    .get('db')
    .db.select()
    .from(artifacts)
    .where(eq(artifacts.jobId, jobId))
    .limit(1);
  const artifact = artifactRows[0];
  if (!artifact) throw ApiError.notFound('产物不存在');

  const file = Bun.file(`${storageDir()}/${artifact.storageKey}`);
  if (!(await file.exists())) throw ApiError.notFound('产物文件不存在');

  c.header('content-type', artifact.mime);
  c.header('content-disposition', contentDisposition(artifact.filename));
  return c.body(file);
});

/**
 * Content-Disposition —— RFC 5987
 * ---------------------------------------------------------------------------
 * 中文文件名不能直接塞进 `filename="..."`（HTTP 头只允许 ASCII），
 * 所以要同时给出 ASCII 回退名和 `filename*=UTF-8''` 百分号编码名。
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** SSE 进度流 —— 轮询任务状态直到终态 */
exportRoutes.get('/:id/events', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const jobId = requireJobId(c);
  const db = c.get('db');

  const jobRows = await db.db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.userId, userId))).limit(1);
  if (!jobRows[0]) throw ApiError.notFound('任务不存在');

  return streamSSE(c, async (stream) => {
    let lastStatus = '';
    for (let i = 0; i < 600; i++) {
      const rows = await db.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      const job = rows[0];
      if (!job) break;

      const key = `${job.status}:${job.progress}`;
      if (key !== lastStatus) {
        lastStatus = key;
        await stream.writeSSE({
          event: 'progress',
          data: JSON.stringify({
            stage: job.status,
            percent: job.progress ?? 0,
            message: job.status === 'running' ? '正在生成产物' : job.status,
          }),
        });
      }

      if (job.status === 'succeeded') {
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ jobId, downloadUrl: `/api/exports/${jobId}/download` }),
        });
        break;
      }

      if (job.status === 'failed' || job.status === 'cancelled') {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ code: 'JOB_FAILED', message: job.error ?? '任务失败' }),
        });
        break;
      }

      await Bun.sleep(300);
    }
  });
});
