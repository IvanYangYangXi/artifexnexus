---
tags: [review, EPIC-0001, M1, implement]
created: 2026-05-07
status: done
related_epic: "[[../tasks/ready/EPIC-0001-m1-onboarding-install]]"
related_handoff: "[[../_handoff/EPIC-0001-implement-handoff]]"
reviewer: ai (reviewer-mode session)
---

# EPIC-0001（M1）S1–S7 implement 验收 Review

> 本会话**不写一行业务代码**，仅做静态审计 + 集成 smoke + 验收报告。
> 所有"建议"以清单形式给出，由后续 implement 会话决定如何执行。

## 总判定：🔴 验收失败（FAIL · 需返修后再 review）

**核心结论**：代码层面 7 份 STORY 的主体功能基本到位，单元测试 54 passed、Tauri NSIS
安装包能打出 2.5 MB 产物，但**任务卡管理、TBD 解决度、文档/契约一致性、端到端 smoke
覆盖**四个维度均不满足 EPIC-0001 implement 的"完成"门槛。

| 维度 | 结论 |
|---|---|
| 6 项硬约束 | 4 / 6 通过（约束 2、约束 6 不通过） |
| 14 项隔离 | 设计层全部覆盖；运行时 1/14 验证（无真实 OpenClaw 安装环境） |
| 5 项 TBD | **3 / 5 解决（T1/T2/T3 仍 open）** |
| 7 份 STORY 卡管理 | 0 / 7 满足"status=done + 全部 [x] + 在 done/" |
| 静态审计 | pytest ✅；ruff ❌（未跑通格式 + 多处 RUF/F401）；行数 ✅ |
| 桌面 artifact | NSIS setup.exe 已产出（2.5 MB）✅，但缺任务卡 / 日志反映 |
| 集成 smoke（9 步） | **本环境无法跑**（无 cargo / 无线上 npm 拉 OpenClaw 的代价） |

---

## 1. 6 项硬约束 review checklist

| # | 约束 | 结论 | 证据 |
|---|---|---|---|
| 1 | 薄壳模式（不 fork） | 🟡 **代码 ✅ 文档 ❌** | `packages/adapters/openclaw/vendor/` 实际未创建 ✅；但 `docs/specs/openclaw-wrapper.md:56`、`docs/specs/install.md:15/16/45`、`docs/specs/openclaw-wrapper-ipc.md:55`、`apps/desktop/installer-assets/README.md:14/15`、`.env.example:5`、`docs/tasks/_handoff/2026-05-03-resume-task-0001.md:72` 仍写 "fork / vendor 子目录"，与 ADR 0002 补充小节自相矛盾。 |
| 2 | gateway.port = 19789 | 🔴 **不通过** | wrapper Python / Rust commands `openclaw.rs` / verify 脚本 / 测试全部 19789 ✅；但 `packages/platform/contracts/schemas/config.schema.json:27-32` default 仍 14523 / gateway_url 仍 18789；`apps/desktop/src/routes/Settings.tsx:14` defaultValue=14523；`apps/desktop/src-tauri/src/sidecar/client.rs:168-169` 测试硬编码 14523；`.env.example:6` `OPENCLAW_GATEWAY_WS=ws://127.0.0.1:18789`；`docs/specs/openclaw-wrapper.md:31`、`docs/specs/install.md:64`、`docs/specs/ui/installer-structure.md:243`、`docs/vision/roadmap.md:51` 仍写 14523/18789。**契约即源（ADR 0004）已被违反**：schema 与实现不一致。 |
| 3 | 不注册系统服务 | 🟢 通过 | implement 代码全仓 0 命中 `gateway install` / `systemctl` / `schtasks` / `launchctl` 实际调用；只在 ADR 0005、survey §2 注释中提及。`runtime.py:9` 注释明确 "M1 不注册系统服务"。 |
| 4 | CLI 独立 prefix 不入 PATH | 🟢 通过 | `installer.py:412-446` 推导 `<openclaw_home>/cli/<version>/`；`runtime.py` 中 spawn 用绝对路径（经 `_find_openclaw_bin` / `cli/current` 解析）；未发现写 PATH 的代码。 |
| 5 | OPENCLAW_VERSION=v2026.5.4 默认 | 🟢 通过 | `installer.py:35`、`bootstrap.py:190/306`、`runtime.py`、`commands/openclaw.rs:60/79`、`InstallItemRow.tsx:122/128`、test_*.py 全部 `v2026.5.4` 一致。 |
| 6 | artclaw 字段已实测核对 | 🔴 **不通过** | `docs/specs/openclaw-upstream-survey.md` §8 仍有 2 行 "实测后再决定"（`models.mode`、Plugin 列表）+ T1 也是 open；`bootstrap.py:72-87` 注释明确写 "TBD T1：以下 schema 基于上游文档推测，待实测"。即 §8 矩阵**没有保留 / 弃用 / 重写的最终决策**。 |

