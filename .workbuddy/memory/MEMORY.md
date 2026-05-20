# Artifex Nexus 项目记忆

## AI 协作规则（PM→开发→QA 三道关卡）

所有开发任务不可跳过：
1. **PM 关卡**（开发前）：审核需求合理性，发现问题先向用户确认
2. **开发关卡**（编码中）：遇到任何设计不明确的点，先确认再继续
3. **QA 关卡**（完成后）：审核代码规范、逻辑通顺、错误处理。问题分级 P0/P1/P2

## 核心设计原则

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
