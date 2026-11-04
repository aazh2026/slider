/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * contentBinding —— 大纲 → 内容槽位（docs/backend-design.md §4.2）
 * ---------------------------------------------------------------------------
 * 这是 F2「布局引擎与内容脱节」的修复点，也是 P2「内容槽位契约」的落点。
 *
 * **唯一的硬约束**：降级链的每一格都只能来自 `outline`（bulletPoints /
 * keyMessage / title / purpose），**绝不允许回落到硬编码演示文案**。
 * 现状（2026-11-01 之前）的降级实现对任何主题都返回同一份
 * 「企业 AI Agent 技术架构规划」大纲 —— 那不是降级，那是撒谎。
 *
 * **波 2 ③ 之后，这一层从「绑定器」变成了「绑定器 + 校验器」。**
 *
 * 过去的内容绑定只做一件事：把 outline 与 AI 给的 content 揉成一份
 * `SlideContent`。揉的时候**不管版式**—— 于是 AI 给 `cards_grid` 的页面
 * 附带了 `layers`，那份 layers 就被原样带进 `SlideContent`，一路带到渲染层，
 * 没有任何一处会报告「这个槽位不属于这个版式」。
 *
 * 现在：
 *
 *   · **绑定按契约裁剪** —— 只有版式契约（`data/layoutIntents.ts` 的
 *     `LAYOUT_SLOT_CONTRACTS`）声明消费的槽位才会进入这一页；
 *   · **校验给出结论** —— `validateContentForLayout()` 报告缺什么、丢了什么。
 *
 * 版式 ↔ 槽位映射表（§4.2）：
 *
 * | layoutPreference    | 消费槽位          | 缺省降级                          |
 * |---------------------|-------------------|-----------------------------------|
 * | title_cover         | title/subtitle/meta| meta 取 purpose / visualIntent   |
 * | architecture_diagram| layers[]          | 每条要点一层（标签=层名，正文=层内容）|
 * | cards_grid          | bullets[]         | 直接消费                          |
 * | problem_solution    | columns[2]        | bullets 前半 / 后半切分           |
 * | timeline_roadmap    | phases[]          | bullets 按数量均分阶段            |
 * | stats_kpi           | metrics[]         | 要点的数字前缀作指标值            |
 * | radial_center       | radial            | bullets 取前 4 条作卫星           |
 * | summary_conclusion  | summary           | bullets → points，keyMessage → headline |
 */

import { SlideContent } from '../types/content';
import { SlideOutlineItem, SlideLayoutType } from '../types/slide';
import { ContentSlotKey, slotContractOf } from '../data/layoutIntents';

/**
 * 要点 → 标签 / 正文
 * ---------------------------------------------------------------------------
 * 版式槽位绑定统一走这个切分：要点形如「标签：正文」时，标签进标题位、正文进描述位；
 * 没有分隔符时整条要点即为标签（正文为空）。
 *
 * 切分是**无损**的 —— 标签与正文合起来等于原要点。
 */
export function splitBullet(bullet: string): { label: string; body: string } {
  const raw = (bullet ?? '').trim();
  const matched = raw.match(/^([^：:]*)[：:]\s*([\s\S]*)$/);
  if (matched) {
    const label = (matched[1] ?? '').trim();
    if (label) return { label, body: (matched[2] ?? '').trim() };
  }
  return { label: raw, body: '' };
}

/** 要点来源：优先 bulletPoints，一个都没有时从 keyMessage 确定性推导 */
export function contentBullets(outline: SlideOutlineItem): string[] {
  const bullets = (outline.bulletPoints ?? [])
    .map((b) => (b ?? '').trim())
    .filter((b) => b.length > 0);
  if (bullets.length > 0) return bullets;

  const keyMessage = (outline.keyMessage ?? '').trim();
  return keyMessage ? [keyMessage] : [];
}

