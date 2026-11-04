/**
 * 注入错误检查（mutation check）
 * ---------------------------------------------------------------------------
 * 「测试通过」本身不证明测试有效。这里对**当前通过**的判据逐条注入一个
 * 代表性错误，确认对应验证器会报错；报不出错的验证器不合格。
 *
 * 每个用例走三步：
 *   1. 基线   —— 未改动时该判据必须 PASS
 *   2. 注入   —— 故意改坏实现，该判据必须 FAIL
 *   3. 还原   —— 还原后必须重新 PASS
 *
 * 运行：
 *     bun run spec/verify/mutation-check.ts
 *
 * 退出码：0 = 全部用例的验证器都抓到了注入错误；1 = 存在抓不到的验证器。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServers, type ServerHandle } from './servers';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const REPORT_PATH = resolve(ROOT, 'spec/evidence/mutation-report.json');

interface Mutation {
  /** 判据 ID —— 出问题时要能追溯回 Spec */
  criterion: string;
  /** 一句话说清注入的是什么错 */
  description: string;
  /** 被改动的源文件（相对仓库根） */
  file: string;
  /** 要替换的原文本 */
  find: string;
  /** 替换后的文本 */
  replace: string;
  /**
   * 附加替换 —— 有些守卫是**多处协同**的。
   *
   * 例如乐观锁：前置检查（`current.versionId !== baseVersionId`）与
   * SQL 条件（`WHERE version_id = baseVersionId`）各挡一半，
   * 只拆掉其中一处，另一处照样返回 409 —— 验证器抓不到注入的错误，
   * 说明注入的不是"代表性错误"，是"不完整的错误"。
   *
   * `file` 省略时沿用主编辑的源文件。
   */
  extraEdits?: Array<{ file?: string; find: string; replace: string }>;
  /** 承载该判据的验证文件 */
  testFile: string;
  /** 验证用例名 */
  testName: string;
  /**
   * 只跑整个文件，不按用例名过滤。
   *
   * 早期 E2E 是一条**顺序流程**（注册 → 建项目 → 生成大纲 → 编译 → 编辑 → 导出），
   * 后面的用例依赖前面留下的状态，所以当时只能整文件跑 —— 单独跑一个用例会因为
   * "前置没做"而失败，那种失败跟"验证器抓到了注入的错误"完全是两回事，
   * 混在一起就是**假阳性**（看起来抓到了，其实只是没跑起来）。
   *
   * 现在 E2E 已拆成**各自完备**的独立链（e2e/*.e2e.ts，每条链自己建项目、自己收尾），
   * 单用例过滤已经安全 —— 每条注入只跑它自己那一条用例，
   * 别的用例挂掉不会被误判成"抓到了注入的错误"。
   */
  wholeFile?: boolean;
}

