# Artifex Nexus 项目记忆

## AI 协助规则：PM→开发→QA 三道关卡

**所有开发任务必须按以下三道关卡执行，不可跳过：**

1. **PM 关卡（开发前）**：从产品经理角度审核需求合理性。发现需求问题（范围不清、验收标准缺失、依赖未声明、与已有架构冲突等）→ **必须先向用户确认**，不可直接假设或跳过。
2. **开发关卡（编码中）**：实现过程中遇到任何设计上不明确的点（接口选择、边界条件、兼容策略等）→ **必须先向用户确认**，不可自行猜测后继续。
3. **QA 关卡（完成后）**：从 QA 角度对代码进行审核，检查项包括：
   - 代码规范（命名、结构、行数 ≤500、函数 ≤80 行、圈复杂度 ≤10）
   - 逻辑通顺性（是否有死代码、错误处理是否完整、是否有未覆盖的验收标准）
   - 审核结果直接报告给用户

## 设计原则

- **SDK 单一源**：`artifex_nexus_sdk` 只有一份源，位于 `packages/dcc/shared/artifex_nexus_sdk/`。不再维护 `_bundled_nexus_tools/` 下的副本。所有工具、sidecar、trigger_dispatcher 通过注入 `packages/dcc/shared/` 到 sys.path 来解析 `import artifex_nexus_sdk`。
- **Skill Hub 扫描加载分离**：Hub 内部维护两个阶段 —— `_available`（启动时扫描元数据，不 import 模块）和 `_loaded`（首次调用时懒加载）。遵循 ADR 0003 "tool 用到再加载"，不需要独立 Loader 类。
- **用户偏好独立于安装器**：pin/favorite 是用户偏好操作，不属于 SkillInstaller。由 `~/.artifexnexus/config/skills.json` 的 `SkillConfig`（`core` 包）管理，与文件系统操作解耦。
- **单进程无需文件锁**：Sidecar JSON-RPC over stdio 是串行处理，`SkillConfig._save()` 的原子 rename（tmp → replace）已保证数据完整性，不加 fcntl/msvcrt 锁。
- **配置覆盖原则**：sidecar 只在安装时写入默认配置（`bootstrap.py`），运行时**不强制重写**用户已存在的配置。
  - 用户修改应被尊重；bug 修复方式应注释 bootstrap 写入代码而非运行时强制改写。
- **sessionKey 格式**：`agent:{agentId}:{subKey}`，统一使用 `lib/chat/session-key.ts` 解析，禁止手动 `.split(":")`。
- **构建命令**：`pnpm -C apps/desktop tauri build`（包含 Next.js build 作为 beforeBuildCommand），不能用 `pnpm build`。
- **Gateway WebSocket client ID**：必须使用 `openclaw-control-ui`（OpenClaw v2026.5.4 CLIENT_IDS 白名单只有 `webchat-ui` / `openclaw-control-ui`），**不可**用 `artifex-nexus-control-ui`。
- **Sidecar 重复进程三层防御**（2026-05-18）：
  1. Rust `preflight.rs::pre_startup_cleanup()` → `kill_python_sidecars()`（EXE 启动期）
  2. Rust `manager.rs::start()` → `kill_python_sidecars()`（每次 spawn 前）
  3. Python `sidecar.py::main()` → `runtime.kill_existing_sidecars()`（Python 启动期，防御深度）

## 关键架构

### Tauri Desktop App
- 嵌入 Next.js `out/` 产物作为前端
- 配置：`apps/desktop/src-tauri/tauri.conf.json`
- 生产：`frontendDist: ../../../packages/apps/web/out`，`beforeBuildCommand: pnpm --filter @artifex-nexus/web build`
- 开发：`devUrl: http://localhost:18790`，`beforeDevCommand: pnpm --filter @artifex-nexus/web dev`
- Web 前端只能在 Tauri WebView 中使用，浏览器直连会失败（`@tauri-apps/api invoke()` 不可用）
- `apps/desktop/src/` 只是安装向导壳，主 UI 是 Next.js ChatView

### OpenClaw Gateway
- Node.js 进程，监听 127.0.0.1:19789（WebSocket + Control UI）
- 入口：`cli/v2026.5.4/node_modules/openclaw/openclaw.mjs`
- 插件：`cli/v2026.5.4/node_modules/openclaw/dist/extensions/`

