# 追溯矩阵与验证报告

> 本文件由 `spec/verify/traceability.ts` 从 `spec/spec.yaml` 与真实执行产物生成，请勿手工编辑。
> 重新生成：`bun run spec/verify/traceability.ts`（前置：先跑测试与注入检查，见 `spec/README.md`）。

- Spec 版本：`1.0`
- 条款总数：**68**　判据总数：**101**
- 生成时 junit 证据：`spec/evidence/junit.xml`；注入证据：`spec/evidence/mutation-report.json`
- 失败原因：`spec/evidence/junit-output.txt`（单元 / 集成）与 `spec/evidence/junit-e2e-output.txt`（E2E）—— **Bun 的 junit 报告只写失败类型、不写错误信息**（实测产出的是 `<failure type="AssertionError" />`），失败详情在 stderr 里，所以单独落盘

---

## 一、追溯矩阵

### 1.1 文档条款 → Spec → 验证器 → 证据

| 文档章节 | Spec ID | 类型 | 风险 | 验收判据 | 验证器 | Oracle tier | 证据 | 结论 |
|---|---|---|---|---|---|---|---|---|
| docs/backend-design.md §7.2 各格式实现 | SPEC-CORE-001 | technical | high | AC-CORE-001, AC-CORE-011 | spec/verify/core-layout.test.ts::canvas-is-always-1920x1080<br>e2e/workbench.e2e.ts::AC-CORE-011 工作台画布在屏幕上保持 16:9，不出现信箱边 | authoritative, formal | EVD-CORE-001, EVD-CORE-011 | **PASS** |
| docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-05 | SPEC-CORE-002 | technical | high | AC-CORE-002 | spec/verify/core-layout.test.ts::no-element-out-of-canvas | authoritative | EVD-CORE-002 | **PASS** |
| docs/architecture.md §12 ADR-012 · 版式专属元素 ID 统一加 slideId 前缀 | SPEC-CORE-003 | technical | high | AC-CORE-003 | spec/verify/core-layout.test.ts::element-ids-unique-across-slides | formal | EVD-CORE-003 | **PASS** |
| docs/architecture.md §12 ADR-012 · 版式专属元素 ID 统一加 slideId 前缀 | SPEC-CORE-004 | technical | high | AC-CORE-004 | spec/verify/core-layout.test.ts::layout-element-ids-contain-slide-id | authoritative | EVD-CORE-004 | **PASS** |
| docs/architecture.md §13 QA-4 · 可维护：版式引擎变更不引入静默回归 | SPEC-CORE-005 | technical | high | AC-CORE-005 | spec/verify/core-layout.test.ts::layout-engine-is-pure | formal | EVD-CORE-005 | **PASS** |
| docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-07 | SPEC-CORE-006 | technical | medium | AC-CORE-006 | spec/verify/core-layout.test.ts::cover-page-has-no-master-elements | authoritative | EVD-CORE-006 | **PASS** |
| docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-07 | SPEC-CORE-007 | technical | low | AC-CORE-007 | spec/verify/core-layout.test.ts::page-number-format | authoritative | EVD-CORE-007 | **PASS** |
| docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-02 | SPEC-CORE-008 | business | high | AC-CORE-008, AC-CORE-009, AC-CORE-010 | spec/verify/core-content.test.ts::bullet-consuming-layouts-use-outline-bullets<br>spec/verify/core-content.test.ts::cover-content-traceable-to-outline<br>spec/verify/core-content.test.ts::render-output-follows-outline-bullets | authoritative | EVD-CORE-008, EVD-CORE-009, EVD-CORE-010 | **PASS** |
| docs/backend-features.md §F 幻灯片编辑与版本（SLD）· SLD-02 / SLD-04 | SPEC-CORE-009 | business | high | AC-CORE-012, AC-CORE-013 | e2e/workbench.e2e.ts::AC-CORE-012 画布放大超出可视区后，左右上下都滚得到，不被裁掉<br>e2e/workbench.e2e.ts::AC-CORE-013 容器尺寸变化后缩放档位自动重新适配，画布不被裁掉 | authoritative, formal | EVD-CORE-012, EVD-CORE-013 | **PASS** |
| docs/architecture.md §12 ADR-018 · 语义住在字段里，不住在 ID 里 | SPEC-CORE-010 | technical | high | AC-CORE-014, AC-CORE-015, AC-CORE-016, AC-CORE-017 | spec/verify/element-variant.test.ts::layout-engine-sets-variant-on-every-element<br>spec/verify/element-variant.test.ts::id-repair-derives-prefix-from-variant<br>spec/verify/element-variant.test.ts::render-and-theme-follow-variant-not-id<br>spec/verify/element-variant.test.ts::no-consumer-parses-element-ids | authoritative | EVD-CORE-014, EVD-CORE-015, EVD-CORE-016, EVD-CORE-017 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-01 | SPEC-QLT-001 | technical | high | AC-QLT-001 | spec/verify/quality-engine.test.ts::quality-formula-weights | authoritative | EVD-QLT-001 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-02 | SPEC-QLT-002 | technical | medium | AC-QLT-002 | spec/verify/quality-engine.test.ts::canvas-mismatch-penalty | authoritative | EVD-QLT-002 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-02 | SPEC-QLT-003 | technical | medium | AC-QLT-003 | spec/verify/quality-engine.test.ts::duplicate-id-penalty | authoritative | EVD-QLT-003 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-02 | SPEC-QLT-004 | technical | medium | AC-QLT-004 | spec/verify/quality-engine.test.ts::out-of-bounds-penalty | authoritative | EVD-QLT-004 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-03 | SPEC-QLT-005 | technical | medium | AC-QLT-005 | spec/verify/quality-engine.test.ts::aabb-collision-penalty | authoritative | EVD-QLT-005 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-04 | SPEC-QLT-006 | technical | medium | AC-QLT-006 | spec/verify/quality-engine.test.ts::missing-title-penalty | authoritative | EVD-QLT-006 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-04 | SPEC-QLT-007 | technical | medium | AC-QLT-007 | spec/verify/quality-engine.test.ts::missing-keymessage-penalty | authoritative | EVD-QLT-007 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-05 | SPEC-QLT-008 | technical | medium | AC-QLT-008 | spec/verify/quality-engine.test.ts::consistency-penalties | authoritative | EVD-QLT-008 | **PASS** |
| docs/backend-features.md §I 质量评估（QLT）· QLT-06 | SPEC-QLT-009 | technical | high | AC-QLT-009, AC-QLT-011 | spec/verify/quality-engine.test.ts::autofix-restores-bounds<br>spec/verify/quality-engine.test.ts::autofix-leaves-master-elements-alone | authoritative | EVD-QLT-009, EVD-QLT-011 | **PASS** |
| docs/architecture.md §12 ADR-012 | SPEC-QLT-010 | technical | high | AC-QLT-010 | spec/verify/quality-engine.test.ts::autofix-restores-id-uniqueness | authoritative | EVD-QLT-010 | **PASS** |
| docs/backend-features.md §G 智能编辑 Agent（EDT）· EDT-06 | SPEC-QLT-011 | quality | high | AC-QLT-012 | spec/verify/quality-engine.test.ts::autofix-never-lowers-score | authoritative | EVD-QLT-012 | **PASS** |
| docs/architecture.md §12 ADR-014 | SPEC-QLT-012 | quality | medium | AC-QLT-013 | spec/verify/quality-engine.test.ts::issues-declare-fixability | authoritative | EVD-QLT-013 | **PASS** |
| docs/quality-rules.md §2 规则总表 | SPEC-QLT-013 | technical | high | AC-QLT-014, AC-QLT-015 | spec/verify/quality-rules.test.ts::rule-table-matches-doc<br>spec/verify/quality-rules.test.ts::every-rule-has-doc-anchor | authoritative | EVD-QLT-014, EVD-QLT-015 | **PASS** |
| docs/quality-rules.md §1 为什么需要这张表 | SPEC-QLT-014 | technical | high | AC-QLT-016, AC-QLT-017 | spec/verify/quality-rules.test.ts::diagnostic-ids-map-to-rules<br>spec/verify/quality-rules.test.ts::penalties-come-from-rule-table | authoritative | EVD-QLT-016, EVD-QLT-017 | **PASS** |
| docs/quality-rules.md §3 content_thin | SPEC-QLT-015 | technical | medium | AC-QLT-018 | spec/verify/quality-engine.test.ts::thin-page-penalty | authoritative | EVD-QLT-018 | **PASS** |
| docs/quality-rules.md §3 content_dup | SPEC-QLT-016 | technical | medium | AC-QLT-019 | spec/verify/quality-engine.test.ts::duplicate-keymessage-penalty | authoritative | EVD-QLT-019 | **PASS** |
| docs/quality-rules.md §3 vis_sparse | SPEC-QLT-017 | technical | medium | AC-QLT-020, AC-QLT-021 | spec/verify/quality-engine.test.ts::sparse-page-penalty<br>spec/verify/quality-engine.test.ts::thin-page-not-double-charged | authoritative | EVD-QLT-020, EVD-QLT-021 | **PASS** |
| docs/backend-features.md §N 安全（SEC）· SEC-07 | SPEC-RND-001 | technical | high | AC-RND-001 | spec/verify/render-svg.test.ts::user-content-is-xml-escaped | authoritative | EVD-RND-001 | **PASS** |
| docs/architecture.md §12 ADR-011 · 服务端渲染去 foreignObject 化 | SPEC-RND-002 | technical | high | AC-RND-002 | spec/verify/render-svg.test.ts::svg-contains-no-foreignobject | authoritative | EVD-RND-002 | **PASS** |
| docs/backend-features.md §J 渲染与导出（EXP）· EXP-01 | SPEC-RND-003 | technical | high | AC-RND-003 | spec/verify/render-svg.test.ts::svg-contains-no-external-font-import | authoritative | EVD-RND-003 | **PASS** |
| docs/architecture.md §8.1 渲染层次 | SPEC-RND-004 | technical | medium | AC-RND-004 | spec/verify/render-svg.test.ts::svg-preserves-element-ids | authoritative | EVD-RND-004 | **PASS** |
| docs/architecture.md §9.3 关键设计 | SPEC-RND-005 | technical | low | AC-RND-005 | spec/verify/render-svg.test.ts::svg-has-four-layers | authoritative | EVD-RND-005 | **PASS** |
| docs/architecture.md §12 ADR-011 | SPEC-RND-006 | technical | high | AC-RND-006 | spec/verify/render-svg.test.ts::long-text-is-truncated-with-ellipsis | authoritative | EVD-RND-006 | **PASS** |
| docs/backend-features.md §J 渲染与导出（EXP）· EXP-15 / EXP-17 | SPEC-EXP-001 | business | high | AC-EXP-001 | spec/verify/export-pptx.test.ts::pptx-preserves-ir-text-content | authoritative | EVD-EXP-001 | **PASS** |
| docs/backend-features.md §J 渲染与导出（EXP）· EXP-14 | SPEC-EXP-002 | technical | medium | AC-EXP-002 | spec/verify/export-pptx.test.ts::pptx-includes-speaker-notes | authoritative | EVD-EXP-002 | **PASS** |
| docs/backend-features.md §J 渲染与导出（EXP）· EXP-02 | SPEC-EXP-003 | technical | medium | AC-EXP-003 | spec/verify/export-pptx.test.ts::png-export-is-2x | authoritative | EVD-EXP-003 | **PASS** |
| docs/backend-features.md §J 渲染与导出（EXP）· EXP-13 | SPEC-EXP-004 | technical | low | AC-EXP-004 | spec/verify/export-pptx.test.ts::export-filename-sanitized | authoritative | EVD-EXP-004 | **PASS** |
| docs/backend-features.md §C 项目管理（PRJ）· PRJ-07 | SPEC-EXP-005 | technical | high | AC-EXP-005, AC-EXP-006 | apps/api/tests/integration/import-bundle.test.ts::exported-bundle-round-trips-with-page-order-intact<br>apps/api/tests/integration/import-bundle.test.ts::duplicate-order-index-is-rejected | authoritative | EVD-EXP-005, EVD-EXP-006 | **PASS** |
| docs/backend-features.md §J 渲染与导出（EXP）· EXP-06 | SPEC-EXP-006 | technical | medium | AC-EXP-007, AC-EXP-008 | spec/verify/font-fallback.test.ts::svg-font-stack-has-cjk-fallback<br>spec/verify/font-fallback.test.ts::pptx-uses-cjk-capable-font | authoritative | EVD-EXP-007, EVD-EXP-008 | **PASS** |
| docs/architecture.md §12 ADR-019 | SPEC-RND-007 | technical | medium | AC-RND-007, AC-RND-008 | spec/verify/text-metrics.test.ts::text-width-model-is-calibrated<br>spec/verify/text-metrics.test.ts::wrapped-lines-never-exceed-the-available-width | expert | EVD-RND-007, EVD-RND-008 | **PASS** |
| docs/backend-design.md §4.3 IRPatch 协议 | SPEC-IRP-001 | technical | high | AC-IRP-001 | apps/api/tests/ai/edit-slide.test.ts::returns-patches-not-full-elements | authoritative | EVD-IRP-001 | **PASS** |
| docs/backend-design.md §4.3 IRPatch 协议 | SPEC-IRP-002 | technical | high | AC-IRP-002 | packages/core/tests/patchApplier.test.ts::apply-is-idempotent | authoritative | EVD-IRP-002 | **PASS** |
| docs/backend-design.md §4.3 IRPatch 协议 | SPEC-IRP-003 | technical | medium | AC-IRP-003 | packages/core/tests/patchApplier.test.ts::remove-missing-element-throws | authoritative | EVD-IRP-003 | **PASS** |
| docs/backend-design.md §5.3 统一响应与错误规范 | SPEC-API-001 | technical | high | AC-API-001, AC-API-006, AC-API-007 | apps/api/tests/contract/response-envelope.test.ts::success-response-envelope<br>apps/api/tests/contract/response-envelope.test.ts::failure-response-envelope<br>apps/api/tests/contract/response-envelope.test.ts::error-codes-closed-enum | authoritative | EVD-API-001, EVD-API-006, EVD-API-007 | **PASS** |
| docs/backend-design.md §5.3 统一响应与错误规范 | SPEC-API-002 | business | high | AC-API-002 | apps/api/tests/integration/optimistic-lock.test.ts::same-base-version-second-write-conflicts | authoritative | EVD-API-002 | **PASS** |
| docs/backend-design.md §9.2 资源级鉴权 | SPEC-API-003 | technical | high | AC-API-003 | apps/api/tests/security/cross-tenant-access.test.ts::cross-tenant-resource-read-is-404 | authoritative | EVD-API-003 | **PASS** |
| docs/backend-design.md §12 安全 | SPEC-API-004 | technical | high | AC-API-004 | apps/api/tests/security/ai-output-validation.test.ts::invalid-model-output-rejected-and-not-persisted | authoritative | EVD-API-004 | **PASS** |
| docs/backend-features.md §N 安全（SEC）· SEC-06 | SPEC-API-005 | technical | high | AC-API-005, AC-API-008 | apps/api/tests/security/secret-handling.test.ts::missing-api-key-fails-startup<br>apps/api/tests/security/secret-handling.test.ts::secret-never-leaks-into-responses-or-logs | authoritative | EVD-API-005, EVD-API-008 | **PASS** |
| docs/backend-design.md §9.1 会话 | SPEC-SEC-001 | technical | high | AC-SEC-001, AC-SEC-003 | apps/api/tests/security/password-hashing.test.ts::password-stored-as-argon2id-hash<br>apps/api/tests/security/password-hashing.test.ts::password-verify-accepts-correct-and-rejects-wrong | authoritative | EVD-SEC-001, EVD-SEC-003 | **PASS** |
| docs/backend-design.md §9.1 会话 | SPEC-SEC-002 | technical | high | AC-SEC-002, AC-SEC-004, AC-SEC-005 | apps/api/tests/security/session-cookie.test.ts::session-cookie-has-security-attributes<br>apps/api/tests/security/session-cookie.test.ts::session-cookie-secure-in-production<br>apps/api/tests/security/session-cookie.test.ts::session-id-is-32-byte-base64url | authoritative | EVD-SEC-002, EVD-SEC-004, EVD-SEC-005 | **PASS** |
| docs/architecture.md §4 关键场景端到端时序（场景 A） | SPEC-E2E-001 | technical | high | AC-E2E-001, AC-E2E-002 | e2e/auth.e2e.ts::AC-E2E-001 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台<br>e2e/projects.e2e.ts::AC-E2E-002 新建项目 → 服务端库里真的有这条项目，且归属当前用户 | authoritative | EVD-E2E-001, EVD-E2E-002 | **PASS** |
| docs/architecture.md §4 关键场景端到端时序（场景 A） | SPEC-E2E-002 | business | high | AC-E2E-003, AC-E2E-004, AC-E2E-005 | e2e/workbench.e2e.ts::AC-E2E-003 生成大纲 → 页数、主题、服务端与 UI 一致<br>e2e/workbench.e2e.ts::AC-E2E-004 改大纲标题 → 服务端存新标题，UI 也显示新标题<br>e2e/workbench.e2e.ts::AC-E2E-005 确认大纲并编译 → 画布渲染的正是服务端那份 IR | authoritative | EVD-E2E-003, EVD-E2E-004, EVD-E2E-005 | **PASS** |
| docs/backend-design.md §5.3 统一响应与错误规范 | SPEC-E2E-003 | business | high | AC-E2E-006, AC-E2E-007 | e2e/workbench.e2e.ts::AC-E2E-006 就地改文本 → 防抖写回服务端，并产生新版本号<br>e2e/workbench.e2e.ts::AC-E2E-007 两个会话改同一页 → 后者收到 409，前端提示且没覆盖服务端 | authoritative | EVD-E2E-006, EVD-E2E-007 | **PASS** |
| docs/architecture.md §4 关键场景端到端时序（场景 B：AI 改页） | SPEC-E2E-004 | business | high | AC-E2E-008 | e2e/workbench.e2e.ts::AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘 | authoritative | EVD-E2E-008 | **PASS** |
| docs/architecture.md §4 关键场景端到端时序（场景 C：导出） | SPEC-E2E-005 | business | high | AC-E2E-009, AC-E2E-010, AC-E2E-023, AC-E2E-024 | e2e/exports.e2e.ts::AC-E2E-009 PPTX 导出 → 产物是真正的 OOXML，而且里面是这份文稿<br>e2e/exports.e2e.ts::AC-E2E-010 PDF 导出 → 产物是真正的 PDF（%PDF 魔数）<br>e2e/navigation.e2e.ts::AC-E2E-023 PNG/SVG 导出 → scope 只含当前页<br>e2e/navigation.e2e.ts::AC-E2E-024 导出弹窗的 PNG 说明 → 页码跟着当前页走 | authoritative | EVD-E2E-009, EVD-E2E-010, EVD-E2E-023, EVD-E2E-024 | **PASS** |
| docs/backend-features.md N. 安全（SEC） | SPEC-E2E-006 | technical | high | AC-E2E-011 | e2e/projects.e2e.ts::AC-E2E-011 跨租户隔离 → 别人的项目拿不到（404 而不是 403） | authoritative | EVD-E2E-011 | **PASS** |
| docs/architecture.md §5.2 实体关系 | SPEC-E2E-007 | business | medium | AC-E2E-012, AC-E2E-013 | e2e/projects.e2e.ts::AC-E2E-012 重命名项目 → 服务端存的是新名字<br>e2e/projects.e2e.ts::AC-E2E-013 删除项目 → 服务端真的删掉了（且列表里也没有） | authoritative | EVD-E2E-012, EVD-E2E-013 | **PASS** |
| docs/backend-design.md §API 路由表 | SPEC-E2E-008 | business | medium | AC-E2E-014, AC-E2E-020 | e2e/templates.e2e.ts::应用模板 → 服务端存的是新模板，刷新后仍然是它<br>e2e/templates.e2e.ts::应用不存在的模板 → 界面如实报错，服务端模板不被改动 | authoritative | EVD-E2E-014, EVD-E2E-020 | **PASS** |
| docs/backend-design.md §17 附录：现状 → 目标 一览 | SPEC-E2E-009 | business | high | AC-E2E-015, AC-E2E-016 | e2e/quality.e2e.ts::质量报告 → 界面分数与服务端权威评分逐项对得上<br>e2e/quality.e2e.ts::一键修复 → 服务端的 IR 真的被改写，版本号前进 | authoritative | EVD-E2E-015, EVD-E2E-016 | **PASS** |
| docs/backend-design.md §17 附录：现状 → 目标 一览 | SPEC-E2E-010 | business | medium | AC-E2E-017, AC-E2E-018, AC-E2E-025 | e2e/presentation.e2e.ts::放映画面上的文字 == 服务端 IR 里的文字<br>e2e/presentation.e2e.ts::翻页 → 换到服务端的后一页，退回后回到第一页<br>e2e/navigation.e2e.ts::AC-E2E-025 工作台第 2 页点放映 → 从第 2 页开始 | authoritative | EVD-E2E-017, EVD-E2E-018, EVD-E2E-025 | **PASS** |
| docs/backend-design.md §5.3 统一响应与错误规范 | SPEC-E2E-011 | technical | high | AC-E2E-019 | e2e/errors.e2e.ts::导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功" | formal | EVD-E2E-019 | **PASS** |
| docs/backend-features.md §N 字体与渲染 TPL-12 / EXP-12 | SPEC-E2E-012 | technical | high | AC-E2E-021, AC-E2E-022 | e2e/offline.e2e.ts::应用 HTML → 没有会阻塞渲染的外部样式表<br>e2e/offline.e2e.ts::外部资源被挂起 → 外壳仍在 8 秒内渲染出来 | formal | EVD-E2E-021, EVD-E2E-022 | **PASS** |
| docs/backend-features.md 非功能性需求（NFR） | SPEC-NFR-001 | quality | medium | AC-NFR-001 | apps/api/tests/perf/outline-latency.bench.ts::outline-generation-p95-under-threshold | statistical | — | INCONCLUSIVE |
| docs/backend-features.md 非功能性需求（NFR） | SPEC-NFR-002 | quality | medium | AC-NFR-002 | apps/api/tests/perf/export-latency.bench.ts::pptx-export-p95-under-threshold | statistical | EVD-NFR-002 | **PASS** |
| docs/architecture.md §7.2 降级链 | SPEC-NFR-003 | quality | high | AC-NFR-003, AC-NFR-004 | apps/api/tests/chaos/model-fallback.test.ts::model-unavailable-falls-back-with-valid-outline<br>apps/api/tests/chaos/model-fallback.test.ts::fallback-outline-varies-by-topic | authoritative | EVD-NFR-003, EVD-NFR-004 | **PASS** |
| docs/testing-strategy.md §8 质量门禁指标 | SPEC-GOV-001 | governance | medium | AC-GOV-001 | scripts/check-coverage.check.ts::domain-coverage-threshold | authoritative | EVD-GOV-001 | **PASS** |
| docs/testing-strategy.md §1.2 可发布门槛（Definition of Done） | SPEC-GOV-002 | governance | high | AC-GOV-002 | packages/core/tests/layoutEngine.snapshot.test.ts::golden-snapshots-all-match | authoritative | EVD-GOV-002 | **PASS** |
| docs/architecture.md §7.3 质量闸门（生成 → 落库的唯一通道） | SPEC-GOV-003 | governance | high | — | — | — | — | **未覆盖** |