const MUTATIONS: Mutation[] = [
  // ---- SPEC-CORE-001 画布尺寸 ----
  {
    criterion: 'AC-CORE-001',
    description: '把画布尺寸改成 1600×900',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: 'const canvas = { width: 1920, height: 1080 };',
    replace: 'const canvas = { width: 1600, height: 900 };',
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'canvas-is-always-1920x1080',
  },
  // ---- SPEC-CORE-001 画布在屏幕上的比例（同一个"1920×1080"事实的另一半） ----
  //
  // 2026-11-04 实测到的真实缺陷：画布那层被 flex-shrink 压成了 480×1080 的
  // 竖条，幻灯片被缩成中间一条 —— 而 IR 里的 canvas 仍然是 1920×1080，
  // 所有内容类断言照样全绿。AC-CORE-001 的单元判据抓不到它，
  // 因为它守的是 IR，不是屏幕。
  //
  // 这里注入的是**同一类错误**：让画布盒子的宽度跟着容器走（而不是钉死 1920），
  // 于是屏幕上的画布再次变成竖条 —— 判据必须失败。
  {
    criterion: 'AC-CORE-011',
    description: '画布宽度改成跟着容器走（width: 100%）—— 屏幕上再次变成竖条、出现信箱边',
    file: 'src/components/Workbench.tsx',
    find: '                width: 1920,\n                height: 1080,',
    replace: "                width: '100%',\n                height: 1080,",
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-CORE-011 工作台画布在屏幕上保持 16:9，不出现信箱边',
  },
  // ---- SPEC-CORE-002 元素不越界 ----
  {
    criterion: 'AC-CORE-002',
    description: '让页码元素横向越出画布',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: 'geometry: { x: 1760, y: 1015, width: 80, height: 30 },',
    replace: 'geometry: { x: 1760, y: 1015, width: 400, height: 30 },',
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'no-element-out-of-canvas',
  },
  // ---- SPEC-CORE-003 元素 ID 全局唯一 ----
  {
    criterion: 'AC-CORE-003',
    description: '卡片元素 ID 不带 slideId —— 同版式的两页会撞 ID',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: '        id: `grid_card_${outline.slideId}_${i}`,',
    replace: '        id: `grid_card_fixed_${i}`,',
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'element-ids-unique-across-slides',
  },
  // ---- SPEC-CORE-004 元素 ID 携带 slideId ----
  {
    criterion: 'AC-CORE-004',
    description: '卡片元素 ID 不再携带 slideId',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: '        id: `grid_card_${outline.slideId}_${i}`,',
    replace: '        id: `grid_card_${i}`,',
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'layout-element-ids-contain-slide-id',
  },
  // ---- SPEC-CORE-005 纯函数 ----
  {
    criterion: 'AC-CORE-005',
    description: '在页脚文案里掺入随机数（破坏确定性）',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find:
      '        content: outline.purpose,\n' +
      '        geometry: { x: 100, y: 1015, width: 600, height: 30 },',
    replace:
      "        content: outline.purpose + ' ' + Math.random(),\n" +
      '        geometry: { x: 100, y: 1015, width: 600, height: 30 },',
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'layout-engine-is-pure',
  },
  // ---- SPEC-CORE-006 封面不渲染母版 ----
  {
    criterion: 'AC-CORE-006',
    description: '去掉「封面不渲染母版」的分支判断',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: '    const isCover = outline.layoutPreference === \'title_cover\';\n    if (!isCover) {',
    replace: '    const isCover = false;\n    if (!isCover) {',
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'cover-page-has-no-master-elements',
  },
  // ---- SPEC-CORE-007 页码格式 ----
  {
    criterion: 'AC-CORE-007',
    description: '页码不再补零到两位',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: "content: `${String(slideOrder).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`,",
    replace: "content: `${slideOrder} / ${totalSlides}`,",
    testFile: 'spec/verify/core-layout.test.ts',
    testName: 'page-number-format',
  },
  // ---- SPEC-CORE-008 版式消费 outline.bulletPoints ----
  {
    criterion: 'AC-CORE-008',
    description: '卡片标题回落到硬编码演示文案（不再用要点标签）',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: '      return { tag: `DIMENSION 0${i + 1}`, title: label, desc: body };',
    replace: "      return { tag: `DIMENSION 0${i + 1}`, title: '硬编码演示文案', desc: body };",
    testFile: 'spec/verify/core-content.test.ts',
    testName: 'bullet-consuming-layouts-use-outline-bullets',
  },
  // ---- SPEC-CORE-009 封面内容可追溯 ----
  {
    criterion: 'AC-CORE-009',
    description: '封面元信息卡塞入与 outline 无关的固定文案',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: "        title: bound.meta?.['visualIntent'] ?? outline.visualIntent,",
    replace: "        title: 'AI PPT STUDIO 演示项目',",
    testFile: 'spec/verify/core-content.test.ts',
    testName: 'cover-content-traceable-to-outline',
  },
  // ---- SPEC-CORE-010 渲染随输入改变 ----
  {
    criterion: 'AC-CORE-010',
    description: '要点来源被固定成常量（渲染结果与输入无关）',
    file: 'packages/core/src/engine/contentBinding.ts',
    find: '  const bullets = c.bullets?.length ? c.bullets : contentBullets(outline);',
    replace: "  const bullets = c.bullets?.length ? c.bullets : ['固定演示文案'];",
    testFile: 'spec/verify/core-content.test.ts',
    testName: 'render-output-follows-outline-bullets',
  },
  // ---- SPEC-RND-001 XML 转义 ----
  {
    criterion: 'AC-RND-001',
    description: '文本内容不再转义',
    file: 'packages/core/src/engine/svgRenderer.ts',
    find: '      inner += escapeXml(single ? block.text : line);',
    replace: '      inner += single ? block.text : line;',
    testFile: 'spec/verify/render-svg.test.ts',
    testName: 'user-content-is-xml-escaped',
  },
  // ---- SPEC-RND-002 去 foreignObject ----
  {
    criterion: 'AC-RND-002',
    description: '卡片渲染重新引入 foreignObject',
    file: 'packages/core/src/engine/svgRenderer.ts',
    find:
      '      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1" filter="url(#card-shadow)"/>',
    replace:
      '      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1" filter="url(#card-shadow)"/>\n' +
      '      <foreignObject x="${x}" y="${y}" width="${width}" height="${height}"/>',
    testFile: 'spec/verify/render-svg.test.ts',
    testName: 'svg-contains-no-foreignobject',
  },
  // ---- SPEC-RND-003 去外链字体 ----
  {
    criterion: 'AC-RND-003',
    description: 'SVG 重新引入 Google Fonts @import',
    file: 'packages/core/src/engine/svgRenderer.ts',
    find: '    <style>\n      text {',
    replace:
      "    <style>\n      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;700');\n      text {",
    testFile: 'spec/verify/render-svg.test.ts',
    testName: 'svg-contains-no-external-font-import',
  },
  // ---- SPEC-RND-004 保留元素 ID ----
  {
    criterion: 'AC-RND-004',
    description: '不再输出元素的 id 属性（只留 data-element-id 顶替）',
    file: 'packages/core/src/engine/svgRenderer.ts',
    find: 'const commonAttrs = `id="${escapeXml(el.id)}" data-element-id="${escapeXml(el.id)}"',
    replace: 'const commonAttrs = `data-element-id="${escapeXml(el.id)}"',
    testFile: 'spec/verify/render-svg.test.ts',
    testName: 'svg-preserves-element-ids',
  },
  {
    criterion: 'AC-RND-004',
    description: 'data-element-id 的值与 IR id 不一致',
    file: 'packages/core/src/engine/svgRenderer.ts',
    find: 'data-element-id="${escapeXml(el.id)}"',
    replace: 'data-element-id="stale-id"',
    testFile: 'spec/verify/render-svg.test.ts',
    testName: 'svg-preserves-element-ids',
  },
  // ---- SPEC-RND-005 四层结构 ----
  {
    criterion: 'AC-RND-005',
    description: '把装饰层改名，破坏四层约定',
    file: 'packages/core/src/engine/svgRenderer.ts',
    find: '<g id="decoration-layer" data-layer-name="decoration">',
    replace: '<g id="ornament-layer" data-layer-name="decoration">',
    testFile: 'spec/verify/render-svg.test.ts',
    testName: 'svg-has-four-layers',
  },
  // ---- SPEC-QLT-001 质量分公式 ----
  {
    criterion: 'AC-QLT-001',
    description: '把内容分权重从 0.2 改成 0.4',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: '0.3 * structureScore + 0.3 * visualScore + 0.2 * contentScore + 0.2 * consistencyScore',
    replace: '0.3 * structureScore + 0.3 * visualScore + 0.4 * contentScore + 0.0 * consistencyScore',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'quality-formula-weights',
  },
  // ---- SPEC-QLT-002 画布惩罚 ----
  {
    criterion: 'AC-QLT-002',
    description: '画布尺寸不符不再扣 15 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalStructurePenalties += 15;\n        issues.push({\n          id: `struct_dim_',
    replace: 'totalStructurePenalties += 0;\n        issues.push({\n          id: `struct_dim_',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'canvas-mismatch-penalty',
  },
  // ---- SPEC-QLT-003 重复 ID 惩罚 ----
  {
    criterion: 'AC-QLT-003',
    description: '重复元素 ID 不再扣 5 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalStructurePenalties += 5;',
    replace: 'totalStructurePenalties += 0;',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'duplicate-id-penalty',
  },
  // ---- SPEC-QLT-004 越界惩罚 ----
  {
    criterion: 'AC-QLT-004',
    description: '几何越界不再扣视觉分 10 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalVisualPenalties += 10;',
    replace: 'totalVisualPenalties += 0;',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'out-of-bounds-penalty',
  },
  // ---- SPEC-QLT-005 AABB 碰撞 ----
  {
    criterion: 'AC-QLT-005',
    description: '卡片碰撞不再扣视觉分 8 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalVisualPenalties += 8;',
    replace: 'totalVisualPenalties += 0;',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'aabb-collision-penalty',
  },
  // ---- SPEC-QLT-006 标题惩罚 ----
  {
    criterion: 'AC-QLT-006',
    description: '标题过短不再扣内容分 15 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalContentPenalties += 15;',
    replace: 'totalContentPenalties += 0;',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'missing-title-penalty',
  },
  // ---- SPEC-QLT-007 核心结论惩罚 ----
  {
    criterion: 'AC-QLT-007',
    description: '核心结论缺失不再扣内容分 8 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalContentPenalties += 8;',
    replace: 'totalContentPenalties += 0;',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'missing-keymessage-penalty',
  },
  // ---- SPEC-QLT-008 一致性惩罚 ----
  {
    criterion: 'AC-QLT-008',
    description: '页数不足不再扣一致性分 15 分',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'totalConsistencyPenalties += 15;',
    replace: 'totalConsistencyPenalties += 0;',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'consistency-penalties',
  },
  // ---- SPEC-QLT-010 自动修复 ID 重排 ----
  {
    criterion: 'AC-QLT-010',
    description: '自动修复不再重排元素 ID（保留重复 ID）',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find: 'el.id = `${el.type}_${slide.slideId}_${eIdx}`;',
    replace: '// mutation: 不再重排 ID',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'autofix-restores-id-uniqueness',
  },
  // ---- SPEC-EXP-002 演讲者备注 ----
  {
    criterion: 'AC-EXP-002',
    description: '不再写入演讲者备注',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: 'pptSlide.addNotes(slideIR.speakerNotes);',
    replace: '// mutation: 不写备注',
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'pptx-includes-speaker-notes',
  },
  // ---- SPEC-EXP-003 PNG 2 倍 ----
  {
    criterion: 'AC-EXP-003',
    description: 'PNG 光栅化改成 1 倍分辨率',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: 'canvas.width = 1920 * 2; // 2x retina',
    replace: 'canvas.width = 1920;',
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'png-export-is-2x',
  },
  // ---- SPEC-EXP-001 PPTX 文本保真 ----
  {
    criterion: 'AC-EXP-001',
    description: '指标卡的大数字不再导出（正文丢失）',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: '    push(c.value, { fontSize: pt(CONTENT_TYPE_SCALE.value), bold: true, color: primary });',
    replace: '    // mutation: 指标数值不导出',
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'pptx-preserves-ir-text-content',
  },
  {
    criterion: 'AC-EXP-001',
    description: '两个 IR 字符串被拼进同一个文本运行（串行）',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: '    pushAll(c.items, { fontSize: pt(CONTENT_TYPE_SCALE.item), color: textSecondary });',
    replace: "    push((c.items as string[]).join(' '), { fontSize: pt(CONTENT_TYPE_SCALE.item), color: textSecondary });",
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'pptx-preserves-ir-text-content',
  },
  {
    criterion: 'AC-EXP-001',
    description: '导出时凭空追加固定文案（多出非 IR 文本）',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: '    runs.push({ text: value, options: { ...options, breakLine: true } });',
    replace: "    runs.push({ text: value + ' · AI PPT STUDIO', options: { ...options, breakLine: true } });",
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'pptx-preserves-ir-text-content',
  },
  // ---- SPEC-EXP-004 文件名清洗与扩展名 ----
  {
    criterion: 'AC-EXP-004',
    description: '文件名不再剥离空白与非法字符',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: "    .replace(ILLEGAL_FILENAME_CHARS, '_')",
    replace: '    // mutation: 不清洗文件名',
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'export-filename-sanitized',
  },
  {
    criterion: 'AC-EXP-004',
    description: 'SVG 文件名丢掉扩展名',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: '`${sanitizeFilename(slide.title)}_${sanitizeFilename(slide.slideId)}.svg`',
    replace: '`${sanitizeFilename(slide.title)}_${sanitizeFilename(slide.slideId)}`',
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'export-filename-sanitized',
  },
  {
    criterion: 'AC-EXP-004',
    description: 'JSON 文件名丢掉扩展名',
    file: 'packages/core/src/engine/exportEngine.ts',
    find: '`${sanitizeFilename(project.name)}_slide_ir.json`',
    replace: '`${sanitizeFilename(project.name)}_slide_ir`',
    testFile: 'spec/verify/export-pptx.test.ts',
    testName: 'export-filename-sanitized',
  },
  // ---- SPEC-EXP-005 导出 → 导入 往返不丢页序 ----
  {
    criterion: 'AC-EXP-005',
    description: '导入时把页序整体倒过来 —— 导出去能再导回来，但回来的页序是反的',
    file: 'apps/api/src/services/projectService.ts',
    find:
      '    await db.db.insert(slides).values({\n' +
      '      projectId: created.id,\n' +
      '      slideId: s.slideId,\n' +
      '      orderIndex: s.orderIndex,',
    replace:
      '    await db.db.insert(slides).values({\n' +
      '      projectId: created.id,\n' +
      '      slideId: s.slideId,\n' +
      '      orderIndex: (bundle.slides?.length ?? 0) - s.orderIndex + 1,',
    testFile: 'apps/api/tests/integration/import-bundle.test.ts',
    testName: 'exported-bundle-round-trips-with-page-order-intact',
  },
  // ---- SPEC-EXP-006 导入端必须校验 bundle 形状 ----
  {
    criterion: 'AC-EXP-006',
    description: 'orderIndex 的下界校验被拆掉 —— 0 / 负数能落库，违反内核契约 order >= 1',
    file: 'apps/api/src/routes/projects.ts',
    find: '  orderIndex: z.number().int().min(1),',
    replace: '  orderIndex: z.number().int(),',
    testFile: 'apps/api/tests/integration/import-bundle.test.ts',
    testName: 'zero-order-index-is-rejected',
  },
  {
    criterion: 'AC-EXP-006',
    description: 'orderIndex 唯一性校验被拆掉 —— 排序键重复，页序静默随机化',
    file: 'apps/api/src/routes/projects.ts',
    find: '      const prevOrder = byOrder.get(s.orderIndex);',
    replace: '      const prevOrder = undefined;',
    testFile: 'apps/api/tests/integration/import-bundle.test.ts',
    testName: 'duplicate-order-index-is-rejected',
  },
  {
    criterion: 'AC-EXP-006',
    description: 'slides 字段不再必填 —— 缺 slides 的文件被当成空项目导进去',
    file: 'apps/api/src/routes/projects.ts',
    find: '  slides: ImportSlidesSchema,\n});',
    replace: '  slides: ImportSlidesSchema.optional(),\n});',
    testFile: 'apps/api/tests/integration/import-bundle.test.ts',
    testName: 'missing-slides-field-is-rejected',
  },
  // ---- SPEC-QLT-009 自动修复不制造越界 ----
  {
    criterion: 'AC-QLT-009',
    description: '自动修复不再收窄超宽元素（修复后仍然越界）',
    file: 'packages/core/src/engine/qualityEngine.ts',
    find:
      '          if (el.geometry.x + el.geometry.width > SAFE_RIGHT) {\n' +
      '            el.geometry.width = Math.max(1, SAFE_RIGHT - el.geometry.x);\n' +
      '          }',
    replace: '          // mutation: 不收窄超宽元素',
    testFile: 'spec/verify/quality-engine.test.ts',
    testName: 'autofix-restores-bounds',
  },

  /* ====================================================================== */
  /* 后端 —— 响应包封 / 权限 / 安全 / 降级 / 延迟                          */
  /* ====================================================================== */

  // ---- SPEC-API-001 成功包封必须带 traceId ----
  {
    criterion: 'AC-API-001',
    description: '成功响应不再带 traceId',
    file: 'apps/api/src/errors.ts',
    find: 'export function ok<T>(data: T, traceId: string): { data: T; traceId: string } {\n  return { data, traceId };\n}',
    replace:
      'export function ok<T>(data: T, traceId: string): { data: T; traceId: string } {\n' +
      '  return { data } as { data: T; traceId: string };\n' +
      '}',
    testFile: 'apps/api/tests/contract/response-envelope.test.ts',
    testName: 'success-response-envelope',
  },
  // ---- SPEC-API-006 失败包封必须是 { error, traceId } ----
  {
    criterion: 'AC-API-006',
    description: '失败响应的 error 字段被换成 data',
    file: 'apps/api/src/errors.ts',
    find:
      '  return {\n' +
      '    error: details ? { code, message, details } : { code, message },\n' +
      '    traceId,\n' +
      '  };',
    replace:
      '  return {\n' +
      '    data: details ? { code, message, details } : { code, message },\n' +
      '    traceId,\n' +
      '  } as never;',
    testFile: 'apps/api/tests/contract/response-envelope.test.ts',
    testName: 'failure-response-envelope',
  },
  // ---- SPEC-API-007 错误码是封闭枚举（不增不减） ----
  {
    criterion: 'AC-API-007',
    description: '错误码枚举被偷偷加了一个 INTERNAL_ERROR',
    file: 'apps/api/src/errors.ts',
    find: "  'RATE_LIMITED',\n] as const;",
    replace: "  'RATE_LIMITED',\n  'INTERNAL_ERROR',\n] as const;",
    testFile: 'apps/api/tests/contract/response-envelope.test.ts',
    testName: 'error-codes-closed-enum',
  },
  // ---- SPEC-API-002 乐观并发 ----
  {
    criterion: 'AC-API-002',
    description: '乐观并发守卫被拆掉（前置检查 + SQL 条件同时失效）',
    file: 'apps/api/src/services/slideService.ts',
    find:
      '  if (current.versionId !== opts.baseVersionId) {\n' +
      "    throw ApiError.versionConflict('内容已被他人修改，请刷新后重试', {\n" +
      '      currentVersionId: current.versionId,\n' +
      '      expectedVersionId: opts.baseVersionId,\n' +
      '    });\n' +
      '  }',
    replace: '  // mutation: 去掉乐观并发前置检查',
    extraEdits: [
      {
        find:
          '        eq(slides.projectId, opts.projectId),\n' +
          '        eq(slides.slideId, opts.slideId),\n' +
          '        eq(slides.versionId, opts.baseVersionId)',
        replace:
          '        eq(slides.projectId, opts.projectId),\n' +
          '        eq(slides.slideId, opts.slideId)',
      },
    ],
    testFile: 'apps/api/tests/integration/optimistic-lock.test.ts',
    testName: 'same-base-version-second-write-conflicts',
  },
  // ---- SPEC-API-003 跨租户访问必须 404 ----
  {
    criterion: 'AC-API-003',
    description: '项目查询不再带 userId 条件（跨租户可读）',
    file: 'apps/api/src/middleware/auth.ts',
    find: 'and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt))',
    replace: 'and(eq(projects.id, id), isNull(projects.deletedAt))',
    testFile: 'apps/api/tests/security/cross-tenant-access.test.ts',
    testName: 'cross-tenant-resource-read-is-404',
  },
  // ---- SPEC-API-004 模型输出必须过 Schema ----
  {
    criterion: 'AC-API-004',
    description: '模型输出跳过 Schema 校验直接进系统',
    file: 'apps/api/src/services/modelRouter.ts',
    find:
      '            if (req.parse) {\n' +
      '              const validated = req.parse.safeParse(parsed.value);',
    replace:
      '            if (req.parse) {\n' +
      '              const validated = { success: true, data: parsed.value } as any;',
    extraEdits: [
      {
        file: 'apps/api/src/services/agents/outlineAgent.ts',
        find: '      const validated = outline.map((o) => SlideOutlineItemSchema.parse(o));',
        replace: '      const validated = outline as SlideOutlineItem[];',
      },
    ],
    testFile: 'apps/api/tests/security/ai-output-validation.test.ts',
    testName: 'invalid-model-output-rejected-and-not-persisted',
  },
  // ---- SPEC-API-005 缺密钥必须启动失败 ----
  {
    criterion: 'AC-API-005',
    description: '启动失败时以退出码 0 结束（缺密钥也"启动成功"）',
    file: 'apps/api/src/index.ts',
    find: '  process.exit(1);',
    replace: '  process.exit(0); // mutation: 启动失败却返回成功退出码',
    testFile: 'apps/api/tests/security/secret-handling.test.ts',
    testName: 'missing-api-key-fails-startup',
  },
  // ---- SPEC-SEC-001 密码必须 argon2id 哈希 ----
  {
    criterion: 'AC-SEC-001',
    description: '密码按明文入库',
    file: 'apps/api/src/services/authService.ts',
    find: "  return Bun.password.hash(password, { algorithm: 'argon2id' });",
    replace: '  return password; // mutation: 明文存储',
    testFile: 'apps/api/tests/security/password-hashing.test.ts',
    testName: 'password-stored-as-argon2id-hash',
  },
  // ---- SPEC-SEC-003 校验密码必须拒错 ----
  {
    criterion: 'AC-SEC-003',
    description: '密码校验永远返回 true（任何密码都登录成功）',
    file: 'apps/api/src/services/authService.ts',
    find: '  return Bun.password.verify(password, hash);',
    replace: '  return true; // mutation: 任何密码都通过',
    testFile: 'apps/api/tests/security/password-hashing.test.ts',
    testName: 'password-verify-accepts-correct-and-rejects-wrong',
  },
  // ---- SPEC-SEC-002 Cookie 安全属性 ----
  {
    criterion: 'AC-SEC-002',
    description: '会话 Cookie 不再带 HttpOnly',
    file: 'apps/api/src/services/authService.ts',
    find:
      '  setCookie(c, opts.cookieName, sessionId, {\n' +
      '    httpOnly: true,\n' +
      "    sameSite: 'Lax',\n" +
      "    path: '/',\n" +
      '    secure: opts.isProduction,\n' +
      '    maxAge: opts.maxAgeSeconds,\n' +
      '  });',
    replace:
      '  setCookie(c, opts.cookieName, sessionId, {\n' +
      '    httpOnly: false,\n' +
      "    sameSite: 'Lax',\n" +
      "    path: '/',\n" +
      '    secure: opts.isProduction,\n' +
      '    maxAge: opts.maxAgeSeconds,\n' +
      '  });',
    testFile: 'apps/api/tests/security/session-cookie.test.ts',
    testName: 'session-cookie-has-security-attributes',
  },
  // ---- SPEC-SEC-004 生产环境必须带 Secure ----
  {
    criterion: 'AC-SEC-004',
    description: '生产环境也不给 Cookie 加 Secure',
    file: 'apps/api/src/services/authService.ts',
    find:
      '    httpOnly: true,\n' +
      "    sameSite: 'Lax',\n" +
      "    path: '/',\n" +
      '    secure: opts.isProduction,\n' +
      '    maxAge: opts.maxAgeSeconds,',
    replace:
      '    httpOnly: true,\n' +
      "    sameSite: 'Lax',\n" +
      "    path: '/',\n" +
      '    secure: false,\n' +
      '    maxAge: opts.maxAgeSeconds,',
    testFile: 'apps/api/tests/security/session-cookie.test.ts',
    testName: 'session-cookie-secure-in-production',
  },
  // ---- SPEC-SEC-005 Session ID 必须 32 字节 ----
  {
    criterion: 'AC-SEC-005',
    description: 'Session ID 只有 16 字节（熵减半）',
    file: 'apps/api/src/services/authService.ts',
    find: '  const bytes = new Uint8Array(32);',
    replace: '  const bytes = new Uint8Array(16); // mutation: session id 只有 16 字节',
    testFile: 'apps/api/tests/security/session-cookie.test.ts',
    testName: 'session-id-is-32-byte-base64url',
  },
  // ---- SPEC-NFR-003 模型不可用必须降级 ----
  {
    criterion: 'AC-NFR-003',
    description: '模型不可用时不再降级（直接把 503 抛给用户）',
    file: 'apps/api/src/services/agents/outlineAgent.ts',
    find: '      if (err instanceof ModelUnavailableError) {',
    replace: '      if (false && err instanceof ModelUnavailableError) {',
    testFile: 'apps/api/tests/chaos/model-fallback.test.ts',
    testName: 'model-unavailable-falls-back-with-valid-outline',
  },
  // ---- SPEC-NFR-004 降级实现必须按 topic 动态生成 ----
  {
    criterion: 'AC-NFR-004',
    description: '降级大纲对所有主题返回同一份（回到旧 fallback 的老毛病）',
    file: 'apps/api/src/services/agents/localOutline.ts',
    find:
      '  const terms = parseTopic(ctx.topic);\n' +
      '  const lex = pickLexicon(ctx.topic);',
    replace:
      "  const terms = parseTopic('企业 AI Agent 技术架构规划');\n" +
      "  const lex = pickLexicon('企业 AI Agent 技术架构规划');",
    testFile: 'apps/api/tests/chaos/model-fallback.test.ts',
    testName: 'fallback-outline-varies-by-topic',
  },
  // ---- SPEC-NFR-002 导出 P95 ----
  {
    criterion: 'AC-NFR-002',
    description: '导出出现长尾（第 19、20 次耗时 46s）—— 判据必须抓长尾，而不是只看中位数',
    file: 'apps/api/src/services/exportService.ts',
    find:
      '): Promise<RenderedExport> {\n' +
      '  const slides = selectSlides(project, scope);',
    replace:
      '): Promise<RenderedExport> {\n' +
      '  // mutation: 导出长尾 —— 只有第 19、20 次变慢，中位数不受影响\n' +
      '  const g = globalThis as { __mutExportCount?: number };\n' +
      '  g.__mutExportCount = (g.__mutExportCount ?? 0) + 1;\n' +
      "  if (g.__mutExportCount === 19 || g.__mutExportCount === 20) await Bun.sleep(46_000);\n" +
      '  const slides = selectSlides(project, scope);',
    testFile: 'apps/api/tests/perf/export-latency.bench.ts',
    testName: 'pptx-export-p95-under-threshold',
  },
  // ---- SPEC-IRP-001 AI 编辑只回增量补丁 ----
  {
    criterion: 'AC-IRP-001',
    description: 'AI 编辑响应里额外返回 updatedElements（违反「只回增量补丁」的契约）',
    file: 'apps/api/src/routes/ai.ts',
    // 锚点必须唯一定位到 **/suggest** 路由 —— 验的也是这个路由。
    // 只写 `patches: result.patches,` 的话它在 /edit-slide 里也有一份，
    // 注入会改到另一条路由上去（见下面的「锚点必须唯一」检查）。
    find: `  if (result.patches.length === 0) {
    throw ApiError.modelOutputInvalid('模型未产出任何可用补丁');
  }

  return respond(c, {
    patches: result.patches,
    message: result.message,`,
    replace: `  if (result.patches.length === 0) {
    throw ApiError.modelOutputInvalid('模型未产出任何可用补丁');
  }

  return respond(c, {
    patches: result.patches,
    updatedElements: [],
    message: result.message,`,
    testFile: 'apps/api/tests/ai/edit-slide.test.ts',
    testName: 'returns-patches-not-full-elements',
  },
  // ---- SPEC-IRP-002 补丁施加幂等 ----
  {
    criterion: 'AC-IRP-002',
    description: 'add_element 不再对已存在的同 id 元素做幂等处理（施加两次会重复插入）',
    file: 'packages/core/src/engine/patchApplier.ts',
    find: '      if (sameElement(existing, element, !specifiesZIndex(item))) continue;',
    replace: '      slide.elements.push(element);\n      continue;',
    testFile: 'packages/core/tests/patchApplier.test.ts',
    testName: 'apply-is-idempotent',
  },
  // ---- SPEC-IRP-003 删不存在的元素必须报错 ----
  {
    criterion: 'AC-IRP-003',
    description: 'remove_element 指向不存在的元素时静默返回（不再报错）',
    file: 'packages/core/src/engine/patchApplier.ts',
    find:
      "  throw new PatchApplyError('UNKNOWN_ELEMENT', `remove_element 指向不存在的元素：${targetId}`, {\n" +
      '    targetId,\n' +
      '  });',
    replace: '  return;',
    testFile: 'packages/core/tests/patchApplier.test.ts',
    testName: 'remove-missing-element-throws',
  },
  // ---- SPEC-API-005 密钥不出现在响应体里 ----
  {
    criterion: 'AC-API-008',
    description: '/api/meta/models 把 API Key 原样返回（密钥泄漏到响应体）',
    file: 'apps/api/src/routes/system.ts',
    find: "  const hasKey = Boolean(process.env['GEMINI_API_KEY']);",
    replace:
      "  const hasKey = Boolean(process.env['GEMINI_API_KEY']);\n" +
      "  const leakedKey = process.env['GEMINI_API_KEY'];",
    extraEdits: [
      {
        find: '        available: hasKey,',
        replace: '        available: hasKey,\n        apiKey: leakedKey,',
      },
    ],
    testFile: 'apps/api/tests/security/secret-handling.test.ts',
    testName: 'secret-never-leaks-into-responses-or-logs',
  },
  // ---- SPEC-GOV-001 覆盖率门禁 ----
  {
    criterion: 'AC-GOV-001',
    description: '把覆盖率门槛从 90 抬到 99（门禁再也拦不住低覆盖率）',
    file: 'scripts/check-coverage.ts',
    find: 'const THRESHOLD = 90;',
    replace: 'const THRESHOLD = 99;',
    testFile: 'scripts/check-coverage.check.ts',
    testName: 'domain-coverage-threshold',
  },
  {
    criterion: 'AC-GOV-001',
    description: '取消「一个领域内核文件都没采到 → 未通过」的守卫（无法判定被当成通过）',
    file: 'scripts/check-coverage.ts',
    find:
      '  if (core.length === 0) {\n' +
      '    console.error(\n' +
      '      `[coverage] ✗ 覆盖率报告里没有任何 ${CORE_ENGINE_DIR}/ 下的文件 —— 无法判定覆盖率，按未通过处理`\n' +
      '    );\n' +
      "    console.error(`[coverage]   （采到的文件共 ${all.length} 个，示例：${all.slice(0, 5).map((f) => f.file).join(', ') || '无'}）`);\n" +
      '    return 1;\n' +
      '  }',
    replace: '  if (core.length === 0) {\n    return 0;\n  }',
    testFile: 'scripts/check-coverage.check.ts',
    testName: 'domain-coverage-threshold',
  },
  // ---- SPEC-GOV-002 黄金快照 ----
  {
    criterion: 'AC-GOV-002',
    description: '版式引擎把标题字号从 38 改成 39（实现与快照基线漂移）',
    file: 'packages/core/src/engine/layoutEngine.ts',
    find: '          fontSize: 38,',
    replace: '          fontSize: 39,',
    testFile: 'packages/core/tests/layoutEngine.snapshot.test.ts',
    testName: 'golden-snapshots-all-match',
  },

  // =======================================================================
  // 前后端集成（E2E）—— 整文件跑，见 Mutation.wholeFile 的说明
  // =======================================================================
  // ---- SPEC-E2E-007 重命名必须落库 ----
  {
    criterion: 'AC-E2E-012',
    description: '重命名时把 name 覆盖回旧值（改名静默不生效）',
    file: 'apps/api/src/services/projectService.ts',
    find: '    .set({ ...patch, updatedAt: new Date() })',
    replace: '    .set({ ...patch, name: existing.name, updatedAt: new Date() })',
    testFile: 'e2e/projects.e2e.ts',
    testName: 'AC-E2E-012 重命名项目 → 服务端存的是新名字',
  },
  // ---- SPEC-E2E-007 删除必须落库 ----
  {
    criterion: 'AC-E2E-013',
    description: '删除项目时不写 deleted_at（软删除没落库）',
    file: 'apps/api/src/services/projectService.ts',
    find: '    .set({ deletedAt: new Date(), updatedAt: new Date() })',
    replace: '    .set({ updatedAt: new Date() })',
    testFile: 'e2e/projects.e2e.ts',
    testName: 'AC-E2E-013 删除项目 → 服务端真的删掉了（且列表里也没有）',
  },
  // ---- SPEC-E2E-006 跨租户隔离 ----
  {
    criterion: 'AC-E2E-011',
    description: '项目查询不再带 userId 条件（浏览器链路上跨租户可读）',
    file: 'apps/api/src/middleware/auth.ts',
    find: 'and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt))',
    replace: 'and(eq(projects.id, id), isNull(projects.deletedAt))',
    testFile: 'e2e/projects.e2e.ts',
    testName: 'AC-E2E-011 跨租户隔离 → 别人的项目拿不到（404 而不是 403）',
  },

  // ---- SPEC-E2E-001 注册必须签发可用的会话 ----
  {
    criterion: 'AC-E2E-001',
    description: '会话不落库（Cookie 签发了，服务端却不认这个会话）',
    file: 'apps/api/src/services/authService.ts',
    find: '  await db.db.insert(sessions).values({ id, userId, expiresAt });',
    replace:
      "  await db.db.insert(sessions).values({\n" +
      "    id: '00000000-0000-0000-0000-000000000000',\n" +
      '    userId,\n' +
      '    expiresAt,\n' +
      '  });',
    testFile: 'e2e/auth.e2e.ts',
    testName: 'AC-E2E-001 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台',
  },
  // ---- SPEC-E2E-001 项目必须落库且归属当前用户 ----
  {
    criterion: 'AC-E2E-002',
    description: '新建项目时归属写成了别的用户（项目不落在当前用户名下）',
    file: 'apps/api/src/services/projectService.ts',
    find: '    .values({\n      userId,\n      name: input.name,',
    replace:
      "    .values({\n" +
      "      userId: '00000000-0000-0000-0000-000000000000',\n" +
      '      name: input.name,',
    testFile: 'e2e/projects.e2e.ts',
    testName: 'AC-E2E-002 新建项目 → 服务端库里真的有这条项目，且归属当前用户',
  },
  // ---- SPEC-E2E-002 大纲必须跟着主题走 ----
  {
    criterion: 'AC-E2E-003',
    description: '解析主题时忽略用户输入（大纲不再随主题变化）',
    file: 'apps/api/src/services/agents/topicTerms.ts',
    find: "export function parseTopic(topic: string): TopicTerms {\n  const original = (topic ?? '').trim();",
    replace:
      "export function parseTopic(topic: string): TopicTerms {\n" +
      "  const original = '通用主题';",
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-003 生成大纲 → 页数、主题、服务端与 UI 一致',
  },
  // ---- SPEC-E2E-002 大纲编辑必须落库 ----
  {
    criterion: 'AC-E2E-004',
    description: '项目 PATCH 忽略前端提交的大纲（编辑静默不生效）',
    file: 'apps/api/src/routes/projects.ts',
    // 前端保存大纲走的是 **PATCH /api/projects/:id**（src/services/projectStorage.ts
    // 的 updateProject），不是 PATCH /api/projects/:id/outline ——
    // 改错路由的话注入根本不在被测路径上（这个坑踩过一次）。
    find: '    ...(body.outline !== undefined ? { outline: body.outline as never } : {}),',
    replace:
      "    ...(body.outline !== undefined\n" +
      "      ? { outline: c.get('project')!.outline as never }\n" +
      '      : {}),',
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-004 改大纲标题 → 服务端存新标题，UI 也显示新标题',
  },
  // ---- SPEC-E2E-002 工作台必须渲染服务端的 IR ----
  //
  // 这条注入改的是**前端**（src/components/Workbench.tsx）——
  // 单元测试覆盖不到 React 组件，只有浏览器 E2E 能发现"界面画的不是服务端那份"。
  {
    criterion: 'AC-E2E-005',
    description: '工作台画布的标题被写死（界面渲染的不是服务端返回的 IR）',
    file: 'src/components/Workbench.tsx',
    find: 'data-slide-title={currentSlide.title}',
    replace: 'data-slide-title="占位标题"',
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-005 确认大纲并编译 → 画布渲染的正是服务端那份 IR',
  },
  // ---- SPEC-E2E-003 编辑必须写回服务端并生成新版本 ----
  {
    criterion: 'AC-E2E-006',
    description: '写回时不生成新版本号（乐观锁失效）',
    file: 'apps/api/src/services/slideService.ts',
    find: '    .set({ ir, versionId, updatedAt: new Date() })',
    replace: '    .set({ ir, updatedAt: new Date() })',
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-006 就地改文本 → 防抖写回服务端，并产生新版本号',
  },
  // ---- SPEC-E2E-003 陈旧版本必须被拒 ----
  //
  // 乐观锁是**两处协同**的守卫：前置检查 + SQL 条件。
  // 只拆掉一处，另一处照样挡住 —— 那不是代表性错误。
  {
    criterion: 'AC-E2E-007',
    description: '乐观锁守卫被拆掉（前置检查 + SQL 条件同时失效）',
    file: 'apps/api/src/services/slideService.ts',
    find: '  if (current.versionId !== opts.baseVersionId) {',
    replace: '  if (current.versionId !== current.versionId) {',
    extraEdits: [
      {
        find:
          '        eq(slides.slideId, opts.slideId),\n' +
          '        eq(slides.versionId, opts.baseVersionId)',
        replace: '        eq(slides.slideId, opts.slideId)',
      },
    ],
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-007 两个会话改同一页 → 后者收到 409，前端提示且没覆盖服务端',
  },
  // ---- SPEC-E2E-004 AI 补丁必须真的被施加 ----
  {
    criterion: 'AC-E2E-008',
    description: 'IRPatch 施加时被丢弃（服务端没改内容）',
    file: 'apps/api/src/services/slideService.ts',
    find: '  const next = applyPatches(current.ir, patches);',
    replace: '  const next = current.ir;',
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘',
  },
  // ---- SPEC-E2E-005 导出必须是真 PPTX ----
  {
    criterion: 'AC-E2E-009',
    description: 'PPTX 产物被替换成假字节（不是真的 PPTX）',
    file: 'apps/api/src/services/exportService.ts',
    find: '      const bytes = await ExportEngine.exportPresentationAsPptxBuffer(project, undefined);',
    replace: "      const bytes = new TextEncoder().encode('not-a-real-pptx');",
    testFile: 'e2e/exports.e2e.ts',
    testName: 'AC-E2E-009 PPTX 导出 → 产物是真正的 OOXML，而且里面是这份文稿',
  },
  // ---- SPEC-E2E-005 导出 PDF 必须是真 PDF ----
  {
    criterion: 'AC-E2E-010',
    description: 'PDF 产物被替换成假字节（不是真的 PDF）',
    file: 'apps/api/src/services/exportService.ts',
    find: "      const out = pdf.output('arraybuffer');",
    replace:
      "      const out = new TextEncoder().encode('not a real pdf').buffer as ArrayBuffer;",
    testFile: 'e2e/exports.e2e.ts',
    testName: 'AC-E2E-010 PDF 导出 → 产物是真正的 PDF（%PDF 魔数）',
  },

  // ---- SPEC-E2E-008 模板必须真的落到服务端 ----
  //
  // 这一条注入盯的是"应用模板"这个动作的**服务端**：
  // 服务端查到了模板、查到了项目，却没把模板写回项目 ——
  // 接口返回 200，界面上"使用中"的标记也变了（前端本地 state），
  // 但服务端存的还是旧模板。刷新一下就露馅。
  {
    criterion: 'AC-E2E-014',
    description: '应用模板时不写回项目（接口说成功，服务端存的还是旧模板）',
    file: 'apps/api/src/routes/templates.ts',
    find: "  const updated = await updateProject(c.get('db'), userId, project.id, { template: ir });",
    replace:
      "  const updated = await updateProject(c.get('db'), userId, project.id, {\n" +
      '    template: project.template ?? (ir as never),\n' +
      '  });',
    testFile: 'e2e/templates.e2e.ts',
    testName: '应用模板 → 服务端存的是新模板，刷新后仍然是它',
  },
  // ---- SPEC-E2E-008 浏览器链路上的模板应用 ----
  //
  // 同一个判据的**前端**侧：应用模板时前端只改本地 state、不落服务端。
  // 这正是"刷新一下就回到旧模板"那个 bug 的原型。
  {
    criterion: 'AC-E2E-014',
    description: '前端应用模板时只改本地 state，不落服务端',
    file: 'src/App.tsx',
    find: '        const updated = await ProjectStorage.applyTemplate(currentProject.id, t.templateId);',
    replace: '        const updated = { ...currentProject, template: t };',
    testFile: 'e2e/templates.e2e.ts',
    testName: '应用模板 → 服务端存的是新模板，刷新后仍然是它',
  },
  // ---- SPEC-E2E-008 模板应用的失败路径 ----
  //
  // **假成功**：服务端拒绝了（模板不存在 → 404），前端却把本地模板换成了新的。
  // 界面显示"当前使用"的是新模板，服务端存的还是旧的 —— 刷新一下就露馅。
  // 这条注入盯的正是它。
  {
    criterion: 'AC-E2E-020',
    description: '应用模板失败时前端仍然乐观换成本地模板（假成功）',
    file: 'src/App.tsx',
    find:
      '      } catch (err) {\n' +
      '        setTemplateNotice(`模板更新失败：${describeError(err)}`);\n' +
      '        return false;\n' +
      '      }',
    replace:
      '      } catch (err) {\n' +
      '        setTemplateNotice(`模板更新失败：${describeError(err)}`);\n' +
      '        // 注入：失败也把本地模板换掉 —— 假成功\n' +
      '        applyProjects((prev) =>\n' +
      '          prev.map((p) => (p.id === currentProject.id ? { ...p, template: t } : p))\n' +
      '        );\n' +
      '        return false;\n' +
      '      }',
    testFile: 'e2e/templates.e2e.ts',
    testName: '应用不存在的模板 → 界面如实报错，服务端模板不被改动',
  },
  // ---- SPEC-E2E-012 外部资源不可达时应用仍能启动 ----
  //
  // 把字体样式表改回**渲染阻塞**：外部 CDN 不可达时，
  // pending 的样式表会连带阻塞脚本执行 ⇒ React 挂不上 ⇒ 白屏。
  // 这正是这次 E2E 挂死事故的原型。
  {
    criterion: 'AC-E2E-022',
    description: '把外部字体样式表改回渲染阻塞（CDN 不可达时白屏）',
    file: 'index.html',
    find:
      '      rel="stylesheet"\n' +
      '      media="print"\n' +
      "      onload=\"this.media='all'\"\n",
    replace: '      rel="stylesheet"\n',
    testFile: 'e2e/offline.e2e.ts',
    testName: '外部资源被挂起 → 外壳仍在 8 秒内渲染出来',
  },

  // ---- SPEC-E2E-004 AI 补丁必须**画得出来** ----
  //
  // 只断言"服务端 IR 变了"是不够的：渲染器装不下的文本块会被整块丢弃 ——
  // 接口说改好了，页面却一点没变。判据必须落到画布上。
  // 这条注入把"渲染可见性"检查拆掉，退回到"IR 里有就算数"。
  {
    criterion: 'AC-E2E-008',
    description: '本地降级不再校验补丁能不能画出来（IR 变了但页面没变）',
    file: 'apps/api/src/services/agents/editAgent.ts',
    find: '  if (!theme) return true;\n  if (!entry.type || !entry.geometry) return false;',
    replace: '  if (!theme) return true;\n  if (!entry.type || !entry.geometry) return true;\n  return true;',
    testFile: 'e2e/workbench.e2e.ts',
    testName: 'AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘',
  },

  // ---------------------------------------------------------------------------
  // 新增的四条链（质量 / 放映 / 异常 / 离线）此前只有"测试跑过了"，
  // 没有被元验证证明"抓得住错" —— 那不叫验证通过。
  // 下面这六条把每条判据的**代表性错误**各注入一次。
  // ---------------------------------------------------------------------------

  // ---- AC-E2E-015 界面分数必须等于服务端权威评分 ----
  //
  // 前后端跑的是同一份 @ppt/core，数字必须一模一样。
  // 注入的是"服务端评估时没把 slides 装进项目"—— 评估了空壳，
  // 分数自然对不上。这正是判据要抓的那类错：
  // **有一边的输入不是服务端那份 IR**。
  {
    criterion: 'AC-E2E-015',
    description: '服务端评估时漏装了 slides（评的是空项目，分数与界面对不上）',
    file: 'apps/api/src/routes/quality.ts',
    find: '  const report = QualityEngine.evaluatePresentation(project);',
    replace:
      '  // 注入：服务端评估时漏装了 slides —— 评的是空壳项目\n' +
      '  const report = QualityEngine.evaluatePresentation({ ...project, slides: [] });',
    testFile: 'e2e/quality.e2e.ts',
    testName: '质量报告 → 界面分数与服务端权威评分逐项对得上',
  },
  // ---- AC-E2E-016 一键修复必须真的落到服务端 ----
  //
  // 修复改的是**元素 ID 与几何**，不是文字。
  // 注入"防抖同步只比较文字"—— 于是修复在界面上看着生效了，
  // 服务端的 IR 一个字节没变，版本号也不前进。
  // 这类错很常见：同步逻辑为了省事只 diff 文本。
  {
    criterion: 'AC-E2E-016',
    description: '防抖同步只比较文本（修复带来的 ID 与几何改动不落库）',
    file: 'src/App.tsx',
    find:
      '    const changed = project.slides.filter((s) => {\n' +
      '      const before = prevById.get(s.slideId);\n' +
      '      return !before || JSON.stringify(before) !== JSON.stringify(s);\n' +
      '    });',
    replace:
      '    const changed = project.slides.filter((s) => {\n' +
      '      const before = prevById.get(s.slideId);\n' +
      '      // 注入：只比较文本 —— 元素 ID 与几何的改动不落库\n' +
      '      const textOf = (x: typeof s) => JSON.stringify(x.elements.map((e) => e.content));\n' +
      '      return !before || textOf(before) !== textOf(s);\n' +
      '    });',
    testFile: 'e2e/quality.e2e.ts',
    testName: '一键修复 → 服务端的 IR 真的被改写，版本号前进',
  },
  // ---- AC-E2E-017 放映画面上的文字必须等于服务端 IR 里的文字 ----
  //
  // 工作台画一遍、导出一遍、放映再画一遍 —— 三处必须一致。
  // 注入"放映只渲染背景层"：画布上确实有图，但一个字都没有。
  //
  // **注意锚点**：画布真正渲染的是 `renderInlineSvg`，
  // 同一个文件里还有一个 `renderToString` 的结果（`svgContent`）——
  // 那个变量**从来没被用过**。第一次注入就改在了那里，
  // 于是"注入生效了、行为却一点没变"，
  // 框架如实报了 `caught: false`（"验证器抓不到这个错"）。
  // 注入必须落在**真正被渲染的那一行**上。
  {
    criterion: 'AC-E2E-017',
    description: '放映模式只渲染背景层（正文元素没画出来）',
    file: 'src/components/PresentationMode.tsx',
    find: '            __html: SVGRenderer.renderInlineSvg(currentSlide, project.template.theme),',
    replace:
      '            __html: SVGRenderer.renderInlineSvg(\n' +
      '              {\n' +
      '                ...currentSlide,\n' +
      "                elements: currentSlide.elements.filter((el) => el.role === 'background'),\n" +
      '              },\n' +
      '              project.template.theme\n' +
      '            ),',
    testFile: 'e2e/presentation.e2e.ts',
    testName: '放映画面上的文字 == 服务端 IR 里的文字',
  },
  // ---- AC-E2E-018 翻页必须翻到服务端的那一页 ----
  //
  // 注入"一次跳两页"（典型的 off-by-one）——
  // 界面有反应、页码也在变，唯独不是服务端的那一页。
  {
    criterion: 'AC-E2E-018',
    description: '翻页一次跳两页（off-by-one，翻到的不是服务端那一页）',
    file: 'src/components/PresentationMode.tsx',
    find: '  const handleNext = () => {\n    setCurrentIndex((i) => Math.min(total - 1, i + 1));\n  };',
    replace:
      '  const handleNext = () => {\n' +
      '    // 注入：一次跳两页\n' +
      '    setCurrentIndex((i) => Math.min(total - 1, i + 2));\n' +
      '  };',
    testFile: 'e2e/presentation.e2e.ts',
    testName: '翻页 → 换到服务端的后一页，退回后回到第一页',
  },
  // ---- AC-E2E-019 导出失败不能显示成功 ----
  //
  // **假成功**是最坏的一种失败：用户以为文稿导出好了，其实根本没导。
  // 注入"catch 里把失败吞掉、改报成功"。
  {
    criterion: 'AC-E2E-019',
    description: '导出提交失败被吞掉，界面改报成功（假成功）',
    file: 'src/components/ExportModal.tsx',
    find:
      '    } catch (err) {\n' +
      '      setProgressText(\n' +
      '        `导出失败：${err instanceof ApiClientError ? err.message : String(err)}`\n' +
      '      );\n' +
      '      setIsExporting(false);\n' +
      '    }',
    replace:
      '    } catch (err) {\n' +
      '      // 注入：失败被吞掉，界面报成功\n' +
      "      setProgressText('导出成功！文件已开始下载。');\n" +
      '      setIsExporting(false);\n' +
      '    }',
    testFile: 'e2e/errors.e2e.ts',
    testName: '导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"',
  },
  // ---- AC-E2E-021 应用 HTML 里不能有渲染阻塞的外部样式表 ----
  //
  // 注入的是"又加了一张渲染阻塞的 CDN 样式表"——
  // 这是判据针对的那类回归（AC-E2E-022 注入的是把现有的那张改回阻塞，
  // 两者是不同的注入点，互不覆盖）。
  {
    criterion: 'AC-E2E-021',
    description: '又加了一张渲染阻塞的外部样式表（CDN 不可达时整页白屏）',
    file: 'index.html',
    find: '    <link rel="preconnect" href="https://fonts.googleapis.com">',
    replace:
      '    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '    <link\n' +
      '      href="https://cdn.jsdelivr.net/npm/design-tokens@1/tokens.css"\n' +
      '      rel="stylesheet"\n' +
      '    >',
    testFile: 'e2e/offline.e2e.ts',
    testName: '应用 HTML → 没有会阻塞渲染的外部样式表',
  },
];