### Python Sidecar
- JSON-RPC over stdio，管理 gateway 生命周期
- 位置：`packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/`
- 关键模块：sidecar.py, runtime.py, bootstrap.py, mcp_bridge.py, sidecar_sessions.py

### 隔离目录
- `~/.artifexnexus/.openclaw/`：配置 + PID 锁 + 端口状态 + workspace + skills

## artclaw_sdk → artifex_nexus_sdk 迁移（2026-05-18）

### 审计范围
- 8 个 `_bundled_nexus_tools` 工具脚本含 `import artclaw_sdk as sdk`
- 2 个 compliance-checker 含 20+ 处 `.artclaw` 路径引用

### 创建的 SDK 模块
`packages/dcc/shared/artifex_nexus_sdk/` — 跨 DCC 共享 SDK：
- `params.py` → `parse_params(inputs, kwargs)`
- `result.py` → `success()`, `fail()`, `allow()`, `reject()`
- `context.py` → `get_selected_objects()`, `get_selected_assets()`（自动检测 Blender/UE/Maya/Max）
- `event.py` → `parse(kwargs)` → EventData 对象
- `logger.py` → `get_tool_logger(name)`

Bundled 副本：`_bundled_nexus_tools/artifex_nexus_sdk/`（与源码目录同步）

### SDK 路径注入
- `trigger_dispatcher._execute_tool()`: 注入 `_bundled_nexus_tools/` 根目录到 sys.path
- `sidecar._inject_sdk_path()`: 启动时注入
- Blender addon 将通过 tool-sources.json 配置发现 SDK 路径（待实现）

### 合规检查器更新
- `tool-compliance-checker/main.py` Rules 30-33: 检查 `artifex_nexus_sdk`（同时兼容 `artclaw_sdk` 作为过渡）

## 工具源码目录配置（2026-05-18）

`~/.artifexnexus/config/tool-sources.json`：
```json
{"version": 1, "sources": [{"path": "...", "type": "bundled|skills|user", ...}]}
```

### 写入点
- `bootstrap.py:_register_default_tool_sources()` — 首次安装
- `dcc_installer.py:_try_register_tool_source()` — DCC 插件安装
- `sidecar.py main()` — 每次启动 `verify_and_refresh()`

### RPC 方法
- `tool_sources.list` — 列出所有源码目录
- `tool_sources.register` — 注册新目录
- `tool_sources.verify` — 验证并刷新

### 设计原则
- 工具保留在原目录，不复制到 `~/.artifexnexus/nexus-tools/`
- Blender/DCC 插件通过 `get_all_manifest_paths()` 读取所有已注册目录的 manifest

## 端口分配

| 端口 | 用途 | 协议 |
|------|------|------|
| 18083 | Blender MCP WebSocket Server | WS |
| 18790 | Next.js dev server | HTTP |
| 19789 | OpenClaw Gateway + Control UI | HTTP + WS |

## 构建系统

- Web：Next.js (`packages/apps/web`)，dev 用 `next dev -p 18790 --turbopack`
- Desktop：`pnpm -C apps/desktop tauri build`（生产）/ `pnpm -C apps/desktop tauri dev`（开发）
- dev.bat：ASCII-only 脚本，自动杀 18790 端口进程后启动 tauri dev

## 收发逻辑（v4 单队列架构）

- **单队列**：`chat-service.pendingQueue`（唯一队列），gateway-ws 不持有队列
- **单驱动器**：`processQueue()`（sendMessage 入队后 / chat final / onReadyChange / healthInterval recovered 触发）
- **防重入**：`sendingRef: boolean`
- **消息流程**：sendMessage → ENQUEUE → queueMicrotask(processQueue) → _doSend → ws.sendChat → 成功则 DEQUEUE_BY_TEXT + START_STREAMING
- **关键防御**：disconnected 不清 pendingQueue；切换会话清 pendingQueue；乐观初始化 _eventLoopDegraded=false

## 已知陷阱

1. MCP Bridge 插件修改 src 后必须同步更新 bundled extension + `openclaw plugins registry --refresh`
2. Gateway 端口固定 19789，不使用自动迁移
3. OpenClaw `agents.list` 是保护配置，添加 agent 需直接修改 `openclaw.json`
4. sidecar 僵尸进程累积需定期清理
5. Gateway 内进程重启会导致 sidecar 断连，需 kill 所有进程后手动重启
6. dev.bat 必须是纯 ASCII（Windows cmd 编码问题）

## 团队

使用 `artifex-nexus-team`（产品经理 + 程序 + QA），共享任务列表协作。