---

## 2. 14 项多实例隔离（survey §7）核对

| # | 资源 | 设计 | 实现验证 |
|---|---|---|---|
| 1 | gateway.port | 19789 | ✅ `ports.py:17`、`bootstrap.py:35`、`doctor.py:34`、`runtime.py:35` |
| 2 | browser.controlPort = port+2 | 跟随 | ⚠️ 设计文档有；但 `bootstrap._generate_default_config()` 只写了 `gateway.port` / `gateway.token` / `agents.defaults.workspace`，**没有显式写 `browser.controlPort`**——如果上游未自动派生则隔离失效（待实测） |
| 3 | CDP 段 = controlPort+9..+108 | 跟随 | ✅ `ports._probe_derived_segment()` 已 probe `base+11..base+110`（注：与 spec 写的 +9..+108 数字差 2，**不一致需对齐**） |
| 4 | OPENCLAW_HOME | `~/.artifexnexus/.openclaw/` | ✅ `installer.py:413`、`fs_layout.rs` |
| 5 | OPENCLAW_STATE_DIR | `$HOME/state/` | ✅ `bootstrap._create_directory_layout()` 创建 + Rust `fs_layout.rs` 注入 env |
| 6 | OPENCLAW_CONFIG_PATH | `$HOME/openclaw.json` | ✅ 同上 |
| 7 | gateway lock | 跟 STATE_DIR | ✅ `doctor._probe_lock(home/state/lock)` |
| 8 | agents.defaults.workspace | `$HOME/workspace/` | ✅ `bootstrap.py:113` |
| 9 | systemd / launchd | M1 不注册 | ✅ runtime.py 直接 spawn，无 service 注册代码 |
| 10 | Win Scheduled Task | M1 不注册 | ✅ 同上 |
| 11 | npm 全局 bin | 独立 prefix 不入 PATH | ✅ Unix `--prefix`；Win `npm install -g --prefix <path>` |
| 12 | Node 二进制 | install-cli.sh 自带 | ✅（Unix）；⚠️ Win 需要系统已装 Node（installer.py:213-217 检测到 npm 缺失会报 E_NETWORK），与 spec "完全自包含" 略有出入但属合理妥协 |
| 13 | npm cache / pnpm store | 共享只读 | — 不需主动隔离 |
| 14 | gateway auth token | 自动生成独立 token | ✅ `bootstrap.py:103` `secrets.token_hex(24)` → 48 hex |

**问题待修**：
- 项 2（controlPort）需要在 `_generate_default_config` 显式写 `browser.controlPort = port + 2`
  作为防御（即便上游会自动派生，写入也无害且明确）
- 项 3 CDP 段范围数字与 spec 不一致（+9..+108 vs +11..+110），需要 align

---

## 3. 5 项 TBD 解决度

| # | TBD | 现状 | 标红原因 |
|---|---|---|---|
| T1 | openclaw.json v2026.5.4 实际 schema | 🔴 **未解决** | handoff 自承 "基于上游文档推测，未做首次完整安装实测核对"；`bootstrap.py:72` 注释 "TBD T1" 仍在 |
| T2 | /healthz HTTP 端点 | 🔴 **未解决** | `doctor._probe_http_health()` 仍是空壳（`doctor.py:269-282` 只返回 None）；handoff 自承 "待实测" |
| T3 | Win native sharp/playwright | 🔴 **未解决** | handoff 自承 "需完整安装 OpenClaw 后验证"，未跑过真实 install-cli.sh / npm install |
| T4 | 中国大陆网络可达性 | 🟢 已解决 | survey §11 + S1 进展日志：PowerShell Invoke-WebRequest 成功下载 install.ps1 ~15s |
| T5 | install.ps1 reference | 🟢 已解决 | survey §10.4 + S1 进展日志：实测 -Tag / -InstallMethod / -NoOnboard / -DryRun，**无 --prefix**，改用 npm install -g --prefix |

