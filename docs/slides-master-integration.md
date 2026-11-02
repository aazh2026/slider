# slides-master 集成评估

> 评估对象：`https://github.com/aazh2026/slides-master`（本机 `/Users/aaronzh/Documents/GitHub/slides-master`）
> 评估基线：`slides-master` @ `1661b51`，102 次提交，1488 个测试全绿（1485 通过 / 3 跳过）
> 评估目的：判断「本项目的 SVG 输出与 SVG→PPTX 转换能否基于 slides-master」（用户原始命题）
> 结论：**不整体引入，但采纳它的 DPI 语义与 OOXML 建模经验；SVG→PPTX 留在本项目（pptxgenjs）**

---

## 1. 结论摘要

| 问题 | 结论 |
| --- | --- |
| 能否用 slides-master 替换本项目的 **SVG→PPTX**？ | **不能。** 会丢加粗、丢换行、丢 CJK 字体、丢演讲者备注，还引入 .NET 运行时与 libgdiplus 硬依赖 |
| 能否用 slides-master 替换本项目的 **SVG 生成**？ | **不能。** 它没有文本排版引擎，折行靠上游 SVG 里预先算好的 `<tspan>`；本项目的排版在 `svgRenderer` 里，换过去等于丢掉排版 |
| slides-master 里有没有值得拿的东西？ | **有，而且很关键：** `ConversionOptions.Dpi` 这条「文档自带分辨率」的语义，正是本项目设计画布（1920×1080 → 13.33in 幻灯片）缺的那块拼图 |
| 顺手查出了什么问题？ | 本项目 `exportEngine.ts` 的**字号比例是错的**（导出比预览大 44%～100%）——已修；slides-master 有一处**坐标二次换算** bug——已修 |

一句话：**slides-master 是一份优秀的 OOXML 建模参考，不是本项目合适的运行时依赖。**

---

## 2. slides-master 实际是什么

.NET 9 / Open XML SDK 3.1.1 / Svg.NET。1488 个测试，全部是结构断言（读回 XML 校验属性），**没有一张渲染图**。

README 落后 102 个提交，**不要照着 README 判断能力**：

| README 说 | 实际 |
| --- | --- |
| 「Supported today (Phase I first slice)」：只有 rect / circle / ellipse / line / text | Roadmap 里的 Phase E/F/G（`<g transform>`、分组、线性/径向渐变、虚线、透明度、`<path>` 曲线 C/Q/A/Z、`<image>` 嵌入）**全部已实现** |
| 「59 tests」 | 1488 个 |
| 「License: TBD」 | 仓库里**没有 LICENSE 文件**（同一 GitHub owner，不构成法律障碍，但应当补上） |
| 「1 SVG unit = 9525 EMU」 | 这条是硬编码的 CSS 默认值；本次已把它变成可声明的 `--dpi` |

真实能力边界（逐条实测，不是读文档得来的）：

**做到的**
- 形状、填充、描边、圆角、渐变、虚线、透明度、`feDropShadow` → `<a:outerShdw>`、`<path>` 曲线、`<image>` 嵌入
- 双向转换（SVG→PPTX、PPTX→SVG），1488 个测试锁住行为
- 完整的 OOXML 建模：`<p:bg>` 提升、段落结构、`normAutofit`、`marL/marR/indent`、连接符、图表/表格 `graphicFrame`

**没做到的**
- **文本排版**：不折行、不截断、不缩放。SVG 里的换行必须是上游算好的 `<tspan>`，它照搬
- **元素级 transform**：`<g>` 上的有效，元素自己身上的 `translate`/`scale` 静默丢弃（旋转保留）
- **`tspan` 的 `dx`/`dy`**：解析了，但 Building 侧从不消费
- **IR 是单向的**：只吃 SVG，不吃本项目的 `SlideIR`
- **`ConversionOptions` 还有 4 个死字段**：`EmbedImages` / `OneSlidePerSvg` / `GroupTransformsBaked` / `Logger` —— 0 处读取。CLI 的 `--bake-transforms` 也是「设了没人用」
- **libgdiplus 硬依赖**：Svg.NET 在 Linux/macOS 上要 `DYLD_FALLBACK_LIBRARY_PATH` 才能跑起来