interface RunResult {
  passed: boolean;
  output: string;
  /** 这一轮的服务端日志（E2E 才有） */
  serverLog?: string;
}

/**
 * E2E 用的后端 + 前端 —— **每一轮都重起**。
 *
 * 复用同一个进程跑"注入前/注入后"两轮是**无效的注入检查**：
 * 服务进程在启动那一刻就把源码读进内存了，之后改磁盘上的文件对它毫无影响。
 * 于是注入"执行成功"、E2E"仍然通过" —— 看上去是"验证器抓不到这个错"，
 * 实际上是注入根本没进到被测系统里。一个自己造出来的假阴性。
 *
 * 每轮都重起 + 每轮都换端口（见 servers.ts）—— 端口不换的话，
 * 上一轮的进程还没退干净，这一轮就会连到旧进程上去，还是个假阴性。
 */
async function runTest(
  testFile: string,
  testName: string,
  wholeFile = false,
  runLabel = 'run'
): Promise<RunResult> {
  const env: Record<string, string> = {};
  let handle: ServerHandle | null = null;
  if (testFile.startsWith('e2e/')) {
    handle = await startServers();
    Object.assign(env, handle.env);
    // 每轮一个独立的浏览器日志文件 —— 共用一个会被后一轮覆盖，
    // 失败时想回看"那一轮"浏览器报了什么就看不到了。
    env['E2E_LOG_FILE'] = `./spec/evidence/e2e-browser-${runLabel}.log`;
  }

  try {
    const cmd = ['bun', 'test', `./${testFile}`];
    if (!wholeFile) cmd.push('-t', testName);

    const proc = Bun.spawnSync({
      cmd,
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...env },
    });
    const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
    // 服务端日志一并带出去 —— 「测试没过」本身没有诊断价值，
    // 要知道是请求没发出去、服务端报了什么错、还是页面被热重载了，
    // 只有日志能回答。前端的日志尤其重要：vite 把「page reload」打在 stdout 上。
    const serverLog = handle ? handle.logs() : undefined;
    return { passed: proc.exitCode === 0, output, serverLog };
  } finally {
    await handle?.stop();
  }
}