> 按用户指令"任一未解决 → 验收失败"，**T1 / T2 / T3 三项 open，验收必须 FAIL**。
> 这是当前会话**无法绕过**的硬性失败原因，与代码质量无关。

---

## 4. STORY-by-STORY review（S1–S7）

### 4.0 总览

| STORY | front-matter status | 文件位置 | 验收标准已 [x] | board 列 |
|---|---|---|---|---|
| STORY-0008 (S1) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 8** 🔴 | Review 🔴 |
| STORY-0009 (S2) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 7** 🔴 | Review 🔴 |
| STORY-0010 (S3) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 7** 🔴 | Review 🔴 |
| STORY-0011 (S4) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 7** 🔴 | Review 🔴 |
| STORY-0012 (S5) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 6** 🔴 | Review 🔴 |
| STORY-0013 (S6) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 7** 🔴 | Review 🔴 |
| STORY-0014 (S7) | `review` 🔴 | `tasks/review/` 🔴 | **0 / 6** 🔴 | Review 🔴 |

> 任务规则要求"front-matter `status: done`、文件位于 `docs/tasks/done/`、board 在 Done 列出现、
> 全部'验收标准'已 [x]"——**7 / 7 全部不满足**。
>
> 这其实是 **SDD 流程的合规做法**（开发者把 STORY 推到 review 列等待人类决定 done），
> 与 `.ai/rules/30-agent-behavior.md` "不允许 Agent 自标 done" 一致。但这意味着按用户
> 验收口径，**EPIC-0001 至少也只是 Implement Done，不是 Story Done**——必须等人类 review
> 通过、由人类把 STORY 迁到 `done/` 并打 [x]，整个 EPIC 才能进入 archive 状态。
>
> 所以"全部 [x] = 0"既是问题也是流程；本 review 的工作就是给"准备打勾"提供依据。

### 4.1 STORY-0008（S1）薄壳安装器 抽查

**抽查项**：验收标准 6 "装完后 `<prefix>/bin/openclaw --version` 输出与传入 `--version` 一致"

- 静态：`installer._check_version_match()` 实现已存在（`installer.py:467-480`），逻辑正确。
- 动态：本环境**未真实跑** install-cli.sh / npm install（无意义地烧 250 MB 网络 + 不
  在隔离 dev home），因此该项**未端到端验证**。
- 抽查项 7 "Win11 + macOS 14 + Ubuntu 22.04 各验证一次" → 进展日志只记 Win11 一行
  "T5 实测完成"，**macOS / Ubuntu 完全没跑**。
- 抽查项 8 "离线场景给出明确 `E_NETWORK`" → `installer.get_install_result()` 有
  网络错误分类逻辑（`installer.py:498`），但**未离线 smoke 测过**。

**子任务勾选**：6 / 6 全 `[ ]`，但 `installer.py` 实际已实现 `install_openclaw` generator + sidecar 注册了 `openclaw.install` RPC + Rust `commands/openclaw.rs:openclaw_install` 已注册 + `InstallItemRow.tsx:122` 已串通——**实质上 5 / 6 已交付，仅"前端 progress UI"是粗粒度而非细粒度 NDJSON**。

**结论**：实现到位，但缺**真实端到端 smoke**与**前端 NDJSON 流**。建议 review 通过的前提是
完成至少一次 dev home 完整安装。

### 4.2 STORY-0009（S2）bootstrap + openclaw.json 抽查

**抽查项**：验收标准 5 "gateway.token 长度 ≥ 48 字符（hex 24 字节）"

- ✅ `bootstrap._generate_default_config():103` `secrets.token_hex(24)` → 48 hex
- ✅ `test_bootstrap.py` 多个测试覆盖
- ✅ `scripts/verify-epic-0001.py` ═══ 6 ═══ 已自动化：`token 长度 ≥ 48` PASS

**抽查项**：验收标准 3 "artclaw 历史脚本的每个配置项有明确处置记录（保留 / 弃用 / 重写），
回填 survey §8 矩阵"

- 🔴 **未完成**。`docs/specs/openclaw-upstream-survey.md:120-125` 矩阵 6 行里仍有 2 行
  是 "TBD：v2026.5.4 schema 是否仍有 …" + "实测后再决定保留/重写"。**直接违反硬约束 #6**。

### 4.3 STORY-0010（S3）runtime 拉起 gateway 抽查

