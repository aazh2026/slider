/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UUID 形态校验
 * ---------------------------------------------------------------------------
 * 主键列都是 PostgreSQL 的 `uuid` 类型。把一个非 UUID 的字符串塞进
 * `WHERE id = $1` 会让 Postgres 在**类型转换**时报错 —— 那是一条数据库
 * 异常，最终以 500 结束。
 *
 * 但从调用方的角度看，"路径里的 id 长得不像 UUID" 就是**这个资源不存在**：
 *
 *   - 404 是封闭错误码里唯一表达"查无此项"的码；
 *   - 403 会泄露"该 id 存在"（SEC-08），所以跨租户也是 404；
 *   - 400/VALIDATION_FAILED 说的是"请求格式错了"，而路径参数格式正确、
 *     只是指向一个不存在的东西 —— 那是 404。
 *
 * 所以：**先校验形态，再查库**。形状不对 → 直接 404，根本不碰数据库。
 */

/** 规范 UUID（含带连字符的 8-4-4-4-12 形式） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 是否是 UUID —— 大小写不敏感 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
