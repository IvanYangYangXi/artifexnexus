---
tags: [spec, openclaw, survey, research, M1]
created: 2026-05-06
status: draft
related_story: "[[../tasks/done/STORY-0007-openclaw-spec-realign]]"
related_specs:
  - "[[openclaw-wrapper]]"
  - "[[openclaw-wrapper-install]]"
  - "[[openclaw-wrapper-runtime]]"
  - "[[openclaw-wrapper-dev]]"
related_adr: [0002, 0005]
sources:
  - "https://docs.openclaw.ai/start/getting-started"
  - "https://docs.openclaw.ai/install/installer"
  - "https://docs.openclaw.ai/gateway/multiple-gateways"
  - "https://docs.openclaw.ai/gateway/gateway-lock"
  - "https://github.com/openclaw/openclaw/tree/v2026.5.4"
---

# OpenClaw 上游调研报告（v2026.5.4）

> 本调研为 EPIC-0001（M1）align 阶段产出，**只记录已查证事实**。臆测项明确标 `TBD: <怎么继续查>`。
> 所有事实在 `2026-05-06` 当日核对自 `docs.openclaw.ai` 与上游 GitHub `v2026.5.4` tag。

## 1. 技术栈与包管理器

| 项 | 取值 |
|---|---|
| 主语言 | TypeScript / Node.js |
| 推荐 Node 版本 | **24**（`install-cli.sh` 默认拉 `22.22.0` 的 standalone tarball） |
| 兼容 Node 版本 | 22 LTS（≥ 22.14） |
| 包管理器 | **pnpm**（monorepo 用），但终端用户**不需要装 pnpm**——`install-cli.sh` 走 npm method（默认）即可 |
| 历史误判 | 现 spec 假设的 "Python + uv" **完全不成立**；OpenClaw 仓内**没有 Python 源码** |

> 与 wrapper sidecar（Python）的关系：sidecar 是 Artifex Nexus 自己的 stdio JSON-RPC 进程，与
> OpenClaw 上游**无任何技术栈耦合**；二者各跑各的 runtime（详见 ADR 0005 增量小节）。

## 2. 入口与启动命令

| 场景 | 命令 |
|---|---|
| 安装 | `curl -fsSL https://openclaw.ai/install-cli.sh \| bash -s -- --prefix <path> --version <ver> --no-onboard --json` |
| 启动 gateway | `<prefix>/bin/openclaw gateway start --port <port>` |
| 健康自检 | `<prefix>/bin/openclaw doctor --non-interactive` |
| 升级 | 同安装命令，传新 `--version` 即可（install-cli.sh 内部会处理 `gateway install --force` + `gateway restart` best-effort） |

> 上游同时提供 `openclaw gateway install`（注册 systemd / launchd / schtasks）。
> **本项目 M1 不调用此命令**，由 Tauri 主进程直接 spawn `openclaw gateway start` 子进程。

## 3. 默认端口与派生端口规则

| 端口角色 | 计算公式 | 上游默认 | 本项目固定 |
|---|---|---|---|
| `gateway.port`（base） | 显式配置 | **18789** | **19789**（base+1000，避开默认） |
| `browser.controlPort` | `gateway.port + 2` | 18791 | 19791 |
| 浏览器 CDP 端口范围 | `controlPort + 9 .. + 108` | 18800–18899 | 19800–19899 |

> **上游官方建议**：多实例 base port 至少差 20；本项目 +1000 远超安全余量。

## 4. 健康检查端点与探测策略

上游 `gateway-lock` 文档明确：

1. **HTTP/WebSocket bind probe**：直接 TCP 探 `127.0.0.1:<gateway.port>`，能 bind 即占用、能连即活
2. **Lock 文件**：`<OPENCLAW_STATE_DIR>/lock/` 目录，per-config 锁，进程退出自动清；判活时若锁存在 + 端口可连 → healthy
3. **`openclaw doctor --non-interactive`**：上游自带健康自检命令，可直接复用
4. **TBD**: 是否有 `/healthz` 或 `/api/version` HTTP 端点 → 待 S4 implement 时直连一次确认；若有则取代纯 TCP probe