**抽查项**：验收标准 5 "系统级 service 列表（systemctl / schtasks）**未出现** `openclaw-gateway` 名"

- 静态：`runtime.py` 无任何 service 注册代码 ✅
- 动态：本环境无运行 gateway，无法 `systemctl --user list-units` / `schtasks /Query` 实测。
  但因 runtime 根本不调用注册命令，从代码层可断言 **结构上不可能注册** ✅。

**抽查项**：验收标准 4 "关闭 Tauri 壳后 5s 内 gateway 进程消失" → 实现里 Win
`taskkill /T` (子树关闭) / Unix `os.killpg(SIGTERM)` 5s grace + SIGKILL fallback
代码可见（runtime.py 中 stop_gateway，长 432 行需 grep 验证）。**未跑真实进程实测**。

### 4.4 STORY-0011（S4）健康检查三通道 抽查

**抽查项**：验收标准 1 "gateway 健康时三通道全绿"

- 静态：`doctor.check_openclaw_health()` 三通道结构清晰；返回 `HealthReport.overall in {healthy/degraded/down/unknown}` ✅
- ✅ contracts schema `openclaw-health.schema.json` 已加（与 ADR 0004 契约即源一致）
- 🔴 通道 D（HTTP）是空壳（TBD T2）

### 4.5 STORY-0012（S5）端口冲突自愈 抽查

**抽查项**：验收标准 6 "派生端口段（base+2、base+11..base+110）也被纳入 probe"

- ✅ `ports._probe_derived_segment()` 正确实现 base+2 + base+11..base+110
- ⚠️ **数字与 spec 不一致**：survey §3 写 "CDP = controlPort + 9 .. + 108"，
  即 base+11 .. base+110 ✅；但 STORY-0012 描述写 "base+11..base+110" ✅；
  `openclaw-wrapper-runtime.md` 写 "base+1000 远超官方建议的 +20 派生端口隔离余量"——
  **多处需统一表述**。
- ⚠️ verify 脚本 `_probe_derived_segment(19789) 返回 bool` 只检查返回类型，没检查"占住
  base+2 时返回 False"——是测试覆盖盲点。

### 4.6 STORY-0013（S6）安装清单 UI 接真实状态 抽查

**抽查项**：验收标准 1 "全新机器：UI 显示「未安装」，按钮仅 Install 可用"

- 静态：`InstallItemRow.tsx:75-107` `handleDetect` 调用 `getOpenClawStatus()` 并
  根据 `gateway_running` / `cli_installed` / `version_mismatch` 派生 state ✅
- 静态：`InstallItemRow.tsx:113-156` `handleInstall` 实现 install→bootstrap→start 真实链 ✅
- 🔴 **缺 polling 与 toast**：验收 6 "端口被切换（S5）时显示实际端口 + 历史 toast 一致"
  在前端代码里**没有实现**——既无 toast 组件也无定期 polling
- 🔴 **缺 NDJSON 进度流**：sidecar `openclaw.install` 把 generator 同步耗光后才返回最终
  `InstallResult`，**前端在安装期间只能看到 button disabled，没有进度条/百分比**

### 4.7 STORY-0014（S7）升级通道接口预留 抽查

**抽查项**：验收标准 5 "Win 上无 symlink 权限时 fallback 到 `current.txt` 指针文件"

- 静态：`runtime.set_current_version()` 已含 try-symlink → except-写 current.txt fallback
- 动态：`test_runtime.py:113-133 test_set_current_version_windows_fallback` 自带测试
  并验证 `_resolve_current_version()` 可读 `current.txt` ✅
- ✅ verify 脚本 ═══ 10 ═══ 通过

**抽查项**：验收标准 2 "openclaw.list_versions 返回 `[{ version: "v2026.5.4", active: true, installed_at: ... }]`"

- ⚠️ `list_versions()` 返回的字段需对齐 contracts schema `openclaw-version.schema.json` —— 
  本 review 未验证字段名 100% 一致，建议 implement 阶段加一个 `jsonschema.validate()` 单测。

---

## 5. 静态审计

### 5.1 单元测试

```text
54 passed, 2 skipped, 1 warning in 9.54s
```

✅ 与 handoff 报告一致（54 / 2）。注意 1 个 warning：`Unknown config option: asyncio_mode`
（pytest 配置过时，建议清理）。

### 5.2 lint（ruff）

