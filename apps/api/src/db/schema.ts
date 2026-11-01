/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 数据库 Schema（Drizzle）—— docs/backend-design.md §4.5
 * ---------------------------------------------------------------------------
 * 设计取舍（原文）：
 *   - `outline` 存 JSONB（整体重写的数组结构，不适合关系化）
 *   - `slides` 存关系表（逐页编辑 + 版本 + 索引）
 *   - `slide_versions` 同时存 `snapshot`（全量，回滚用）与 `patch`（增量，审计用）
 *   - `model_calls` 是成本与效果分析的原料
 *
 * **每一次资源查询都必须带 userId 条件**（§9.2）—— 跨租户访问返回 404 而不是 403。
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  PresentationProject,
  PresentationRequirement,
  QualityReport,
  SlideIR,
  SlideOutlineItem,
  TemplateIR,
} from '@ppt/core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex('users_email').on(table.email)]
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // 随机 256-bit
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id').on(table.userId)]
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    requirement: jsonb('requirement').$type<PresentationRequirement>().notNull(),
    template: jsonb('template').$type<TemplateIR>().notNull(),
    outline: jsonb('outline').$type<SlideOutlineItem[]>().notNull(),
    qualityReport: jsonb('quality_report').$type<QualityReport>(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('projects_user_id').on(table.userId)]
);

export const slides = pgTable(
  'slides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    slideId: text('slide_id').notNull(), // 业务 ID，IR 内引用
    orderIndex: integer('order_index').notNull(),
    ir: jsonb('ir').$type<SlideIR>().notNull(),
    versionId: uuid('version_id').notNull(), // 乐观锁
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex('slides_project_slideid').on(table.projectId, table.slideId),
    index('slides_project_id').on(table.projectId),
  ]
);

export const slideVersions = pgTable(
  'slide_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    slideId: text('slide_id').notNull(),
    versionId: uuid('version_id').notNull(),
    author: text('author').notNull(), // 'ai' | 'user' | 'agent:xxx'
    description: text('description'),
    snapshot: jsonb('snapshot').$type<SlideIR>().notNull(),
    patch: jsonb('patch').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('slide_versions_project_slide').on(table.projectId, table.slideId)]
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    templateId: text('template_id').notNull(), // 'tpl_modern_light' 等
    name: text('name').notNull(),
    category: text('category'),
    ir: jsonb('ir').$type<TemplateIR>().notNull(),
    source: text('source').notNull(), // 'builtin' | 'extracted' | 'user'
    previewKey: text('preview_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex('templates_owner_templateid').on(table.ownerId, table.templateId)]
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    type: text('type').notNull(), // 'export.pptx' | 'template.extract' | ...
    status: text('status').notNull(), // queued|running|succeeded|failed|cancelled
    progress: integer('progress').default(0), // 0-100
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('jobs_user_id').on(table.userId), index('jobs_status').on(table.status)]
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    format: text('format').notNull(), // pptx|pdf|png|svg|json
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [index('artifacts_project_id').on(table.projectId)]
);

export const modelCalls = pgTable(
  'model_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    projectId: uuid('project_id'),
    agent: text('agent').notNull(), // requirement|outline|edit|extract
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    latencyMs: integer('latency_ms'),
    ok: boolean('ok').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('model_calls_user_id').on(table.userId)]
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes'),
    storageKey: text('storage_key').notNull(),
    extractedText: text('extracted_text'), // 文档解析后的纯文本
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('documents_project_id').on(table.projectId)]
);

/** 整库导出（JSON 导入 / 复制项目时用） */
export type ProjectRow = typeof projects.$inferSelect;
export type SlideRow = typeof slides.$inferSelect;
export type SlideVersionRow = typeof slideVersions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ModelCallRow = typeof modelCalls.$inferSelect;

/** 供 JSON 导入使用的不含服务端字段的项目形状 */
export type ProjectBundle = Omit<PresentationProject, 'id'> & { id?: string };