---

## 3. 四条集成路径的评估

### 路径 A：替换 SVG→PPTX（pptxgenjs → slides-master）

**否决。** 实测本项目真实 SVG（`slide_1_03`，6608 字节，21 个文本运行）：

| 检查项 | 结果 | 影响 |
| --- | --- | --- |
| 加粗 | SVG 里 `font-weight: 400/500/600/700`，产出 **21 个 `<a:r>` 里 0 个**带 `b="1"` | 标题层级全部塌成同一视觉重量 |
| 换行 | SVG 里 4 个 `<tspan>` 折行 → PPTX 里是**同一个 `<a:p>` 里的多个 `<a:r>`，0 个 `<a:br/>`** | PowerPoint 把它们**并排显示成一行** |
| CJK 字体 | **没有 `<a:ea>`** | 中文字体靠 PowerPoint 自己兜底，不可控 |
| 字体栈 | 每条 CSS 规则只取**第一个**字体家族：`Manrope, system-ui, sans-serif` → `Manrope`；`.font-heading` → `Plus Jakarta Sans`；`.tabular-nums` 的 `JetBrains Mono` **整个丢掉** | 等宽数字变成比例数字 |
| 演讲者备注 | **没有 notesSlide** | 直接违反本项目 SPEC-EXP-002 / AC-EXP-002 |

这五条里，**加粗、换行、备注**是本项目已有的硬性验收项。用 slides-master 换掉 pptxgenjs，等于把三个已通过的判据换成不通过。

### 路径 B：替换 SVG 生成

**否决。** 本项目的 SVG 是 `svgRenderer` 渲染 `SlideIR` 的产物，其文本排版（折行、截断、卡片内边距）在 `packages/core/src/engine/textMetrics.ts` + `svgRenderer` 里自研（见 ADR-011：服务端渲染去 `foreignObject` 化后自研的折行算法）。slides-master 没有排版引擎，接它等于把这部分重写一遍且得不到更好的结果。

### 路径 C：把 slides-master 当 .NET 侧车服务

**技术上可行，收益为负。** 保留了路径 A 的全部保真损失，换来的是：部署镜像里多一套 .NET 运行时 + libgdiplus（native 依赖）、多一跳网络、多一套进程编排与故障面。只有在「宁可用 .NET 也不要动 pptxgenjs」时才是好选择。

### 路径 D（采纳）：采纳语义，留在本项目

具体落地两件事：

1. **采纳 DPI 语义** —— 见下一节。这条已经落地并验证。
2. **把 slides-master 当 OOXML 建模的参照物** —— 需要往 PPTX 里写本项目还没写的东西（`<a:br/>`、`<a:ea>`、`b="1"`、字体栈）时，去看它怎么建模，而不是从零猜 DrawingML。

---

## 4. 本次改动：把 `ConversionOptions.Dpi` 从死字段做成真功能

### 4.1 问题

SVG **不携带分辨率**。CSS 把默认值定死在 96 DPI，即 1 用户单位 = 1/96 英寸 = 9525 EMU。

本项目的设计画布是 1920×1080，幻灯片是 13.333in × 7.5in = 12192000 × 6858000 EMU。于是：

```
1 设计 px = 12192000 / 1920 = 6350 EMU = 0.5pt
```

按 CSS 默认的 96 DPI 换算，1920 用户单位 = 18288000 EMU = **20 英寸**，在 13.33 英寸的幻灯片上**整整溢出 1.5 倍**。slides-master 原来的 `ConversionOptions.Dpi` 是个**从来没被读过的死字段**，所以这个溢出一直存在。

### 4.2 改法

DPI 做成**每次转换的环境变量**（`AsyncLocal<double>`），而不是把参数一路透传到 85 个调用点：