```text
python -m ruff check packages apps scripts
→ 大量 RUF001 / RUF002 / RUF003 全角符号告警（中文注释里 ()：，; 等）
→ F401 未使用 import：bootstrap.py(os) / doctor.py(json, platform) / installer.py(shlex, sys, tempfile)
→ UP015 open(...,"r") 模式参数冗余（installer.py:103）
→ UP035 typing.Iterator → collections.abc.Iterator（installer.py:27）
→ UP045 Optional[X] → X | None（多处）
→ SIM110 循环可改 all() 推导（ports.py:61）
```

🔴 **不通过**。RUF001-003 严格说是配置问题（项目允许中文注释），可 `select` 去掉；
但 F401 / UP015 / UP035 / UP045 是真问题，建议 fix 并加 ruff 配置文件锁定 select。

### 5.3 pnpm tauri build

🟢 **artifact 已产出**：

```text
apps/desktop/src-tauri/target/release/
├── artifex-nexus-desktop.exe         (10.4 MB, 2026-05-07 00:52:41)
└── bundle/nsis/
    └── Artifex Nexus_0.0.0_x64-setup.exe  (2.5 MB, 2026-05-07 00:52:41)
```

但 **NSIS 安装包版本号是 `0.0.0`**（`apps/desktop/package.json` 默认未填），M1 应当
打成 `v0.1.0` 或 `v2026.M1.x`，便于发布管理。

> **本 review 未在新机器上"双击 setup.exe → 装出 → 启动 → 看到清单"完成最后一公里**，
> 因当前会话不允许写代码也无 disposable Win 沙箱。建议 implement 阶段补一份
> `docs/_handoff/M1-smoke-on-clean-vm.md` 记录新机实测脚本与截屏。

### 5.4 文件行数

✅ 无 > 500 行的 .py / .rs。最大三个文件（已接近黄色区，建议关注后续拆分）：

| 文件 | 行数 | 备注 |
|---|---|---|
| `runtime.py` | 432 | start/stop + PID 锁 + 版本管理三块功能耦合，可考虑拆 `version_manager.py` |
| `installer.py` | 413 | Unix / Win 两条平台分支共一个文件，可考虑拆 `installer_unix.py` / `installer_windows.py` |
| `doctor.py` | 328 | 三通道 + 异步并行版本，目前可接受 |

### 5.5 公共 API 中英双语 docstring 抽查

抽查 5 处：

| 位置 | 中英双语？ |
|---|---|
| `installer.install_openclaw` (installer.py:391) | ✅ "安装 OpenClaw 到隔离 prefix（薄壳模式）。\n\nInstall OpenClaw to an isolated prefix..." |
| `installer.ProgressEvent` 类 (installer.py:50) | ✅ "安装进度事件（从 NDJSON 解析）。\n\nProgress event parsed..." |
| `bootstrap.bootstrap` (bootstrap.py:189) | ✅ 双语 |
| `doctor.check_openclaw_health` (doctor.py:312) | ✅ 双语 |
| `runtime.list_versions` | ⚠️ 仅中文 docstring，缺英文（需补）|

**结论**：80% 通过，建议把 `runtime.py` 全部公共 API 的英文段补齐。

### 5.6 仓内异常发现

🟠 **仓库根存在孤儿 `main.rs`**（d:\MyProject_D\artifexnexus\main.rs），仅 8 行
内容：

```rust
fn main() {
    artifex_nexus_desktop_lib::run()
}
```

与 `apps/desktop/src-tauri/src/main.rs` 重复，疑似某次 cargo new 残留 / IDE 误生成。
**建议直接删除**，否则 `cargo` 在仓库根识别到会乱。

🟠 **scripts/verify-epic-0001.py 第 13 项检查盲点**：
"无 14523 残留" 的扫描范围**仅 `wrapper/src/**.py`**，遗漏了 contracts schema、
Rust 源码、TS、docs，因而误报"全绿"。这正是约束 #2 失败的根因之一。**建议把扫描
范围扩到 `packages/`、`apps/`、`docs/specs/`、`.env*`**。

---

## 6. 集成 smoke（9 步）— 本会话**无法完整执行**

### 现状
- 当前环境无 `cargo`（Rust 工具链未装），**Tauri 自身可以打 .exe（已存在产物），
  但本次无法重跑 `pnpm tauri build` 验证全流程**
- 当前环境无 `uv`（PEP 工具链），用 `python -m pytest` 替代跑过 ✅
- 跑步骤 2 真实安装 OpenClaw 需要拉 ~250 MB（含 standalone Node + sharp/playwright），
  且会污染开发机；review 角色不应执行