## AI 协作规则（2026-05-15 定）

用户要求每一轮开发任务必须经过三道关卡：

1. **开发前 → PM 审核**：从产品经理角度审核需求合理性。发现任何疑点（需求矛盾、边界不清、范围过大/过小、缺验收标准等）**必须先向用户确认**，不得自行假设后直接开发。
2. **开发中 → 即时确认**：遇到任何设计上不明确的点（接口签名、数据结构、错误处理策略、命名、边界情况等），**停下来向用户确认**，不猜测。
3. **开发后 → QA 审核**：从 QA 角度审查代码规范性和逻辑通顺性。检查项包括：
   - 代码风格一致性（与项目现有代码对齐）
   - 错误处理是否完整（异常分支是否被吞）
   - 类型标注是否准确
   - 公共 API 是否有 docstring
   - 是否有明显的逻辑漏洞或边界条件遗漏
   - 是否有死代码或重复逻辑

审核结果在回复中明确呈现（通过/发现问题/需确认），问题分级：
- **P0**：逻辑错误、崩溃风险、数据丢失 → 必须修
- **P1**：设计不一致、边界遗漏、错误处理缺失 → 应该修
- **P2**：风格/命名/文档 → 建议修

## OpenClaw 重装备份

- 备份：workspace/skills/、workspace-<agent>/ 人格文件、auth-profiles.json（双路径）、models.providers + auth
- 不备份：plugins/installs.json、plugin-skills/（symlink）、cli/（~200MB+）、.git/
- 实现：bootstrap.py 备份/恢复 + sidecar RPC + Tauri 命令 + 前端勾选项 UI

### 重装链路与目录约定（2026-05-15 定）
```
~/.artifexnexus/
├── .openclaw/                  ← 当前实例（cli + state + workspace + ...）
├── backups/<ts>/               ← 选择性备份（restore 成功后清理）
└── full-snapshots/<ts>/        ← 全量安全网（永久保留 3 份，自动清理更早）
```

- `agent.workspace` 字段允许相对（`workspace`/`workspace-twelve`）或绝对路径，**备份时必须 `relative_to(openclaw_home)` 规范化**，否则 `backup_dir / abs_path` 会覆盖前缀指向源
- `agents.list` 是 OpenClaw 保护字段，CLI `config patch` 拒写 → restore 用**直写 openclaw.json**（read → replace → atomic rename）
- 慢 RPC 超时分级：install/restore=600s, bootstrap=120s, backup=300s，其他默认 30s（`apps/desktop/src-tauri/src/sidecar/client.rs`）
- 容错复制工具：`bootstrap._safe_copy_file`（fallback 共享读）+ `bootstrap._sqlite_backup`（在线 backup API，可绕过 SQLite 写锁）
- sessions 双路径备份：`state/agents/<id>/sessions/`（legacy）+ `.openclaw/agents/<id>/sessions/`（new），manifest 每条带 `prefix` 字段

### Auth profile 两文件分工（不能合并 / 不能删 auth-profiles.json）
- `openclaw.json` 里 `auth.profiles` 仅存元数据 `{provider, mode}`；CLI `config patch` 主动剥离任何 secret 字段
- `auth-profiles.json` 在 `state/agents/<id>/agent/`（legacy）+ `.openclaw/agents/<id>/agent/`（new），存 `{type, provider, token|key, ...}` —— 真实凭据
- **类型 → 字段映射（OpenClaw 内部）**：
  - `type=api_key` → 读 `cred.key`（从 `apiKey` 字段映射）
  - `type=token` → 读 `cred.token`（直接字段）
  - `type=oauth` → 经 oauthManager 处理
- **常见坑**：手工把 `{ type: "api_key", token: "sk-..." }` 写进去 → OpenClaw 找 `cred.key` 拿不到 → "No API key found"。修：要么 `type: "token"`（直读 token），要么改字段名为 `key`（apiKey 也行）
- **mode 校验**：`openclaw.json.auth.profiles[pid].mode` 必须与 `auth-profiles.json[pid].type` **兼容**（`isCompatibleModeType`）。`oauth` 和 `token` 互通（BEARER_AUTH_MODES），`api_key` 严格匹配
- DEFAULT_AGENT_ID = `"main"` —— 当我们的 agent 不是 `main` 时，OpenClaw 会去 `state/agents/main/agent/` 找 mainStore 合并（不存在则跳过，不报错）