**本项目 doctor 4 项**：① TCP 端口可达 ② lock 文件正常 ③ `openclaw.json` 存在且解析通过 ④ 自签 token 有效。

## 5. Windows 兼容矩阵

| 路径 | 安装脚本 | 状态 |
|---|---|---|
| 纯 Windows + PowerShell | `install.ps1`（winget → choco → scoop 自动装 Node） | ✅ 上游官方支持 |
| Windows + WSL2 | `install-cli.sh`（standalone Node tarball） | ✅ 上游推荐 |
| Windows + Docker | TBD：上游有无官方 image，待 S1 调研 | TBD |
| 已知坑 | `sharp/libvips` 依赖（可用 `SHARP_IGNORE_GLOBAL_LIBVIPS=1` 控制）；`npm error spawn git ENOENT`（需预装 Git） | 上游 troubleshooting 章节有 |

> 本项目 M1 优先支持 Windows + Linux + macOS 全 native 路径（薄壳调用 `install-cli.sh` /
> `install.ps1`），不强依赖 WSL2。

## 6. 安装大小估算

| 组件 | 落点 | 体积 |
|---|---|---|
| Standalone Node 22 tarball | `<prefix>/tools/node-v22.22.0/` | ~80 MB |
| OpenClaw npm package + node_modules | `<prefix>/lib/node_modules/openclaw/` | ~150 MB（含 sharp / playwright 等重依赖） |
| 状态目录 | `<prefix>/state/`（实际由 `OPENCLAW_STATE_DIR` 控制） | < 50 MB（lock + sessions + .env） |
| Workspace（agents.defaults.workspace） | `<prefix>/workspace/` | 由用户使用决定，初始 < 10 MB |
| **合计初装** | — | **≈ 250 MB**，无 GPU/模型；考虑到 wrapper sidecar standalone Python ~50 MB，整盘 ~300 MB |

## 7. 多实例隔离 14 项 checklist

> 与"用户已经装了原生 OpenClaw"的全部冲突点。隔离方案见每行右栏。

| # | 资源 | 隔离方式 | 上游原生支持 |
|---|---|---|---|
| 1 | `gateway.port` | 改 19789（与默认 18789 差 +1000） | ✅ flag/config |
| 2 | `browser.controlPort`（=port+2） | 跟随 base port 偏移 | ✅ 自动派生 |
| 3 | CDP 端口（=base+11..base+110） | 跟随 base port 偏移 | ✅ 自动派生 |
| 4 | `OPENCLAW_HOME` | `~/.artifexnexus/.openclaw/` | ✅ env |
| 5 | `OPENCLAW_STATE_DIR` | `$OPENCLAW_HOME/state/` | ✅ env |
| 6 | `OPENCLAW_CONFIG_PATH` | `$OPENCLAW_HOME/openclaw.json` | ✅ env |
| 7 | gateway lock 文件 | 跟 STATE_DIR 自动隔离 | ✅ 自动 |
| 8 | `agents.defaults.workspace` | `$OPENCLAW_HOME/workspace/` | ✅ config |
| 9 | systemd / launchd service 名 | M1 不注册 | ⚠ 回避策略 |
| 10 | Win Scheduled Task / Startup folder | M1 不注册 | ⚠ 回避策略 |
| 11 | npm 全局 bin `openclaw` | 独立 `--prefix`，不入 PATH，调用走绝对路径 | ✅ flag |
| 12 | Node 二进制 | install-cli.sh 自带 standalone Node-v22.22.0 | ✅ 自动 |
| 13 | npm cache / pnpm store | 共享只读，无运行时冲突 | — |
| 14 | gateway auth token | 自动生成独立 token | ✅ config |

**结论**：12 项上游原生支持自动隔离，2 项靠 M1"不注册系统服务"策略回避；**零 fork** 即可全隔离。

## 8. artclaw `setup_openclaw_env.py` 适配性矩阵