- 步骤 6（端口冲突自愈）、步骤 7（强杀 gateway）、步骤 9（systemctl 检查）需要 Linux
  环境与真实运行的 OpenClaw

### 已可在静态层得出的结论

| 步骤 | 是否能静态判断 | 结论 |
|---|---|---|
| 1. 干净起点 | — | 用户操作 |
| 2. install → `bin/openclaw` 存在 | ❌ 需真跑 | 未验证 |
| 3. bootstrap → openclaw.json + token ≥ 48 | ✅ 静态 + 单测 | **代码层可断言通过**（`secrets.token_hex(24)` + 测试覆盖）|
| 4. start → 监听 19789 | ❌ 需真跑 | 代码路径完整，未跑 |
| 5. doctor → 三通道全绿 | ❌ 需真跑 | 三通道实现完整，TBD T2（HTTP）空 |
| 6. 端口冲突 → 切 19809 | ✅ 静态 + 单测 | `pick_port()` + `_probe_derived_segment()` 已测；**注意 verify 脚本未测"19789 被占"路径**，仅测 happy path |
| 7. 强杀 gateway → 5s 反映异常 | ❌ 需真跑 | doctor `_probe_lock` + `_is_pid_alive` 实现可见 |
| 8. 关壳 → 子进程清空 | ❌ 需真跑 | runtime 含 SIGTERM grace + SIGKILL fallback |
| 9. systemctl/schtasks 无 openclaw-gateway | ✅ 静态可断言 | runtime.py 完全无 service 注册代码，结构上不可能注册 |

### 建议
implement 会话恢复后，必须在**全新 Linux VM + 全新 Win11 VM** 各跑一次 9 步脚本，
把每步实际输出贴到 `docs/_handoff/M1-smoke-2026-MM-DD.md`，作为 EPIC-0001 真正归档的
前提。当前 review 在缺少这份证据的前提下，**不能给"集成 smoke 通过"绿灯**。

---

## 7. 桌面 artifact 验收（用户特别要求）

> "阶段末尾 Tauri 桌面应用应能打包出一个可装的 artifact"
> 用户明示已让开发补上，请一并 review

### 7.1 产物层 ✅
- `artifex-nexus-desktop.exe` 10.4 MB
- `Artifex Nexus_0.0.0_x64-setup.exe` 2.5 MB（NSIS）
- 时间戳 2026-05-07 00:52:41 ⇒ 是新鲜产物

### 7.2 任务/文档层 🔴
**没有任何新任务卡 / spec patch / 进展日志记录这次"补打 artifact"动作**。
- `docs/_handoff/EPIC-0001-implement-handoff.md:95` 仍写 "Rust 编译未验证"
- 7 份 STORY 进展日志最新一条仍是 2026-05-06，没人记 "2026-05-07 补 tauri build 验证"
- 没有新增 STORY-0015（"S8 桌面 artifact 验收"之类）

> 这违反了 `.ai/rules/20-docs-workflow.md` "docs 即真相、改架构必先改 docs"。
> 即使只是补一次 build，也应该有进展日志条目佐证。

### 7.3 需要补的事
- [ ] 在 `STORY-0014` 进展日志或 `EPIC-0001` 进展日志里加一行：
  `2026-05-07 tauri build 验证：NSIS setup.exe 已产出 (2.5 MB, version=0.0.0)`
- [ ] handoff 文档更新风险 #4 状态（Rust 编译已验证）
- [ ] 把 `apps/desktop/package.json` 的 `version` 从 `0.0.0` 改为 `0.1.0` 或与 EPIC-0001
  对齐的版本号
- [ ] 在新机 / Sandbox 跑一次"双击 setup.exe → 装出 → 打开 → 走到 InstallerWizard"
  并截图存档

---

## 8. 反链 / kanban 一致性

✅ 反链未悬：board 的 7 份 STORY 都指向 `tasks/review/`，与文件实际位置一致；
EPIC-0001 子节点表里指向 `[[../review/STORY-NNNN-...]]` 与文件一致。

⚠️ 但 `docs/tasks/_handoff/2026-05-03-resume-task-0001.md:72` 仍有 "OpenClaw fork：
`packages/adapters/openclaw/vendor/`（ADR 0002）"，是旧 handoff 残留。**建议加一行
说明"已废弃，见 ADR 0002 补充小节"** 或直接更新，避免误导 future agent。