### 1.2 反向孤儿检查

| 检查 | 结果 | 判定 |
|---|---|---|
| 有没有条款没有验收判据？ | 1 条（SPEC-GOV-003） | ✅ 全部登记在 §1.3 未覆盖清单 |
| 有没有判据 ID 重复？ | 0 个 | ✅ |
| 有没有判据挂错条款？ | 0 个 | ✅ |
| 有没有验证器没有对应条款？ | 0 个 | ✅ |
| 有没有文档段落没有对应条款？ | 4 段 | ✅ 全部登记在 §1.4 |
| 有没有 `maturity: none` 的条款？ | 1/68（1.5%） | ✅ 低于 30% 阈值 |

### 1.3 未覆盖清单

| Spec ID | 未覆盖原因 | 影响 | 计划 |
|---|---|---|---|
| SPEC-NFR-001 | 验证器**已建成**（apps/api/tests/perf/outline-latency.bench.ts，100 次采样），但本轮只跑了**降级模式**：模型不可用时采样到的是本地确定性实现，模型往返延迟根本没被采样到。真实模型下的 P95 仍未测过 —— 结论为 INCONCLUSIVE，不能用降级模式的通过顶替 | 中低风险条款无证据 | 在有真实 GEMINI_API_KEY 的评估环境设 BENCH_REAL_MODEL=1 重跑 `bun test ./apps/api/tests/perf/outline-latency.bench.ts`，把结果并入 spec/evidence/junit.xml |
| SPEC-GOV-003 | AMB-001 未裁决 —— 质量闸门阈值在文档中从未给出，判据本身无法成立 | 受 AMB-001 影响 | 由领域负责人给出阈值后补齐验收判据 |

### 1.4 遗漏说明（源文档有、Spec 无）

| 文档章节 | 内容摘要 | 未纳入原因 |
|---|---|---|
| docs/backend-design.md §部署与运维 | 生产环境由运维手工执行数据库迁移 | 组织流程而非产品行为，落地为 SPEC-GOV 类的治理条款而非可执行判据 |
| docs/backend-design.md §限流细则 | 网关层令牌桶的具体速率参数（未给出数值） | 文档未给具体数值，写成判据等于替用户编业务规则；已登记为 AMB-003，条款标 planned |
| docs/testing-strategy.md §测试分层配比 | 各层测试建议数量配比（单测:集成:E2E = 7:2:1） | 是流程建议不是产品行为，且仓库当前无任何测试，比例无参照基准 |
| docs/test-cases.md §UI 交互用例 | 编辑器拖拽、缩放等鼠标交互用例 | 属前端实现细节，仓库无前端交互测试基础设施；已由 SPEC-IRP-002 覆盖「结构不变量」部分 |

### 1.5 歧义、冲突与已作决定

| 类型 | ID | 内容 | 阻塞的条款 |
|---|---|---|---|
| 歧义 | AMB-001 | AI 生成内容落库前的质量分阈值 Q 取多少？文档只写「Q ≥ 阈值」与「Q < 阈值 → 降级内容 / 重新生成 / 拒绝并提示」，从未给出数字。 | SPEC-GOV-003 |
| 歧义 | AMB-002 | LAY-05 说「内容区 100px 边距、底部 1020px；元素不得越界」，而质量引擎按 1920×1080 画布判定越界。以哪一个为准？ | （不阻塞） |
| 歧义 | AMB-003 | EXP-06 要求「字体名 fallback 链保证中英混排」，但没有给出链的具体顺序。当前实现硬编码为单一 'Arial'。 | （不阻塞） |
| 歧义 | AMB-004 | 『卡片/层 AABB 碰撞检测（10px 缓冲）』有两种读法：(a) 10px 是容差 —— 重叠不超过 10px 不算碰撞；(b) 10px 是安全距 —— 两个盒子间距不足 10px 即算碰撞。两者在重叠 0~10px 与间隙 0~10px 区间结论相反。 | （不阻塞） |
| 冲突 | CONF-001 | 元素 ID 的前缀用 role 还是 type —— 影响 patch 寻址与快照基线的具体字符串，但不影响『ID 含 slideId』与『全局唯一』这两条可判定的性质 | BLOCKED |
| 冲突 | CONF-002 | 质量闸门阈值缺失 —— 闸门无法配置，也就无法自动拦截不达标内容 | BLOCKED |
| 决定 | DEC-001 | 不追求章节级全覆盖，改为领域级全覆盖 + 显式遗漏说明 | （全局） |
| 决定 | DEC-002 | 画布判定用于质量扣分，安全区用于版式布局约束，两者并存 | SPEC-QLT-004 |
| 决定 | DEC-003 | 改为以『行』为单位，并追加『运行集合与 IR 行集合相等』这一更强的不变式 | SPEC-EXP-001 |
| 决定 | DEC-004 | 信封固定为 { data, traceId } 与 { error: { code, message, details? }, traceId }；**data 里再包一层业务字段**（如 { data: { project: {...} } }、{ data: { slides: [...] } }），而不是把业务字段平铺到 data 上 | SPEC-API-001, SPEC-API-002, SPEC-API-003, SPEC-API-004, SPEC-API-005 |
| 决定 | DEC-005 | remove_element 指向**不存在**的元素时报错（这是契约错误）；指向**已被删除**的元素时是幂等 no-op —— 通过墓碑（tombstone）集合记录已删除的元素 ID 来区分这两种情况 | SPEC-IRP-002, SPEC-IRP-003 |
| 决定 | DEC-006 | **模型不可用**（5xx / 超时 / 配额耗尽 / 网络错误）→ 走本地降级，返回 200 且 `data.degraded = true`；**模型输出非法**（不是 JSON / 不合 Schema）→ 返回 4xx MODEL_OUTPUT_INVALID，**绝不降级** | SPEC-API-004, SPEC-NFR-003 |
| 决定 | DEC-007 | 返回 404 NOT_FOUND —— **绝不返回 500**，也**不返回 400** | SPEC-API-001, SPEC-API-003 |
| 决定 | DEC-008 | 要 —— **每一个**资源读路径都必须带 `deleted_at IS NULL`，包括中间件，而不只是在 list / find 查询里 | SPEC-API-003 |
| 决定 | DEC-009 | 用 lcov 报告的 ΣLH / ΣLF 精确聚合，不用 text 表格 | SPEC-GOV-001 |
| 决定 | DEC-010 | 不直连 —— E2E 的模型端点指向**本地替身**（spec/verify/model-stub-server.ts），替身返回官方端点在占位 key 下的**原样** 400 响应体；E2E 因此恒定走「模型不可用 → 本地降级」这条路径 | SPEC-E2E-001, SPEC-E2E-002, SPEC-E2E-003, SPEC-E2E-004, SPEC-E2E-005, SPEC-E2E-006, SPEC-E2E-007, SPEC-E2E-008, SPEC-E2E-009, SPEC-E2E-010, SPEC-E2E-011 |
| 决定 | DEC-011 | 不开 —— E2E 的 vite 一律带 `DISABLE_HMR=true`（关掉 hmr 与文件监听） | SPEC-E2E-001, SPEC-E2E-002, SPEC-E2E-003, SPEC-E2E-004, SPEC-E2E-005, SPEC-E2E-006, SPEC-E2E-007, SPEC-E2E-008, SPEC-E2E-009, SPEC-E2E-010, SPEC-E2E-011 |
| 决定 | DEC-012 | 1-based —— orderIndex ≥ 1，与领域内核的 outline.order 同基线；导入端据此校验（缺该项校验会让重复的 orderIndex 静默落库，页序从此由数据库决定） | SPEC-EXP-005 |
| 决定 | DEC-013 | 字体 fallback 链定为：**SVG 侧是 CSS 字体栈** —— 主题拉丁字体 → 显式命名的 CJK 族（'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Source Han Sans SC'）→ generic 兜底，**CJK 族必须排在第一个 generic 族之前**；**PPTX 侧是单一字体名** `'Microsoft YaHei'`（DrawingML 的 <a:latin>/<a:ea>/<a:cs> 各写各的，没有 fallback 链可依赖）。链的单一真相源是 packages/core/src/engine/typography.ts 的 `withCjkFallback` / `CJK_FALLBACK_FAMILIES` / `PPTX_FONT_NAME`，SVG 渲染与 PPTX 导出共用 | SPEC-EXP-006 |
| 决定 | DEC-014 | 10px 是**安全距**而非容差：两块之间必须留出 10px 才算『分开的』，否则判碰撞。间距取两轴间隙的较大者 separation = max(dx, dy)（负值表示重叠），**恰好 10px 判不碰撞** | SPEC-QLT-005 |

