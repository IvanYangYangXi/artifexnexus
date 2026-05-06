---
tags: [spec, openclaw, survey, research, M1]
created: 2026-05-06
status: draft
related_story: "[[../tasks/review/STORY-0007-openclaw-spec-realign]]"
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
| 3 | CDP 端口（=controlPort+9..+108） | 跟随 base port 偏移 | ✅ 自动派生 |
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
| `models.mode = "replace"` | TBD：v2026.5.4 schema 是否仍有 `models.mode` 字段，待 S2 implement 时实测 `openclaw.json` 默认结构 | 实测后再决定保留/重写 |
| Provider preset 注入（OpenAI / Anthropic / Gemini token） | 大概率仍存在（核心功能），但字段名可能漂移（如 `providers.openai.apiKey` vs `models.providers[].token`） | 实测后裁剪复用 |
| Plugin 列表裁剪（删除非必要 plugin） | TBD：v2026.5.4 是否仍走 plugin 模型；若是则字段名核对 | 实测后再决定 |
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

## 11. 风险与待办（TBD 集合）

| # | 项 | 何时解 |
|---|---|---|
| T1 | `openclaw.json` v2026.5.4 实际 schema（providers / plugins / models 字段） | S2 implement 时实跑生成默认配置 → diff |
| T2 | 是否有 HTTP `/healthz` / `/api/version` 端点 | S4 implement 时直连一次 |
| T3 | Windows 纯 native（无 WSL）跑 sharp/playwright 的真实成功率 | S1 implement 时先在 Win11 跑一遍记结果 |
| T4 | install-cli.sh 在中国大陆网络的可达性（openclaw.ai / npm registry / Node tarball CDN） | S1 implement 时实测 + 必要时给镜像 fallback |
| T5 | install.ps1 是否有等价的 `--version` / `--prefix` / `--no-onboard` | 已知有 `-Tag`，其余待 S1 调研 ps1 reference |

---

## 引用

- OpenClaw 官方文档（2026-05-06 访问）：
  - `docs.openclaw.ai/start/getting-started`
  - `docs.openclaw.ai/install/installer`
  - `docs.openclaw.ai/gateway/multiple-gateways`
  - `docs.openclaw.ai/gateway/gateway-lock`
- 上游仓库：`github.com/openclaw/openclaw`，tag `v2026.5.4`
- 反链 STORY：[[../tasks/review/STORY-0007-openclaw-spec-realign]]
- 反链 EPIC：[[../tasks/ready/EPIC-0001-m1-onboarding-install]]
