---
tags: [spec, openclaw, runtime, isolation]
created: 2026-05-03
status: draft
---

# OpenClaw Wrapper — 运行时（Runtime）

> 总览：[[openclaw-wrapper]]。本文讲"**装完以后它每天是怎么跑的**"。

## 1. 进程模型

```
Tauri 壳（UI + Rust 后端）
 ├─► child: OpenClaw gateway 主进程（Node.js，由 install-cli.sh 装的 standalone Node-v22 拉起）
 │    └─► 内部子线程/子进程：MCP server / Gateway HTTP+WS / Browser 控制 / Skill loader
 ├─► child: wrapper sidecar（standalone Python 3.11，stdio JSON-RPC，详见 [[openclaw-wrapper-ipc]]）
 ├─► child: 按需拉起的 DCC 对应 MCP server（UE/Blender 侧由 DCC 内部起，壳不直接管）
 └─► IPC: Tauri Command（UI ↔ Rust）；Rust ↔ sidecar 走 stdio JSON-RPC；Rust ↔ Gateway 走本地 HTTP/WS
```

- **M1 不注册系统服务**（systemd / launchd / schtasks），由 Tauri 主进程托管 gateway 子进程；
  应用退出 → SIGTERM 子进程 → 5s 超时 SIGKILL。详见 ADR 0005 增量小节。
- **单实例**：通过 `~/.artifexnexus/run/app.lock` 文件锁保证。
- 子进程日志统一落 `~/.artifexnexus/logs/openclaw-YYYYMMDD.log`，滚动 7 天。

> ⚠ **历史 spec 更正**：原假设 OpenClaw 主进程是 Python，已查证为 **Node.js**（详见
> [[openclaw-upstream-survey]] §1）。standalone Python 仅供 wrapper sidecar 自身使用，与
> OpenClaw 主进程零耦合。

## 2. 目录布局（用户数据）

```
~/.artifexnexus/
├── config/
│   └── artifexnexus.json          # 配置中心，契约见 contracts/schemas
├── .openclaw/                     # 与外部 ~/.openclaw/ 物理隔离（OPENCLAW_HOME 指向此）
│   ├── cli/                       # 上游 install-cli.sh 装入，按版本分子目录
│   │   ├── v2026.5.4/
│   │   │   ├── bin/openclaw       # CLI 可执行（绝对路径调用，不入 PATH）
│   │   │   ├── lib/node_modules/  # npm method 装的 OpenClaw 包
│   │   │   └── tools/node-v22.22.0/  # standalone Node tarball
│   │   └── current → v2026.5.4    # symlink，便于升级灰度切换（M2+）
│   ├── workspace/                 # agents.defaults.workspace 指向此
│   │   └── skills/{official,team,user}/
│   ├── state/                     # OPENCLAW_STATE_DIR 指向此（含 lock/、sessions/、.env）
│   │   └── lock/                  # gateway 锁文件，per-config 自动隔离
│   └── openclaw.json              # OPENCLAW_CONFIG_PATH 指向此（gateway.port=19789 等）
├── logs/
├── cache/
└── run/
    ├── app.lock                   # Artifex Nexus 自身单实例锁
    └── ports.json                 # 当前选定端口快照
```

> DEV 环境用 `~/.artifexnexus.dev/` 后缀隔离，所有子目录布局完全一致（路径逻辑零分支）。

### 2.1 DCC 插件安装策略

从 M2 起，所有 DCC 插件的安装部署统一使用 **物理拷贝（`shutil.copytree`）**，
弃用 junction/symlink。原因：

- OpenClaw v2026.5.4 discovery 调用 `fs.realpathSync` 解析跨卷 junction 指向源码盘，
  被 trusted-root 安全检查拒绝（ADR 0008）
- 物理拷贝使文件可审计——每次安装后在 `state/deploy-manifest.json` 记录所有文件的
  `sha256 + size`，后续 `openclaw.deploy.validate` RPC 可校验完整性