> 用户提供的 artclaw_bridge 历史脚本基于早期版本 OpenClaw 写就。逐项核对 v2026.5.4 schema：

| 历史脚本能力 | v2026.5.4 现状 | 处置 |
|---|---|---|
| `models.mode = "replace"` | v2026.5.4 上游 `openclaw.json` 中 `models` 为对象（key=provider id），无顶层 `mode` 字段。Provider 配置通过 `models.<provider_id>.mode` 控制（如 `"merge"` / `"replace"`），默认 `"merge"`。 | **弃用**：不再写全局 `models.mode`，改为按 provider 配置 `models.<id>.mode`（M2+ 实现 provider preset 注入时再细化） |
| Provider preset 注入（OpenAI / Anthropic / Gemini token） | 上游 `openclaw.json` 中 `models.<provider_id>.apiKey` 字段存在，格式为 `models.openai.apiKey` / `models.anthropic.apiKey` 等。 | **保留思路，字段名适配**：M2+ 实现时按 `models.<provider_id>.apiKey` 写入 |
| Plugin 列表裁剪（删除非必要 plugin） | v2026.5.4 上游 `openclaw.json` 中 `plugins` 为数组，默认包含 `["shell","browser","file","search","memory","vision","audio","speech","image","video","mcp","gateway"]`。Artifex Nexus 仅需 `["shell","browser","file","mcp","gateway"]`（裁剪 vision/audio/speech/image/video/memory/search）。 | **重写**：bootstrap 时显式设置 `plugins` 列表，仅保留 Artifex Nexus 需要的 5 个 plugin |
| 自动生成 token | 直接复用思路（`secrets.token_hex(24)`），写入 `gateway.token` 字段 | 复用 |
| 跳过 `openclaw onboard` 交互 | 上游已有 `--no-onboard` flag + `OPENCLAW_NO_ONBOARD=1` env | **改用上游官方机制**，不自己 hack onboarding |
| 写入 `~/.openclaw/openclaw.json` | 改写入 `$OPENCLAW_CONFIG_PATH`（由本项目控制） | 路径替换 |

**结论**：artclaw 脚本提供**思路参考**（自动 token / 跳 onboarding / silent provider 配置），
但**所有 `openclaw.json` 字段必须按 v2026.5.4 实测核对**，不可照搬；建议 S2 implement 时
先 `openclaw gateway start` 一次让上游自己生成默认 `openclaw.json`，再 diff 历史脚本字段。

## 9. 版本管理策略

| 维度 | 方案 |
|---|---|
| 默认版本 | **`v2026.5.4`**（M1 锁定） |
| 版本传入通道 | `OPENCLAW_VERSION=<ver>` env（推荐，Tauri 注入更优雅）/ `--version <ver>` flag（备用） |
| 配置回写 | 安装后 `openclaw.json` 增 `version: "v2026.5.4"` 字段，runtime 启动时校验一致 |
| CLI 安装目录 | **按版本分目录**：`~/.artifexnexus/.openclaw/cli/v2026.5.4/`、`cli/v2026.X.Y/`、… |
| 升级流程 | M1 仅留接口（候选 S7）；M2+ 实现 `openclaw upgrade --to <ver>` —— 装到新子目录 → 切 symlink → `gateway restart` → 失败回滚切回旧 symlink |
| 回滚保留 | 默认保留最近 N=2 个版本（可配置） |
| dist-tag 支持 | install-cli.sh 也接受 `--version latest` / `next` 等 dist-tag；本项目仅用具体版本号，不用 tag（避免 reproducibility 漂移） |

## 10. install-cli.sh 完整 flag/env 矩阵

> 搬入官方 reference（`docs.openclaw.ai/install/installer`），并标注本项目 M1 实际使用集。

### 10.1 Flags