### Auth 解析优先级（OpenClaw v2026.5.4 实测）
顺序（命中即返回）：
1. `agent.profileId` 显式指定 → 走 profile 路径（auth-profiles.json）
2. `authOverride === "aws-sdk"` → AWS SDK 自动鉴权
3. **`shouldPreferExplicitConfigApiKeyAuth(cfg, provider)` → 读 `cfg.models.providers.<id>.apiKey`**（直接 raw 字符串）★ artifex 单源走这条
4. env-first 模式 → 环境变量
5. profile store（auth-profiles.json，type=api_key 读 cred.key / type=token 读 cred.token）
6. 兜底再读 `models.providers.<id>.apiKey`
7. 都没有 → "No API key found for provider"

### Auth 单源策略（2026-05-15 收敛 决议）
- **artifex 只支持 OpenClaw v2026.5.x+**，所有 API key 类凭据**只存** `openclaw.json::models.providers.<id>.apiKey`
- **不再使用** `auth-profiles.json`（legacy `state/agents/<id>/agent/` + new `.openclaw/agents/<id>/agent/` 两路径都不再写/读/备份/恢复）
- `set_auth_token` (config_io.py)：直写 openclaw.json，原子 rename，**不再 spawn `openclaw models auth paste-token`**
- bootstrap `_backup_for_reinstall` `_restore_providers_auth` 移除 auth-profiles.json 备份/恢复逻辑（manifest 里的 `auth_files` 字段保留兼容读取，但仅 log 跳过）
- bootstrap `_migrate_auth_profiles_files` 降级为空 stub（pragma: no cover）
- **OAuth provider 暂不支持**（GitHub Copilot 等）：将来需要时单独引入新路径，**不复用 legacy auth-profiles.json**
- 单源好处：消除 openclaw.json/auth-profiles.json 双源不一致 bug，UI 删除/编辑只改一个文件
- **关键 schema**：每个 provider 必须带 `auth: "api-key"`，否则 OpenClaw `shouldPreferExplicitConfigApiKeyAuth` 返回 false，会绕过 `apiKey` 字段去查 profile store。`set_auth_token` 写 token 时自动补，前端 `buildPatchFromState` 构造 patch 时也强制带

### 删 provider/model 真删（patch --replace-path）— 2026-05-15
- OpenClaw `config patch --stdin` 默认 strict merge，**单纯发空对象/不含某 key 的对象不会删**
- 真删需要 `--replace-path <dot.path>`（CLI 自带，每次可重复多次）
- **关键陷阱**：OpenClaw `visit()` 在外层路径匹配后**整体替换并 return**，不下钻子路径。所以**只能用最浅路径**（`models.providers`），细路径（`models.providers.<id>.models`）会被判 unused → "did not match any value in the input patch"
- **artifex 改造已完成**（4 文件）：
  - `config_io.py::_run_config_patch / patch_config` 加 `replace_paths` 参数
  - `config_io.py::_patch_path_exists` 防御性过滤（先检查 patch 里实际存在再下发）
  - `sidecar.py::_handle_openclaw_config_patch` 接收 `replacePaths`
  - `commands/openclaw_config.rs::openclaw_config_patch` 透传
  - `ipc/openclaw.ts::patchOpenClawConfig` 加第三参数
  - `settings.reducer.ts::buildPatchFromState` 默认带顶层 `replacePaths`：`models.providers`、`auth.profiles`、`auth.order`、`agents.list`（**不再加 `.<id>.models`**）
- 用户在 UI 删 provider/model/agent 现在能真删，不需要走 OpenClaw CLI 删命令

## Skill & Nexus-Tool 系统（调研于 2026-05-15）

### 现状
- **MCP 基础设施已完成**（MCP Server + Gateway Plugin + MCP Bridge Client）—— 端到端验证通过
- **Skill 子系统骨架已建但全部为空桩**：`packages/platform/skill/src/artifex_nexus/skill/` 下 8 个子模块仅有空 `__init__.py`
- **Web UI Skill/SkillTool 页面已做**（mock 数据），待 STORY-0040 接真实 API
- **Manifest Schema 已定义**：`packages/platform/contracts/schemas/manifest.schema.json`

