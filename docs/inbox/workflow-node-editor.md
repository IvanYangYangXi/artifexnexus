---
tags: [inbox, epic, workflow, node-editor, comfyui]
created: 2026-05-28
updated: 2026-05-28
status: draft
priority: P0
---

# 目标3：Workflow — 节点式工作流编辑器

> 参考 ComfyUI 的节点式编辑体验，让用户通过可视化节点编排 AI + 工具 + 脚本的复杂工作流。

## 核心设计原则

- **平台通过编码控制生命周期**：Workflow Engine 负责节点调度、状态管理、暂停/恢复
- **节点能力控制流程**：暂停（User Choice）、切换分支（Condition）、结束（Terminate）由节点自身声明
- **运行时 UI**：部分节点执行时弹出自定义操作界面到右侧面板
- **Gateway 只参与特定节点**：仅 `Send to Chat` / `Get Chat Response` 等对话类节点通过 Gateway 通信

## 生命周期模型

```
                    ┌──────────────┐
     start ────────→│   PENDING    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   RUNNING    │──── user input ────→┌──────────────┐
                    └──────┬───────┘                    │   WAITING    │
                           │                            └──────┬───────┘
              ┌────────────┼────────────┐                      │
              ▼            ▼            ▼              ┌───────▼──────┐
         ┌─────────┐ ┌──────────┐ ┌──────────┐        │   RUNNING    │
         │  DONE   │ │ BRANCHED │ │TERMINATED│        └──────────────┘
         └─────────┘ └──────────┘ └──────────┘
```

- **PENDING**: 等待上游节点完成
- **RUNNING**: 正在执行（可触发 UI 面板）
- **WAITING**: 暂停等用户输入（User Choice / 参数输入）
- **DONE**: 执行完成，输出传给下游
- **BRANCHED**: 条件分支，激活一条路径
- **TERMINATED**: 用户或条件终止工作流

## Node（节点）

### 节点能力声明

每个节点类型声明自己的运行时行为：

```json
{
  "type": "user_choice",
  "name": "选择方案",
  "capabilities": {
    "canPause": true,       // 是否需要暂停等用户操作
    "canBranch": false,     // 是否输出分支选择
    "canTerminate": false,  // 是否能终止工作流
    "runtimeUI": true       // 是否需要弹出操作 UI
  }
}
```

### 节点分类

| 类别 | 节点 | capabilities | Gateway 依赖 |
|------|------|-------------|-------------|
| **触发** | `On Demand` | - | 无 |
| | `On Schedule` | - | 无 |
| **工具** | `Run Tool` | - | 无（本地/Nexus-Tool Runtime） |
| | `Run Skill` | - | 无（SkillHub） |
| **AI 对话** | `Send to Chat` | runtimeUI | **需要 Gateway**（创建会话+发消息） |
| | `Get Chat Response` | canPause, runtimeUI | **需要 Gateway**（监听回复） |
| | `AI Analysis` | - | 通过 Gateway 调用模型 |
| **用户交互** | `User Choice` | canPause, runtimeUI | 无（纯前端） |
| | `Input Form` | canPause, runtimeUI | 无（纯前端） |
| **控制流** | `Condition` | canBranch | 无 |
| | `Loop` | - | 无 |
| | `Terminate` | canTerminate | 无 |
| **数据** | `Parse JSON` | - | 无 |
| | `Transform` | - | 无 |
| **脚本** | `Run Python` | - | 无 |
| | `Run Shell` | - | 无 |
| **输出** | `Save File` | - | 无 |
| | `Notification` | - | 无 |

## 运行时 UI（右侧面板 Workflow 分页）

当工作流在 Running/Waiting 状态时，右侧面板新增一个 Workflow 分页（与预览面板并列）：

```
+--------------------------------------------------+
|  [Workflow 运行状态]                    [X 关闭]   |
+--------------------------------------------------+
|  状态: ⬤ Running                                 |
|  工作流: 场景优化流程                              |
|  当前节点: Send to Chat (2/5)                     |
|  ──────────────────────────────────────────────── |
|  [节点运行时 UI 区域]                              |
|                                                   |
|  正在等待 AI 回复...                               |
|  ┌─────────────────────────────────────────────┐  |
|  │ AI 回复内容预览...                           │  |
|  └─────────────────────────────────────────────┘  |
|                                                   |
|  [▶ 继续]  [⏸ 暂停]  [⏹ 终止]                    |
+--------------------------------------------------+
```

当 User Choice 节点运行时：

```
+--------------------------------------------------+
|  节点: User Choice — 选择优化方案                  |
|  ──────────────────────────────────────────────── |
|  ┌─────────────────────────────────────────────┐  |
|  │ ○ 方案A：减面 + LOD（预计减少 40% 面数）      │  |
|  │ ● 方案B：材质合并 + 实例化（无视觉差异）       │  |
|  │ ○ 方案C：混合方案（面数-25% + 材质合并）      │  |
|  │ ○ 方案D：仅清理未使用资产（零风险）            │  |
|  └─────────────────────────────────────────────┘  |
|                                                   |
|  [确认选择]  [跳过]                                |
+--------------------------------------------------+
```

## 示例工作流

```
[On Demand]
    │
    ▼
[Run Tool: scene-stats]      ← 本地执行，无 Gateway
    │
    ▼
[Send to Chat]                ← Gateway：创建会话+发消息
  prompt: "分析场景数据：{{result}}，给出 4 个优化方案"
    │
    ▼
[Get Chat Response]           ← Gateway：监听 AI 回复 → 暂停
    │
    ▼
[AI Analysis]                 ← Gateway：调用模型解析回复 → 提取 4 个方案
  output: ["方案A:...", "方案B:...", "方案C:...", "方案D:..."]
    │
    ▼
[User Choice]                 ← 纯前端：右侧面板展示 4 个选项 → 暂停等选择
    │
    ▼
[Run Skill: scene-optimize]  ← 本地 SkillHub 执行
  params: { "plan": "{{choice}}" }
    │
    ▼
[Notification]                ← 纯前端：toast 通知完成
```

## 基建需求

### 前端
- 节点画布（React Flow 或自研）
- 节点拖拽、连线、缩放
- 节点属性面板（右侧）
- 工作流文件格式 AWF（JSON 序列化/反序列化）
- **右侧面板 Workflow 分页**：运行状态、阶段进度、节点 UI、按钮控制
- 实时节点状态着色（pending=灰, running=蓝, waiting=黄, done=绿, error=红）

### 后端
- **WorkflowEngine**：解析 AWF → 拓扑排序 → 按序执行 → 上下文传递
- Node Runtime：每种节点类型的执行器
- 暂停/恢复机制：User Choice 节点写入等待状态 → 前端通知 → 用户操作 → 恢复执行
- 上下文变量引用：`{{nodeId.outputKey}}`

### Gateway 集成（仅对话类节点）
- `Send to Chat` → `chat-service.sendMessage()`
- `Get Chat Response` → 监听 `chat-service` 的 streaming 事件
- `AI Analysis` → 调用模型 API

## 同步问题确认

- [ ] 右侧面板 Workflow 分页与预览面板的切换逻辑？
- [ ] 是否可以同时运行多个 Workflow？还是单实例？
- [ ] 工作流编辑器与运行态是否分离为两个视图/面板？