/** 一次编辑 —— 可能落在不同文件上 */
interface Edit {
  file: string;
  find: string;
  replace: string;
}

/** 统计子串出现次数 —— 用来判定锚点是否唯一 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * 取输出的尾部 —— 失败时真正有用的是最后那几行（断言差异、堆栈）。
 *
 * 没有它，「基线挂了」就只是一句没有线索的话：到底是实现坏了、
 * 还是服务没起来、还是用例本身超时，全靠猜。
 */
function tail(output: string, maxLines = 40): string {
  const lines = output.split('\n');
  return lines.slice(-maxLines).join('\n');
}

/**
 * 失败那轮的服务端日志。
 *
 * 只在**失败**时附上 —— 成功轮的日志没有诊断价值，还会把报告撑爆。
 * 失败的轮次最需要回答的问题是「请求到底发出去没有 / 服务端报了什么」，
 * 而答案只在这份日志里。
 */
function serverTail(run: RunResult): string {
  if (run.passed || !run.serverLog) return '';
  return `\n--- 该轮服务端日志（失败轮）---\n${tail(run.serverLog, 60)}`;
}

async function main(): Promise<number> {
  const results: Array<{
    criterion: string;
    description: string;
    file: string;
    testFile: string;
    testName: string;
    wholeFile: boolean;
    baseline: boolean;
    caught: boolean;
    restored: boolean;
    note: string;
    /** 失败时的输出尾部 —— 没有它，"基线挂了"就只是一句没有线索的话 */
    outputTail: string;
  }> = [];

  /**
   * 覆盖率证据要被保护起来。
   *
   * AC-GOV-001 的注入改的就是门禁阈值，而门禁跑完会把结果写进
   * `spec/evidence/coverage.json` —— 注入期间写进去的是**被改坏的**结论
   * （threshold 99、passed false）。跑完还原能覆盖回来，但中途被打断
   * 就会留下一个假的证据文件。这里先存一份，跑完原样写回去。
   */
  const coverageEvidencePath = resolve(ROOT, 'spec/evidence/coverage.json');
  const coverageEvidenceBefore = existsSync(coverageEvidencePath)
    ? readFileSync(coverageEvidencePath, 'utf-8')
    : null;

  /** 只校验锚点，不真的注入 —— 改完源文件后先跑这个，省掉一轮无效等待 */
  const dryRun = process.env['MUTATION_CHECK_DRY_RUN'] === '1';

  /**
   * 只跑指定判据 —— `MUTATION_CHECK_ONLY=AC-E2E-011,AC-E2E-012`。
   *
   * 迭代某个验证器时用：整轮 59 个用例要十几分钟，只验一条是几秒。
   * 注意这是**调试开关**，报告落盘时依然会覆盖整份报告 ——
   * 所以只在迭代时用，正式出报告必须跑全量。
   */
  const only = process.env['MUTATION_CHECK_ONLY'];
  const onlySet = only ? new Set(only.split(',').map((s) => s.trim())) : null;

  for (const m of MUTATIONS) {
    if (onlySet && !onlySet.has(m.criterion)) continue;
    const edits: Edit[] = [
      { file: m.file, find: m.find, replace: m.replace },
      ...(m.extraEdits ?? []).map((e) => ({ file: e.file ?? m.file, find: e.find, replace: e.replace })),
    ];
    const files = [...new Set(edits.map((e) => e.file))];

    // 读原文 + 校验所有锚点
    const originals = new Map<string, string>();
    for (const f of files) originals.set(f, readFileSync(resolve(ROOT, f), 'utf-8'));

    const missing = edits.filter((e) => !originals.get(e.file)!.includes(e.find));
    if (missing.length > 0) {
      results.push({
        criterion: m.criterion,
        description: m.description,
        file: m.file,
        testFile: m.testFile,
        testName: m.testName,
        wholeFile: m.wholeFile === true,
        baseline: false,
        caught: false,
        restored: false,
        note: `锚点未命中 —— ${missing[0]!.file} 里找不到待替换文本，注入未执行`,
        outputTail: '',
      });
      continue;
    }

    // 锚点必须**唯一**。
    //
    // `String.replace(字符串)` 只替换**第一处**匹配 —— 锚点在文件里出现两次时，
    // 注入会落在第一处，而被测路径可能根本不在那儿。
    // 那种情况下注入"执行成功"、验证器"仍然通过"，看上去是"验证器抓不到错"，
    // 实际上是**注入根本没进到被测代码路径上** —— 一个自己造出来的假阴性。
    // （AC-IRP-001 就栽在这上面：同一段 `patches: result.patches,` 同时出现在
    //   /edit-slide 和 /suggest 两个路由里，注入改的是前者，验的却是后者。）
    const ambiguous = edits.filter((e) => countOccurrences(originals.get(e.file)!, e.find) > 1);
    if (ambiguous.length > 0) {
      const e = ambiguous[0]!;
      results.push({
        criterion: m.criterion,
        description: m.description,
        file: m.file,
        testFile: m.testFile,
        testName: m.testName,
        wholeFile: m.wholeFile === true,
        baseline: false,
        caught: false,
        restored: false,
        note: `锚点不唯一 —— ${e.file} 里该文本出现 ${countOccurrences(originals.get(e.file)!, e.find)} 次，注入只会落到第一处，可能与被测路径无关`,
        outputTail: '',
      });
      continue;
    }

    if (dryRun) {
      results.push({
        criterion: m.criterion,
        description: m.description,
        file: m.file,
        testFile: m.testFile,
        testName: m.testName,
        wholeFile: m.wholeFile === true,
        baseline: false,
        caught: false,
        restored: false,
        note: '锚点命中（干跑模式，未执行注入）',
        outputTail: '',
      });
      continue;
    }

    // 1) 基线：未改动时该判据必须 PASS
    const baseline = await runTest(m.testFile, m.testName, m.wholeFile, `${m.criterion}-baseline`);

    // 2) 注入
    try {
      for (const f of files) {
        let src = originals.get(f)!;
        for (const e of edits.filter((x) => x.file === f)) src = src.replace(e.find, e.replace);
        writeFileSync(resolve(ROOT, f), src, 'utf-8');
      }
      const mutated = await runTest(m.testFile, m.testName, m.wholeFile, `${m.criterion}-mutated`);
      results.push({
        criterion: m.criterion,
        description: m.description,
        file: m.file,
        testFile: m.testFile,
        testName: m.testName,
        wholeFile: m.wholeFile === true,
        baseline: baseline.passed,
        caught: !mutated.passed,
        restored: false,
        note: mutated.passed ? '注入后验证器仍然通过 —— 验证器抓不到这个错' : '已报错',
        outputTail:
          tail(baseline.output) +
          '\n--- 注入后 ---\n' +
          tail(mutated.output) +
          serverTail(baseline) +
          serverTail(mutated),
      });
    } finally {
      // 3) 还原
      for (const f of files) writeFileSync(resolve(ROOT, f), originals.get(f)!, 'utf-8');
    }

    const restored = await runTest(m.testFile, m.testName, m.wholeFile, `${m.criterion}-restored`);
    const idx = results.length - 1;
    results[idx]!.restored = restored.passed;
    results[idx]!.outputTail += '\n--- 还原后 ---\n' + tail(restored.output) + serverTail(restored);
  }

  // 覆盖率证据还原 —— 注入期间的写入不代表真仓库的覆盖率
  if (coverageEvidenceBefore !== null) {
    writeFileSync(coverageEvidencePath, coverageEvidenceBefore, 'utf-8');
  }

  let broken = 0;
  for (const r of results) {
    if (dryRun) {
      // 干跑模式只关心锚点命中与否
      if (r.note.includes('锚点未命中')) broken++;
      continue;
    }
    if (!r.baseline || !r.caught || !r.restored) broken++;
  }

  // 落盘机器可读结果 —— 追溯矩阵的「注入错误检查」一节由它生成，不手写
  if (!dryRun) {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify(
        {
          generated_by: 'spec/verify/mutation-check.ts',
          total: results.length,
          unqualified: broken,
          cases: results.map((r) => ({
            criterion: r.criterion,
            description: r.description,
            mutated_file: r.file,
            verifier: r.wholeFile ? `${r.testFile}（整文件）` : `${r.testFile}::${r.testName}`,
            baseline_pass: r.baseline,
            caught: r.caught,
            restored_pass: r.restored,
            note: r.note,
            // 只有失败时才留输出 —— 报告是给人看的，不是日志转储
            output_tail:
              r.baseline && r.caught && r.restored
                ? ''
                : r.outputTail,
          })),
        },
        null,
        2
      )}\n`,
      'utf-8'
    );
  }

  console.log('\n注入错误检查结果\n');
  if (dryRun) {
    console.log('（干跑模式：只校验锚点，不执行注入）\n');
    for (const r of results) {
      console.log(`${r.criterion.padEnd(16)}${r.note}`);
    }
    console.log('─'.repeat(96));
    console.log(`共 ${results.length} 个注入用例；锚点未命中 ${broken} 个`);
    return broken > 0 ? 1 : 0;
  }

  console.log('判据            基线PASS  抓到注入  还原后PASS  说明');
  console.log('─'.repeat(96));
  for (const r of results) {
    const mark = (b: boolean) => (b ? '  ✓    ' : '  ✗    ');
    console.log(
      `${r.criterion.padEnd(16)}${mark(r.baseline)}${mark(r.caught)}${mark(r.restored)}   ${r.description}${
        r.note && r.note !== '已报错' ? `（${r.note}）` : ''
      }`
    );
  }
  console.log('─'.repeat(96));
  console.log(`共 ${results.length} 个注入用例；不合格 ${broken} 个`);

  if (broken > 0) {
    console.log('\n❌ 存在抓不到注入错误的验证器 —— 需要补强后才能声称这些判据有效。');
    return 1;
  }
  console.log('\n✅ 每个注入错误都被对应验证器抓到，且源文件已全部还原。');
  return 0;
}

process.exit(await main());