| 文件 | 改动 |
| --- | --- |
| `Internal/UnitConverter.cs` | 新增 `Dpi` / `EmuPerSvgUnit` / `UseDpi(double)` / `EffectRadiusPerSvgUnit`；`PptxFontSizeToPx` / `PxToPptxFontSize` 接入 DPI 因子 |
| `PublicApi/ConversionOptions.cs` | `Dpi` 从死字段变成真开关，文档写明「144 DPI 让 1920×1080 画布正好铺满 13.33in 幻灯片」 |
| `Pptx/Building/PptxDocumentBuilder.cs` | `BuildMultiAsync` 里 `using var dpiScope = UnitConverter.UseDpi(options.Dpi)` |
| `Pptx/Reading/PptxDocumentReader.cs` | `ReadAsync` / `ReadSingleSlideAsync` 同样开作用域 |
| `Cli/Commands/SvgToPptxCommand.cs` | 新增 `--dpi`（默认 96） |
| `Cli/Commands/PptxToSvgCommand.cs` | 新增 `--dpi`（默认 96） |

两个关键约束：

- **默认行为逐位不变。** DPI 因子一律作为**最后一步**乘上去，且在 96 DPI 时**恰好等于 1.0**。早期版本把 `h * 4.0 / 300.0` 改成 `h * (Dpi / 7200.0)`（先乘后除 vs 先除后乘），浮点末位就变了，`LstStyleDefRPrTests` 挂了 —— 改成尾乘 1.0 后恢复。
- **并发隔离。** `AsyncLocal` 保证两次并发的转换互不干扰；测试 `A_conversion_does_not_leak_its_dpi_into_the_caller` 守住「转换结束后调用方仍是 96」。

### 4.3 顺带修掉的两类真 bug

**（a）DPI 逃逸：写死了 9525 的换算点。** 几何和字号走 `UnitConverter`，但**阴影、描边粗细、文字边距、圆角半径、路径控制点**这些地方写死了 `× 9525`，不随 DPI 缩放。实测证据（修复前，同一张 SVG 只改 `--dpi`）：

```
<a:outerShdw blurRad="101600" dist="38100" dir="5400000">   ← 96 DPI
<a:outerShdw blurRad="101600" dist="38100" dir="5400000">   ← 144 DPI，一模一样
```

阴影偏移在 144 DPI 下大 1.5 倍。已把全部 65 处硬编码换算点改为走 `UnitConverter`（`EffectBuilder` / `PresetShapeBuilder` / `CustomShapeBuilder` / `SvgNodeWalker` / `TextShapeReader` / `StyleExtractor` / `SlideReader`），同时保持 96 DPI 逐位不变。

**（b）坐标二次换算。** `ChartFrameBuilder.cs:60-61` 与 `TableFrameBuilder.cs:49-50,80,87` 对**已经是 EMU** 的 `node.Bounds` / `cell.Width` / `row.Cells[0].Height` 又套了一层 `UnitConverter.ToEmu()` —— 多乘一次 9525。`ChartFrameBuilder` 的注释还写着「Bounds is already in SVG-px; convert via UnitConverter」，而 `SvgNodeWalker.cs:231-235` 写的正相反（后者是对的）。已去掉多余的一层换算。

### 4.4 实测结果

用本项目真实 SVG（`SVGRenderer.renderToString(starterProjects[0].slides[2], theme)`）：

| 检查项 | 96 DPI（默认） | 144 DPI |
| --- | --- | --- |
| 画布组 ext | 18288000 × 10287000 EMU | **12192000 × 6858000 EMU** |
| 相对 16:9 幻灯片 | 1.5×（溢出） | **恰好 1×** |
| 正文字号 `sz` | 900 … 2850 | 600 … 1900（×2/3） |
| 描边宽度 | 3 × 9525 | 3 × 6350 |
| 阴影偏移 `dist` | 38100 | **25400**（4 × 6350） |
| 阴影模糊 `blurRad` | 101600 | **67733**（×2/3） |
| 回读 PPTX→SVG | — | 画布回到 1920 × 1080 ✓ |

