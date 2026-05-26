# Artifex Nexus 项目记忆

## AI 协作规则

1. **PM 关卡**（开发前）：审核需求合理性，先确认再动手
2. **开发关卡**（编码中）：任何设计不明确先确认
3. **QA 关卡**（完成后）：代码规范、逻辑、错误处理。P0/P1/P2 分级

## UE 编译必知

- **UE 5.7 编译三件套（MSB4018/C3859/C1076）**：三层防御：`Directory.Build.props`→`<UseEnv>true</UseEnv>` + `BuildConfiguration.xml`→`<bUseUnityBuild>false</bUseUnityBuild>` + `Directory.Build.targets`→`/Zm2000`
- 属性名是 `bUseUnityBuild` 非 `bUseUnity`；`/Zm` 必须用 `.targets` 追加
- 插件多版本用 git 分支管理；安装/重装保留 `Lib/` 目录
- 详见 `docs/development/ue-msb4018-fix.md`

## 核心设计原则

- **禁止 systemPromptOverride**：会阻断 `buildEmbeddedSystemPrompt()` 导致 `<available_skills>` 丢失
- **多 Agent Skill 共享**：通过 Windows Junction 指向主 `workspace/skills/`
- **software 统一为 DCCEntry[]**：`[{dcc, minVersion?, maxVersion?}]`
- **category→tags 合并**，枚举唯一源 `contracts/data/categories.json`
- **SDK 单一源**：`packages/dcc/shared/artifex_nexus_sdk/`
- **构建命令**：`pnpm -C apps/desktop tauri build`（不能用 `pnpm build`）
- **sessionKey 格式**：`agent:{agentId}:{subKey}`，统一用 `lib/chat/session-key.ts`

## 关键架构

- **Tauri Desktop App**：嵌入 Next.js `out/`，开发 `devUrl: http://localhost:18790`
- **OpenClaw Gateway**：Node.js 监听 `127.0.0.1:19789`（WS + Control UI）
- **Python Sidecar**：JSON-RPC over stdio，位于 `packages/adapters/openclaw/wrapper/`
- **隔离目录**：`~/.artifexnexus/.openclaw/`（cli/ workspace/ state/ config）

## 端口分配

| 端口 | 用途 |
|------|------|
| 18080 | UE MCP Server |
| 18081 | Maya MCP Server |
| 18082 | 3ds Max MCP Server |
| 18083 | Blender MCP Server |
| 18790 | Next.js dev server |
| 19789 | OpenClaw Gateway + Control UI |

## 收发逻辑（v4 单队列）

- `chat-service.pendingQueue` 为唯一队列，`processQueue()` 为单驱动器
- 消息流：sendMessage → ENQUEUE → processQueue → _doSend → ws.sendChat → DEQUEUE + START_STREAMING

## 已知陷阱

1. MCP Bridge 修改后必须同步 bundled extension + `openclaw plugins registry --refresh`
2. Gateway 端口固定 19789
3. `agents.list` 是保护配置，添加 agent 直接改 `openclaw.json`
4. Sidecar 僵尸进程需定期清理
5. `dev.bat` 必须是纯 ASCII

## DCC 插件开发要点

- **Maya**：userSetup.py 部署到 `scripts/`，`maya.utils.executeDeferred` 延迟启动，单例 Server
- **3ds Max**：`QTimer.singleShot(2000)` 延迟，`_startup_done` 进程锁，MacroScript 先注册再引用
- **Gateway Plugin**：修改 index.ts 后重编译 index.js；重装需重启 Gateway
- **MCP 端口**：UE 18080 / Maya 18081 / Max 18082 / Blender 18083
- **共享 SDK**：`BaseDCCAdapter` + `MCPServer` 在 `packages/dcc/shared/artifex_nexus_sdk/`
- 详见 `docs/development/dcc-plugin-development-guide.md`

## Auth（单源策略）

- API key 只存 `openclaw.json::models.providers.<id>.apiKey`，删 provider 用 `patch --replace-path`

## Skill & Nexus-Tool

- 每个 DCC 只注册 1 个 MCP 工具 `run_python`（ADR 0003）
- Skill = SKILL.md + manifest.json + __init__.py
- Nexus-Tool 三态：无触发器/启动触发/禁用触发；`is_enabled` 只控制触发器
- Tool ID 为 UUID v4 GUID

## Chat 模型切换

- 模型通过 `sessions.create`/`sessions.patch` 在会话层面设置（`chat.send` 不含 model 字段）
- `chat-service.changeModel()` → ws.ensureSessionModel → sessions.patch → fallback sessions.create
- UI 下拉格式：`provider/modelId`

## 安装向导

- 子项通过 localStorage 持久化（`artifex_installer:v1:children:{itemId}`）
- UE 子项纯手动添加（输入路径+版本号），Blender 通过扫描检测
- Fixtures 禁止预设子项，来源只有真实检测 + 用户手动添加

## 右侧面板 UI（v4）

- 单层 `CollapsiblePanelGroup`，声明式尺寸控制（minSize/maxSize）
- 折叠：锁定 header 高度；隐藏：从 DOM 移除
- 双列模式：horizontal PanelGroup 嵌套 left/right vertical
- 关键文件：`packages/ui/src/components/collapsible-panel.tsx`

## 对话自动清理（2026-05-27）

- `session-cleanup.ts`：空会话 >24h + 无 transcript → 自动删除；过期 >30d → 自动删除
- 静默清理（console.log），ChatControlBar 会话加载后延迟 30s 触发，不阻塞 UI
- 即时过滤：`hasTranscript=false` 且创建 >24h 的会话从下拉列表直接隐藏
- 清理层次：下拉过滤 → 30s 后 IndexedDB 批量删除 → localStorage 清理 → chat-service 内存清理