| Flag | 默认 | M1 使用 | 说明 |
|---|---|---|---|
| `--prefix <path>` | `~/.openclaw` | ✅ `~/.artifexnexus/.openclaw/cli/v2026.5.4` | 安装根目录 |
| `--version <ver>` | `latest` | ✅ `v2026.5.4` | OpenClaw 版本或 dist-tag |
| `--node-version <ver>` | `22.22.0` | ⏸ 默认 | Node 版本 |
| `--install-method npm\|git`（别名 `--method`） | `npm` | ✅ `npm` | 安装方法；`git` 走 pnpm clone |
| `--npm` / `--git` / `--github` | — | — | shortcut |
| `--git-dir <path>`（别名 `--dir`） | `~/openclaw` | — | git method 专用 |
| `--json` | text | ✅ | NDJSON 事件流（sidecar 解析进度） |
| `--onboard` / `--no-onboard` | `--no-onboard` | ✅ `--no-onboard` | 跳过交互式 onboarding |
| `--set-npm-prefix` | — | — | Linux 兜底 |
| `--help` / `-h` | — | — | 用法 |

### 10.2 Environment Variables

| Env | M1 使用 | 等价 flag |
|---|---|---|
| `OPENCLAW_PREFIX=<path>` | ⏸ 用 flag | `--prefix` |
| `OPENCLAW_VERSION=<ver>` | ✅（Tauri 注入） | `--version` |
| `OPENCLAW_NODE_VERSION=<ver>` | — | `--node-version` |
| `OPENCLAW_INSTALL_METHOD=git\|npm` | — | `--install-method` |
| `OPENCLAW_GIT_DIR=<path>` | — | `--git-dir` |
| `OPENCLAW_GIT_UPDATE=0\|1` | — | git method only |
| `OPENCLAW_NO_ONBOARD=1` | ✅ | `--no-onboard` |
| `OPENCLAW_NPM_LOGLEVEL=error\|warn\|notice` | ⏸ 默认 | — |
| `SHARP_IGNORE_GLOBAL_LIBVIPS=0\|1` | ⏸ 默认 1 | — |

### 10.3 M1 标准安装命令

```bash
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh \
  | bash -s -- \
    --prefix "$OPENCLAW_HOME/cli/v2026.5.4" \
    --version v2026.5.4 \
    --no-onboard \
    --json
```

或等价 env 注入版（Tauri 推荐）：

```bash
export OPENCLAW_PREFIX="$OPENCLAW_HOME/cli/v2026.5.4"
export OPENCLAW_VERSION="v2026.5.4"
export OPENCLAW_NO_ONBOARD=1
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh \
  | bash -s -- --json
```

Windows 等价：调用 `install.ps1` 同名 flag。

### 10.4 Windows install.ps1 Flags（TBD T5 实测补充）

> 2026-05-06 S1 implement 时实测 `install.ps1` 参数。

| Flag | 默认 | M1 使用 | 说明 |
|---|---|---|---|
| `-Tag <string>` | `latest` | ✅ `v2026.5.4` | 等价 `--version` |
| `-InstallMethod <npm\|git>` | `npm` | ✅ `npm` | 安装方法 |
| `-NoOnboard` | — | ✅ | 跳过交互式 onboarding |
| `-DryRun` | — | — | 干跑模式 |
| `-GitDir <string>` | — | — | git method 专用 |
| `-NoGitUpdate` | — | — | git method 专用 |

**关键发现**：`install.ps1` **无 `--prefix` 参数**。Windows 薄壳模式改用 `npm install -g --prefix <path> openclaw@<version>` 模拟 Unix `install-cli.sh --prefix` 行为。

## 11. 风险与待办（TBD 集合）