96 DPI 那一列与改动前**逐位一致**（`dist="38100"`、`blurRad="101600"`），确认「默认行为不变」这条约束成立。

144 DPI 下的额外收获：整页背景矩形**被提升为真正的 `<p:bg>`**（`SlideBuilder.TryBuildSlideBackground` 要求它是 SVG 的第一个子元素且尺寸与幻灯片**精确相等**）—— 96 DPI 下因为尺寸不匹配，永远只是「一块画在背景上的形状」。

### 4.5 测试

新增 `tests/SlidesMaster.Core.Tests/DpiTests.cs`，15 个用例：

- 默认 96 DPI 保持历史行为；144 DPI 下 1 用户单位 = 0.5pt
- 作用域恢复上一层值；非正 DPI 被拒
- 96 DPI 下 1920 画布溢出；144 DPI 下正好铺满并被提升为 `<p:bg>`
- 几何、字号、描边、阴影偏移、文字边距、路径几何**逐项**随 DPI 缩放
- 转换不把 DPI 泄漏给调用方
- 144 DPI 下回读得到原始画布尺寸

全量结果：**1485 通过 / 0 失败 / 3 跳过**（改动前 1473 通过；新增 15 个 DPI 用例 + 原有 1473 全绿，说明 96 DPI 路径逐位未变）。

---

## 5. 仍未解决的问题

按严重度排序。前四条是「用 slides-master 替换现有实现」的真正拦路虎。

| # | 问题 | 证据 | 严重度 |
| --- | --- | --- | --- |
| 1 | **加粗丢失** | SVG `font-weight: 400/500/600/700` → 21 个 `<a:r>` 里 0 个 `b="1"` | 高（直接违反视觉保真） |
| 2 | **换行丢失** | 4 个 `<tspan>` → 0 个 `<a:br/>`，PowerPoint 并排显示 | 高（内容错位） |
| 3 | **没有 notesSlide** | 解包产物无 `ppt/notesSlides/` | 高（违反 SPEC-EXP-002） |
| 4 | **没有 `<a:ea>`** | 中文无声明东亚字体 | 中高（跨机器不可控） |
| 5 | **字体栈只取每个 CSS 规则的第一个家族** | `JetBrains Mono` 等丢失 | 中 |
| 6 | **没有文本排版引擎** | `wrap="none"` 写死；不折行/不截断/不缩放 | 中 |
| 7 | **元素级 transform 丢弃** | 元素自身 `translate`/`scale` 丢失（`<g>` 上的有效） | 中 |
| 8 | **`tspan` 的 `dx`/`dy` 丢弃** | 解析了但 Building 侧不消费 | 低 |
| 9 | **libgdiplus 硬依赖** | macOS/Linux 需 `DYLD_FALLBACK_LIBRARY_PATH` | 中（部署面） |
| 10 | **没有 LICENSE 文件** | README 写「License: TBD」 | 低（同一 owner） |
| 11 | **4 个死选项** | `EmbedImages` / `OneSlidePerSvg` / `GroupTransformsBaked` / `Logger` 0 处读取 | 低 |
| 12 | **没有视觉回归测试** | 1488 个测试全是结构断言 | 中（质量） |

第 1～5 条，本项目**自己用 pptxgenjs 就能做到**，不需要 slides-master。

---

## 6. 顺带查出的本项目缺陷（已修）

### 6.1 `exportEngine.ts` 字号比例错误

**这是本次评估最有价值的产出。**

设计画布 1920px 铺满 960pt 的幻灯片 → **1 设计 px = 0.5pt**。但 `exportEngine.ts` 里有**两条**字号换算路径，都错了，而且错得不一样：

```ts
// 路径一：普通 text 元素 —— 用了 CSS 的 96dpi 系数
const fontSize = Math.round((el.style.fontSize || 16) * 0.72);   // 应为 * 0.5

// 路径二：卡片/指标卡 —— 手写的一组磅值，和 SVG 渲染器那张字号表对不上
push(c.value, { fontSize: 32, bold: true, color: primary });      // SVG 那边是 58 设计 px = 29pt
```

