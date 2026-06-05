---
tags: [handoff, M11, prompt]
created: 2026-06-04T00:30
updated: 2026-06-04T00:30
status: active
---

# M11 开发关卡新对话提示词 / Handoff Prompt

> 直接复制下面 `===` 之间的全部内容，贴到新对话作为首条消息。
> 当前对话已完成 PM 关卡，两份草稿与 EPIC 卡已落盘，新对话从开发关卡 STORY-0075 开始。

---

```
你是我在 artifex-nexus 项目的 AI 协作者，现在进入 EPIC-0011 / M11
「节点式工作流编辑器」的开发关卡。

工作目录：D:\MyProject_D\artifexnexus
工作模式：你是主 agent，负责【审核 + 串联 + 收尾】，
         具体编码全部分配给子 agent 执行（Agent 工具，subagent_type 选 general-purpose）。
今晚目标：把 STORY-0075 至 STORY-0082 全部跑完 + 自审 review，
         明早用户起来直接验收。

═══════════════════════════════════════════════════
0. PM 关卡产物（已 accept，开工前先读）
═══════════════════════════════════════════════════
- D:\MyProject_D\artifexnexus\docs\tasks\backlog\EPIC-0011-m11-workflow-editor.md
  · DoD 8 项 / 8 STORY 清单 / 选型论证 / 风险表 / 进展日志
- D:\MyProject_D\artifexnexus\docs\specs\ui\workflow-editor-structure.md
  · 信息架构 / 工作流级 6 态 + 节点级 7 态 / 8 类端口 / 9 类节点 18 个 / 节点能力 4 维 / Diff / AppShell 对接
- D:\MyProject_D\artifexnexus\.workbuddy\memory\MEMORY.md（项目长期记忆）
- D:\MyProject_D\artifexnexus\.workbuddy\memory\2026-06-04.md（M10 全程 + M11 PM 落定记录）
- D:\MyProject_D\artifexnexus\docs\tasks\done\EPIC-0010-m10-data-view.md（参考粒度）
- D:\MyProject_D\artifexnexus\docs\specs\ui\data-view-structure.md（参考写法）

═══════════════════════════════════════════════════
1. 硬性约束（违反必返工）
═══════════════════════════════════════════════════
- 单文件 100–300 行黄金区，硬上限 500 行
- 禁止 systemPromptOverride
- 视觉值全部 token：hsl(var(--*))，禁止硬编码颜色/字号/圆角
- React Hooks 必须在所有 early return 之前
- 端口已分配：18080 UE / 18081 Maya / 18082 Max / 18083 Blender / 18790 Next.js / 19789 Gateway
- 构建命令：apps 改动走 `pnpm -C apps/desktop tauri build`
- ASCII 引号：写代码/JSON/shell 时只用直引号
- 文档 frontmatter：updated 精确到分钟，状态用表格

═══════════════════════════════════════════════════
2. 技术栈现状
═══════════════════════════════════════════════════
- 前端：Next.js 14 + React 18 + Tauri 2 + @artifex-nexus/ui + Tailwind v4
- 状态：useReducer + Context（参考 packages/apps/web/src/components/data/DataPage.tsx）
- 节点画布：@xyflow/react（M11 新引入，需 add 到 packages/apps/web）
- 测试：vitest 2.1
- 数据契约：JSON Schema → TS（typescript/src/generated）+ Python（python/src/artifex_nexus）双派生

═══════════════════════════════════════════════════
3. 8 个 STORY 执行计划
═══════════════════════════════════════════════════

每个 STORY：
1. 主 agent 先开 STORY 卡到 docs/tasks/ready/STORY-NNNN-*.md
   （DoD ≤6 项 / AC / 影响文件 / 接口签名 / 测试要求）
2. 主 agent 用 Agent 工具派发子 agent（subagent_type=general-purpose）实施
3. 子 agent 完成 → 主 agent 审核：
   - 跑 `pnpm -C packages/apps/web tsc --noEmit`
   - 跑 vitest（如有单测）
   - 文件行数检查（>300 警告 / >500 强制拆）
   - token 硬编码检查（grep '#[0-9a-f]\{6\}' src/）
   - hooks 顺序检查
4. 通过则 STORY → done/，失败则就地修
5. 主 agent 把 EPIC 卡进展日志加一行（时间精确到分钟）

执行顺序（有依赖）：

| # | STORY | 名称 | 估时 | 依赖 | 子 agent 数 |
|---|-------|------|------|------|------------|
| 1 | 0075 | AWFF schema + 类型派生 | 3d | - | 1 |
| 2 | 0076 | WorkflowEngine 核心 | 5d | 0075 | 1 |
| 3 | 0077 | 节点 Registry + 18 内置节点 | 4d | 0076 | 1 |
| 4 | 0078 | WorkflowPage UI 外壳 | 4d | 0075,0077 | 1 |
| 5 | 0079 | InspectorPanel 抽象 + 4 分页 | 3d | 0078 | 1 |
| 6 | 0080 | 反向编辑 + AWFF Diff 导出 | 2d | 0079 | 1 |
| 7 | 0081 | 运行时 UI + 节点能力 | 3d | 0080 | 1 |
| 8 | 0082 | E2E checklist + tauri build | 2d | 0081 | 1 |

可并行的：0075 与 0076 同步动（0076 前期可先用临时 type）；0078 的 React Flow 集成与 0077 节点 Registry 可错峰并行。

═══════════════════════════════════════════════════
4. 子 agent prompt 模板（主 agent 必须用这个调）
═══════════════════════════════════════════════════

每次 Agent 调用，prompt 必须包含：
1. STORY ID + 标题
2. 工作目录绝对路径
3. 必读文件清单（spec + EPIC 卡 + STORY 卡）
4. 该 STORY 的 DoD 与 AC
5. 影响文件清单 + 接口签名
6. 硬性约束（行数 / token / hooks / 引号）
7. 完成后必须做的自查（tsc / vitest / 行数 / 提交格式）
8. 输出要求：报告"完成 / 待修 / 阻塞"，列出实际改动文件

子 agent 不直接改 EPIC / spec / memory，只负责该 STORY 的代码 + STORY 卡 + 单测。
EPIC / spec / memory 由主 agent 串联。

═══════════════════════════════════════════════════
5. Review 标准（主 agent 自审，明早交付）
═══════════════════════════════════════════════════

完成所有 STORY 后，主 agent 出一份 QA review 报告：
- 路径：docs/tasks/review/EPIC-0011-m11-review.md
- 分级：P0（阻塞验收）/ P1（应修但不阻塞）/ P2（建议）
- 每条问题给：问题描述 + 文件:行号 + 修法
- DoD 8 项逐项打勾 / 打叉
- 出口条件 4 项逐项打勾 / 打叉
- tauri build 实测结果（成功 / 失败 + 日志摘要）
- 截图归档（如果环境允许）

═══════════════════════════════════════════════════
6. 时间纪律
═══════════════════════════════════════════════════
- 现在是 2026-06-05 凌晨，明早用户验收
- 子 agent 单次执行 ≤ 30 分钟，超时主 agent 介入拆分
- 串行 STORY，每完成一个写日志 + memory 一行
- 每个整点检查一次进度，落后则缩范围（首版本可以再砍：18 节点缩到 12，对话节点全 mock，Run Python/Shell 直接 disabled）

═══════════════════════════════════════════════════
7. 出口
═══════════════════════════════════════════════════
- 8 个 STORY 全 done
- DoD 8/8 通过
- review 报告就绪（有 P0 也写下来，让用户决定）
- memory 写入 2026-06-05.md
- 给用户一份"明早验收清单"（5 步内能验完）

现在开始：先把 §0 的两份 PM 产物 + 2026-06-04 memory 读一遍，
回我"准备就绪 + 今晚执行计划"，然后立刻派 STORY-0075 子 agent 开干。
不要再问我，直接做完。
```

---

## 备注

- 用户偏好"先读完上下文 → 一句话计划 → 直接做完"，**不要再开 PM 关卡问题**
- review 报告给 P0/P1/P2 时务必带 `文件:行号` 和"修法"两个字段
- 如果今晚 React Flow 装不下来或 tauri build 卡死，主 agent 必须降级（spec 已写降级路径：节点数缩、对话全 mock、Python/Shell 节点 disabled）
- 每完成一个 STORY，主 agent 必须 append 一行到 `docs/tasks/backlog/EPIC-0011-m11-workflow-editor.md` 进展日志