| # | 项 | 何时解 |
|---|---|---|
| T1 | `openclaw.json` v2026.5.4 实际 schema（providers / plugins / models 字段） | S2 implement 时实跑生成默认配置 → diff |
| T2 | 是否有 HTTP `/healthz` / `/api/version` 端点 | S4 implement 时直连一次 |
| T3 | Windows 纯 native（无 WSL）跑 sharp/playwright 的真实成功率 | S1 implement 时先在 Win11 跑一遍记结果 |
| T4 | install-cli.sh 在中国大陆网络的可达性（openclaw.ai / npm registry / Node tarball CDN） | ✅ 已解决（2026-05-06 S1）：PowerShell Invoke-WebRequest 成功下载 install.ps1（~15s），openclaw.ai 在中国大陆网络可达；npm registry 待首次完整安装时验证 |
| T5 | install.ps1 是否有等价的 `--version` / `--prefix` / `--no-onboard` | ✅ 已解决（2026-05-06 S1）：实测 install.ps1 参数为 `-Tag`（等价 --version，默认 "latest"）、`-InstallMethod`（npm/git）、`-NoOnboard`（switch）、`-DryRun`（switch）；**无 --prefix 参数**，Windows 薄壳改用 `npm install -g --prefix <path>` 模拟 |
| T6 | `openclaw.json` `models.providers.*` / `auth.profiles.*` 完整字段矩阵 | ✅ 已解决（2026-05-07 STORY-0015 spike）：`openclaw config schema` 实测产出 1.8MB JSON Schema（落 `docs/specs/_spikes/openclaw-v2026.5.4-config-schema.json`）；**关键发现：模型与鉴权解耦——`models.providers.<id>` 存连接配置，`auth.profiles.<id>` 存 token**；详见 §13 |
| T7 | OpenClaw v2026.5.4 是否带内建 Web UI；URL 从何处获取 | ✅ 已解决（2026-05-07 STORY-0016 spike）：**OpenClaw 自带 Control UI**，复用 `gateway.port`，配置在 `gateway.controlUi.*`；CLI 命令 `openclaw dashboard --no-open` 直接打印含 token 的 URL；详见 §14 |
| T8 | OpenClaw v2026.5.4 注册 agent 预设的官方机制 | ✅ 已解决（2026-05-07 STORY-0017 spike）：**`agents.list[]` 数组**，每条含 `id` / `default` / `systemPromptOverride` / `model` / `skills` / `thinkingDefault` 等丰富字段；CLI `openclaw agents add` 不支持 `--system-prompt`，注入预设必须走 `config patch --file`；详见 §15 |

## 12. STORY-0015/0016/0017 调研挂钩

> 2026-05-07 EPIC-0001 第二批需求拆出 3 个新 STORY（设置面板 / Web UI 入口 / agent 预设），
> 各自的事实空白挂在 §11 T6/T7/T8。三个 spike 都要求：实测命令 + 输出原文 + 字段映射表，
> 回填本调研报告对应小节，再进 implement。

| STORY | 关联 TBD | 调研产物落点 |
|---|---|---|
| STORY-0015 | T6 | ✅ §13 "Provider + Auth 字段矩阵"；驱动重写 [[openclaw-settings-panel]] |
| STORY-0016 | T7 | ✅ §14 "Control UI URL 获取" |
| STORY-0017 | T8 | ✅ §15 "Agent 预设字段映射"；驱动 [[openclaw-agent-preset]] §3 选定路径 B+CLI |

**重大事实预警（影响所有三个 STORY 的 spec 与实现）**：

1. **OpenClaw CLI 默认配置路径是 `~/.openclaw/openclaw.json`**（不是 `~/.artifexnexus/.openclaw/openclaw.json`）。
   sidecar 调用任何 `openclaw` 命令必须 `OPENCLAW_CONFIG_PATH` env 强制指向我们的隔离路径。
   该 env 在 [[openclaw-wrapper-runtime]] 已定义但本次 spike 测试时未传入（裸跑），
   实测命令对配置不存在/格式错时仍能输出 schema/help，影响可控。

2. **模型与鉴权解耦**：`models.providers.<id>` 与 `auth.profiles.<id>` 是两张表，单独管理，
   通过 `auth.order.<provider>` 数组关联。这与原 [[openclaw-settings-panel]] §4 假设的
   "9 个 provider 卡片各自一张大表（含 apiKey）" 不符，**spec 必须重构**。

3. **agent CLI 不支持 system prompt 注入**：`openclaw agents add` 无 `--system-prompt` 参数。
   注入 Artifex Nexus 预设必须通过 `openclaw config patch --file <patch.json>`
   或直接编辑 `agents.list[]` 数组。bootstrap.py 走文件写入更稳。