/** 把要点均分到 count 组 */
export function distributeEvenly(items: string[], count: number): string[][] {
  const groups: string[][] = Array.from({ length: Math.max(1, count) }, () => []);
  if (items.length === 0) return groups;

  const base = Math.floor(items.length / groups.length);
  const remainder = items.length % groups.length;
  let cursor = 0;
  groups.forEach((group, i) => {
    const size = base + (i < remainder ? 1 : 0);
    group.push(...items.slice(cursor, cursor + size));
    cursor += size;
  });
  return groups;
}

/** 要点 → 指标值（数字前缀） */
function deriveMetric(bullet: string): { value: string; trend: string; title: string; desc: string } {
  const matched = bullet.match(/^\s*([\d][\d.,]*\s*[%xX倍]?)\s*([\s\S]*)$/);
  const value = matched ? (matched[1] ?? '').trim() : '';
  const rest = (matched ? (matched[2] ?? '') : bullet).trim();
  const { label, body } = splitBullet(rest);
  return { value, trend: '', title: label, desc: body };
}

function nonEmpty(v: string | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : undefined;
}

/**
 * 一个槽位里「像样」的那些条目
 * ---------------------------------------------------------------------------
 * 校验 `requires` 时要数的是**条目**，不是字段是否存在 ——
 * `layers: [{title: '', items: []}]` 有一个条目，但那个条目是空的。
 */
function slotItems(slot: ContentSlotKey, content: SlideContent | undefined): string[] {
  if (!content) return [];
  switch (slot) {
    case 'title':
      return content.title ? [content.title] : [];
    case 'subtitle':
      return content.subtitle ? [content.subtitle] : [];
    case 'keyMessage':
      return content.keyMessage ? [content.keyMessage] : [];
    case 'bullets':
      return (content.bullets ?? []).filter((b) => (b ?? '').trim().length > 0);
    case 'columns':
      return (content.columns ?? []).map((c) => c.title ?? '');
    case 'layers':
      return (content.layers ?? []).map((l) => l.title ?? '');
    case 'phases':
      return (content.phases ?? []).map((p) => p.phase ?? '');
    case 'metrics':
      return (content.metrics ?? []).map((m) => m.value ?? '');
    case 'radial':
      return content.radial ? content.radial.satellites.map((s) => s.title ?? '') : [];
    case 'summary':
      return content.summary ? [content.summary.headline ?? ''] : [];
    case 'meta':
      return Object.values(content.meta ?? {});
    default:
      return [];
  }
}

/** 槽位在内容里「有东西」吗 */
function slotPresent(slot: ContentSlotKey, content: SlideContent | undefined): boolean {
  return slotItems(slot, content).some((v) => (v ?? '').trim().length > 0);
}

/**
 * 内容校验结果
 * ---------------------------------------------------------------------------
 * `ok` 只看 **error** 级问题：被丢弃的槽位是 warning —— 丢弃本身是
 * 正确行为（那一页不该有那个槽位），但值得让人知道 AI 给了多余的东西。
 */
export interface ContentValidation {
  /** 没有 error 级问题 */
  ok: boolean;
  /** 问题清单 */
  issues: ContentIssue[];
  /** 这个版式实际消费的槽位 */
  consumed: ContentSlotKey[];
  /** 因为不属于这个版式而被丢弃的槽位 */
  dropped: ContentSlotKey[];
}

/** 一条校验问题 */
export interface ContentIssue {
  /** 出问题的槽位 */
  slot: ContentSlotKey;
  /** error = 这一页按这个版式排不出来；warning = 有多余的东西被丢弃 */
  level: 'error' | 'warning';
  /** 人能读的一句话 */
  message: string;
}

/**
 * 校验内容与版式是否匹配（波 2 ③）
 * ---------------------------------------------------------------------------
 * 这就是「校验器」：它**回答**「这份内容配这个版式行不行」，而不是把不配的
 * 内容硬塞进去。
 *
 * 两种问题：
 *   · **error** —— 契约要求的槽位没内容，或条目里没有要求的值
 *     （`stats_kpi` 的指标没有数字）；
 *   · **warning** —— 内容里带了不属于这个版式的槽位（会被丢弃）。
 */