新增 DCC 时接入方式：在安装函数中调用 `_record_deployment()` 自动注册，校验机制零配置。
详见 [[../development/context-handoff-copy-model-and-validation]] 和
[[../decisions/0008-copy-model-deploy-manifest]]。

## 3. 隔离策略（强约束）

1. **环境变量隔离**：子进程只继承白名单环境变量；显式设置上游官方三件套（详见
   [[openclaw-upstream-survey]] §7）：
   - `OPENCLAW_HOME=~/.artifexnexus/.openclaw`
   - `OPENCLAW_STATE_DIR=~/.artifexnexus/.openclaw/state`
   - `OPENCLAW_CONFIG_PATH=~/.artifexnexus/.openclaw/openclaw.json`
   - `OPENCLAW_NO_ONBOARD=1`（保险，运行时也带）
   - 配合 `openclaw.json` 写入 `agents.defaults.workspace=~/.artifexnexus/.openclaw/workspace`
   - wrapper sidecar 的 Python 环境：`PYTHONHOME=<install>/runtime/python`，`PYTHONPATH` 只含 sidecar 自身
2. **路径隔离**：源码/状态/配置都必须走 `OPENCLAW_HOME`，代码审计禁止出现裸 `~/.openclaw/`（CI lint）
3. **端口隔离**：见 §4（19789 + 派生端口自动跟随，与上游默认 18789 安全隔离）
4. **服务名隔离**：M1 不调用 `openclaw gateway install`，不注册任何系统级服务（systemd / launchd / schtasks）

### 3.1 Windows 上 spawn `openclaw` 的统一约定（ADR 0007）

OpenClaw v2026.5.4 经 npm 安装后，可执行入口落在 **`<cli_dir>/` 根目录**（不是
`<cli_dir>/bin/`），且为三件套 shell wrapper：`openclaw`（POSIX sh）/ `openclaw.cmd`
（Windows cmd）/ `openclaw.ps1`（PowerShell）。Windows 上若选错（命中无后缀 sh 脚本）
直接 `subprocess.Popen` 会触发 `OSError [WinError 193] %1 不是有效的 Win32 应用程序`，
导致 gateway / config get / config patch / infer / dashboard 全部不可用。

故所有 wrapper 内 spawn `openclaw` CLI 的代码**必须经 helper**
`openclaw_wrapper._subprocess`：

| Helper | 职责 |
|---|---|
| `find_openclaw_bin(home)` | 查找可执行；Windows 优先 `.cmd`，POSIX 优先无后缀 sh |
| `build_openclaw_env(home)` | 注入三件套 env + `OPENCLAW_NO_ONBOARD=1` |
| `popen_kwargs(*, win_no_window=True, win_new_group=False)` | 返回 Win 上 `creationflags=CREATE_NO_WINDOW [\| CREATE_NEW_PROCESS_GROUP]` + UTF-8 解码默认值 |
| `run_openclaw(cli_args, home, *, timeout, input=None)` | `subprocess.run` 简化封装；返回 `CompletedProcess` |

**禁止**散落使用 `subprocess.Popen([str(bin), …])` 不带 `creationflags=CREATE_NO_WINDOW`
的写法——会导致每次 spawn 弹黑窗。

具体决策与候选顺序见 `[[../decisions/0007-windows-openclaw-shell-spawn]]`。

## 4. 端口探测与自愈

**策略**：默认 `19789`（与上游官方 multi-gateway 文档 rescue bot 示例对齐，base+1000 远超
官方建议的 +20 派生端口隔离余量）；冲突时在 `19789 / 19809 / 19829 / ...`（步进 20，保派生隔离）
段内自增，写回 `~/.artifexnexus/.openclaw/openclaw.json` 的 `gateway.port` 字段 + `run/ports.json`。

