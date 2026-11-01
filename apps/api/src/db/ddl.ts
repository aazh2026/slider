/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 建表 DDL —— 与 `schema.ts` 的 Drizzle 定义一一对应
 * ---------------------------------------------------------------------------
 * 为什么不直接用 drizzle-kit 生成迁移产物：
 *   迁移产物需要在 CI 里对真实 PG 执行，而本地 / 测试用 PGlite（进程内）。
 *   这里维护一份等价的 DDL，让两种后端跑同一套语句 —— **单一 SQL 方言**。
 *
 * **漂移防护**：`apps/api/tests/contract/db-schema-parity.test.ts` 会把
 * information_schema 里实际的表 / 列 与 Drizzle schema 反射出来的表 / 列
 * 逐个比对。改了一边忘了另一边，那条测试会红。
 */

export const DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     email text NOT NULL,
     password_hash text NOT NULL,
     name text NOT NULL,
     created_at timestamptz DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id)`,

  `CREATE TABLE IF NOT EXISTS projects (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     name text NOT NULL,
     requirement jsonb NOT NULL,
     template jsonb NOT NULL,
     outline jsonb NOT NULL,
     quality_report jsonb,
     deleted_at timestamptz,
     created_at timestamptz DEFAULT now(),
     updated_at timestamptz DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS projects_user_id ON projects (user_id)`,

  `CREATE TABLE IF NOT EXISTS slides (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     slide_id text NOT NULL,
     order_index integer NOT NULL,
     ir jsonb NOT NULL,
     version_id uuid NOT NULL,
     updated_at timestamptz DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS slides_project_slideid ON slides (project_id, slide_id)`,
  `CREATE INDEX IF NOT EXISTS slides_project_id ON slides (project_id)`,

  `CREATE TABLE IF NOT EXISTS slide_versions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     slide_id text NOT NULL,
     version_id uuid NOT NULL,
     author text NOT NULL,
     description text,
     snapshot jsonb NOT NULL,
     patch jsonb,
     created_at timestamptz DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS slide_versions_project_slide ON slide_versions (project_id, slide_id)`,

  `CREATE TABLE IF NOT EXISTS templates (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     owner_id uuid REFERENCES users (id) ON DELETE CASCADE,
     template_id text NOT NULL,
     name text NOT NULL,
     category text,
     ir jsonb NOT NULL,
     source text NOT NULL,
     preview_key text,
     created_at timestamptz DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS templates_owner_templateid ON templates (owner_id, template_id)`,

  `CREATE TABLE IF NOT EXISTS jobs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid REFERENCES users (id) ON DELETE CASCADE,
     project_id uuid,
     type text NOT NULL,
     status text NOT NULL,
     progress integer DEFAULT 0,
     payload jsonb NOT NULL,
     result jsonb,
     error text,
     created_at timestamptz DEFAULT now(),
     updated_at timestamptz DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS jobs_user_id ON jobs (user_id)`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status)`,

  `CREATE TABLE IF NOT EXISTS artifacts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     job_id uuid REFERENCES jobs (id) ON DELETE CASCADE,
     project_id uuid,
     format text NOT NULL,
     storage_key text NOT NULL,
     filename text NOT NULL,
     mime text NOT NULL,
     size_bytes integer,
     expires_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS artifacts_project_id ON artifacts (project_id)`,

  `CREATE TABLE IF NOT EXISTS model_calls (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid,
     project_id uuid,
     agent text NOT NULL,
     provider text NOT NULL,
     model text NOT NULL,
     input_tokens integer,
     output_tokens integer,
     cost_usd numeric(10, 6),
     latency_ms integer,
     ok boolean NOT NULL,
     error text,
     created_at timestamptz DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS model_calls_user_id ON model_calls (user_id)`,

  `CREATE TABLE IF NOT EXISTS documents (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     filename text NOT NULL,
     mime text NOT NULL,
     size_bytes integer,
     storage_key text NOT NULL,
     extracted_text text,
     created_at timestamptz DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS documents_project_id ON documents (project_id)`,
];