按设计画布折算成「设计 px」再对比（1 pt = 2 设计 px）：

| 路径 | 导出实际 | 预览实际 | 偏大 |
| --- | --- | --- | --- |
| `text` 元素 | `px × 0.72` | `px × 0.5` | **44%** |
| 卡片/指标卡 | 手写磅值（如 phase 12pt = 24 设计 px） | 12 设计 px | **100%**（正好大一倍） |
| 卡片/指标卡（指标值） | 32pt = 64 设计 px | 58 设计 px | 10%（手调过，接近） |

也就是说同一个 IR，导出的 PPT 和浏览器预览**根本不是一张图**：正文大 44%，卡片正文大 100%。

**修复**：新增 `packages/core/src/engine/typography.ts` 作为唯一真相源：

```ts
export const DESIGN_PX_TO_EMU = SLIDE_WIDTH_EMU / DESIGN_CANVAS_WIDTH;  // 6350
export const DESIGN_PX_TO_PT  = DESIGN_PX_TO_EMU / EMU_PER_POINT;       // 0.5
export const CONTENT_TYPE_SCALE = { plain: 15, value: 58, /* ... */ } as const;
```

- `svgRenderer.contentBlocks` 的所有字号改读 `CONTENT_TYPE_SCALE`
- `exportEngine` 的所有字号统一走 `pt(px) = Math.round(px * DESIGN_PX_TO_PT)`
- 几何换算从 `13.33/1920` 改成 `DESIGN_PX_TO_EMU / EMU_PER_INCH`（除得干净，没有 13.33 的近似误差）

### 6.2 本项目 PPTX 导出的其余已知短板

（记录在此，供后续排期；本次未动）

- **字体固定为 `Microsoft YaHei`**：主题里的 `fontFamily` 是 CSS 字体栈，PPTX 只认单一字体名。`docs/backend-features.md §J EXP-06` 要求的「字体名 fallback 链」在 spec 里仍是未定义项（AMB-003）。
- **`<a:ea>` 缺失**：同样因为字体被固定成单一名称。
- **加粗判定是 `fontWeight >= 700`**：500/600 的「半粗」在 PPTX 里没有对应档位，会被判成不加粗。

---

## 7. 建议路线

1. **已完成** —— slides-master 的 `Dpi` 落地并验证（§4）
2. **已完成** —— 本项目 `exportEngine.ts` 字号比例修复（§6.1）
3. **待做** —— 本项目 PPTX 导出补齐三件事：`<a:br/>` 换行、`<a:ea>` CJK 字体、字体栈 fallback。这三件 slides-master 都没做到，所以**要自己写**，参照 DrawingML 规范即可
4. **待做** —— 见 §8 的 spec 变更
5. **不建议** —— 引入 slides-master 作为运行时依赖。若将来确实要用，按 §5 的清单先补齐 1～5 条

---

## 8. 需要补的 spec 条款（本次**未改** `spec/spec.yaml`）

> `spec/spec.yaml` 当前在另一条工作线的未提交改动里，本次不碰。以下是评估得出的、**应该**补的条款。

### 8.1 新增 `SPEC-EXP-005`「导出字号与预览一致」

**statement**：同一份 IR 渲染出的 SVG 与 PPTX，字号比例必须一致；设计画布 1920×1080 铺满 960pt 幻灯片，故 1 设计 px = 0.5pt。

**判据方向**：解包 PPTX，断言已知字号的 `<a:rPr sz>` 等于 `设计 px × 50`（0.5pt = 50 个百分之一磅）。例：58px → `sz="2900"`。

这条正是本次 `exportEngine.ts` 缺陷本该拦住的东西 —— 现有 `SPEC-EXP-001` 只查**文本存在性**，不查**排版**。

### 8.2 扩充 `AC-EXP-001` 的保真面