---

## 二、验证报告

### 2.1 结论汇总

| 结论 | 条款数 | 判据数 | 占比（按判据） |
|---|---|---|---|
| PASS | 66 | 100 | 99.0% |
| FAIL | 0 | 0 | 0.0% |
| INCONCLUSIVE | 1 | 1 | 1.0% |
| 未覆盖（无判据） | 1 | 0 | 0.0% |
| **合计** | **68** | **101** | **100%** |

> 结论为 PASS 的判据共 100 条，每一条都在 §2.3 有对应证据记录（EVD-*）。
> 「未覆盖（无判据）」的 1 条（SPEC-GOV-003）连判据都不存在，既不是 PASS 也不是 FAIL —— 见 §2.5。
> **证据集对账**：这轮证据集共 437 个用例（spec/evidence/junit.xml 339 + spec/evidence/junit-e2e.xml 98），其中 100 个被某条判据点名、337 个没有。
> 没有判据的 337 个用例里 **0 个失败** —— 上表的「FAIL 0」不是漏报：它们也都过了。
> 判据点名的 101 个验证目标里，**1 个在这轮证据集里没找到**（`apps/api/tests/perf/outline-latency.bench.ts::outline-generation-p95-under-threshold`）—— 挂不上验证目标的判据一律 INCONCLUSIVE，绝不按「通过」算（§2.5）。

#### 2.1.1 这批结论对应的是哪一版代码

这些证据生成于：spec/evidence/junit.xml 2026-11-05 07:03:10、spec/evidence/junit-e2e.xml 2026-11-05 07:04:40。每一条 PASS/FAIL 都是**跑批那一刻**的结论 —— 跑完之后动过它依赖的文件，这条结论就不再自动适用于当前代码。下面按「这条结论依赖的文件有没有在证据之后被改过」逐条判定。

> **100 条结论全部仍然成立** —— 它们依赖的文件在证据生成之后都没有被改过。

> **E2E 的依赖只能按整条链算**：Playwright 规格通过浏览器操作页面、通过 HTTP 打到服务端，它的 import 闭包里**没有**前端与服务端的代码。本次 E2E 证据之后没有源文件被改过，28 条 E2E 结论仍然成立。

### 2.2 失败明细

#### 挂了判据的失败

（无）

#### 未挂判据的失败

（无）—— 没有判据的 337 个用例也全都过了。这一节存在的意义是：**「没有失败」得说得出依据**，不能靠「没列」来暗示。

### 2.3 证据清单

每条 PASS / FAIL 都有一条。`verdict` 为 PASS 或 FAIL 时，验证器**确实执行过**。