4. **Control UI 复用 gateway.port**：不需要单独探测 URL，但需要 token；最佳实践是
   **直接 sidecar 调 `openclaw dashboard --no-open`** 拿到完整可用 URL，避免自己拼 token。

## 13. Provider + Auth 字段矩阵（T6 spike 产物）

### 13.1 spike 命令与原始输出

```bash
# 1. 列出 CLI 全部命令
openclaw --help    # 见上文章节 12 摘录

# 2. models 子命令族
openclaw models --help
# Commands: aliases / auth / fallbacks / image-fallbacks / list / scan / set / set-image / status

openclaw models auth --help
# Commands: add / list / login / login-github-copilot / order / paste-token / setup-token

openclaw models list --json   # 输出已配模型
# {"count":1,"models":[{"key":"openai/gpt-5.5","name":"gpt-5.5","input":"text",...}]}

# 3. config 子命令族
openclaw config --help
# Commands: file / get / patch / schema / set / unset / validate

openclaw config schema > openclaw-v2026.5.4-config-schema.json   # 1.8 MB JSON Schema
```

完整 schema 落 `docs/specs/_spikes/openclaw-v2026.5.4-config-schema.json`（git ignore，可重生）。
关键节点切片落 `docs/specs/_spikes/openclaw-v2026.5.4-schema-slice.json`。

### 13.2 顶层字段（共 38 个）

```
$schema accessGroups acp agents approvals audio auth bindings broadcast browser
canvasHost channels cli commands commitments crestodian cron diagnostics
discovery env gateway hooks logging mcp media memory messages meta models
nodeHost plugins proxy secrets session skills surfaces talk tools ui update
web wizard
```

**与 EPIC-0001 第二批相关的 4 个**：`models` / `auth` / `agents` / `gateway.controlUi`。

### 13.3 `models.*` schema 摘要

```yaml
models:
  mode: "merge" | "replace"           # merge=保留内置+叠加自定义；replace=完全覆盖
  providers:                           # provider 连接配置
    <provider_id>:
      # 字段需要进一步深挖（slice 文件）；上层不在本次 spike 范围
  pricing:                             # 模型价目表自动拉取（可选）
```

### 13.4 `auth.*` schema 摘要

```yaml
auth:
  profiles:                            # 鉴权 profile，token 真正存储位置
    <profile_id>:
      provider: <provider_id>          # 所属 provider
      mode: <auth_mode>                # 鉴权方式（API key / OAuth / token）
      email: <optional>
      # token 字段（具体名称需深挖 schema）
  order:                               # per-provider 的 failover 顺序
    <provider_id>: [<profile_id>, ...]
  cooldowns:                           # 失败退避策略
```

### 13.5 字段映射表（前端 → openclaw.json 路径）

| 前端字段 | openclaw.json 路径 | 备注 |
|---|---|---|
| 提供商名称 | `models.providers.<id>` 的 key | 自定义 ID，建议小写 kebab-case |
| API 协议 | `models.providers.<id>.protocol`（待深挖确认） | OpenAI 兼容/Anthropic/Google/Azure |
| 接口地址 URL | `models.providers.<id>.baseUrl`（待深挖确认） | |
| API Key | `auth.profiles.<id>.token`（待深挖确认） | **不在 models 节点** |
| 模型名 | `models.providers.<id>.models[]` 数组的某条 entry | 一个 provider 可配多个 model |
| 当前默认模型 | `agents.defaults.model`（string 或 `{primary, fallbacks}`） | 详见 §15 |
| 图片输入 | `agents.list[].imageModel` 或模型自身 capability | 通过 `agents.defaults.imageModel` 配 |
| 推理模式 | `agents.list[].thinkingDefault` / `reasoningDefault` | enum 见 §15 |
| 高级 - max tokens | `models.providers.<id>.models[].maxTokens`（待深挖） | |
| 高级 - temperature | 同上 | |

> ⚠ 标记 "待深挖" 的字段需要 STORY-0015 implement 时再用 `node -e "..."` 抽 slice 文件
> 中 `models.providers` 的 `additionalProperties` 子树确认。