### 架构铁律（不可违反）
- **每个 DCC 只注册 1 个 MCP 工具 `run_python`**（ADR 0003）
- **Skill 由 AI 通过 `run_python` 写代码调用**，不注册独立 MCP 工具
- **Contracts 先行**：所有数据结构先定义 JSON Schema
- **Skill 包不依赖具体 DCC 模块**（bpy/unreal）
- **安装路径**：`~/.artifexnexus/.openclaw/workspace/skills/`，copy 不用 symlink
- **Skill ≠ SkillTool**：Skill = 包（SKILL.md + manifest.json + __init__.py），SkillTool = @skill_tool 装饰的函数
- **枚举唯一数据源**：`contracts/data/categories.json` 为 Software/RiskLevel/Category 枚举的唯一数据源。categories.py 和 manifest.schema.json 均从此读取，禁止各自定义。前端 TS 也应从此 JSON 取枚举值。
- **Category 开放自定义**：预设值在 categories.json，用户可在 manifest 中自定义（格式 `^[\u4e00-\u9fa5a-zA-Z0-9_-]{1,31}$`），UI 动态收集已安装 Skill 的 category 合并展示
- **RiskLevel 硬约束**：仅 low/medium/high/critical 四值，不可自定义

### 调研文档
- `docs/research/artclaw-tool-manager-skill-tool-survey.md` — 全量调研报告
- `docs/research/artclaw-tool-manager-replication-plan.md` — 复刻接入方案 v1
- `docs/research/artclaw-tool-manager-replication-plan-v2.md` — **v2 最终方案**（复制优先、35 文件映射、SDK/API 设计、路径调整）

### v2 实施任务（2026-05-15 已创建）
| STORY | 内容 | 父 EPIC |
|-------|------|---------|
| STORY-0042 | @skill_tool 装饰器 + Manifest + Version | EPIC-0004 | ✅ done |
| STORY-0043 | SkillHub + Registry + Conflict | EPIC-0004 | ✅ done |
| STORY-0044 | SkillInstaller + Loader + Config | EPIC-0004 | ✅ done |
| STORY-0045 | NexusToolRegistry + NexusToolInstaller | EPIC-0005 | next |
| STORY-0046 | Sidecar RPC：Skill/SkillTool 方法注册 | EPIC-0004 | |
| STORY-0047 | Web UI：Skill/SkillTool 管理面板接线 | EPIC-0004 | |
| STORY-0048 | Skill/SkillTool 内容迁移（16 项） | EPIC-0004 | |

### 推荐执行顺序
A1(decorator) → A2(manifest) → A3(hub) → B4(registry) → C1(sidecar RPC) → C2/C3(UI wiring)

### Nexus-Tool 触发器三态设计（2026-05-17 定）
- **三态**：无触发器（不显示按钮）/ 启动触发（🟢徽章 + 「禁用触发」按钮）/ 禁用触发（🔴徽章 + 「启动触发」按钮）
- **`is_enabled` 只控制触发器**，不影响「▶ 运行」按钮（手动运行永远可用）
- **启用/禁用不改触发器 `enabled` 字段**（存 skills.json 的 `nexus_tools.disabled`）
- **总闸 + 分闸独立**：`is_enabled` 是总闸，每条 trigger 的 `enabled` 是分闸，互不修改
- **SDK `run_nexus_tool()` 已移除 `is_enabled` 门禁**（registry.py）

### tool-sources.json 三端共享（2026-05-19）
- `~/.artifexnexus/config/tool-sources.json` 是唯一数据源，被 3 个消费端读取：
  1. Sidecar `trigger_dispatcher._load_tools()` → `tool_sources.get_all_manifest_paths()`
  2. Blender `trigger_dispatcher._get_source_dirs()` → 直接读 JSON（无法 import sidecar 模块）
  3. 其他 DCC addon（未来）
- **注册环节**：`bootstrap.py`（首次安装）、`dcc_installer.py`（DCC 插件安装）、`sidecar.py main()` 启动期兜底
- **目录类型**：`bundled`（内置工具）、`skills`（技能目录）、`user`（`~/.artifexnexus/nexus-tools/`，实例工具目录）
- **去重**：`_normalize_path()` 剥离 Windows `\\?\` 前缀，防止同目录因前缀不同被重复注册

### 实例工具 parentPath fallback 约定（2026-05-19）
- 实例工具只有 `manifest.json`（参数副本），**无 `main.py`**，脚本沿用父工具
- 两个 `trigger_dispatcher._execute_tool()` 必须实现 parentPath fallback：
  ```python
  entry_path = Path(tool_dir) / entry
  if not entry_path.exists():
      parent_path = manifest.get("parentPath", "")
      if parent_path and Path(parent_path).is_dir():
          tool_dir = parent_path
  ```
