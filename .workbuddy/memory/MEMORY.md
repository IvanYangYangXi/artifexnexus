# Artifex Nexus 项目记忆

## AI 协作规则（PM→开发→QA 三道关卡）

所有开发任务不可跳过：
1. **PM 关卡**（开发前）：审核需求合理性，发现问题先向用户确认
2. **开发关卡**（编码中）：遇到任何设计不明确的点，先确认再继续
3. **QA 关卡**（完成后）：审核代码规范、逻辑通顺、错误处理。问题分级 P0/P1/P2

## UE 编译必知

- **MSB4018 SetEnv 环境变量过长**（2026-05-22）：UE 5.7 生成的 vcxproj 中 IncludePath/SourcePath 超长会导致编译崩溃。解决方案：在项目根目录创建 `Directory.Build.props`，设 `<UseEnv>true</UseEnv>`。文档：`docs/development/ue-msb4018-fix.md`。来源：artclaw_bridge 项目。
- **UE 插件多版本用 git 分支管理**（2026-05-22）：不同 UE 版本 C++ 改动大，工程内不保留多版本目录。当前主分支适配 UE 5.7。`plugin_info.py` 声明 `ue_target`（当前适配版本）+ `ue_min`/`ue_max`（兼容范围）。
- **UE 插件安装/重装保留 Lib/**（2026-05-22）：`packages/dcc/unreal/Content/Python/Lib/` 包含 pip 安装的运行时依赖（pydantic, websockets, cryptography 等），重装插件时不可覆盖删除，应保留或合并。

## 核心设计原则

- **禁止 systemPromptOverride**（2026-05-21）：agent 配置中不设置 `systemPromptOverride`，该字段会阻断 OpenClaw 的 `buildEmbeddedSystemPrompt()`，导致 `<available_skills>` 块丢失。Agent 专属指令写 workspace 的 AGENTS.md。
- **多 Agent Skill 共享**（2026-05-21）：所有 agent workspace 的 `skills/` 通过目录联结（Windows Junction）指向主 `workspace/skills/`，bootstrap 时自动创建。

- **software 统一为 DCCEntry[]**（2026-05-19）：`[{dcc, minVersion?, maxVersion?}]`，RPC key 为 `"software"`
- **category→tags 合并**（2026-05-19）：category 废弃，统一用 tags（OR 匹配）
- **枚举唯一数据源**：`contracts/data/categories.json`
- **SDK 单一源**：`packages/dcc/shared/artifex_nexus_sdk/`，注入 sys.path 解析
- **Skill Hub 扫描加载分离**：`_available`（扫描元数据）+ `_loaded`（懒加载）
- **用户偏好独立于安装器**：pin/favorite 由 `~/.artifexnexus/config/skills.json` 管理
- **配置覆盖原则**：bootstrap 写入默认配置，运行时**不强制重写**用户现有配置
- **sessionKey 格式**：`agent:{agentId}:{subKey}`，统一用 `lib/chat/session-key.ts` 解析
- **构建命令**：`pnpm -C apps/desktop tauri build`（不能只用 `pnpm build`）
- **Gateway WS client ID**：必须用 `openclaw-control-ui`
- **Sidecar 三层防御**（2026-05-18）：Rust preflight → Rust manager.start → Python sidecar.main

## 关键架构

### Tauri Desktop App
- 嵌入 Next.js `out/`，生产构建：`pnpm -C apps/desktop tauri build`
- 开发：`devUrl: http://localhost:18790`
- 主 UI 是 Next.js ChatView（`packages/apps/web`）

### OpenClaw Gateway
- Node.js 进程，监听 `127.0.0.1:19789`（WebSocket + Control UI）
- 入口：`cli/v2026.5.4/node_modules/openclaw/openclaw.mjs`

### Python Sidecar
- JSON-RPC over stdio，位置：`packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/`
- 关键模块：sidecar.py, runtime.py, bootstrap.py, mcp_bridge.py

### 隔离目录 `~/.artifexnexus/.openclaw/`
- `cli/` OpenClaw CLI / `workspace/` skills / `state/` 状态 / `openclaw.json` 配置

## 端口分配

| 端口 | 用途 |
|------|------|
| 18083 | Blender MCP WebSocket Server |
| 18790 | Next.js dev server |
| 19789 | OpenClaw Gateway + Control UI |

## 构建系统

- Web：`next dev -p 18790 --turbopack`
- Desktop 生产：`pnpm -C apps/desktop tauri build`
- Desktop 开发：`pnpm -C apps/desktop tauri dev`
- dev.bat：ASCII-only，杀 18790 后启动 tauri dev

## 收发逻辑（v4 单队列）

- `chat-service.pendingQueue` 为唯一队列，`processQueue()` 为单驱动器
- 消息流：sendMessage → ENQUEUE → processQueue → _doSend → ws.sendChat → DEQUEUE + START_STREAMING
- disconnected 不清 pendingQueue；切换会话清 pendingQueue

## 已知陷阱

1. MCP Bridge 修改 src 后必须同步更新 bundled extension + `openclaw plugins registry --refresh`
2. Gateway 端口固定 19789，不使用自动迁移
3. `agents.list` 是保护配置，添加 agent 需直接修改 `openclaw.json`
4. sidecar 僵尸进程需定期清理
5. dev.bat 必须是纯 ASCII

## Auth 单源策略（2026-05-15）

- artifex 所有 API key 只存 `openclaw.json::models.providers.<id>.apiKey`
- 不再使用 `auth-profiles.json`；`set_auth_token` 直写 openclaw.json（原子 rename）
- 删 provider/model 用 `patch --replace-path models.providers`（最浅路径）
- 每个 provider 必须带 `auth: "api-key"`

## 重装备份

- 备份：workspace/skills/、人格文件、models.providers + auth
- 不备份：plugins/installs.json、plugin-skills/（symlink）、cli/~200MB+、.git/
- 慢 RPC 超时：install/restore=600s, bootstrap=120s, backup=300s，默认 30s

## Skill & Nexus-Tool 系统

- **每个 DCC 只注册 1 个 MCP 工具 `run_python`**（ADR 0003）
- Skill = 包（SKILL.md + manifest.json + __init__.py），SkillTool = @skill_tool 装饰的函数
- 安装路径：`~/.artifexnexus/.openclaw/workspace/skills/`，copy 不用 symlink
- **Nexus-Tool 三态**：无触发器 / 🟢启动触发 / 🔴禁用触发
- `is_enabled` 只控制触发器，不影响手动运行
- **tool-sources.json**：`~/.artifexnexus/config/` 下唯一数据源，三端共享（Sidecar/Blender/其他DCC）
- 实例工具只有 manifest.json，无 main.py，脚本沿用父工具（parentPath fallback）
- **Tool ID 为 UUID v4 GUID**（2026-05-20）：scanner 自动为缺失/旧格式 id 生成 UUID 并持久化；改名/移动目录不漂移；registry/installer/skill_config 统一使用 GUID 作为唯一标识

## Chat 模型选择对接（2026-05-21 修复 + 优化）

**问题**：前端选 `custom/deepseek-v4-flash`，实际 Gateway 使用 agent 默认的 `deepseek-v4-pro`

**根因**：OpenClaw v2026.5.4 的 `chat.send` RPC 协议 schema（`ChatSendParamsSchema`）不含 model 字段且 `additionalProperties: false`。模型必须通过 `sessions.create` / `sessions.patch` RPC 在会话层面设置。

**初版修复**（每次 sendChat 前调 sessions.create）：
- `gateway-ws.ts`：`_ensureSessionModel()` → `sendChat` 新增 `model?` 参数
- `chat-service.ts`：`_doSend` / `_doSendMerged` 传递 `cfg.model`
- `types.ts`：`ChatSendParams` 新增 `model?` 字段

**优化版修复**（2026-05-21 晚，UI 可切换 + 按需调用）：
- **gateway-ws.ts**：公开 `ensureSessionModel()`，策略为 sessions.patch → fallback sessions.create；**移除** sendChat 的 model 参数
- **chat-service.ts**：新增 `changeModel(model)` → 更新 ref + 持久化 localStorage + 调用 ws.ensureSessionModel
- **ChatControlBar.tsx**：Model 从只读 span → Select 下拉（格式对齐 NewSessionDialog：`provider/modelId`）
- **ChatView.tsx**：onConfigChange 中 model 变更时调用 `chat.changeModel`；新会话首条消息前 await changeModel
- **types.ts**：ChatSendParams 移除 `model?` 字段

**RPC 调用时机**：
1. UI 切换模型下拉 → `sessions.patch`（已有会话）→ fallback `sessions.create`
2. 新建会话首条消息前 → `sessions.create`（新会话，await 确保先设模型再发消息）

**教训**：OpenClaw Gateway 的 `sessions.create` / `sessions.patch` 是设置模型的唯一入口。STORY-0039 待增强项 #2 早已记录此问题但一直未修。

## 合规检查器

- **tool-compliance-checker**：检查 Nexus-Tool（manifest schema、software 枚举、trigger 范式、SDK 导入等）
- **skill-compliance-checker**（2026-05-21）：检查 Skill（frontmatter、manifest schema、依赖、tags、@skill_tool）
- **DCC 枚举唯一源**：两个 checker 均从 `contracts/data/categories.json` 运行时读取，不再硬编码
- **合规检查闭环**：nexus-tool-creator / nexus-skill-manage 的指引要求创建/修改后必须运行对应 checker

## 安装向导（Installer Wizard）

- **子项持久化**（2026-05-24）：用户添加的 DCC 子项通过 `localStorage` 持久化，key 格式 `artifex_installer:v1:children:{itemId}`。初始化时从 localStorage 读取并合并到 fixture 数据，子项变更（增/删/改）自动写入。
- **UE 与 Blender 差异**：Blender 需要扫描安装目录检测版本（`dccRegistry` 注册了真实 detect），UE 不需要扫描，纯由用户手动添加工程条目（`handleAddChild` 中已有 UE 专用分支，输入工程路径+版本号）。标签格式为 `项目名 (UE 版本)`。添加后通过 `check_ue_plugin_installed` 异步检测插件是否已安装（检查 `{projectPath}/Plugins/ArtifexNexusForUnreal/` 目录是否存在）。
- **Fixtures 禁止预设子项**（2026-05-24）：所有 DCC 条目（blender, unreal, max, maya）的 `children` 初始必须为 `[]`，不得硬编码预设条目。子项来源只有两个：真实检测（已注册 DCC）+ 用户手动添加。