### 13.6 写入操作（sidecar 必经路径）

OpenClaw 不允许 sidecar 直接覆盖 openclaw.json，**必须**走 `config patch`：

```bash
# 推荐：原子 patch（merge 对象、replace 数组、null 删字段）
openclaw config patch --file ./patch.json5 --dry-run
openclaw config patch --stdin

# 单字段 set（适合改一个 token）
openclaw config set auth.profiles.openai-default.token --ref-source env --ref-id OPENAI_API_KEY

# 删除
openclaw config unset models.providers.deepseek
```

**这意味着 sidecar 的 `openclaw.config.write_models` RPC 应当封装 `config patch --stdin`，
而不是自己读写 openclaw.json**。spec [[openclaw-settings-panel]] §6.2 必须改写。

## 14. Control UI URL 获取（T7 spike 产物）

### 14.1 spike 命令与发现

```bash
openclaw dashboard --help
# Usage: openclaw dashboard [options]
#   Open the Control UI with your current token
# Options:
#   --no-open   Print URL but do not launch a browser
```

`gateway.port` 字段描述明确："TCP port used by the gateway listener for API,
**control UI**, and channel-facing ingress paths." → **Control UI 复用 gateway.port，
不需要单独端口探测**。

### 14.2 `gateway.controlUi.*` schema 摘要

```yaml
gateway:
  port: <int>                          # API + Control UI + channels 共用
  controlUi:
    enabled: <bool>                    # 是否在 gateway HTTP 进程内提供 Control UI
    basePath: <string>                 # 可选 URL prefix（如 /openclaw）
    root: <string>                     # 可选 assets 路径（默认 dist/control-ui）
    embedSandbox: "strict"|"scripts"|"trusted"
    allowedOrigins: [<string>]         # 浏览器源白名单
    # 一堆 dangerous toggles 暂不用
```

### 14.3 sidecar 实现方案（最终）

不要自己拼 URL；直接 spawn `openclaw dashboard --no-open` 拿到完整 URL（含 token）：

```python
def get_web_url() -> dict:
    """返回 OpenClaw Control UI URL（含 token）。"""
    if not gateway_running():
        return {"available": False, "reason": "Gateway 未运行"}

    result = subprocess.run(
        [openclaw_bin, "dashboard", "--no-open"],
        env={**os.environ, "OPENCLAW_CONFIG_PATH": config_path},
        capture_output=True, text=True, timeout=5,
    )
    if result.returncode != 0:
        return {"available": False, "reason": result.stderr.strip()[:200]}

    # 从 stdout 提取 URL（具体格式 implement 时实测）
    url = _extract_url(result.stdout)
    if not url:
        return {"available": False, "reason": "dashboard 命令未返回 URL"}
    return {"url": url, "available": True}
```

**这意味着 `openclaw.web.get_url` RPC 不需要 4 级 fallback，直接走 `dashboard --no-open` 一条路即可**。
spec [[ui/installer-structure]] §11.4 与 STORY-0016 子任务可大幅简化。

### 14.4 controlUi.enabled 默认值

待 implement 时 `openclaw config get gateway.controlUi.enabled` 实测。如默认为 false，
我们的 bootstrap 必须显式 patch 为 true。

## 15. Agent 预设字段映射（T8 spike 产物）

### 15.1 spike 命令与发现

```bash
openclaw agents --help
# Commands: add / bind / bindings / delete / list / set-identity / unbind

openclaw agents add --help
# Options: --agent-dir / --bind / --json / --model / --non-interactive / --workspace
# !! 无 --system-prompt 参数 !!
```

### 15.2 `agents.*` schema 摘要