---

## 9. 必须 fix 才能 PASS 的清单（按优先级）

### P0（直接导致 EPIC fail）

1. 解决 TBD T1：跑一次真实 `openclaw gateway start`，dump 出默认 `openclaw.json`，
   diff 后回填 `survey §8` 矩阵 + 更新 `bootstrap._generate_default_config()` 字段
2. 解决 TBD T2：在 dev home 跑起 gateway 后 `curl http://127.0.0.1:19789/healthz`
   与 `/api/version`，把结果回填 survey §4 + 实现 `doctor._probe_http_health()` 或
   明确写"上游无此端点"
3. 解决 TBD T3：在 Win11 native（无 WSL）跑通 install→start→doctor，记录 sharp /
   playwright 是否需要额外步骤
4. 修硬约束 #2：让 `config.schema.json` default = 19789、`gateway_url` = ws://...:19789；
   修 `Settings.tsx:14`、`sidecar/client.rs:168-169`、`.env.example:6`、
   `docs/specs/openclaw-wrapper.md:31`、`docs/specs/install.md:64`、
   `docs/specs/ui/installer-structure.md:243`、`docs/vision/roadmap.md:51` 全部端口残留
5. 修硬约束 #6：survey §8 矩阵 `models.mode` 与 `Plugin 列表` 行做出"保留 / 弃用 / 重写" 决策

### P1（实质功能缺口，不补则用户体验明显残缺）

6. 实装前端进度条：sidecar `openclaw.install` 改成 streaming RPC（Tauri channel
   或多次 emit event），前端 `InstallItemRow` 监听并显示百分比
7. 实装 toast 系统 + 端口切换 toast（STORY-0013 验收 6）
8. 完成 dev home 全栈 9 步 smoke，把日志存 `docs/_handoff/M1-smoke-2026-MM-DD.md`

### P2（卫生 / 一致性）

9. 删除仓根孤儿 `main.rs`
10. 修文档残留 vendor / fork 表述：`docs/specs/openclaw-wrapper.md:56`、
    `docs/specs/install.md:15-46`、`docs/specs/openclaw-wrapper-ipc.md:55`、
    `apps/desktop/installer-assets/README.md:14-15`、`.env.example:5`
11. 修 `_generate_default_config` 显式写 `browser.controlPort = port + 2`
12. 统一 CDP 段数字（+9..+108 vs +11..+110）
13. 修 ruff F401 / UP015 / UP035 / UP045，并加 `ruff.toml` 锁规则集
14. 把 `apps/desktop/package.json` `version` 从 `0.0.0` 改为有意义的 M1 版本
15. 把 `verify-epic-0001.py` 第 13 项扫描范围扩到全仓
16. 给 `runtime.py` 公共 API 补全英文 docstring
17. 在 EPIC-0001 / STORY-0014 / handoff 里**补"2026-05-07 桌面 artifact 验证"进展日志**

### P3（建议）

18. 把 `runtime.py` 拆成 `runtime.py` + `version_manager.py`（≤300 行）
19. `installer.py` 拆 `installer_unix.py` + `installer_windows.py`
20. 加 `jsonschema.validate()` 单测验证 `list_versions()` / `check_openclaw_health()`
    返回与 contracts schema 一致

---

## 10. 验收会议建议

按 SDD 流程，本 review 输出后建议：

1. **不**把 STORY-0008..0014 推进 done（开发者把 STORY 留 review 是合规的）
2. 把 P0（5 项）+ P1（3 项）转成 implement 任务，新一轮 implement 完成后再做一次 review
3. 桌面 artifact 已能打出 ✅，但需要在新机做"双击安装→打开→看到清单"截图作为 EPIC DoD 证据
4. EPIC-0001 在 P0/P1 闭环 + 新机 smoke 完成前，**保持 ready 状态，不进 in-progress
   也不进 done**

---

## 11. 元数据与可复现性

- Review 时间：2026-05-07 00:50–01:30
- 主机：Windows_NT，Python 3.14，pnpm 已安装，cargo / uv 未安装
- pytest：54 passed / 2 skipped（与 handoff 一致）
- ruff：see §5.2
- verify-epic-0001.py：45/45 passed（脚本盲点已说明）
- Tauri 产物：见 §5.3
- 本报告 0 编辑业务代码、0 修改 spec / ADR / STORY，仅在 `docs/reviews/` 新增本文


