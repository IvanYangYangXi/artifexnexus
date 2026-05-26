# Artifex Nexus 项目记忆

## AI 协作规则（PM→开发→QA 三道关卡）

所有开发任务不可跳过：
1. **PM 关卡**（开发前）：审核需求合理性，发现问题先向用户确认
2. **开发关卡**（编码中）：遇到任何设计不明确的点，先确认再继续
3. **QA 关卡**（完成后）：审核代码规范、逻辑通顺、错误处理。问题分级 P0/P1/P2

## UE 编译必知

- **UE 5.7 编译错误三件套（MSB4018 / C3859 / C1076）**：超长 IncludePath 引发三种错误，需三层防御：
  1. **MSB4018**：`Directory.Build.props` → `<UseEnv>true</UseEnv>` 跳过 SetEnv（环境变量 32K 限制）
  2. **C3859/C1076 核心修复**：`BuildConfiguration.xml` → `<bUseUnityBuild>false</bUseUnityBuild>` 禁用 Unity Build（多个 .cpp 合并成巨量翻译单元 → PCH 编译撑爆编译器堆，这是**主因**）
  3. **C3859/C1076 辅助**：`Directory.Build.targets` → `/Zm2000` 提升 IntelliSense PCH 编译器堆（默认 100MB→2000MB）；`<MaxParallelActions>4</MaxParallelActions>` + `<bAllowXGE>false</bAllowXGE>` 限制并行度
  注意：属性名是 `bUseUnityBuild` 非 `bUseUnity`；`/Zm` 必须用 `.targets` 追加（`.props` 会被 vcxproj 覆盖）
  详见 `docs/development/ue-msb4018-fix.md`。
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

## DCC 插件开发规范（2026-05-26，参照 artclaw）

### Maya
- **userSetup.py 必须部署**到 `scripts/`：Maya 启动自动加载；安装器自动生成
- **register() 用 `maya.utils.executeDeferred`** 延迟启动（等 UI 就绪）
- **单例 Server**：模块级变量防重复创建

### 3ds Max
- **QTimer.singleShot(2000) 延迟启动**：不可在模块顶层立即执行
- **_startup_done 进程锁**：防重复进程
- **MacroScript 先注册再引用**：菜单项必须先用 `rt.execute('macroScript ...')` 注册
- **主线程调度用 QTimer(50ms) 轮询**：比 #timeout 回调可靠；QTimer 不可用时回退 #timeout

### Gateway Plugin
- 修改 index.ts 后必须重编译 index.js（`pnpm --filter @openclaw/mcp-bridge build`）
- Tauri build 前 `beforeBuildCommand` 自动编译
- 部署后需重启 Gateway 才能加载新插件
- 安装向导独立行放在 openclaw 下方
- 详见 `docs/development/dcc-plugin-development-guide.md`

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
- **UE 测试工程路径**（2026-05-24）：`D:\MyProject_D\artifexnexus_packages\ue57_artifex_nexus`，插件同步目标 `{project}/Plugins/ArtifexNexusForUnreal/Content/Python/tools/`。
- **Blender addon 运行路径**（2026-05-25）：`%APPDATA%/Blender Foundation/Blender/5.1/scripts/addons/artifex_nexus/` — 主项目修改后必须同步到此路径才能在 Blender 中生效。
- **DCC 代码部署规则**（2026-05-25）：主项目源码修改后，必须同步到各 DCC 实际运行目录（UE 测试工程 / Blender addons 目录），否则 DCC 仍运行旧代码。
- **Maya 插件安装路径**（2026-05-25）：`~/Documents/maya/{ver}/scripts/artifex_nexus/`，locale 同步到 `xx_XX/scripts/` 物理复制。
- **3ds Max 插件安装路径**（2026-05-25）：`%LOCALAPPDATA%/Autodesk/3dsMax/{ver}/ENU/scripts/artifex_nexus/`，入口 `scripts/startup/artifex_startup.ms` → `startup.py`。
- **MCP 端口分配（全 DCC）**（2026-05-25）：UE 18080 / Maya 18081 / Max 18082 / Blender 18083 / Gateway 19789。
- **共享 SDK 架构**（2026-05-25）：`BaseDCCAdapter` + `MCPServer` 提升到 `packages/dcc/shared/artifex_nexus_sdk/`，MCPServer 通过 `dcc_name`/`dcc_version`/`port` 参数化，`register_builtin_tools()` 保留在各 DCC 侧。
- **DCC 插件版本号规则**（2026-05-25）：插件版本号 = 目标 DCC 主版本号。Maya/Max 本地测试用 2023，版本标记为 `v2023`。Blender 用 `v5.0.0`（对应 Blender 5.0.x）。`plugin_info.version` = `(主版本号,)` 元组。
- **端口冲突处理规则**（2026-05-25）：固定端口的 DCC（Maya 18081 / Max 18082）使用 `max_port_probe=0`，端口被占用时 pre-check 跳过启动 + UI 警告。共享 SDK 默认 `max_port_probe=10`（Blender 继续使用自动端口探测）。
- **触发器调度器共享**（2026-05-25）：`TriggerDispatcher` 类提取到 `trigger_dispatcher_base.py`，Maya/Max 侧仅保留事件钩子注册/注销函数。

## 右侧面板 UI 架构（2026-05-26，v4）

- **单层结构**：所有 D1-D5 面板在同一个 `CollapsiblePanelGroup` 内。
- **声明式尺寸控制**（v4）：废弃命令式 `collapse()/expand()`，通过 `minSize`/`maxSize` 锁定尺寸：
  - 展开：`minSize={minSize}`, `maxSize={undefined}` → 可拖拽
  - 折叠：`minSize={collapsedSize}`, `maxSize={collapsedSize}` → 锁定 header 高度，空间重分配时不会被推动
  - 隐藏：面板从 PanelGroup DOM 中**移除**（`.filter(!hiddenRegistry[id])`）→ 空间释放到展开面板
- **展开用 RAF + resize()**：`useEffect([open])` 检测 collapsed→expanded 时，RAF 延迟到下一帧 resize(defaultSize)，避开 "index -1" 错误。
- **列切换用唯一 key**：Fragment key 使用 `{panelId || i}`（非纯 index），确保 React 在列切换时重新 mount 组件 → `mountedRef` 正确重置。
- **双列模式**：horizontal PanelGroup 嵌套 left/right vertical PanelGroup。全部默认左列，用户切换列归属持久化到 localStorage。
- **列归属单向同步**：`setColumn` 只更新内部 state，独立 `useEffect` 在 render 后单向同步。
- **关键文件**：`packages/ui/src/components/collapsible-panel.tsx`、`packages/apps/web/src/components/shell/RightPanel.tsx`