export function validateContentForLayout(
  layout: SlideLayoutType,
  content: SlideContent | undefined
): ContentValidation {
  const contract = slotContractOf(layout);
  const consumed = [...contract.consumes];
  const issues: ContentIssue[] = [];

  if (!content) {
    issues.push({
      slot: 'bullets',
      level: 'error',
      message: `内容缺失 —— 无法按「${layout}」版式排版`,
    });
    return { ok: false, issues, consumed, dropped: [] };
  }

  // 1) 契约要求的槽位必须有内容
  for (const req of contract.requires) {
    const items = slotItems(req.slot, content);
    if (items.length < req.min) {
      issues.push({
        slot: req.slot,
        level: 'error',
        message: `版式「${layout}」需要至少 ${req.min} 个「${req.slot}」，实际只有 ${items.length} 个`,
      });
      continue;
    }
    if (req.pattern) {
      const matched = items.filter((v) => req.pattern!.test(v ?? ''));
      if (matched.length === 0) {
        issues.push({
          slot: req.slot,
          level: 'error',
          message: `版式「${layout}」的「${req.slot}」里没有任何符合要求的条目（要求匹配 ${req.pattern.source}）`,
        });
      }
    }
  }

  // 2) 不属于这个版式的槽位会被丢弃 —— 报告出来，但不判失败
  const allSlots: ContentSlotKey[] = [
    'title',
    'subtitle',
    'keyMessage',
    'bullets',
    'columns',
    'layers',
    'phases',
    'metrics',
    'radial',
    'summary',
    'meta',
  ];
  const droppedSlots = allSlots.filter(
    (s) => !consumed.includes(s) && slotPresent(s, content)
  );
  for (const slot of droppedSlots) {
    issues.push({
      slot,
      level: 'warning',
      message: `「${slot}」不属于版式「${layout}」，已从这一页丢弃`,
    });
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    consumed,
    dropped: droppedSlots,
  };
}

/**
 * 绑定内容槽位
 *
 * @param outline 大纲项 —— 降级内容的**唯一**来源
 * @param content AI / 人工产出的槽位 —— 存在则优先采用
 */
export function bindContent(
  outline: SlideOutlineItem,
  content?: SlideContent
): SlideContent {
  const c: Partial<SlideContent> = content ?? {};
  const bullets = c.bullets?.length ? c.bullets : contentBullets(outline);

  const base: SlideContent = {
    ...c,
    bullets,
    title: nonEmpty(c.title) ?? outline.title,
    subtitle: nonEmpty(c.subtitle) ?? outline.purpose,
    keyMessage: nonEmpty(c.keyMessage) ?? outline.keyMessage,
  };

  const derived = deriveDedicatedSlots(outline, c, bullets);
  const merged: SlideContent = { ...base, ...derived };

  // **按契约裁剪** —— 不属于这个版式的槽位不进这一页（波 2 ③）
  return pickConsumedSlots(merged, slotContractOf(outline.layoutPreference).consumes);
}

/**
 * 专属槽位的推导 —— 每个版式怎么把通用要点变成自己的形状
 * ---------------------------------------------------------------------------
 * 这里只管**怎么推导**；「这个版式该不该有这个槽位」由契约表回答。
 */
