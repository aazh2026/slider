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

  switch (outline.layoutPreference) {
    case 'title_cover': {
      const meta = { ...(c.meta ?? {}) };
      if (!meta['visualIntent']) meta['visualIntent'] = outline.visualIntent;
      if (!meta['purpose']) meta['purpose'] = outline.purpose;
      if (!meta['speakerNotes'] && outline.speakerNotes) meta['speakerNotes'] = outline.speakerNotes;
      return { ...base, meta };
    }

    case 'architecture_diagram': {
      const layers = c.layers?.length
        ? c.layers
        : bullets.map((b) => {
            const { label, body } = splitBullet(b);
            return { title: label, items: body ? [body] : [] };
          });
      return { ...base, layers };
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
      return { ...base, columns };
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
      return { ...base, phases };
    }

    case 'stats_kpi': {
      const metrics = c.metrics?.length ? c.metrics : bullets.map(deriveMetric);
      return { ...base, metrics };
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
      return { ...base, radial };
    }

    case 'summary_conclusion': {
      const summary = c.summary
        ? c.summary
        : {
            headline: outline.keyMessage,
            points: bullets,
            actions: [] as string[],
          };
      return { ...base, summary };
    }

    case 'cards_grid':
    default:
      return base;
  }
}

/**
 * 版式是否与槽位自洽（§6.4 评估项「版式匹配率」）
 * ---------------------------------------------------------------------------
 * `architecture_diagram` 必须有 layers，`stats_kpi` 必须有 metrics，依此类推。
 */
export function isLayoutContentConsistent(
  layout: SlideLayoutType,
  content: SlideContent | undefined
): boolean {
  if (!content) return false;
  switch (layout) {
    case 'architecture_diagram':
      return (content.layers?.length ?? 0) > 0;
    case 'problem_solution':
      return (content.columns?.length ?? 0) >= 2;
    case 'timeline_roadmap':
      return (content.phases?.length ?? 0) > 0;
    case 'stats_kpi':
      return (content.metrics?.length ?? 0) > 0;
    case 'radial_center':
      return !!content.radial && content.radial.satellites.length > 0;
    case 'summary_conclusion':
      return !!content.summary;
    case 'title_cover':
    case 'cards_grid':
    default:
      return true;
  }
}