```python
def pick_port(preferred: int = 19789, step: int = 20, max_tries: int = 5) -> int:
    """返回首个可绑定的端口（保 +20 派生端口隔离）。"""
```

- 探测方法：`bind(127.0.0.1, p)` 成功即视为空闲，随后 close 释放给真实服务用
- UI 行为：若最终选定端口 ≠ preferred，右上角 toast："端口已切换为 19809（19789 被占用）"
- 外部已装 OpenClaw 仍用 18789 运行时 → 互不干扰
- **派生端口自动跟随**：`browser.controlPort = port+2`，CDP 端口 = `base+11..base+110`，
  无需手动配置（详见 [[openclaw-upstream-survey]] §3）

## 5. 配置中心

所有可变参数集中于 `~/.artifexnexus/config/artifexnexus.json`，字段契约见
`packages/platform/contracts/schemas/config.schema.json`。壳启动流程：

```
load config → validate by schema → apply → (冲突时) 端口探测 → 写回
```

配置 UI 在壳内表单；不鼓励手工编辑，但手工编辑结果在启动时也会被 schema 校验。

## 6. 状态面板（UI）

主界面三区：

1. **Status**：OpenClaw 进程健康、端口、CPU/内存、连通 DCC 数
2. **Skills**：已装 Skill 列表（official / team / user），可 enable/disable
3. **Plugins**：UE / Blender 插件投放状态 + 一键同步

按钮：Start / Stop / Restart / Open Log / Open Data Dir。

## 7. 健康检查（doctor）

壳内置 `doctor` 按钮，对外也暴露 `artifex doctor` CLI（用于脚本化）。检查项：

- [ ] `~/.artifexnexus/` 目录结构完整
- [ ] `artifexnexus.json` 通过 schema 校验
- [ ] `~/.artifexnexus/.openclaw/openclaw.json` 存在且 `version` 字段与 CLI 实际版本一致
- [ ] OpenClaw gateway 端口可 bind / 当前进程响应（HTTP/WS probe + lock 文件双通道）
- [ ] 上游 `<cli>/bin/openclaw doctor --non-interactive` 自检通过
- [ ] gateway auth token 有效
- [ ] UE / Blender 插件链接/副本版本匹配
- [ ] 官方 Skill 完整性

> 健康探测三通道：① TCP `bind(127.0.0.1, gateway.port)` ② `state/lock/` 锁文件存在性
> ③ 上游 `openclaw doctor` 自检；任一通道异常即降级提示。详见 [[openclaw-upstream-survey]] §4。

失败项给出"一键修复"建议（尽量幂等）。

## 8. 卸载钩子

- 壳卸载时：停进程、释放锁、清 `<install>/`
- 用户数据：**默认保留**；只在用户勾选"清除数据"时才删 `~/.artifexnexus/`

## 9. 验收标准

- [ ] 子进程日志落盘、滚动、UI 可查
- [ ] 端口探测在 19789 被占时按 +20 步进切换并写回 `openclaw.json` + `run/ports.json`
- [ ] 杀掉壳进程后，所有子进程（含 gateway Node 进程）在 5s 内终止
- [ ] 外部 `~/.openclaw/`（用户已装 OpenClaw）在全生命周期内 0 读 0 写（用 fs audit 验证）
- [ ] 系统范围内**未注册** `openclaw-gateway.service` / `Openclaw Gateway` 计划任务等
- [ ] `<cli>/bin/openclaw doctor --non-interactive` 自检通过

## 相关

- [[openclaw-wrapper]] · [[openclaw-wrapper-install]] · [[openclaw-wrapper-ipc]] · [[openclaw-wrapper-dev]]
- [[openclaw-upstream-survey]] — 上游事实底（v2026.5.4 调研）
- [[../decisions/0002-vendor-openclaw-fork]]、[[../decisions/0005-desktop-distribution-tauri-standalone-python]]
- [[../tasks/done/STORY-0007-openclaw-spec-realign]] — 本 spec 校正来源
