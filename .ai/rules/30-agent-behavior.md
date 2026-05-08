# AI Agent 行为准则

面向在本仓库工作的任何 AI 助手（Claude / Cursor / Codex …）。违反即拒绝合并。

## 1. 沟通准则

- **简洁、实事求是**，不编造事实、不捏造 API、不猜路径。
- 每次回复用中文；代码注释中文；公共 API docstring 中英双语。
- 不恭维、不赘述已知事实、不写"接下来我将……"之类废话。

## 2. 接单前必须对齐（Clarify-First）

收到新任务时，必须**先反复追问设计细节**，直到与用户形成共同理解，再进入实现。追问规则：

1. 每个开放问题单独一问，**给出推荐答案 + 推荐理由**。
2. 问题可以通过 **读代码 / 读文档 / 网络检索** 得到答案的，先自己查，查不到再问。
3. 沿着"设计树"逐分支深入，显式列出每个决策的**依赖关系**与**验证标准**。
4. 未达成共识前不动代码；写成短 proposal 放入 `docs/inbox/` 或相关 task 卡片。

### 2.1 SDK/API 审查（强制）

**所有任务**在设计和实现阶段，必须审查：

1. **是否可以提取为 SDK/API**：当前功能是否有可复用的接口/函数/类型，能否抽象为通用 SDK 供其他模块或未来 DCC 使用。
2. **是否已有 SDK/API 可用**：先查 `docs/development/agent-onboarding.md` §6 的 SDK/API 索引，以及 `docs/specs/dcc-plugin-management.md` 的通用规范，确认没有重复造轮子。
3. **提取标准**：
   - 被 2+ 个模块使用 → 必须提取
   - 未来明确会复用（如新 DCC 接入）→ 应该提取
   - 仅当前模块使用且无复用预期 → 暂不提取
4. **提取后必须**：更新 `agent-onboarding.md` §6 的 SDK/API 索引，补充使用示例。

## 3. 变更原则（Minimal-Diff）

- **只做任务要求的事**，禁止顺手重构、顺手统一风格、顺手"优化"。
- **修 bug 先复现再修**；无复现路径不得合并修复。
- 一次提交只改一件事（Conventional Commits）。
- 改代码前先读相邻文件，模仿现有约定。

## 4. 文档-代码交叉引用（强约束）

- 新增/修改文档时，必须更新**所在目录 `README.md` 的索引**。
- 新增/修改代码模块时，必须在对应 `docs/specs/` 或 `docs/development/` 文档中补交叉引用（Obsidian `[[wiki-link]]`）。
- 新 ADR 必须在 `docs/decisions/README.md` 登记。
- 新 Task 必须在 `docs/tasks/README.md` 登记并出现在看板视图。

## 4.1 多级任务管理（EPIC / STORY / TASK）

详见 `[[../../docs/development/task-management]]`。Agent 必须遵守：

1. 三级体系：**EPIC（阶段/大特性）→ STORY（可交付子特性）→ TASK（具体编码任务）**。
   层级靠卡片 frontmatter 的 `kind` 与 `parent` 体现，**不靠目录深度**；三者共用同一组生命周期目录（`backlog/ready/in-progress/review/done/archived`）。
2. **状态迁移三处同步铁律**（每次必须同步 3 处）：
   - 文件位置（`docs/tasks/<status>/`）
   - frontmatter `status`
   - `docs/tasks/board.md` 对应 Kanban 列
   缺一即视为未完成迁移。详见 `[[../../docs/development/sdd-workflow]]` §3。
3. **Kanban 列名必须首字母大写**：`Backlog / Ready / In Progress / Review / Done`，
   与 frontmatter 小写值（`backlog/ready/in-progress/review/done`）逻辑等价。
   Obsidian Kanban 插件不会按 frontmatter 自动归列，**必须手工编辑 `board.md`**。
4. 编号空间：`EPIC-NNNN` / `STORY-NNNN` / `TASK-NNNN` 各自独立递增，跨目录不复用。
5. **不允许在 `parent` 留空**（除 EPIC）；STORY 必须挂 EPIC，TASK 必须挂 STORY 或（极简场景）EPIC。
6. **不允许 Agent 自标 done**：`review → done` 必须由人类触发。

## 4.2 UI 先行（GUI 强约束）

任何涉及 GUI 的 STORY / TASK，**开工前**必须先出 UI 结构 spec：

1. 文件落位 `docs/specs/ui/<module>-structure.md`，至少包含：信息架构 / 状态机 / 关键交互 / 线框（ASCII 即可） / 与现有架构的对接点。
2. 所属 EPIC 卡的"出口条件"必须显式包含"UI 结构 spec accepted"。
3. 设计语言（design tokens / 基础组件）由 M3 阶段统一沉淀到 `docs/specs/ui/design-language.md` 与 `component-inventory.md`，**M3 之前的 UI 不要硬编码视觉**，留替换空间。
4. 允许使用外部辅助（如 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)）做探索，**结论必须沉淀到 spec**，不能仅口述。

## 5. 文档编写原则

| 类型 | 上限 | 拆分方式 |
|------|------|---------|
| PRD / 架构文档 | ≤ **2000 字**/文件 | 按功能模块拆：`PRD_Auth.md`、`PRD_Order.md` |
| API 契约 | 每模块**独立文件** | 禁止把所有 API 堆一个文件 |
| ADR | ≤ 1 页 | 一事一 ADR |
| Task 卡片 | ≤ 500 字 | 过大拆子任务 |

禁止：冗余解释、重复说明、无意义附录、AI 口水话。

## 6. 代码文件规范

- **黄金区间：100–300 行**（AI 修改逻辑最准）
- **硬上限：500 行**，超限必须拆分
- **单一职责**：一个文件只处理一件事（一个类 / 一组相关纯函数 / 一个组件）
- 超长函数 > 80 行必须拆；圈复杂度 > 10 必须重构当前函数（仅当前，不扩散）

## 7. 自检清单（提交前）

- [ ] **SDK/API 审查**：是否可提取 SDK/API？是否已有可复用的 SDK/API？
- [ ] 文档与代码双向交叉引用已更新
- [ ] 相关 README 索引已更新
- [ ] 代码文件未超 500 行
- [ ] 未顺手改无关代码
- [ ] bug fix 有复现步骤
- [ ] 新决策已沉淀为 ADR / task / spec
- [ ] **状态迁移三处同步**（文件位置 / frontmatter.status / board.md 列）已全部完成
- [ ] **GUI 任务**：UI 结构 spec 已 accepted，再写代码
- [ ] **多级任务**：parent / children 双向可达，孤儿（无 parent 又非 EPIC）= 0