```
EVD-CORE-001
  clause:        SPEC-CORE-001
  acceptance:    AC-CORE-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §7.2 各格式实现 —— | **PDF** | `pdf-lib` + resvg 位图嵌入 | 每页 1920×108…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::canvas-is-always-1920x1080
  result:        该用例通过（canvas-is-always-1920x1080）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §7.2 —— 每页 1920×1080
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-011
  clause:        SPEC-CORE-001
  acceptance:    AC-CORE-011
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §7.2 各格式实现 —— | **PDF** | `pdf-lib` + resvg 位图嵌入 | 每页 1920×108…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-CORE-011 工作台画布在屏幕上保持 16:9，不出现信箱边
  result:        该用例通过（AC-CORE-011 工作台画布在屏幕上保持 16:9，不出现信箱边）
  oracle_tier:   formal
  oracle_source: docs/backend-design.md §7.2 —— 每页 1920×1080 ⇒ 16:9；viewBox 比例与元素盒比例一致时，preserveAspectRatio="xMidYMid meet" 必然铺满整个盒子（形式化推论，非新增业务规则）
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-CORE-002
  clause:        SPEC-CORE-002
  acceptance:    AC-CORE-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-05 —— 内容区 100px 边距、底部 1020px；元素不得越界…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::no-element-out-of-canvas
  result:        该用例通过（no-element-out-of-canvas）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §E LAY-05 —— 元素不得越界
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-003
  clause:        SPEC-CORE-003
  acceptance:    AC-CORE-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-012 · 版式专属元素 ID 统一加 slideId 前缀 —— **决策**：`@ppt/core` 生成的所有元素 ID 形如 `{role}_{slideI…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::element-ids-unique-across-slides
  result:        该用例通过（element-ids-unique-across-slides）
  oracle_tier:   formal
  oracle_source: ID 全局唯一性不变量 —— ADR-012『全局唯一是契约而非巧合』
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-004
  clause:        SPEC-CORE-004
  acceptance:    AC-CORE-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-012 · 版式专属元素 ID 统一加 slideId 前缀 —— **背景**：现状 `grid_card_0` / `kpi_card_0` / `proble…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::layout-element-ids-contain-slide-id
  result:        该用例通过（layout-element-ids-contain-slide-id）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-012 —— 决策：所有元素 ID 形如 {role}_{slideId}_{localIndex}
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-005
  clause:        SPEC-CORE-005
  acceptance:    AC-CORE-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §13 QA-4 · 可维护：版式引擎变更不引入静默回归 —— **架构响应**：① 64 组黄金快照测试进 CI ② 版式是纯函数无隐藏状态 ③ 快照 dif…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::layout-engine-is-pure
  result:        该用例通过（layout-engine-is-pure）
  oracle_tier:   formal
  oracle_source: docs/architecture.md §13 QA-4 —— 版式是纯函数无隐藏状态
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-006
  clause:        SPEC-CORE-006
  acceptance:    AC-CORE-006
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-07 —— 页眉 kicker、页脚机密声明、页码 `NN / TT`；封面页不渲染母版…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::cover-page-has-no-master-elements
  result:        该用例通过（cover-page-has-no-master-elements）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §E LAY-07 —— 封面页不渲染母版
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-007
  clause:        SPEC-CORE-007
  acceptance:    AC-CORE-007
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-07 —— 页眉 kicker、页脚机密声明、页码 `NN / TT`；封面页不渲染母版…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-layout.test.ts
  case:          spec/verify/core-layout.test.ts::page-number-format
  result:        该用例通过（page-number-format）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §E LAY-07 —— 页码 NN / TT
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-008
  clause:        SPEC-CORE-008
  acceptance:    AC-CORE-008
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-02 —— `bindContent(outline, content)`：缺失槽位从 `outline.b…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-content.test.ts
  case:          spec/verify/core-content.test.ts::bullet-consuming-layouts-use-outline-bullets
  result:        该用例通过（bullet-consuming-layouts-use-outline-bullets）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §4.2 版式↔槽位映射表 —— 7 种版式的缺省降级均由 bullets 推导；docs/backend-features.md §E LAY-02
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-009
  clause:        SPEC-CORE-008
  acceptance:    AC-CORE-009
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-02 —— `bindContent(outline, content)`：缺失槽位从 `outline.b…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-content.test.ts
  case:          spec/verify/core-content.test.ts::cover-content-traceable-to-outline
  result:        该用例通过（cover-content-traceable-to-outline）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §E LAY-02 —— 任何路径都不得回落到硬编码演示文案
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-010
  clause:        SPEC-CORE-008
  acceptance:    AC-CORE-010
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §E 版式与内容绑定（LAY）· LAY-02 —— `bindContent(outline, content)`：缺失槽位从 `outline.b…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/core-content.test.ts
  case:          spec/verify/core-content.test.ts::render-output-follows-outline-bullets
  result:        该用例通过（render-output-follows-outline-bullets）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §E LAY-02 —— 不得回落到硬编码演示文案
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-012
  clause:        SPEC-CORE-009
  acceptance:    AC-CORE-012
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §F 幻灯片编辑与版本（SLD）· SLD-02 / SLD-04 —— | SLD-02 | 元素几何更新 | P0 | S1 | 拖拽、方向键微调（步长 1 / Sh…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-CORE-012 画布放大超出可视区后，左右上下都滚得到，不被裁掉
  result:        该用例通过（AC-CORE-012 画布放大超出可视区后，左右上下都滚得到，不被裁掉）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §F SLD-02 / SLD-04 —— 元素几何更新与内容编辑要求任意元素可选中、可编辑；元素分布在整页 1920×1080 上，故整页必须可见可达
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-CORE-013
  clause:        SPEC-CORE-009
  acceptance:    AC-CORE-013
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §F 幻灯片编辑与版本（SLD）· SLD-02 / SLD-04 —— | SLD-02 | 元素几何更新 | P0 | S1 | 拖拽、方向键微调（步长 1 / Sh…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-CORE-013 容器尺寸变化后缩放档位自动重新适配，画布不被裁掉
  result:        该用例通过（AC-CORE-013 容器尺寸变化后缩放档位自动重新适配，画布不被裁掉）
  oracle_tier:   formal
  oracle_source: 「适配缩放」的定义（把整页装进可视区）＋ 滚动容器语义：内容不得被裁到不可达的位置（形式化推论，非新增业务规则）
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-CORE-014
  clause:        SPEC-CORE-010
  acceptance:    AC-CORE-014
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-018 · 语义住在字段里，不住在 ID 里 —— 字符串即语义意味着任何一次重命名都是事故…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/element-variant.test.ts
  case:          spec/verify/element-variant.test.ts::layout-engine-sets-variant-on-every-element
  result:        该用例通过（layout-engine-sets-variant-on-every-element）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-018 —— 变体的全部语义收进一张表（ELEMENT_VARIANTS），渲染层、主题重映射、ID 修复一律读表
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-015
  clause:        SPEC-CORE-010
  acceptance:    AC-CORE-015
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-018 · 语义住在字段里，不住在 ID 里 —— 字符串即语义意味着任何一次重命名都是事故…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/element-variant.test.ts
  case:          spec/verify/element-variant.test.ts::id-repair-derives-prefix-from-variant
  result:        该用例通过（id-repair-derives-prefix-from-variant）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-018 —— ID 重排的语义前缀取自 variant 字段，绝不从旧 ID 里抠
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-016
  clause:        SPEC-CORE-010
  acceptance:    AC-CORE-016
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-018 · 语义住在字段里，不住在 ID 里 —— 字符串即语义意味着任何一次重命名都是事故…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/element-variant.test.ts
  case:          spec/verify/element-variant.test.ts::render-and-theme-follow-variant-not-id
  result:        该用例通过（render-and-theme-follow-variant-not-id）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-018 —— 语义判断一律读 variant 字段，不猜 ID 字符串
  evidence:      spec/evidence/junit.xml
```
```
EVD-CORE-017
  clause:        SPEC-CORE-010
  acceptance:    AC-CORE-017
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-018 · 语义住在字段里，不住在 ID 里 —— 字符串即语义意味着任何一次重命名都是事故…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/element-variant.test.ts
  case:          spec/verify/element-variant.test.ts::no-consumer-parses-element-ids
  result:        该用例通过（no-consumer-parses-element-ids）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-018 —— legacyVariantOf 是全仓唯一一处解析 ID 语义的地方，且只在字段缺失时触发
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-001
  clause:        SPEC-QLT-001
  acceptance:    AC-QLT-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-01 —— `Q = 0.3·Qs + 0.3·Qv + 0.2·Qc + 0.2·Qg`；与前端 `qua…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::quality-formula-weights
  result:        该用例通过（quality-formula-weights）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §I QLT-01 —— Q = 0.3·Qs + 0.3·Qv + 0.2·Qc + 0.2·Qg
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-002
  clause:        SPEC-QLT-002
  acceptance:    AC-QLT-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-02 —— 画布尺寸、元素 ID 全局唯一、几何越界…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::canvas-mismatch-penalty
  result:        该用例通过（canvas-mismatch-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §struct_dim —— 画布尺寸不符扣结构分 15（幅度以规则表为准；原幅度由现状实现追认，见 ADR-015）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-003
  clause:        SPEC-QLT-003
  acceptance:    AC-QLT-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-02 —— 画布尺寸、元素 ID 全局唯一、几何越界…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::duplicate-id-penalty
  result:        该用例通过（duplicate-id-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §struct_id —— 元素 ID 重复扣结构分 5（幅度以规则表为准；原幅度由现状实现追认，见 ADR-015）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-004
  clause:        SPEC-QLT-004
  acceptance:    AC-QLT-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-02 —— 画布尺寸、元素 ID 全局唯一、几何越界…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::out-of-bounds-penalty
  result:        该用例通过（out-of-bounds-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §vis_bounds —— 元素越界扣视觉分 10（幅度以规则表为准；原幅度由现状实现追认，见 ADR-015）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-005
  clause:        SPEC-QLT-005
  acceptance:    AC-QLT-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-03 —— 卡片/层 AABB 碰撞检测（10px 安全距 —— 间距不足 10px 即判碰撞，恰好 10p…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::aabb-collision-penalty
  result:        该用例通过（aabb-collision-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §vis_collide —— 10px 是安全距：两块之间必须留出 10px 才算分开（AMB-004 裁决，见 DEC-014）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-006
  clause:        SPEC-QLT-006
  acceptance:    AC-QLT-006
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-04 —— 标题缺失、核心结论缺失…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::missing-title-penalty
  result:        该用例通过（missing-title-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §content_title —— 标题缺失或过短扣内容分 15（幅度以规则表为准；原幅度由现状实现追认，见 ADR-015）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-007
  clause:        SPEC-QLT-007
  acceptance:    AC-QLT-007
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-04 —— 标题缺失、核心结论缺失…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::missing-keymessage-penalty
  result:        该用例通过（missing-keymessage-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §content_keymsg —— 非封面页缺核心结论扣内容分 8（幅度以规则表为准；原幅度由现状实现追认，见 ADR-015）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-008
  clause:        SPEC-QLT-008
  acceptance:    AC-QLT-008
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-05 —— 页数过少、缺封面页…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::consistency-penalties
  result:        该用例通过（consistency-penalties）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §consist_count 与 §consist_cover —— 页数不足扣 15、缺封面扣 10（幅度以规则表为准；原幅度由现状实现追认，见 ADR-015）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-009
  clause:        SPEC-QLT-009
  acceptance:    AC-QLT-009
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-06 —— 几何钳制回安全区、ID 重排、补齐缺失元素；修复后复评…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::autofix-restores-bounds
  result:        该用例通过（autofix-restores-bounds）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §E LAY-05（内容区 100px 边距、底部 1020px）＋ §I QLT-06（几何钳制回安全区）＋ docs/architecture.md §12 ADR-014（越界判据取画布边界，母版元素不得被挪动）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-011
  clause:        SPEC-QLT-009
  acceptance:    AC-QLT-011
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §I 质量评估（QLT）· QLT-06 —— 几何钳制回安全区、ID 重排、补齐缺失元素；修复后复评…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::autofix-leaves-master-elements-alone
  result:        该用例通过（autofix-leaves-master-elements-alone）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-014 —— 母版元素贴着画布边缘是版式设计，修复不得挪动它们
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-010
  clause:        SPEC-QLT-010
  acceptance:    AC-QLT-010
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-012 —— **决策**：`@ppt/core` 生成的所有元素 ID 形如 `{role}_{slideI…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::autofix-restores-id-uniqueness
  result:        该用例通过（autofix-restores-id-uniqueness）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-012（ID 形如 {role}_{slideId}_{localIndex}，全局唯一是契约）＋ §12 ADR-014（重排只改后半截，前缀必须保留）
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-012
  clause:        SPEC-QLT-011
  acceptance:    AC-QLT-012
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §G 智能编辑 Agent（EDT）· EDT-06 —— 编辑后复评四维分；分数下降超阈值自动回滚并以更严格提示重试一次…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::autofix-never-lowers-score
  result:        该用例通过（autofix-never-lowers-score）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §G EDT-06 —— 分数下降即回滚；docs/architecture.md §12 ADR-014 —— 修复后复评、不更差才生效
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-013
  clause:        SPEC-QLT-012
  acceptance:    AC-QLT-013
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-014 —— **决策**：诊断与修复能力必须分开声明 —— 只有真做了自动修复的规则才置 `fixable:…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::issues-declare-fixability
  result:        该用例通过（issues-declare-fixability）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-014 —— 诊断与修复能力必须分开声明
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-014
  clause:        SPEC-QLT-013
  acceptance:    AC-QLT-014
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §2 规则总表 —— `struct_dim` | `structure` | 15 | 是 | 画布尺寸必须是 19…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-rules.test.ts
  case:          spec/verify/quality-rules.test.ts::rule-table-matches-doc
  result:        该用例通过（rule-table-matches-doc）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §2 规则总表 —— 规则表是扣分幅度的权威依据；§1 记录了「幅度写在文档里、引擎从表里读」的决策
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-015
  clause:        SPEC-QLT-013
  acceptance:    AC-QLT-015
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §2 规则总表 —— `struct_dim` | `structure` | 15 | 是 | 画布尺寸必须是 19…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-rules.test.ts
  case:          spec/verify/quality-rules.test.ts::every-rule-has-doc-anchor
  result:        该用例通过（every-rule-has-doc-anchor）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §1 —— 规则 id 同时是诊断 id 的前缀，保证「诊断」与「规则」一一对应
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-016
  clause:        SPEC-QLT-014
  acceptance:    AC-QLT-016
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §1 为什么需要这张表 —— 规则 `id` 同时是**诊断 id 的前缀**…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-rules.test.ts
  case:          spec/verify/quality-rules.test.ts::diagnostic-ids-map-to-rules
  result:        该用例通过（diagnostic-ids-map-to-rules）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §2 规则总表 —— 11 条规则覆盖四个维度，每一条都必须有诊断能命中
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-017
  clause:        SPEC-QLT-014
  acceptance:    AC-QLT-017
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §1 为什么需要这张表 —— 规则 `id` 同时是**诊断 id 的前缀**…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-rules.test.ts
  case:          spec/verify/quality-rules.test.ts::penalties-come-from-rule-table
  result:        该用例通过（penalties-come-from-rule-table）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §1 —— 规则表是数据，评分器退化成它的解释器
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-018
  clause:        SPEC-QLT-015
  acceptance:    AC-QLT-018
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §3 content_thin —— 非封面页里 `role ∈ {card, layer, metric, badge, chart…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::thin-page-penalty
  result:        该用例通过（thin-page-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §3 content_thin —— 扣 8 分；与 vis_sparse 互斥；封面豁免
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-019
  clause:        SPEC-QLT-016
  acceptance:    AC-QLT-019
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §3 content_dup —— 把每页的 `keyMessage` 归一化（去空白、去标点、转小写）后分组…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::duplicate-keymessage-penalty
  result:        该用例通过（duplicate-keymessage-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §3 content_dup —— 扣 10 分；归一化后算同一句；封面不参与
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-020
  clause:        SPEC-QLT-017
  acceptance:    AC-QLT-020
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §3 vis_sparse —— 面积占比 < 20% 即违例…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::sparse-page-penalty
  result:        该用例通过（sparse-page-penalty）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §3 vis_sparse —— 20% 阈值与矩形并集算法，附实测标定表
  evidence:      spec/evidence/junit.xml
```
```
EVD-QLT-021
  clause:        SPEC-QLT-017
  acceptance:    AC-QLT-021
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/quality-rules.md §3 vis_sparse —— 面积占比 < 20% 即违例…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/quality-engine.test.ts
  case:          spec/verify/quality-engine.test.ts::thin-page-not-double-charged
  result:        该用例通过（thin-page-not-double-charged）
  oracle_tier:   authoritative
  oracle_source: docs/quality-rules.md §3 vis_sparse —— 与 content_thin 互斥
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-001
  clause:        SPEC-RND-001
  acceptance:    AC-RND-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §N 安全（SEC）· SEC-07 —— 复用现有 `escapeXml`；用户内容入 SVG 必须转义，防注入…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/render-svg.test.ts
  case:          spec/verify/render-svg.test.ts::user-content-is-xml-escaped
  result:        该用例通过（user-content-is-xml-escaped）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §N SEC-07 —— 用户内容入 SVG 必须转义，防注入
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-002
  clause:        SPEC-RND-002
  acceptance:    AC-RND-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-011 · 服务端渲染去 foreignObject 化 —— **背景**：`svgRenderer` 把卡片正文放在 `<foreignObject>` +…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/render-svg.test.ts
  case:          spec/verify/render-svg.test.ts::svg-contains-no-foreignobject
  result:        该用例通过（svg-contains-no-foreignobject）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-011 —— resvg 直接丢弃 foreignObject
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-003
  clause:        SPEC-RND-003
  acceptance:    AC-RND-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-01 —— `svgRenderer.renderToString` 前后端共用；服务端去掉 Google …
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/render-svg.test.ts
  case:          spec/verify/render-svg.test.ts::svg-contains-no-external-font-import
  result:        该用例通过（svg-contains-no-external-font-import）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-01 —— 服务端去掉 Google Fonts @import
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-004
  clause:        SPEC-RND-004
  acceptance:    AC-RND-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §8.1 渲染层次 —— SlideIR ──► svgRenderer ──► SVG DOM（元素保留 id，便于调试…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/render-svg.test.ts
  case:          spec/verify/render-svg.test.ts::svg-preserves-element-ids
  result:        该用例通过（svg-preserves-element-ids）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §8.1 —— SVG DOM（元素保留 id，便于调试与 diff）；docs/test-cases.md TC-EXP-003 —— 每个元素保留原始 id
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-005
  clause:        SPEC-RND-005
  acceptance:    AC-RND-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §9.3 关键设计 —— **大页面渲染性能** | SVG 元素数可能过千 → 分层渲染（背景层静态、内容层增量）+ 只…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/render-svg.test.ts
  case:          spec/verify/render-svg.test.ts::svg-has-four-layers
  result:        该用例通过（svg-has-four-layers）
  oracle_tier:   authoritative
  oracle_source: docs/test-cases.md §TC-CORE-146 —— 元素分层为 4 层：background-layer / template-layer / content-layer / decoration-layer，顺序固定
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-006
  clause:        SPEC-RND-006
  acceptance:    AC-RND-006
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-011 —— **决策**：`@ppt/core` 的渲染器改为原生 SVG 文本排版（`<text>` + …
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/render-svg.test.ts
  case:          spec/verify/render-svg.test.ts::long-text-is-truncated-with-ellipsis
  result:        该用例通过（long-text-is-truncated-with-ellipsis）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §12 ADR-011 —— 换行与截断由渲染层自研；docs/backend-design.md §A —— 需自研文本换行与截断
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-001
  clause:        SPEC-EXP-001
  acceptance:    AC-EXP-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-15 / EXP-17 —— 导出后回读产物，校验页数、尺寸、关键文本存在…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/export-pptx.test.ts
  case:          spec/verify/export-pptx.test.ts::pptx-preserves-ir-text-content
  result:        该用例通过（pptx-preserves-ir-text-content）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-15 + EXP-17 —— 回读产物，校验关键文本存在
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-002
  clause:        SPEC-EXP-002
  acceptance:    AC-EXP-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-14 —— `addNotes` 写入 `speakerNotes`…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/export-pptx.test.ts
  case:          spec/verify/export-pptx.test.ts::pptx-includes-speaker-notes
  result:        该用例通过（pptx-includes-speaker-notes）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-14 —— addNotes 写入 speakerNotes
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-003
  clause:        SPEC-EXP-003
  acceptance:    AC-EXP-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-02 —— `@resvg/resvg-js` 3840×2160，无需浏览器…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/export-pptx.test.ts
  case:          spec/verify/export-pptx.test.ts::png-export-is-2x
  result:        该用例通过（png-export-is-2x）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-02 —— 3840×2160
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-004
  clause:        SPEC-EXP-004
  acceptance:    AC-EXP-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-13 —— 名称清洗（去非法字符）、中文名保持可读、扩展名正确…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/export-pptx.test.ts
  case:          spec/verify/export-pptx.test.ts::export-filename-sanitized
  result:        该用例通过（export-filename-sanitized）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-13 —— 名称清洗（去非法字符）
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-005
  clause:        SPEC-EXP-005
  acceptance:    AC-EXP-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §C 项目管理（PRJ）· PRJ-07 —— | PRJ-07 | 导入 Slide IR JSON | P0 | S1 | 校验 `slid…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/integration/import-bundle.test.ts
  case:          apps/api/tests/integration/import-bundle.test.ts::exported-bundle-round-trips-with-page-order-intact
  result:        该用例通过（exported-bundle-round-trips-with-page-order-intact）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §C PRJ-07 —— 校验 slides/name 字段合法性；非法文件返回明确错误而非崩溃（并见 docs/test-cases.md TC-CONTRACT-034~036、TC-EXP-023）
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-006
  clause:        SPEC-EXP-005
  acceptance:    AC-EXP-006
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §C 项目管理（PRJ）· PRJ-07 —— | PRJ-07 | 导入 Slide IR JSON | P0 | S1 | 校验 `slid…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/integration/import-bundle.test.ts
  case:          apps/api/tests/integration/import-bundle.test.ts::duplicate-order-index-is-rejected
  result:        该用例通过（duplicate-order-index-is-rejected）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §C PRJ-07 + docs/test-cases.md TC-CONTRACT-034~036 —— 非法文件返回明确错误（400）而非崩溃
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-007
  clause:        SPEC-EXP-006
  acceptance:    AC-EXP-007
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-06 —— `pptxgenjs` 将 IR 映射为 Office 原生形状与文本框；字体名 fallbac…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/font-fallback.test.ts
  case:          spec/verify/font-fallback.test.ts::svg-font-stack-has-cjk-fallback
  result:        该用例通过（svg-font-stack-has-cjk-fallback）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-06 —— 字体名 fallback 链保证中英混排（链的内容见 DEC-013：CJK 族必须排在 generic 之前）
  evidence:      spec/evidence/junit.xml
```
```
EVD-EXP-008
  clause:        SPEC-EXP-006
  acceptance:    AC-EXP-008
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §J 渲染与导出（EXP）· EXP-06 —— `pptxgenjs` 将 IR 映射为 Office 原生形状与文本框；字体名 fallbac…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/font-fallback.test.ts
  case:          spec/verify/font-fallback.test.ts::pptx-uses-cjk-capable-font
  result:        该用例通过（pptx-uses-cjk-capable-font）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §J EXP-06 —— 字体名 fallback 链保证中英混排（PPTX 侧只能单名，见 DEC-013）
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-007
  clause:        SPEC-RND-007
  acceptance:    AC-RND-007
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-019 —— **两路模型**：**全角字符**（CJK / 全角标点 / 韩文）按 1em —— 各家 CJ…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/text-metrics.test.ts
  case:          spec/verify/text-metrics.test.ts::text-width-model-is-calibrated
  result:        该用例通过（text-width-model-is-calibrated）
  oracle_tier:   expert
  oracle_source: docs/architecture.md §12 ADR-019 —— 半角按标准西文 advance width 表计宽并乘 1.08 安全系数；Helvetica/Arial 的字宽在实务上被当作「西文标准档」
  evidence:      spec/evidence/junit.xml
```
```
EVD-RND-008
  clause:        SPEC-RND-007
  acceptance:    AC-RND-008
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §12 ADR-019 —— **两路模型**：**全角字符**（CJK / 全角标点 / 韩文）按 1em —— 各家 CJ…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./spec/verify/text-metrics.test.ts
  case:          spec/verify/text-metrics.test.ts::wrapped-lines-never-exceed-the-available-width
  result:        该用例通过（wrapped-lines-never-exceed-the-available-width）
  oracle_tier:   expert
  oracle_source: docs/architecture.md §12 ADR-019 —— 空格断行时尾段超宽必须退化为硬断，保证每一行的估算宽度都不超过可用宽度
  evidence:      spec/evidence/junit.xml
```
```
EVD-IRP-001
  clause:        SPEC-IRP-001
  acceptance:    AC-IRP-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §4.3 IRPatch 协议 —— **AI 返回 `{ patches: IRPatch[], message: string }…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/ai/edit-slide.test.ts
  case:          apps/api/tests/ai/edit-slide.test.ts::returns-patches-not-full-elements
  result:        该用例通过（returns-patches-not-full-elements）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §4.3 —— AI 返回 { patches: IRPatch[], message: string }
  evidence:      spec/evidence/junit.xml
```
```
EVD-IRP-002
  clause:        SPEC-IRP-002
  acceptance:    AC-IRP-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §4.3 IRPatch 协议 —— - **幂等**：同一条 patch 施加两次结果相同，便于重试。…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./packages/core/tests/patchApplier.test.ts
  case:          packages/core/tests/patchApplier.test.ts::apply-is-idempotent
  result:        该用例通过（apply-is-idempotent）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §4.3 —— 幂等：同一条 patch 施加两次结果相同
  evidence:      spec/evidence/junit.xml
```
```
EVD-IRP-003
  clause:        SPEC-IRP-003
  acceptance:    AC-IRP-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §4.3 IRPatch 协议 —— case 'remove_element':   /* 存在性校验，删不存在则报错而非静默 */…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./packages/core/tests/patchApplier.test.ts
  case:          packages/core/tests/patchApplier.test.ts::remove-missing-element-throws
  result:        该用例通过（remove-missing-element-throws）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §4.3 —— 删不存在则报错而非静默
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-001
  clause:        SPEC-API-001
  acceptance:    AC-API-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— 错误码枚举：`UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `VA…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/contract/response-envelope.test.ts
  case:          apps/api/tests/contract/response-envelope.test.ts::success-response-envelope
  result:        该用例通过（success-response-envelope）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3 —— 统一响应与错误规范
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-006
  clause:        SPEC-API-001
  acceptance:    AC-API-006
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— 错误码枚举：`UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `VA…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/contract/response-envelope.test.ts
  case:          apps/api/tests/contract/response-envelope.test.ts::failure-response-envelope
  result:        该用例通过（failure-response-envelope）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3 —— 统一响应与错误规范
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-007
  clause:        SPEC-API-001
  acceptance:    AC-API-007
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— 错误码枚举：`UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `VA…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/contract/response-envelope.test.ts
  case:          apps/api/tests/contract/response-envelope.test.ts::error-codes-closed-enum
  result:        该用例通过（error-codes-closed-enum）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3 —— 错误码枚举：UNAUTHORIZED FORBIDDEN NOT_FOUND VALIDATION_FAILED SLIDE_VERSION_CONFLICT QUOTA_EXCEEDED MODEL_UNAVAILABLE MODEL_OUTPUT_INVALID JOB_FAILED RATE_LIMITED
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-002
  clause:        SPEC-API-002
  acceptance:    AC-API-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— **乐观并发**：所有 `PATCH /slides/:slideId` 必须携带 `baseV…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/integration/optimistic-lock.test.ts
  case:          apps/api/tests/integration/optimistic-lock.test.ts::same-base-version-second-write-conflicts
  result:        该用例通过（same-base-version-second-write-conflicts）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3 —— 不匹配则返回 409 SLIDE_VERSION_CONFLICT 并附带当前版本
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-003
  clause:        SPEC-API-003
  acceptance:    AC-API-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §9.2 资源级鉴权 —— **绝不依赖"资源 ID 难猜"来防越权**——每个资源查询都必须带 `userId` 条件。…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/cross-tenant-access.test.ts
  case:          apps/api/tests/security/cross-tenant-access.test.ts::cross-tenant-resource-read-is-404
  result:        该用例通过（cross-tenant-resource-read-is-404）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §9.2 + docs/backend-features.md §N SEC-01 / SEC-08
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-004
  clause:        SPEC-API-004
  acceptance:    AC-API-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §12 安全 —— | Prompt 注入 | 用户文档内容作为**数据**注入并明确标注边界；模型输出**永远经过…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/ai-output-validation.test.ts
  case:          apps/api/tests/security/ai-output-validation.test.ts::invalid-model-output-rejected-and-not-persisted
  result:        该用例通过（invalid-model-output-rejected-and-not-persisted）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §12 安全 —— 模型输出永远经过 Zod 校验后才进入系统
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-005
  clause:        SPEC-API-005
  acceptance:    AC-API-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §N 安全（SEC）· SEC-06 —— 密钥仅在服务端；缺失即启动失败；日志不打印密钥…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/secret-handling.test.ts
  case:          apps/api/tests/security/secret-handling.test.ts::missing-api-key-fails-startup
  result:        该用例通过（missing-api-key-fails-startup）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §N SEC-06 —— 密钥仅在服务端；缺失即启动失败；日志不打印密钥
  evidence:      spec/evidence/junit.xml
```
```
EVD-API-008
  clause:        SPEC-API-005
  acceptance:    AC-API-008
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §N 安全（SEC）· SEC-06 —— 密钥仅在服务端；缺失即启动失败；日志不打印密钥…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/secret-handling.test.ts
  case:          apps/api/tests/security/secret-handling.test.ts::secret-never-leaks-into-responses-or-logs
  result:        该用例通过（secret-never-leaks-into-responses-or-logs）
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md §N SEC-06 —— 密钥仅在服务端；日志不打印密钥
  evidence:      spec/evidence/junit.xml
```
```
EVD-SEC-001
  clause:        SPEC-SEC-001
  acceptance:    AC-SEC-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §9.1 会话 —— 注册/登录：`Bun.password.hash(pw, { algorithm: 'argon…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/password-hashing.test.ts
  case:          apps/api/tests/security/password-hashing.test.ts::password-stored-as-argon2id-hash
  result:        该用例通过（password-stored-as-argon2id-hash）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §9.1 —— Bun.password.hash(pw, { algorithm: 'argon2id' })
  evidence:      spec/evidence/junit.xml
```
```
EVD-SEC-003
  clause:        SPEC-SEC-001
  acceptance:    AC-SEC-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §9.1 会话 —— 注册/登录：`Bun.password.hash(pw, { algorithm: 'argon…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/password-hashing.test.ts
  case:          apps/api/tests/security/password-hashing.test.ts::password-verify-accepts-correct-and-rejects-wrong
  result:        该用例通过（password-verify-accepts-correct-and-rejects-wrong）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §9.1 —— 验证 Bun.password.verify
  evidence:      spec/evidence/junit.xml
```
```
EVD-SEC-002
  clause:        SPEC-SEC-002
  acceptance:    AC-SEC-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §9.1 会话 —— Cookie：`HttpOnly` + `SameSite=Lax` + `Secure`（生产…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/session-cookie.test.ts
  case:          apps/api/tests/security/session-cookie.test.ts::session-cookie-has-security-attributes
  result:        该用例通过（session-cookie-has-security-attributes）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §9.1 —— Cookie：HttpOnly + SameSite=Lax + Secure（生产）+ Path=/
  evidence:      spec/evidence/junit.xml
```
```
EVD-SEC-004
  clause:        SPEC-SEC-002
  acceptance:    AC-SEC-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §9.1 会话 —— Cookie：`HttpOnly` + `SameSite=Lax` + `Secure`（生产…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/session-cookie.test.ts
  case:          apps/api/tests/security/session-cookie.test.ts::session-cookie-secure-in-production
  result:        该用例通过（session-cookie-secure-in-production）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §9.1 —— Secure（生产）
  evidence:      spec/evidence/junit.xml
```
```
EVD-SEC-005
  clause:        SPEC-SEC-002
  acceptance:    AC-SEC-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §9.1 会话 —— Cookie：`HttpOnly` + `SameSite=Lax` + `Secure`（生产…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/security/session-cookie.test.ts
  case:          apps/api/tests/security/session-cookie.test.ts::session-id-is-32-byte-base64url
  result:        该用例通过（session-id-is-32-byte-base64url）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §9.1 —— Session ID 为 32 字节 CSPRNG 的 base64url 编码
  evidence:      spec/evidence/junit.xml
```
```
EVD-E2E-001
  clause:        SPEC-E2E-001
  acceptance:    AC-E2E-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 A） —— 用户 │ 体验层 │ API 层 │ 编排层 │ 领域层 │ 基础设施 —— 输入需求 → PO…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/auth.e2e.ts
  case:          e2e/auth.e2e.ts::AC-E2E-001 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台
  result:        该用例通过（AC-E2E-001 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 A —— 注册后由 API 层签发会话并驱动体验层进入工作台
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-002
  clause:        SPEC-E2E-001
  acceptance:    AC-E2E-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 A） —— 用户 │ 体验层 │ API 层 │ 编排层 │ 领域层 │ 基础设施 —— 输入需求 → PO…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/projects.e2e.ts
  case:          e2e/projects.e2e.ts::AC-E2E-002 新建项目 → 服务端库里真的有这条项目，且归属当前用户
  result:        该用例通过（AC-E2E-002 新建项目 → 服务端库里真的有这条项目，且归属当前用户）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 A —— 体验层发起的写操作最终持久化到 PG
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-003
  clause:        SPEC-E2E-002
  acceptance:    AC-E2E-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 A） —— 产出 outline + SlideContent → ↓ Zod校验 → ↓ bindCont…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-E2E-003 生成大纲 → 页数、主题、服务端与 UI 一致
  result:        该用例通过（AC-E2E-003 生成大纲 → 页数、主题、服务端与 UI 一致）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 A 与 §7.3 —— 降级链触发时产出确定性内容（按 topic 动态生成，不再是写死的 Agent 架构大纲）
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-004
  clause:        SPEC-E2E-002
  acceptance:    AC-E2E-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 A） —— 产出 outline + SlideContent → ↓ Zod校验 → ↓ bindCont…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-E2E-004 改大纲标题 → 服务端存新标题，UI 也显示新标题
  result:        该用例通过（AC-E2E-004 改大纲标题 → 服务端存新标题，UI 也显示新标题）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 A —— 体验层的编辑必须持久化到服务端
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-005
  clause:        SPEC-E2E-002
  acceptance:    AC-E2E-005
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 A） —— 产出 outline + SlideContent → ↓ Zod校验 → ↓ bindCont…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-E2E-005 确认大纲并编译 → 画布渲染的正是服务端那份 IR
  result:        该用例通过（AC-E2E-005 确认大纲并编译 → 画布渲染的正是服务端那份 IR）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 A —— 编译后由服务端返回 SlideIR 并持久化
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-006
  clause:        SPEC-E2E-003
  acceptance:    AC-E2E-006
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— **乐观并发**：所有 `PATCH /slides/:slideId` 必须携带 `baseV…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-E2E-006 就地改文本 → 防抖写回服务端，并产生新版本号
  result:        该用例通过（AC-E2E-006 就地改文本 → 防抖写回服务端，并产生新版本号）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3 —— 写操作必须携带 baseVersionId 并生成新版本
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-007
  clause:        SPEC-E2E-003
  acceptance:    AC-E2E-007
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— **乐观并发**：所有 `PATCH /slides/:slideId` 必须携带 `baseV…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-E2E-007 两个会话改同一页 → 后者收到 409，前端提示且没覆盖服务端
  result:        该用例通过（AC-E2E-007 两个会话改同一页 → 后者收到 409，前端提示且没覆盖服务端）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3 —— 不匹配则返回 409 SLIDE_VERSION_CONFLICT
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-008
  clause:        SPEC-E2E-004
  acceptance:    AC-E2E-008
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 B：AI 改页） —— ### 场景 B：AI 改页（增量编辑）…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/workbench.e2e.ts
  case:          e2e/workbench.e2e.ts::AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘
  result:        该用例通过（AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 B —— AI 改页由服务端施加增量补丁后返回新 IR
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-009
  clause:        SPEC-E2E-005
  acceptance:    AC-E2E-009
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 C：导出） —— ### 场景 C：导出（服务端管线）…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/exports.e2e.ts
  case:          e2e/exports.e2e.ts::AC-E2E-009 PPTX 导出 → 产物是真正的 OOXML，而且里面是这份文稿
  result:        该用例通过（AC-E2E-009 PPTX 导出 → 产物是真正的 OOXML，而且里面是这份文稿）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 C —— 导出走服务端管线产出真实产物
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-010
  clause:        SPEC-E2E-005
  acceptance:    AC-E2E-010
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 C：导出） —— ### 场景 C：导出（服务端管线）…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/exports.e2e.ts
  case:          e2e/exports.e2e.ts::AC-E2E-010 PDF 导出 → 产物是真正的 PDF（%PDF 魔数）
  result:        该用例通过（AC-E2E-010 PDF 导出 → 产物是真正的 PDF（%PDF 魔数））
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §4 场景 C —— 导出走服务端管线产出真实产物
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-023
  clause:        SPEC-E2E-005
  acceptance:    AC-E2E-023
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 C：导出） —— ### 场景 C：导出（服务端管线）…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/navigation.e2e.ts
  case:          e2e/navigation.e2e.ts::AC-E2E-023 PNG/SVG 导出 → scope 只含当前页
  result:        该用例通过（AC-E2E-023 PNG/SVG 导出 → scope 只含当前页）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.2 API 路由表 —— 导出任务以 scope 决定范围；scope 必须由当前页推导
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-024
  clause:        SPEC-E2E-005
  acceptance:    AC-E2E-024
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §4 关键场景端到端时序（场景 C：导出） —— ### 场景 C：导出（服务端管线）…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/navigation.e2e.ts
  case:          e2e/navigation.e2e.ts::AC-E2E-024 导出弹窗的 PNG 说明 → 页码跟着当前页走
  result:        该用例通过（AC-E2E-024 导出弹窗的 PNG 说明 → 页码跟着当前页走）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.2 API 路由表 —— 导出范围由当前页推导，界面文案必须如实回显当前页码
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-011
  clause:        SPEC-E2E-006
  acceptance:    AC-E2E-011
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md N. 安全（SEC） —— | SEC-08 | ID 枚举防护 | P1 | S1 | 越权访问统一返回 404（不泄露"…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/projects.e2e.ts
  case:          e2e/projects.e2e.ts::AC-E2E-011 跨租户隔离 → 别人的项目拿不到（404 而不是 403）
  result:        该用例通过（AC-E2E-011 跨租户隔离 → 别人的项目拿不到（404 而不是 403））
  oracle_tier:   authoritative
  oracle_source: docs/backend-features.md SEC-08 —— 越权访问统一返回 404（不泄露"存在但无权"）
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-012
  clause:        SPEC-E2E-007
  acceptance:    AC-E2E-012
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §5.2 实体关系 —— ├──< projects ──┬──< slides ──< slide_versions…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/projects.e2e.ts
  case:          e2e/projects.e2e.ts::AC-E2E-012 重命名项目 → 服务端存的是新名字
  result:        该用例通过（AC-E2E-012 重命名项目 → 服务端存的是新名字）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §5.2 —— 项目实体的写操作最终持久化到服务端
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-013
  clause:        SPEC-E2E-007
  acceptance:    AC-E2E-013
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §5.2 实体关系 —— ├──< projects ──┬──< slides ──< slide_versions…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/projects.e2e.ts
  case:          e2e/projects.e2e.ts::AC-E2E-013 删除项目 → 服务端真的删掉了（且列表里也没有）
  result:        该用例通过（AC-E2E-013 删除项目 → 服务端真的删掉了（且列表里也没有））
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §5.2 —— 删除是软删除（deleted_at），所有读路径都必须过滤
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-014
  clause:        SPEC-E2E-008
  acceptance:    AC-E2E-014
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §API 路由表 —— POST   /api/templates/:id/apply     应用模板并重映射元素样式…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/templates.e2e.ts
  case:          e2e/templates.e2e.ts::应用模板 → 服务端存的是新模板，刷新后仍然是它
  result:        该用例通过（应用模板 → 服务端存的是新模板，刷新后仍然是它）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §API 路由表 + docs/backend-features.md TPL-03「模板应用 + 元素样式重映射 …… 服务端权威执行」
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-020
  clause:        SPEC-E2E-008
  acceptance:    AC-E2E-020
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §API 路由表 —— POST   /api/templates/:id/apply     应用模板并重映射元素样式…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/templates.e2e.ts
  case:          e2e/templates.e2e.ts::应用不存在的模板 → 界面如实报错，服务端模板不被改动
  result:        该用例通过（应用不存在的模板 → 界面如实报错，服务端模板不被改动）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §5.3「服务端返回错误信封时，前端必须把这次操作显示为失败并说明原因；绝不能显示成成功」+ 同节错误码枚举中的 NOT_FOUND（不存在的资源按 404 处理 —— 由该节『项目不存在』示例推广到模板）+ docs/backend-features.md TPL-03「服务端权威执行」
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-015
  clause:        SPEC-E2E-009
  acceptance:    AC-E2E-015
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §17 附录：现状 → 目标 一览 —— | 质量检查 | 纯前端计算 | 服务端权威 + 生成后自动闸门 |…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/quality.e2e.ts
  case:          e2e/quality.e2e.ts::质量报告 → 界面分数与服务端权威评分逐项对得上
  result:        该用例通过（质量报告 → 界面分数与服务端权威评分逐项对得上）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §17 —— 质量检查由「纯前端计算」改为「服务端权威」
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-016
  clause:        SPEC-E2E-009
  acceptance:    AC-E2E-016
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §17 附录：现状 → 目标 一览 —— | 质量检查 | 纯前端计算 | 服务端权威 + 生成后自动闸门 |…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/quality.e2e.ts
  case:          e2e/quality.e2e.ts::一键修复 → 服务端的 IR 真的被改写，版本号前进
  result:        该用例通过（一键修复 → 服务端的 IR 真的被改写，版本号前进）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §17 —— 服务端权威 + 生成后自动闸门（闸门在服务端执行，修复也必须落库）
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-017
  clause:        SPEC-E2E-010
  acceptance:    AC-E2E-017
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §17 附录：现状 → 目标 一览 —— | 页面生成 | 前端 `layoutEngine`，7/8 版式硬编码 | `@ppt/cor…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/presentation.e2e.ts
  case:          e2e/presentation.e2e.ts::放映画面上的文字 == 服务端 IR 里的文字
  result:        该用例通过（放映画面上的文字 == 服务端 IR 里的文字）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §17「前后端一致」+ docs/architecture.md §4 体验层页签含「演示模式」
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-018
  clause:        SPEC-E2E-010
  acceptance:    AC-E2E-018
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §17 附录：现状 → 目标 一览 —— | 页面生成 | 前端 `layoutEngine`，7/8 版式硬编码 | `@ppt/cor…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/presentation.e2e.ts
  case:          e2e/presentation.e2e.ts::翻页 → 换到服务端的后一页，退回后回到第一页
  result:        该用例通过（翻页 → 换到服务端的后一页，退回后回到第一页）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §3「Presentation Mode —— 全屏放映 + 缩略图」+ docs/architecture.md §4 体验层页签含「演示模式」
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-025
  clause:        SPEC-E2E-010
  acceptance:    AC-E2E-025
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §17 附录：现状 → 目标 一览 —— | 页面生成 | 前端 `layoutEngine`，7/8 版式硬编码 | `@ppt/cor…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/navigation.e2e.ts
  case:          e2e/navigation.e2e.ts::AC-E2E-025 工作台第 2 页点放映 → 从第 2 页开始
  result:        该用例通过（AC-E2E-025 工作台第 2 页点放映 → 从第 2 页开始）
  oracle_tier:   authoritative
  oracle_source: docs/backend-design.md §3「Presentation Mode —— 全屏放映 + 缩略图」—— 放映的起点是当前页，不是恒定的第一页
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-019
  clause:        SPEC-E2E-011
  acceptance:    AC-E2E-019
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-design.md §5.3 统一响应与错误规范 —— 统一响应信封：成功 `{ data, traceId }`，失败 `{ error: { cod…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/errors.e2e.ts
  case:          e2e/errors.e2e.ts::导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"
  result:        该用例通过（导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"）
  oracle_tier:   formal
  oracle_source: 由 SPEC-API-001 推导 —— 统一信封在协议层把成功与失败区分开（形式化约束）；推导依据见本条的 inference
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-021
  clause:        SPEC-E2E-012
  acceptance:    AC-E2E-021
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §N 字体与渲染 TPL-12 / EXP-12 —— | TPL-12 | 字体资源托管 | P0 | S3 | Manrope / Plus Jak…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/offline.e2e.ts
  case:          e2e/offline.e2e.ts::应用 HTML → 没有会阻塞渲染的外部样式表
  result:        该用例通过（应用 HTML → 没有会阻塞渲染的外部样式表）
  oracle_tier:   formal
  oracle_source: HTML 平台的形式化约束 —— 浏览器只把「匹配当前媒体类型」的样式表算作渲染阻塞（docs/test-cases.md TC-EXP-001b 同源：服务端 SVG 产物不得含 fonts.googleapis.com 远程引用，ADR-009 vendored fonts）
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-E2E-022
  clause:        SPEC-E2E-012
  acceptance:    AC-E2E-022
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md §N 字体与渲染 TPL-12 / EXP-12 —— | TPL-12 | 字体资源托管 | P0 | S3 | Manrope / Plus Jak…
  environment:   bun 1.3.11 / darwin / **无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）
  command:       bun test ./e2e/offline.e2e.ts
  case:          e2e/offline.e2e.ts::外部资源被挂起 → 外壳仍在 8 秒内渲染出来
  result:        该用例通过（外部资源被挂起 → 外壳仍在 8 秒内渲染出来）
  oracle_tier:   formal
  oracle_source: 浏览器平台的形式化行为（脚本执行被渲染阻塞样式表挡住 ⇒ 应用不挂载）＋ 观测判据（外壳是否出现）；**8 秒是工程阈值**（低于外部挂起窗口 20s、低于 page.goto 默认 30s），文档没有给这个数值 —— 它只保证「回归时会快速失败而不是挂死」
  evidence:      spec/evidence/junit-e2e.xml
```
```
EVD-NFR-002
  clause:        SPEC-NFR-002
  acceptance:    AC-NFR-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/backend-features.md 非功能性需求（NFR） —— | | 整本 PPTX 导出（12 页） | < 45s |…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/perf/export-latency.bench.ts
  case:          apps/api/tests/perf/export-latency.bench.ts::pptx-export-p95-under-threshold
  result:        该用例通过（pptx-export-p95-under-threshold）
  oracle_tier:   statistical
  oracle_source: docs/backend-features.md NFR —— 整本 PPTX 导出（12 页） < 45s
  evidence:      spec/evidence/junit.xml
```
```
EVD-NFR-003
  clause:        SPEC-NFR-003
  acceptance:    AC-NFR-003
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §7.2 降级链 —— **降级实现的硬约束**：本地实现必须按 `requirement.topic` **动态生成*…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/chaos/model-fallback.test.ts
  case:          apps/api/tests/chaos/model-fallback.test.ts::model-unavailable-falls-back-with-valid-outline
  result:        该用例通过（model-unavailable-falls-back-with-valid-outline）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §7.2 —— 降级实现的硬约束：必须按 requirement.topic 动态生成
  evidence:      spec/evidence/junit.xml
```
```
EVD-NFR-004
  clause:        SPEC-NFR-003
  acceptance:    AC-NFR-004
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/architecture.md §7.2 降级链 —— **降级实现的硬约束**：本地实现必须按 `requirement.topic` **动态生成*…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./apps/api/tests/chaos/model-fallback.test.ts
  case:          apps/api/tests/chaos/model-fallback.test.ts::fallback-outline-varies-by-topic
  result:        该用例通过（fallback-outline-varies-by-topic）
  oracle_tier:   authoritative
  oracle_source: docs/architecture.md §7.2 —— 本地实现必须按 requirement.topic 动态生成，不能对所有主题返回同一份大纲
  evidence:      spec/evidence/junit.xml
```
```
EVD-GOV-001
  clause:        SPEC-GOV-001
  acceptance:    AC-GOV-001
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/testing-strategy.md §8 质量门禁指标 —— | 领域层行覆盖率 | ≥ 90% | `bun test --coverage` | 阻断 |…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./scripts/check-coverage.check.ts
  case:          scripts/check-coverage.check.ts::domain-coverage-threshold
  result:        该用例通过（domain-coverage-threshold）
  oracle_tier:   authoritative
  oracle_source: docs/testing-strategy.md §8 —— 领域层行覆盖率 ≥ 90%，阻断
  evidence:      spec/evidence/junit.xml
```
```
EVD-GOV-002
  clause:        SPEC-GOV-002
  acceptance:    AC-GOV-002
  verdict:       PASS
  spec_version:  1.0
  input_data:    docs/testing-strategy.md §1.2 可发布门槛（Definition of Done） —— □ 黄金快照全部一致（64 组：8 版式 × 8 主题）…
  environment:   bun 1.3.11 / darwin / 无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）
  command:       bun test ./packages/core/tests/layoutEngine.snapshot.test.ts
  case:          packages/core/tests/layoutEngine.snapshot.test.ts::golden-snapshots-all-match
  result:        该用例通过（golden-snapshots-all-match）
  oracle_tier:   authoritative
  oracle_source: docs/testing-strategy.md §1.2 —— 黄金快照全部一致（64 组：8 版式 × 8 主题）
  evidence:      spec/evidence/junit.xml
```

### 2.4 注入错误检查（验证器的元验证）

共 90 个注入用例，**不合格 0 个**。每个用例走「基线 PASS → 注入必须 FAIL → 还原后重新 PASS」三步。

| 判据 | 注入的错误 | 改动的文件 | 检出者 | 基线 | 检出 | 还原 |
|---|---|---|---|---|---|---|
| AC-CORE-001 | 把画布尺寸改成 1600×900 | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::canvas-is-always-1920x1080` | ✅ | ✅ | ✅ |
| AC-CORE-011 | 画布宽度改成跟着容器走（width: 100%）—— 屏幕上再次变成竖条、出现信箱边 | `src/components/Workbench.tsx` | `e2e/workbench.e2e.ts::AC-CORE-011 工作台画布在屏幕上保持 16:9，不出现信箱边` | ✅ | ✅ | ✅ |
| AC-CORE-012 | 水平方向把 safe center 改回普通 center —— 溢出的一半被推到不可达的左侧 | `src/components/Workbench.tsx` | `e2e/workbench.e2e.ts::AC-CORE-012 画布放大超出可视区后，左右上下都滚得到，不被裁掉` | ✅ | ✅ | ✅ |
| AC-CORE-012 | 垂直方向把 safe center 改回普通 center —— 溢出的一半被推到不可达的顶部 | `src/components/Workbench.tsx` | `e2e/workbench.e2e.ts::AC-CORE-012 画布放大超出可视区后，左右上下都滚得到，不被裁掉` | ✅ | ✅ | ✅ |
| AC-CORE-013 | 不再观察容器尺寸变化 —— 缩放档位停在旧值上，画布不再适配新的可视区 | `src/components/Workbench.tsx` | `e2e/workbench.e2e.ts::AC-CORE-013 容器尺寸变化后缩放档位自动重新适配，画布不被裁掉` | ✅ | ✅ | ✅ |
| AC-CORE-002 | 让页码元素横向越出画布 | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::no-element-out-of-canvas` | ✅ | ✅ | ✅ |
| AC-CORE-003 | 卡片元素 ID 不带 slideId —— 同版式的两页会撞 ID | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::element-ids-unique-across-slides` | ✅ | ✅ | ✅ |
| AC-CORE-004 | 卡片元素 ID 不再携带 slideId | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::layout-element-ids-contain-slide-id` | ✅ | ✅ | ✅ |
| AC-CORE-005 | 在页脚文案里掺入随机数（破坏确定性） | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::layout-engine-is-pure` | ✅ | ✅ | ✅ |
| AC-CORE-006 | 去掉「封面不渲染母版」的分支判断 | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::cover-page-has-no-master-elements` | ✅ | ✅ | ✅ |
| AC-CORE-007 | 页码不再补零到两位 | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-layout.test.ts::page-number-format` | ✅ | ✅ | ✅ |
| AC-CORE-008 | 卡片标题回落到硬编码演示文案（不再用要点标签） | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-content.test.ts::bullet-consuming-layouts-use-outline-bullets` | ✅ | ✅ | ✅ |
| AC-CORE-009 | 封面元信息卡塞入与 outline 无关的固定文案 | `packages/core/src/engine/layoutEngine.ts` | `spec/verify/core-content.test.ts::cover-content-traceable-to-outline` | ✅ | ✅ | ✅ |
| AC-CORE-010 | 要点来源被固定成常量（渲染结果与输入无关） | `packages/core/src/engine/contentBinding.ts` | `spec/verify/core-content.test.ts::render-output-follows-outline-bullets` | ✅ | ✅ | ✅ |
| AC-RND-001 | 文本内容不再转义 | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::user-content-is-xml-escaped` | ✅ | ✅ | ✅ |
| AC-RND-002 | 卡片渲染重新引入 foreignObject | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::svg-contains-no-foreignobject` | ✅ | ✅ | ✅ |
| AC-RND-003 | SVG 重新引入 Google Fonts @import | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::svg-contains-no-external-font-import` | ✅ | ✅ | ✅ |
| AC-RND-004 | 不再输出元素的 id 属性（只留 data-element-id 顶替） | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::svg-preserves-element-ids` | ✅ | ✅ | ✅ |
| AC-RND-004 | data-element-id 的值与 IR id 不一致 | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::svg-preserves-element-ids` | ✅ | ✅ | ✅ |
| AC-RND-005 | 把装饰层改名，破坏四层约定 | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::svg-has-four-layers` | ✅ | ✅ | ✅ |
| AC-RND-006 | 不再截断 —— 装不下的行原样溢出（整段原文直接铺进 SVG） | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::long-text-is-truncated-with-ellipsis` | ✅ | ✅ | ✅ |
| AC-RND-006 | 截断了但不补省略号 —— 文字被切掉，读者却看不出来 | `packages/core/src/engine/svgRenderer.ts` | `spec/verify/render-svg.test.ts::long-text-is-truncated-with-ellipsis` | ✅ | ✅ | ✅ |
| AC-QLT-001 | 把内容分权重从 0.2 改成 0.4 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::quality-formula-weights` | ✅ | ✅ | ✅ |
| AC-QLT-002 | 画布尺寸不符不再扣 15 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::canvas-mismatch-penalty` | ✅ | ✅ | ✅ |
| AC-QLT-003 | 重复元素 ID 不再扣 5 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::duplicate-id-penalty` | ✅ | ✅ | ✅ |
| AC-QLT-004 | 几何越界不再扣视觉分 10 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::out-of-bounds-penalty` | ✅ | ✅ | ✅ |
| AC-QLT-005 | 卡片碰撞不再扣视觉分 8 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::aabb-collision-penalty` | ✅ | ✅ | ✅ |
| AC-QLT-006 | 标题过短不再扣内容分 15 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::missing-title-penalty` | ✅ | ✅ | ✅ |
| AC-QLT-007 | 核心结论缺失不再扣内容分 8 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::missing-keymessage-penalty` | ✅ | ✅ | ✅ |
| AC-QLT-008 | 页数不足不再扣一致性分 15 分 | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::consistency-penalties` | ✅ | ✅ | ✅ |
| AC-QLT-010 | 自动修复不再重排元素 ID（保留重复 ID） | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::autofix-restores-id-uniqueness` | ✅ | ✅ | ✅ |
| AC-EXP-002 | 不再写入演讲者备注 | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::pptx-includes-speaker-notes` | ✅ | ✅ | ✅ |
| AC-EXP-003 | PNG 光栅化改成 1 倍分辨率 | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::png-export-is-2x` | ✅ | ✅ | ✅ |
| AC-EXP-001 | 指标卡的大数字不再导出（正文丢失） | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::pptx-preserves-ir-text-content` | ✅ | ✅ | ✅ |
| AC-EXP-001 | 两个 IR 字符串被拼进同一个文本运行（串行） | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::pptx-preserves-ir-text-content` | ✅ | ✅ | ✅ |
| AC-EXP-001 | 导出时凭空追加固定文案（多出非 IR 文本） | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::pptx-preserves-ir-text-content` | ✅ | ✅ | ✅ |
| AC-EXP-004 | 文件名不再剥离空白与非法字符 | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::export-filename-sanitized` | ✅ | ✅ | ✅ |
| AC-EXP-004 | SVG 文件名丢掉扩展名 | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::export-filename-sanitized` | ✅ | ✅ | ✅ |
| AC-EXP-004 | JSON 文件名丢掉扩展名 | `packages/core/src/engine/exportEngine.ts` | `spec/verify/export-pptx.test.ts::export-filename-sanitized` | ✅ | ✅ | ✅ |
| AC-EXP-005 | 导入时把页序整体倒过来 —— 导出去能再导回来，但回来的页序是反的 | `apps/api/src/services/projectService.ts` | `apps/api/tests/integration/import-bundle.test.ts::exported-bundle-round-trips-with-page-order-intact` | ✅ | ✅ | ✅ |
| AC-EXP-006 | orderIndex 的下界校验被拆掉 —— 0 / 负数能落库，违反内核契约 order >= 1 | `apps/api/src/routes/projects.ts` | `apps/api/tests/integration/import-bundle.test.ts::zero-order-index-is-rejected` | ✅ | ✅ | ✅ |
| AC-EXP-006 | orderIndex 唯一性校验被拆掉 —— 排序键重复，页序静默随机化 | `apps/api/src/routes/projects.ts` | `apps/api/tests/integration/import-bundle.test.ts::duplicate-order-index-is-rejected` | ✅ | ✅ | ✅ |
| AC-EXP-006 | slides 字段不再必填 —— 缺 slides 的文件被当成空项目导进去 | `apps/api/src/routes/projects.ts` | `apps/api/tests/integration/import-bundle.test.ts::missing-slides-field-is-rejected` | ✅ | ✅ | ✅ |
| AC-QLT-009 | 自动修复不再把越出画布的元素挪回安全区（修复后仍然越界） | `packages/core/src/engine/qualityEngine.ts` | `spec/verify/quality-engine.test.ts::autofix-restores-bounds` | ✅ | ✅ | ✅ |
| AC-API-001 | 成功响应不再带 traceId | `apps/api/src/errors.ts` | `apps/api/tests/contract/response-envelope.test.ts::success-response-envelope` | ✅ | ✅ | ✅ |
| AC-API-006 | 失败响应的 error 字段被换成 data | `apps/api/src/errors.ts` | `apps/api/tests/contract/response-envelope.test.ts::failure-response-envelope` | ✅ | ✅ | ✅ |
| AC-API-007 | 错误码枚举被偷偷加了一个 INTERNAL_ERROR | `apps/api/src/errors.ts` | `apps/api/tests/contract/response-envelope.test.ts::error-codes-closed-enum` | ✅ | ✅ | ✅ |
| AC-API-002 | 乐观并发守卫被拆掉（前置检查 + SQL 条件同时失效） | `apps/api/src/services/slideService.ts` | `apps/api/tests/integration/optimistic-lock.test.ts::same-base-version-second-write-conflicts` | ✅ | ✅ | ✅ |
| AC-API-003 | 项目查询不再带 userId 条件（跨租户可读） | `apps/api/src/middleware/auth.ts` | `apps/api/tests/security/cross-tenant-access.test.ts::cross-tenant-resource-read-is-404` | ✅ | ✅ | ✅ |
| AC-API-004 | 模型输出跳过 Schema 校验直接进系统 | `apps/api/src/services/modelRouter.ts` | `apps/api/tests/security/ai-output-validation.test.ts::invalid-model-output-rejected-and-not-persisted` | ✅ | ✅ | ✅ |
| AC-API-005 | 启动失败时以退出码 0 结束（缺密钥也"启动成功"） | `apps/api/src/index.ts` | `apps/api/tests/security/secret-handling.test.ts::missing-api-key-fails-startup` | ✅ | ✅ | ✅ |
| AC-SEC-001 | 密码按明文入库 | `apps/api/src/services/authService.ts` | `apps/api/tests/security/password-hashing.test.ts::password-stored-as-argon2id-hash` | ✅ | ✅ | ✅ |
| AC-SEC-003 | 密码校验永远返回 true（任何密码都登录成功） | `apps/api/src/services/authService.ts` | `apps/api/tests/security/password-hashing.test.ts::password-verify-accepts-correct-and-rejects-wrong` | ✅ | ✅ | ✅ |
| AC-SEC-002 | 会话 Cookie 不再带 HttpOnly | `apps/api/src/services/authService.ts` | `apps/api/tests/security/session-cookie.test.ts::session-cookie-has-security-attributes` | ✅ | ✅ | ✅ |
| AC-SEC-004 | 生产环境也不给 Cookie 加 Secure | `apps/api/src/services/authService.ts` | `apps/api/tests/security/session-cookie.test.ts::session-cookie-secure-in-production` | ✅ | ✅ | ✅ |
| AC-SEC-005 | Session ID 只有 16 字节（熵减半） | `apps/api/src/services/authService.ts` | `apps/api/tests/security/session-cookie.test.ts::session-id-is-32-byte-base64url` | ✅ | ✅ | ✅ |
| AC-NFR-003 | 模型不可用时不再降级（直接把 503 抛给用户） | `apps/api/src/services/agents/outlineAgent.ts` | `apps/api/tests/chaos/model-fallback.test.ts::model-unavailable-falls-back-with-valid-outline` | ✅ | ✅ | ✅ |
| AC-NFR-004 | 降级大纲对所有主题返回同一份（回到旧 fallback 的老毛病） | `apps/api/src/services/agents/localOutline.ts` | `apps/api/tests/chaos/model-fallback.test.ts::fallback-outline-varies-by-topic` | ✅ | ✅ | ✅ |
| AC-NFR-002 | 导出出现长尾（第 19、20 次耗时 46s）—— 判据必须抓长尾，而不是只看中位数 | `apps/api/src/services/exportService.ts` | `apps/api/tests/perf/export-latency.bench.ts::pptx-export-p95-under-threshold` | ✅ | ✅ | ✅ |
| AC-IRP-001 | AI 编辑响应里额外返回 updatedElements（违反「只回增量补丁」的契约） | `apps/api/src/routes/ai.ts` | `apps/api/tests/ai/edit-slide.test.ts::returns-patches-not-full-elements` | ✅ | ✅ | ✅ |
| AC-IRP-002 | add_element 不再对已存在的同 id 元素做幂等处理（施加两次会重复插入） | `packages/core/src/engine/patchApplier.ts` | `packages/core/tests/patchApplier.test.ts::apply-is-idempotent` | ✅ | ✅ | ✅ |
| AC-IRP-003 | remove_element 指向不存在的元素时静默返回（不再报错） | `packages/core/src/engine/patchApplier.ts` | `packages/core/tests/patchApplier.test.ts::remove-missing-element-throws` | ✅ | ✅ | ✅ |
| AC-API-008 | /api/meta/models 把 API Key 原样返回（密钥泄漏到响应体） | `apps/api/src/routes/system.ts` | `apps/api/tests/security/secret-handling.test.ts::secret-never-leaks-into-responses-or-logs` | ✅ | ✅ | ✅ |
| AC-GOV-001 | 把覆盖率门槛从 90 抬到 99（门禁再也拦不住低覆盖率） | `scripts/check-coverage.ts` | `scripts/check-coverage.check.ts::domain-coverage-threshold` | ✅ | ✅ | ✅ |
| AC-GOV-001 | 取消「一个领域内核文件都没采到 → 未通过」的守卫（无法判定被当成通过） | `scripts/check-coverage.ts` | `scripts/check-coverage.check.ts::domain-coverage-threshold` | ✅ | ✅ | ✅ |
| AC-GOV-002 | 版式引擎把标题字号从 38 改成 39（实现与快照基线漂移） | `packages/core/src/engine/layoutEngine.ts` | `packages/core/tests/layoutEngine.snapshot.test.ts::golden-snapshots-all-match` | ✅ | ✅ | ✅ |
| AC-E2E-012 | 重命名时把 name 覆盖回旧值（改名静默不生效） | `apps/api/src/services/projectService.ts` | `e2e/projects.e2e.ts::AC-E2E-012 重命名项目 → 服务端存的是新名字` | ✅ | ✅ | ✅ |
| AC-E2E-013 | 删除项目时不写 deleted_at（软删除没落库） | `apps/api/src/services/projectService.ts` | `e2e/projects.e2e.ts::AC-E2E-013 删除项目 → 服务端真的删掉了（且列表里也没有）` | ✅ | ✅ | ✅ |
| AC-E2E-011 | 项目查询不再带 userId 条件（浏览器链路上跨租户可读） | `apps/api/src/middleware/auth.ts` | `e2e/projects.e2e.ts::AC-E2E-011 跨租户隔离 → 别人的项目拿不到（404 而不是 403）` | ✅ | ✅ | ✅ |
| AC-E2E-001 | 会话不落库（Cookie 签发了，服务端却不认这个会话） | `apps/api/src/services/authService.ts` | `e2e/auth.e2e.ts::AC-E2E-001 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台` | ✅ | ✅ | ✅ |
| AC-E2E-002 | 新建项目时归属写成了别的用户（项目不落在当前用户名下） | `apps/api/src/services/projectService.ts` | `e2e/projects.e2e.ts::AC-E2E-002 新建项目 → 服务端库里真的有这条项目，且归属当前用户` | ✅ | ✅ | ✅ |
| AC-E2E-003 | 解析主题时忽略用户输入（大纲不再随主题变化） | `apps/api/src/services/agents/topicTerms.ts` | `e2e/workbench.e2e.ts::AC-E2E-003 生成大纲 → 页数、主题、服务端与 UI 一致` | ✅ | ✅ | ✅ |
| AC-E2E-004 | 项目 PATCH 忽略前端提交的大纲（编辑静默不生效） | `apps/api/src/routes/projects.ts` | `e2e/workbench.e2e.ts::AC-E2E-004 改大纲标题 → 服务端存新标题，UI 也显示新标题` | ✅ | ✅ | ✅ |
| AC-E2E-005 | 工作台画布的标题被写死（界面渲染的不是服务端返回的 IR） | `src/components/Workbench.tsx` | `e2e/workbench.e2e.ts::AC-E2E-005 确认大纲并编译 → 画布渲染的正是服务端那份 IR` | ✅ | ✅ | ✅ |
| AC-E2E-006 | 写回时不生成新版本号（乐观锁失效） | `apps/api/src/services/slideService.ts` | `e2e/workbench.e2e.ts::AC-E2E-006 就地改文本 → 防抖写回服务端，并产生新版本号` | ✅ | ✅ | ✅ |
| AC-E2E-007 | 乐观锁守卫被拆掉（前置检查 + SQL 条件同时失效） | `apps/api/src/services/slideService.ts` | `e2e/workbench.e2e.ts::AC-E2E-007 两个会话改同一页 → 后者收到 409，前端提示且没覆盖服务端` | ✅ | ✅ | ✅ |
| AC-E2E-008 | IRPatch 施加时被丢弃（服务端没改内容） | `apps/api/src/services/slideService.ts` | `e2e/workbench.e2e.ts::AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘` | ✅ | ✅ | ✅ |
| AC-E2E-009 | PPTX 产物被替换成假字节（不是真的 PPTX） | `apps/api/src/services/exportService.ts` | `e2e/exports.e2e.ts::AC-E2E-009 PPTX 导出 → 产物是真正的 OOXML，而且里面是这份文稿` | ✅ | ✅ | ✅ |
| AC-E2E-010 | PDF 产物被替换成假字节（不是真的 PDF） | `apps/api/src/services/exportService.ts` | `e2e/exports.e2e.ts::AC-E2E-010 PDF 导出 → 产物是真正的 PDF（%PDF 魔数）` | ✅ | ✅ | ✅ |
| AC-E2E-014 | 应用模板时不写回项目（接口说成功，服务端存的还是旧模板） | `apps/api/src/routes/templates.ts` | `e2e/templates.e2e.ts::应用模板 → 服务端存的是新模板，刷新后仍然是它` | ✅ | ✅ | ✅ |
| AC-E2E-014 | 前端应用模板时只改本地 state，不落服务端 | `src/App.tsx` | `e2e/templates.e2e.ts::应用模板 → 服务端存的是新模板，刷新后仍然是它` | ✅ | ✅ | ✅ |
| AC-E2E-020 | 应用模板失败时前端仍然乐观换成本地模板（假成功） | `src/App.tsx` | `e2e/templates.e2e.ts::应用不存在的模板 → 界面如实报错，服务端模板不被改动` | ✅ | ✅ | ✅ |
| AC-E2E-022 | 把外部字体样式表改回渲染阻塞（CDN 不可达时白屏） | `index.html` | `e2e/offline.e2e.ts::外部资源被挂起 → 外壳仍在 8 秒内渲染出来` | ✅ | ✅ | ✅ |
| AC-E2E-008 | 本地降级不再校验补丁能不能画出来（IR 变了但页面没变） | `apps/api/src/services/agents/editAgent.ts` | `e2e/workbench.e2e.ts::AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘` | ✅ | ✅ | ✅ |
| AC-E2E-015 | 服务端评估时漏装了 slides（评的是空项目，分数与界面对不上） | `apps/api/src/routes/quality.ts` | `e2e/quality.e2e.ts::质量报告 → 界面分数与服务端权威评分逐项对得上` | ✅ | ✅ | ✅ |
| AC-E2E-016 | 防抖同步只比较文本（修复带来的 ID 与几何改动不落库） | `src/App.tsx` | `e2e/quality.e2e.ts::一键修复 → 服务端的 IR 真的被改写，版本号前进` | ✅ | ✅ | ✅ |
| AC-E2E-017 | 放映模式只渲染背景层（正文元素没画出来） | `src/components/PresentationMode.tsx` | `e2e/presentation.e2e.ts::放映画面上的文字 == 服务端 IR 里的文字` | ✅ | ✅ | ✅ |
| AC-E2E-018 | 翻页一次跳两页（off-by-one，翻到的不是服务端那一页） | `src/components/PresentationMode.tsx` | `e2e/presentation.e2e.ts::翻页 → 换到服务端的后一页，退回后回到第一页` | ✅ | ✅ | ✅ |
| AC-E2E-019 | 导出提交失败被吞掉，界面改报成功（假成功） | `src/components/ExportModal.tsx` | `e2e/errors.e2e.ts::导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"` | ✅ | ✅ | ✅ |
| AC-E2E-021 | 又加了一张渲染阻塞的外部样式表（CDN 不可达时整页白屏） | `index.html` | `e2e/offline.e2e.ts::应用 HTML → 没有会阻塞渲染的外部样式表` | ✅ | ✅ | ✅ |

> 全部注入错误都被对应验证器抓到。**没有 MISSED 行** —— 上表的 PASS 因此不是自证。**但那是跑批那一刻的结论**：这些用例现在还跑不跑得起来，见 §2.4.2。

#### 2.4.1 这批结论还对当前代码成立吗

注入报告生成于 2026-11-04T23:18:34.865Z。「验证器抓得住这个错」是**某一版**验证器与**某一版**实现之间的结论 —— 跑完之后动过其中任何一边，这条结论就不再自动适用于当前代码。下面按报告里记下的文件指纹逐条比对。

> 逐条比对了跑批时的文件指纹与当前的文件内容：**90 条全部仍然成立**（验证器与被改动的源文件都和跑批时一致）。

#### 2.4.2 现在还跑得起来吗

当前代码里定义了 **90** 条注入用例，全量报告里有 **90** 条。

> 全部 90 条都在报告里，锚点**命中且唯一** —— 现在重跑还跑得起来，报告里的结论没有过期。

> 首轮运行曾出现 1 个 MISSED（AC-RND-004）：判据原文写作「存在 `id=` **或** `data-element-id=`」，弱于条款陈述本身要求的「必须带有 id 属性」。已把判据收紧到与条款陈述及 `docs/test-cases.md` TC-EXP-003 一致，并补上第二条注入（data-element-id 值与 IR 不一致）。

> **注入的必须是「代表性错误」** —— 拆掉乐观锁的前置检查却留着 SQL 里的 `WHERE version_id = ...`，验证器照样返回 409，抓不到；那不是代表性错误，是不完整的错误。AC-API-002 因此需要同时改两处。

> **E2E 的注入跑整个文件而不是单个用例** —— E2E 是一条顺序流程，单独跑一个用例会因为「前置没做」而失败。那种失败跟「抓到了注入的错误」是两回事，混在一起就是假阳性。

> **锚点必须唯一** —— `String.replace(字符串)` 只替换**第一处**匹配。锚点在文件里出现两次时，注入落在第一处，而被测路径可能根本不在那儿：注入「执行成功」、验证器「仍然通过」，看上去是验证器抓不到错，实际上是**注入根本没进到被测代码路径**。首轮的 AC-IRP-001 就栽在这（同一段 `patches: result.patches,` 同时出现在 `/edit-slide` 和 `/suggest` 两个路由里，注入改的是前者，验的却是后者）。现在这条是**硬校验**：锚点不唯一即判该用例不合格。

> **E2E 每一轮都重起服务** —— 服务进程在启动那一刻就把源码读进内存了，之后改磁盘上的文件对它毫无影响。复用同一个进程跑「注入前/注入后」两轮，注入根本没进到被测系统里 —— 又一个自己造出来的假阴性。首轮的 AC-E2E-011/012/013 三个用例就死在这里。现在每一轮都重起，且每轮换一组新端口（端口不换的话，上一轮的进程还没退干净，这一轮就等于连到了旧进程）。

> **注入必须落在被测路径上** —— 改错路由/改错函数，注入就等于没注入。AC-E2E-004 首轮注入的是 `PATCH /api/projects/:id/outline`，而前端保存大纲走的是 `PATCH /api/projects/:id`（`src/services/projectStorage.ts` 的 `updateProject`）—— 注入落在一个没人调的路由上，E2E 自然照样通过。

> **探活要认身份，不能只看 `res.ok`** —— 首轮找空闲端口时「借一个、放一个」连做两次，操作系统把刚放开的端口又发了一遍，于是后端和前端拿到了同一个端口：vite 绑不上（`--strictPort` 直接退出），探活却打到了后端 —— 后端也回 200，于是「前端起来了」是假的，E2E 的基线就这么平白挂了一次。现在两个端口同时占住探针再一起放开，并分别校验「后端回信封」「前端回 HTML」，起不来就换一组端口重试。

> **E2E 现在是离线的 —— 这是文档要求，不是降级偷懒** —— docs/testing-strategy.md §6.1 明写「`bun test` 一律使用回放，不烧 API 额度」，docs/backend-design.md §13 的测试分层把「AI 离线 → 录制响应回放」列为独立一层。E2E 之前的做法（直连官方端点 + `.env` 里的占位 key）**违反**了这一条：它每次都真烧一次外网请求，结论还取决于外网当时的状态。现在模型端点被指向本地替身（`spec/verify/model-stub-server.ts`），替身返回官方端点在占位 key 下的**原样** 400 响应体，于是链路仍是「真 HTTP → 真 SDK → 真错误分类（400 不可重试）→ 真降级链 → 真本地生成」，被换掉的只有链路尽头那台机器。

> **结论的适用范围因此要说清楚** —— E2E 证明的是「模型不可用时前后端仍然集成正确」。它**不**证明「真实模型下的生成质量」，也**不**证明「真实模型下的延迟」。前者由 `apps/api/tests/ai/`（FakeModelClient）覆盖、后者由 `apps/api/tests/perf/` 覆盖 —— 两者同样都不是真实模型。要用真实模型验证，只能在预发环境单独跑，不能进 `bun test`。

> **测试的等待上限不能等于被测实现的最坏值** —— AC-E2E-012 首轮的基线是**掷硬币**：「生成大纲」那一步只等 60s，而降级链的最坏耗时正好是 3 × 20s 模型超时 = 60s。官方端点实测既有 300ms 返回 400 的常态，也有 TLS 校验失败、整整 20s 连不上的时刻 —— 外网一抖，判据就"失败"了。**一次失败的判据分不清是实现坏了还是外网抽风，证据就不成立。** 改走本地替身后，模型调用在 0–7ms 内失败（不再是 60,756ms），一轮 E2E 约 10s。复现脚本：`bun run spec/verify/repro-flake.ts`。

> **超时必须真的 abort 掉请求** —— 后端原先用裸 `Promise.race` 实现超时：竞速输了就不等了，但底层那个 HTTP 请求还挂着，socket 也没释放。现在把生效的超时下推到 SDK 的 `httpOptions.timeout`，由 SDK 自己去 abort —— 竞速的超时和客户端的超时是同一个值，两边不会再各等各的。

> **替身不能跑在调用方的进程里** —— 注入检查用 `Bun.spawnSync` 同步等测试结果，整个进程的 JS 事件循环是**停着**的。替身要是同进程，它的 HTTP 服务就没机会应答，后端发来的请求一直挂到超时（实测每次模型调用整整 60s），E2E 会每次都挂。现在替身是独立进程（`spec/verify/model-stub-server.ts`），端口通过 stdout 的 `PORT=<n>` 交接。**被同步阻塞的进程服务不了别人。**

> **E2E 的页面不能被热重载** —— vite 的 dev server 监听**整个项目根目录**，而 E2E 跑的时候根目录底下一直在变：PGlite 是文件数据库（每写一行都在改 `.data/e2e-pglite/**`）、导出产物落在 `.data/e2e-artifacts/`、浏览器证据落在 `spec/evidence/`、注入检查还会直接改源码。任何一次改动都可能让 vite 给页面发一次**整页重载**。页面一重载，React 的内存状态就没了，E2E 里「UI 操作 → 服务端存了什么」这条链子就断在中间。实测两次：一次让「还原后」那一轮连挂 4 个用例（AC-E2E-006 判为不合格），一次只是碰巧没炸。现在 E2E 的 vite 一律带 `DISABLE_HMR=true`（这个开关本来就是为「agent 改文件时页面乱闪」准备的，见 vite.config.ts）—— E2E 断言的是**服务端状态**，不测热重载，热重载对它是纯噪声。

> **顺带挖出两个真实的前端缺陷**（不是测试问题，是实现问题）—— 页面重载会走一遍「会话恢复 → 拉项目列表 → 拉项目全量」，这条链上暴露出：(a) `App.tsx` 的 `loadProjects()` 用**摘要**覆盖已加载的全量，而摘要里的 `slides` 恒为空数组，于是已加载的每一页 IR 被抹掉；(b) `Workbench.tsx` 在 `project.slides` 为空时仍一路解引用 `currentSlide`，`Cannot read properties of undefined (reading 'slideId')` 直接把整个应用打崩（仓库里没有错误边界）。两个都已修：摘要只更新标量字段、IR 沿用已加载的那份；工作台对「零页」渲染空状态而不是崩。**这是 E2E 的价值 —— 它抓到了单元测试抓不到的东西。**

### 2.5 证据不足的结论（INCONCLUSIVE）

| 条款 | 缺什么 | 为什么不能用 PASS 代替 |
|---|---|---|
| SPEC-NFR-001 | 验证器**已建成**（apps/api/tests/perf/outline-latency.bench.ts，100 次采样），但本轮只跑了**降级模式**：模型不可用时采样到的是本地确定性实现，模型往返延迟根本没被采样到。真实模型下的 P95 仍未测过 —— 结论为 INCONCLUSIVE，不能用降级模式的通过顶替 | 验证器存在但**本次未执行**（用例未出现在证据集中）—— 没跑过的验证不是通过 |
| SPEC-GOV-003 | AMB-001 未裁决 —— 质量闸门阈值在文档中从未给出，判据本身无法成立 | 判据本身不存在，无法判定 —— 连要测什么都没确定 |

### 2.6 已知限制

| 限制 | 影响面 | 是否可接受 | 缓解方式 |
|---|---|---|---|
| AI 端点在本轮证据中走的是**本地确定性降级实现**（.env 里 GEMINI_API_KEY 是占位符，模型不可用） | 所有涉及「模型返回了什么」的判据验证的是降级路径；AC-NFR-001（真实模型 P95）因此只能给 INCONCLUSIVE | 部分 —— 结构合规、落库前校验、降级行为这些判据与模型无关；但延迟类必须在真实模型下重测 | 在有真实密钥的评估环境设 BENCH_REAL_MODEL=1 重跑 `bun test ./apps/api/tests/perf/outline-latency.bench.ts`，把结果并入 spec/evidence/junit.xml |
| **E2E 是离线的**：模型端点被指向本地替身（`spec/verify/model-stub-server.ts`），因此 E2E **永远走「模型不可用 → 本地降级」这条路**，一次也没有连过真实模型 | E2E 验证的是「模型不可用时前后端仍然集成正确」；它**不能**作为「真实模型下的生成质量」或「真实模型下的延迟」的证据。后者由 apps/api/tests/ai/（FakeModelClient）与 perf/ 下的基准覆盖，同样不是真实模型 | 是 —— 而且这是**文档要求的**，不是偷懒：docs/testing-strategy.md §6.1「默认离线：`bun test` 一律使用回放，不烧 API 额度」，docs/backend-design.md §13 的测试分层把「AI 离线 → 录制响应回放」列为独立一层。真实模型只在预发环境用 | 替身返回的是官方端点在占位 key 下的**原样** 400 响应体，于是链路仍是「真 HTTP → 真 SDK → 真错误分类（400 不可重试）→ 真降级链 → 真本地生成」，被换掉的只有链路尽头那台机器。要验证真实模型，需在预发环境单独跑（不进 `bun test`） |
| **E2E 的「生成大纲」等待上限（60s）等于降级链的最坏耗时（3 × 20s 模型超时）** —— 这条等式曾经让整条 E2E 变成掷硬币 | 外网抖一下（实测官方端点有 300ms 返回 400 的常态，也有 TLS 校验失败、整整 20s 连不上的时刻），AC-E2E-012 的基线就在「过」与「不过」之间摇摆。**证据不稳**：一次失败的判据分不清是实现坏了还是外网抽风 | 否 —— 这不是环境限制，是**测试设计的缺陷**。已经修掉：E2E 改走本地替身后，模型调用在 0–7ms 内失败（不再是 60,756ms），一轮 E2E 约 10s | 替身让「模型不可用」变成确定事件而不是概率事件；同时后端把生效超时下推到 SDK 的 `httpOptions.timeout`，让超时**真的 abort 掉请求**（裸 `Promise.race` 只是不等了，socket 还挂着）。复现脚本：`bun run spec/verify/repro-flake.ts` |
| **替身不能跑在调用方的进程里** —— 注入检查用 `Bun.spawnSync` 同步等测试结果，整个进程的 JS 事件循环是停的 | 同进程内的替身 HTTP 服务没机会应答，后端发来的请求一直挂到超时（实测每次模型调用整整 60s 超时），E2E 会**确定性地**失败 —— 这不是偶发，是每次都挂 | 否 —— 已修 | 替身拆成独立进程（`spec/verify/model-stub-server.ts`），端口通过 stdout 的 `PORT=<n>` 交接。被同步阻塞的进程服务不了别人 |
| 前后端集成 E2E 的证据依赖真实浏览器（Playwright + Chromium）与真实服务端进程 | 证据不可移植到没装浏览器的环境；跑一次要拉起两个进程（后端 + vite），比单元测试重 | 是 —— 判据断言的是**服务端状态**（UI 操作 → 库里存了什么），不依赖浏览器的实现细节 | spec/verify/servers.ts 已把「拉起服务 → 跑 E2E → 收尾」收成一条命令（bun run spec/verify/all.ts），并用独立端口 3199/5199 与独立数据目录，不与开发者本机的 dev server 打架 |
| 注入错误检查只覆盖了一部分判据 | 没被注入验证过的判据，它的 PASS 只来自「测试跑过了」，没有被证明「验证器抓得住错」 | 部分 —— 已逐条列出（见 §三），高风险条款优先补 | 给每条判据补一个代表性注入错误；注入的必须是**代表性错误**，不是不完整的错误 |
| 质量门禁分数线未在任何文档中给出 | SPEC-GOV-003 无法写成判据，质量分能否「上线」无从判定 | 否 —— 属关键歧义 | 需业务方给出分数线；已登记为 AMB-001 |
| DOM 垫片只实现尺寸与文件名，PNG/JPG 像素内容未验证 | AC-EXP-003 只覆盖分辨率倍率，不覆盖实际渲染结果 | 是 | 像素级验收交给人工目视或后续接入真实 Canvas 实现 |
| Oracle 中 self-derived 的判据无法独立证明实现正确 | AC-QLT-010（元素 ID 重排规则）只能防回归 | 是 —— 已显式标注，且该条款 risk 不为 high | 等 SPEC-GOV-001 的版本化存储落地后，用真实快照基线替换 |

---

## 三、汇报口径

### 生成了什么

- `spec/spec.yaml` —— 68 条条款 / 101 条判据的机器可读契约
- `spec/spec.schema.json` —— Spec 自身的结构约束（JSON Schema 2020-12）
- `spec/verify/*.test.ts` —— 21 个验证器文件（Spec 自检 + 领域内核 + 导出 + 质量引擎 + 渲染）
- `packages/core/tests/` —— 领域内核（@ppt/core）的版式快照与补丁应用测试
- `apps/api/tests/` —— 后端的契约 / 集成 / 安全 / AI / 混沌 / 性能测试
- `e2e/` —— 13 条前后端集成链（Playwright 真实浏览器 + 真实服务端），断言落在服务端状态上：`e2e/auth.e2e.ts`、`e2e/errors.e2e.ts`、`e2e/exports.e2e.ts`、`e2e/library.e2e.ts`、`e2e/navigation.e2e.ts`、`e2e/offline.e2e.ts`、`e2e/presentation.e2e.ts`、`e2e/projects.e2e.ts`、`e2e/quality.e2e.ts`、`e2e/templates.e2e.ts`、`e2e/workbench-editing.e2e.ts`、`e2e/workbench-pages.e2e.ts`、`e2e/workbench.e2e.ts`
- `spec/verify/servers.ts` —— 为 E2E 拉起后端与前端的编排（独立端口、独立数据目录、HMR 关闭）
- `spec/verify/model-stub-server.ts` —— 模型端点替身本体（独立进程，返回官方端点在占位 key 下的原样 400）
- `spec/verify/model-stub.ts` —— 替身的启动器（端口经 stdout 的 `PORT=<n>` 交接）
- `spec/verify/repro-flake.ts` —— E2E 抖动的复现循环（每轮重起服务并留证）
- `spec/verify/mutation-check.ts` —— 验证器的元验证（注入错误检查）
- `spec/verify/all.ts` —— 全链路入口（结构 → 类型 → 判据 → E2E → 注入 → 追溯矩阵）
- `src/services/projectMerge.ts` + `src/services/projectMerge.test.ts` —— 摘要/全量合并的纯函数与回归锁（前端唯一的单元测试）
- `spec/evidence/` —— junit.xml / junit-e2e.xml / mutation-report.json / coverage.json / 浏览器日志（执行产物，非手写）
- `spec/traceability.md` —— 本文件
- `spec/README.md` —— 使用说明

### 覆盖了什么

- 源文档：`docs/backend-design.md`、`docs/backend-features.md`、`docs/architecture.md`、`docs/testing-strategy.md`、`docs/test-cases.md`、`docs/quality-rules.md`
- 条款 68 条（business/technical/quality/governance），判据 101 条 —— 其中 101 条判据指向可执行验证器
- 成熟度分布：automated 67 / planned 0 / none 1

### 实际验证了什么

- 真的跑了证据集（`bun test spec/verify/ packages/core/tests/ apps/api/tests/ ./scripts/check-coverage.check.ts ./apps/api/tests/perf/export-latency.bench.ts`）：**339 个用例，0 失败，339 通过**，覆盖 38 个测试文件
- 真的跑了前后端集成 E2E（`bun test ./e2e/auth.e2e.ts ./e2e/errors.e2e.ts ./e2e/exports.e2e.ts ./e2e/library.e2e.ts ./e2e/navigation.e2e.ts ./e2e/offline.e2e.ts ./e2e/presentation.e2e.ts ./e2e/projects.e2e.ts ./e2e/quality.e2e.ts ./e2e/templates.e2e.ts ./e2e/workbench-editing.e2e.ts ./e2e/workbench-pages.e2e.ts ./e2e/workbench.e2e.ts`，Playwright 驱动真实 Chromium + 真实服务端）：**98 个用例，0 失败**
- 证据集对账：两层证据共 **437 个用例**，其中 **100 个挂了判据**、337 个没挂；没挂判据的用例里 **0 个失败** —— 「失败明细」里那个「（无）」不是漏报
- 真的跑了 `python3 spec/verify/spec-schema.py`：Spec 结构校验通过（68 条条款 / 101 条判据引用完整）
- 真的跑了 `npx tsc --noEmit`：类型检查通过
- 真的跑了 `bun run spec/verify/mutation-check.ts`：**90 个注入用例，不合格 0 个** —— 每个用例走「基线 PASS → 注入必须 FAIL → 还原后重新 PASS」三步，源文件已全部还原 —— 其中对**当前代码**仍然成立 **90** 条、已过期 **0** 条（见 §2.4.1）
- 领域内核行覆盖率：**93.42% ≥ 90%**（2358/2524 行，证据落盘在 `spec/evidence/coverage.json`）

### 哪些结论仍不可信

- **23 条判据没有做注入错误检查**（AC-CORE-014、AC-CORE-015、AC-CORE-016、AC-CORE-017、AC-QLT-011、AC-QLT-012、AC-QLT-013、AC-QLT-014、AC-QLT-015、AC-QLT-016、AC-QLT-017、AC-QLT-018、AC-QLT-019、AC-QLT-020、AC-QLT-021、AC-EXP-007、AC-EXP-008、AC-RND-007、AC-RND-008、AC-E2E-023、AC-E2E-024、AC-E2E-025、AC-NFR-001）—— 它们的 PASS 只来自「测试跑过了」，没有被元验证证明「抓得住错」
- **SPEC-NFR-001 —— 真实模型下的 P95 从未测过**。验证器已建成，但本轮只跑了降级模式（.env 里的 GEMINI_API_KEY 是占位符），模型往返延迟根本没被采样到
- **SPEC-GOV-003 —— 质量门禁分数线从未在文档中给出**，判据无法存在（AMB-001 未裁决）
- **AC-QLT-010 —— self-derived oracle**，只能防回归，不能证明正确
- **PNG/JPG 的像素内容 —— DOM 垫片只覆盖分辨率**，不覆盖真实渲染
- **AI 生成内容的「质量」本身无人背书** —— 判据只覆盖结构合规、落库前校验与降级行为；文案好不好、有没有洞察，文档没给判据，本 Spec 也不替它编一个

### 下一步最值得解决的一个问题

**在有真实模型密钥的环境重跑 AC-NFR-001，把大纲生成的 P95 从 INCONCLUSIVE 变成可判定的结论。**

理由：这是**唯一一条判据已经写好、验证器已经建成、却因为环境缺一个变量而给不出结论**的条款。其余的不可信项要么需要业务方拍板（SPEC-GOV-003 的分数线）、要么需要引入外部评审者（文案质量），都不是写代码能解决的；而这一条只要给 `GEMINI_API_KEY` 填上真值、设 `BENCH_REAL_MODEL=1`，重跑 `bun test ./apps/api/tests/perf/outline-latency.bench.ts` 就能拿到真实的 P95 采样 —— 100 次采样、statistical oracle、判据原文就是「P95 < 25000ms」，判完就是判完了。

顺带一提：这一条还是**唯一一条至今没有被任何注入错误检查覆盖过的高价值判据**（AC-NFR-001）。真实模型跑起来之后，顺手给它补一个注入（例如把采样里的真实调用替换成本地降级实现，看 P95 是否还"通过"），这条判据才算真正闭合。