function deriveDedicatedSlots(
  outline: SlideOutlineItem,
  c: Partial<SlideContent>,
  bullets: string[]
): Partial<SlideContent> {
  switch (outline.layoutPreference) {
    case 'title_cover': {
      const meta = { ...(c.meta ?? {}) };
      if (!meta['visualIntent']) meta['visualIntent'] = outline.visualIntent;
      if (!meta['purpose']) meta['purpose'] = outline.purpose;
      if (!meta['speakerNotes'] && outline.speakerNotes) meta['speakerNotes'] = outline.speakerNotes;
      return { meta };
    }

    case 'architecture_diagram': {
      const layers = c.layers?.length
        ? c.layers
        : bullets.map((b) => {
            const { label, body } = splitBullet(b);
            return { title: label, items: body ? [body] : [] };
          });
      return { layers };
    }

    case 'problem_solution': {
      const columns = c.columns?.length
        ? c.columns
        : (() => {
            const half = Math.ceil(bullets.length / 2);
            return [
              { title: '核心问题', items: bullets.slice(0, half) },
              { title: '解决方案', items: bullets.slice(half) },
            ];
          })();
      return { columns };
    }

    case 'timeline_roadmap': {
      const phases = c.phases?.length
        ? c.phases
        : (() => {
            const phaseCount = Math.min(4, Math.max(1, bullets.length));
            const groups = distributeEvenly(bullets, phaseCount);
            return groups.map((items, idx) => ({
              phase: `PHASE 0${idx + 1}`,
              time: '',
              title: '',
              deliverables: items,
            }));
          })();
      return { phases };
    }

    case 'stats_kpi': {
      const metrics = c.metrics?.length ? c.metrics : bullets.map(deriveMetric);
      return { metrics };
    }

    case 'radial_center': {
      const radial = c.radial
        ? c.radial
        : (() => {
            const center = splitBullet(outline.keyMessage ?? '');
            return {
              center: { title: center.label, desc: center.body },
              satellites: bullets.slice(0, 4).map((b) => {
                const { label, body } = splitBullet(b);
                return { title: label, desc: body };
              }),
            };
          })();
      return { radial };
    }

    case 'summary_conclusion': {
      const summary = c.summary
        ? c.summary
        : {
            headline: outline.keyMessage,
            points: bullets,
            actions: [] as string[],
          };
      return { summary };
    }

    case 'cards_grid':
    default:
      return {};
  }
}

/**
 * 只保留契约声明消费的槽位
 * ---------------------------------------------------------------------------
 * `bullets` 永远保留 —— 它是降级链的源头，任何版式都从它出发。
 */
function pickConsumedSlots(
  content: SlideContent,
  consumed: ContentSlotKey[]
): SlideContent {
  const out: SlideContent = { bullets: content.bullets ?? [] };
  for (const slot of consumed) {
    switch (slot) {
      case 'bullets':
        break; // 已保留
      case 'title':
        if (content.title !== undefined) out.title = content.title;
        break;
      case 'subtitle':
        if (content.subtitle !== undefined) out.subtitle = content.subtitle;
        break;
      case 'keyMessage':
        if (content.keyMessage !== undefined) out.keyMessage = content.keyMessage;
        break;
      case 'columns':
        if (content.columns !== undefined) out.columns = content.columns;
        break;
      case 'layers':
        if (content.layers !== undefined) out.layers = content.layers;
        break;
      case 'phases':
        if (content.phases !== undefined) out.phases = content.phases;
        break;
      case 'metrics':
        if (content.metrics !== undefined) out.metrics = content.metrics;
        break;
      case 'radial':
        if (content.radial !== undefined) out.radial = content.radial;
        break;
      case 'summary':
        if (content.summary !== undefined) out.summary = content.summary;
        break;
      case 'meta':
        if (content.meta !== undefined) out.meta = content.meta;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * 版式是否与槽位自洽（§6.4 评估项「版式匹配率」）
 * ---------------------------------------------------------------------------
 * 波 2 ③ 之后，这一问由契约表回答 —— 校验器是唯一裁判。
 */
export function isLayoutContentConsistent(
  layout: SlideLayoutType,
  content: SlideContent | undefined
): boolean {
  return validateContentForLayout(layout, content).ok;
}

/** 契约表（供外部查询与测试引用） */
export { slotContractOf };
export type { ContentSlotKey, LayoutSlotContract, SlotRequirement } from '../data/layoutIntents';
