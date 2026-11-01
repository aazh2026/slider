/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 素材与文档路由（docs/backend-design.md §5.2「素材」段）
 * ---------------------------------------------------------------------------
 *   POST   /api/projects/:id/documents  上传参考文档（md/txt/pdf/docx）
 *   GET    /api/projects/:id/documents  列出项目素材
 *   GET    /api/documents/:id/text      提取后的纯文本
 *   DELETE /api/documents/:id           删除素材（并清理存储文件）
 *
 * **资源级鉴权（§9.2）**：文档属于项目，项目查询必带 userId 条件；
 * 跨租户访问一律 404 NOT_FOUND，不泄露"存在但无权"。
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';

import { ApiError } from '../errors';
import { requireAuth, requireProject } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { documents, projects } from '../db/schema';
import {
  extractDocumentText,
  sanitizeFilename,
  validateUpload,
} from '../services/documentService';
import { isUuid } from '../utils/uuid';
import { respond, requireUserId } from './_helpers';
import type { AppEnv } from '../types';

export const documentRoutes = new Hono<AppEnv>();

function storageDir(): string {
  return process.env['STORAGE_DIR'] ?? '.data/artifacts';
}

/**
 * 按 id 查文档 —— **必须带项目归属条件**
 * ---------------------------------------------------------------------------
 * 查询走 `projects ⋈ documents` 两级连接：先确认项目属于当前用户，再取文档。
 * 少一级都可能把别人的文档交出去。
 */
async function findOwnedDocument(
  db: import('../db/client').DbHandle,
  userId: string,
  documentId: string
) {
  // 形态不对的 id 不该进数据库 —— uuid 列的类型转换会抛错并变成 500
  if (!isUuid(documentId)) throw ApiError.notFound('文档不存在');

  const rows = await db.db
    .select({ doc: documents, projectId: projects.id })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(and(eq(documents.id, documentId), eq(projects.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw ApiError.notFound('文档不存在');
  return row.doc;
}

/* -------------------------------------------------------------------------- */
/* 上传                                                                         */
/* -------------------------------------------------------------------------- */

documentRoutes.post(
  '/projects/:id/documents',
  requireAuth,
  requireProject,
  rateLimit({ limit: 20, windowMs: 60_000, name: 'documents' }),
  async (c) => {
    const project = c.get('project')!;

    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') {
      throw ApiError.validation('缺少上传文件（multipart/form-data，字段名 file）');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = await validateUpload(file.name, bytes);

    // 抽文本 —— 失败不阻断上传（元数据仍然有用），但要如实告知
    let extractedText: string | null = null;
    let warnings: string[] = [];
    try {
      extractedText = await extractDocumentText(validated.kind, bytes);
    } catch (err) {
      warnings.push(
        `文本抽取失败：${err instanceof Error ? err.message : String(err)}`
      );
    }

    const documentId = crypto.randomUUID();
    const storageKey = `documents/${documentId}-${validated.filename}`;
    const dir = storageDir();
    await Bun.write(`${dir}/${storageKey}`, bytes);

    const [row] = await c
      .get('db')
      .db.insert(documents)
      .values({
        id: documentId,
        projectId: project.id,
        filename: validated.filename,
        mime: validated.mime,
        sizeBytes: validated.sizeBytes,
        storageKey,
        extractedText,
      })
      .returning();

    return respond(
      c,
      {
        document: row
          ? {
              id: row.id,
              projectId: row.projectId,
              filename: row.filename,
              mime: row.mime,
              sizeBytes: row.sizeBytes,
              textLength: row.extractedText?.length ?? 0,
              createdAt: row.createdAt,
            }
          : null,
        text: extractedText,
        warnings,
      },
      201
    );
  }
);

/* -------------------------------------------------------------------------- */
/* 列出                                                                         */
/* -------------------------------------------------------------------------- */

documentRoutes.get('/projects/:id/documents', requireAuth, requireProject, async (c) => {
  const project = c.get('project')!;

  const rows = await c
    .get('db')
    .db
    .select()
    .from(documents)
    .where(eq(documents.projectId, project.id));

  return respond(c, {
    documents: rows.map((d) => ({
      id: d.id,
      filename: d.filename,
      mime: d.mime,
      sizeBytes: d.sizeBytes,
      textLength: d.extractedText?.length ?? 0,
      createdAt: d.createdAt,
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* 取文本 / 删除                                                                */
/* -------------------------------------------------------------------------- */

documentRoutes.get('/documents/:id/text', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const doc = await findOwnedDocument(c.get('db'), userId, c.req.param('id')!);

  return respond(c, {
    document: {
      id: doc.id,
      filename: doc.filename,
      mime: doc.mime,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt,
    },
    text: doc.extractedText ?? '',
  });
});

documentRoutes.delete('/documents/:id', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const db = c.get('db');
  const doc = await findOwnedDocument(db, userId, c.req.param('id')!);

  await db.db.delete(documents).where(eq(documents.id, doc.id));

  // 清理存储文件（DOC-07）—— 失败不阻断删除（元数据已删）
  const file = Bun.file(`${storageDir()}/${doc.storageKey}`);
  try {
    if (await file.exists()) await file.delete();
  } catch {
    // 留待存储生命周期任务清理（OPS-10）
  }

  return respond(c, { deleted: true, filename: sanitizeFilename(doc.filename) });
});