现在的判据只保证「IR 里的每行文本都能在 PPTX 里找到」。建议追加三项（可作为 `AC-EXP-001` 的子判据或新条款）：

- **换行**：IR 字符串里的 `\n` 在 PPTX 里必须落在不同的 `<a:p>`（或 `<a:br/>`）上，不能被并排成一行
- **加粗**：`fontWeight >= 700` 的元素，其 PPTX 运行必须带 `b="1"`
- **CJK 字体**：中文文本的 `<a:rPr>` 必须声明 `<a:ea typeface="...">`

### 8.3 澄清 `AMB-003`（字体 fallback 链）

`docs/backend-features.md §J EXP-06` 要求字体名 fallback 链，spec 里仍是未定义项。当前实现是单一字体 `Microsoft YaHei`。要么把 EXP-06 的要求落到判据上，要么在 spec 里显式降级为「单一字体名 + 记录在案的已知限制」。

---

## 附录 A：复现步骤

```bash
# 0. 前置：libgdiplus（slides-master 的 Svg.NET 依赖）
export DYLD_FALLBACK_LIBRARY_PATH="/opt/homebrew/opt/mono-libgdiplus/lib"

# 1. 生成本项目的真实 SVG
cd slider && bun -e '
import { SVGRenderer, createStarterProjects } from "@ppt/core";
const p = createStarterProjects()[0];
await Bun.write("/tmp/sm-eval.svg", SVGRenderer.renderToString(p.slides[2], p.template.theme));
'

# 2. 两个 DPI 各转一次
cd slides-master
dotnet run --project src/SlidesMaster.Cli -- svg2pptx \
  -i /tmp/sm-eval.svg -o /tmp/sm-eval-144.pptx --slide-size 16x9 --dpi 144

# 3. 看画布尺寸是否正好等于幻灯片
unzip -p /tmp/sm-eval-144.pptx ppt/slides/slide1.xml | grep -o 'cx="12192000" cy="6858000"' | head
```

## 附录 B：slides-master 侧改动清单

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `Internal/UnitConverter.cs` | 改 | DPI 环境变量、EMU/磅换算接入 DPI |
| `PublicApi/ConversionOptions.cs` | 改 | `Dpi` 从死字段变成真开关 |
| `Pptx/Building/PptxDocumentBuilder.cs` | 改 | 转换期开 DPI 作用域 |
| `Pptx/Reading/PptxDocumentReader.cs` | 改 | 同上 |
| `Cli/Commands/SvgToPptxCommand.cs` | 改 | `--dpi` 参数 |
| `Cli/Commands/PptxToSvgCommand.cs` | 改 | `--dpi` 参数 |
| `Pptx/Building/StyleBuilders/EffectBuilder.cs` | 改 | 阴影/辉光/反射随 DPI 缩放 |
| `Pptx/Building/ShapeBuilders/PresetShapeBuilder.cs` | 改 | 文字边距、缩进、下划线粗细、描边宽度随 DPI 缩放 |
| `Pptx/Building/ShapeBuilders/CustomShapeBuilder.cs` | 改 | 路径控制点、圆角半径随 DPI 缩放；去掉二次换算 |
| `Pptx/Building/ShapeBuilders/ChartFrameBuilder.cs` | 改 | 去掉坐标二次换算 |
| `Pptx/Building/ShapeBuilders/TableFrameBuilder.cs` | 改 | 同上 |
| `Svg/Parsing/SvgNodeWalker.cs` | 改 | 变换偏移随 DPI 缩放 |
| `Pptx/Reading/ShapeReaders/TextShapeReader.cs` | 改 | 回读方向随 DPI 缩放 |
| `Pptx/Reading/ShapeReaders/StyleExtractor.cs` | 改 | 回读方向随 DPI 缩放 |
| `Pptx/Reading/SlideReader.cs` | 改 | 回读方向随 DPI 缩放 |
| `tests/SlidesMaster.Core.Tests/DpiTests.cs` | 新增 | 15 个 DPI 用例 |