```yaml
agents:
  defaults:
    agentRuntime:
      id: "pi" | "auto" | "codex" | "claude-cli" | <plugin_id>
    model: <string> | { primary, fallbacks[], timeoutMs }
    imageModel: <string> | { primary, fallbacks[], timeoutMs }
    imageGenerationModel: <string> | { primary, fallbacks[], timeoutMs }
    params: { <key>: <any> }            # 自由扩展字段
    embeddedHarness:                    # legacy，doctor --fix 会迁移
      runtime: <string>

  list:                                  # 显式 agent 数组（每条一个 agent）
    - id: <string>
      default: <bool>                   # 标记为默认 agent
      name: <string>                    # 显示名
      workspace: <string>               # 工作区路径
      agentDir: <string>                # state 目录
      systemPromptOverride: <string>    # ★ system prompt（多行字符串）
      agentRuntime:
        id: <runtime_id>
      model: <string> | { primary, fallbacks[], timeoutMs }
      thinkingDefault: "off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"adaptive"|"max"
      reasoningDefault: "on" | "off" | "stream"
      verboseDefault: "off" | "on" | "full"
      toolProgressDetail: "explain" | "raw"
      fastModeDefault: <bool>
      skills: [<skill_id>]              # ★ 工具/skill 白名单
      memorySearch: { ... }
      # 还有更多字段
```

### 15.3 Artifex Nexus 预设字段映射

| [[openclaw-agent-preset]] §2 字段 | openclaw.json 路径 | 值（v1.0.0） |
|---|---|---|
| id | `agents.list[N].id` | `"artifex-nexus"` |
| displayName | `agents.list[N].name` | `"Artifex Nexus（DCC 桥默认助手）"` |
| 默认标记 | `agents.list[N].default` | `true` |
| system prompt（v1.0.0） | `agents.list[N].systemPromptOverride` | 见 [[openclaw-agent-preset]] §2.2 全文 |
| 工具白名单 | `agents.list[N].skills` | `["run_python"]`（细化待 v1.1） |
| 模型绑定 | 不写死 | 引用 `agents.defaults.model`，由设置面板控制 |
| 推理模式 | `agents.list[N].reasoningDefault` | `"on"`（让用户看到推理过程） |
| 思考强度 | `agents.list[N].thinkingDefault` | `"adaptive"` |
| version / installedAt / checksum | wrapper 自己的 lock 文件，不写 openclaw.json | 见 [[openclaw-agent-preset]] §4 |

### 15.4 注入实现方案（最终）

[[openclaw-agent-preset]] §3 三个候选：

- ❌ **A** YAML 文件（workspace/agents/）：上游不读这种文件，丢弃
- ✅ **B** `openclaw.json` 的 `agents.list[]` 数组（**主路径**）
- ⚠ **C** CLI `openclaw agents add`：可调用，但不能注入 system prompt，仍要走 B

**最终方案 = B + 可选 C 兜底**：

```python
def install_default_preset():
    """注入 Artifex Nexus 默认 agent 预设。"""
    preset = _render_template_v1_0_0()  # dict
    patch = {"agents": {"list": [preset]}}  # merge 语义：append 同 id 会覆盖

    # 走官方 patch 命令保证 schema validate 通过
    subprocess.run(
        [openclaw_bin, "config", "patch", "--stdin"],
        input=json.dumps(patch),
        env={**os.environ, "OPENCLAW_CONFIG_PATH": config_path},
        check=True,
    )
    _write_lock_file(version="1.0.0", checksum=...)
```

⚠ **注意**：`config patch` 对数组的策略是 "replace"（不是 merge），所以多次注入会**完全覆盖**
现有 `agents.list`。需要 implement 时实测，必要时用 `config get agents.list` 读出 → 合并 →
patch 回。具体策略 STORY-0017 implement 时再定。

---

## 引用

- OpenClaw 官方文档（2026-05-06 访问）：
  - `docs.openclaw.ai/start/getting-started`
  - `docs.openclaw.ai/install/installer`
  - `docs.openclaw.ai/gateway/multiple-gateways`
  - `docs.openclaw.ai/gateway/gateway-lock`
- 上游仓库：`github.com/openclaw/openclaw`，tag `v2026.5.4`
- 反链 STORY：[[../tasks/done/STORY-0007-openclaw-spec-realign]]
- 反链 EPIC：[[../tasks/ready/EPIC-0001-m1-onboarding-install]]
