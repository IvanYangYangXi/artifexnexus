# 架构铁律（AI 改代码前必读）

## 1. 包分层与依赖方向

允许的依赖方向（从上到下，单向）：

```
apps/web ────────────┐
platform/cli ────────┼──► platform/contracts / platform/skill / platform/core
                     │
adapters/<platform> ──► platform/core + platform/contracts
                     │
dcc/<dcc>           ──► platform/core + platform/skill + platform/contracts
                       + adapters/<platform>（按需，仅在 DCC 直连场景）
```

**禁止**：
- `platform/core` ❌ 依赖 `platform/skill` 或任何 `adapters/*` / `dcc/*`
- `platform/contracts` ❌ 依赖任何业务包
- `platform/skill` ❌ 依赖具体 DCC 模块（`unreal`、`bpy`）
- `dcc/*` 之间 ❌ 互相依赖
- `adapters/*` 之间 ❌ 互相依赖

## 2. MCP 工具最小化与命名

每个 DCC 的 MCP Server **只注册 1 个工具**：`run_python`。
Gateway 端会自动加 `mcp_{server}_` 前缀变成 `mcp_unreal_run_python` / `mcp_blender_run_python`。

新增能力 = **新增 Skill 包**（用 `@tool` 装饰函数）+ `manifest.json`。
不要在 MCP Server 里注册新工具，不要写 `@mcp_tool` 之类装饰器——违反此约束的 PR 将被拒绝。

## 3. Skill ≠ Tool

- **Skill** = 一个包（目录 + `SKILL.md` + `manifest.json` + `__init__.py`），分发与版本管理的单位
- **Tool** = Skill 包内被 `@tool` 装饰的可调用函数，实际执行的单位
- 一个 Skill 可暴露多个 Tool；装饰器统一为 `@tool`（`@artclaw_tool` 是兼容别名）

## 4. 主线程安全

DCC 内任何 API 调用必须在主线程执行。MCP 处理线程通过 `command_queue` 入队，
由主线程 tick 消费。直接在 MCP 线程调用 `unreal.*` / `bpy.*` 会崩溃。

## 5. 平台默认路径

锚定 `~/.artifexnexus/`，OpenClaw 隔离在 `~/.artifexnexus/.openclaw/`。
**不要**写 `~/.openclaw/`、`~/.artclaw/` 等旧路径。
配置 schema 见 `packages/platform/contracts/schemas/config.schema.json`。

## 6. 安装与引用规则

- Python 包：通过 `artifexnexus.json.source_path` + `sys.path` 引用源码（开发模式），**不要根级 symlink**
- Skill 包：由 `SkillInstaller` copy + 版本管理到 `~/.artifexnexus/.openclaw/workspace/skills/`，**不要 symlink**
- **Blender addon / OpenClaw Gateway 插件：物理拷贝（`shutil.copytree`）+ `deploy-manifest.json` 校验，弃用 junction/symlink**（ADR 0008）
  - 每次安装自动记录所有文件的 `{path, sha256, size}` 到 manifest
  - 前端"检测"按钮调用 `openclaw.deploy.validate` 校验文件完整性
  - 新增 DCC 接入：安装函数中调用 `_record_deployment()` 即自动注册，零配置
- UE 插件：**copy** 到 `<Project>/Plugins/ArtifexNexusForUnreal/`

## 7. 契约即源（Contracts as Source of Truth）

所有跨进程 / 跨语言数据结构必须先在 `packages/platform/contracts/schemas/` 加 JSON Schema，
然后由 Python（pydantic）和 TS（json2ts）派生。
不要在 Python 与 TS 各写一份手写类型——会漂移。详见 ADR 0004。

## 8. 可替换性矩阵

| 组件 | 平台耦合 | 改动注意 |
|------|---------|---------|
| `platform/skill` / `platform/core` / `platform/contracts` | 无 | 永远通用 |
| `dcc/*` 内 MCP Server | 无 | 标准 MCP，不要加私有扩展 |
| `adapters/openclaw/uplink` | 强 | 换平台 = 新建 `adapters/<name>/uplink/` |
| `adapters/openclaw/gateway-plugin` | 强 | OpenClaw 专属，不要复用到其他平台 |

## 9. 每阶段可分发铁律（来自 roadmap.md 核心原则 1）

**每个里程碑末尾必须产出可双击运行的 Tauri artifact**。具体定义见
`docs/vision/roadmap.md` 各阶段的"可分发定义"行。

Agent 在 implement 阶段结束时必须自检：
- [ ] `pnpm tauri build` 是否成功出包？
- [ ] 前端 UI 是否接上了真实逻辑（非桩数据）？
- [ ] 端到端流程是否贯通（用户双击 → 操作 → 看到预期结果）？

若以上任一项不满足，该阶段 implement 不算完成，不得推进到下一阶段。

## 10. 桌面应用代码分层优先级

新功能实现时，**优先使用高层语言，减少编译等待**：

| 优先级 | 层 | 语言 | 职责 | 改动成本 |
|:---:|------|------|------|---------|
| 1 | 前端 | TypeScript / React | UI 逻辑、状态管理、缓存、交互 | 热更新（dev 模式），秒级 |
| 2 | Sidecar | Python | 业务逻辑、文件处理、API 调用、Gateway 管理 | 改完即生效（重启 sidecar 即可），无需编译 |
| 3 | Tauri 后端 | Rust | 框架胶水、IPC 桥接、性能关键路径（如大文件直读） | 需 `cargo build`，分钟级 |

**铁律：能用 TS/Python 做的事，不放 Rust。** Rust 只用于：
- Tauri command 声明（IPC 入口薄层）
- 性能关键的文件 I/O（如直读 .jsonl 绕过 sidecar Mutex 瓶颈）
- 操作系统原生 API 调用（进程管理、窗口管理等）

**反例（不要做）**：
- ❌ 在 Rust 里写业务解析逻辑（应放 Python sidecar）
- ❌ 在 Rust 里写 UI 状态管理（应放前端 TS）
- ❌ 频繁修改 Rust 代码迭代功能（每次改动需全量 `pnpm tauri build`）
