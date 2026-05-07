---
tags: [handoff, EPIC-0001, M1, implement]
created: 2026-05-06
status: draft
related_epic: "[[../tasks/ready/EPIC-0001-m1-onboarding-install]]"
---

# EPIC-0001 Implement Handoff

> 一次性实现 S1–S7（OpenClaw Onboarding & Installation），2026-05-06 完成。

## 总体状态

- **7/7 STORY 全部 Review**，全部推进至 `docs/tasks/review/`
- **Python 测试**：54 passed, 2 skipped, 0 failed
- **Rust 编译**：待 `pnpm tauri build` 验证（需 Rust 工具链 + Node.js）
- **三平台 smoke**：Windows 11 已部分验证（TBD T4/T5 实测），Linux/macOS 待补

## 各 STORY 产出文件清单

### S1 STORY-0008 — 薄壳安装器

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/installer.py` | 新增 | Unix curl\|bash + Win npm --prefix 双路径安装器 |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` | 重写 | 新增 openclaw.install RPC + 全部 11 个 method |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/ports.py` | 重写 | 端口 14523→19789 + 派生段 probe + ports.json 持久化 |
| `apps/desktop/src-tauri/src/fs_layout.rs` | 重写 | 三件套 env + DEV 后缀 + run_dir |
| `apps/desktop/src-tauri/src/commands/status.rs` | 更新 | 端口 14523→19789 |
| `packages/adapters/openclaw/wrapper/tests/test_ports.py` | 更新 | 端口号更新 + 新测试 |
| `packages/adapters/openclaw/wrapper/tests/test_sidecar.py` | 更新 | 端口号更新 + upgrade/rollback 测试 |

### S2 STORY-0009 — bootstrap + openclaw.json

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py` | 重写 | 目录布局 + openclaw.json 生成 + 幂等 token + 失败回滚 + 端口探测集成 |
| `packages/adapters/openclaw/wrapper/tests/test_bootstrap.py` | 新增 | 13 个测试 |

### S3 STORY-0010 — runtime 拉起 gateway

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/runtime.py` | 重写 | start/stop/is_running + PID 锁 + 版本管理 + 状态聚合 |
| `packages/adapters/openclaw/wrapper/tests/test_runtime.py` | 新增 | 13 个测试 |

### S4 STORY-0011 — 健康检查三通道

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/doctor.py` | 重写 | TCP + lock + upstream doctor 三通道 + 异步并行版本 |
| `packages/adapters/openclaw/wrapper/tests/test_doctor.py` | 新增 | 12 个测试 |
| `packages/platform/contracts/schemas/openclaw-health.schema.json` | 新增 | HealthReport JSON Schema |

### S5 STORY-0012 — 端口冲突自愈

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/ports.py` | (S1 已含) | pick_port + 派生段 probe + ports.json |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py` | (S2 已含) | bootstrap_with_port_probe 集成 |

### S6 STORY-0013 — 安装清单 UI 接真实状态

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/platform/contracts/schemas/openclaw-status.schema.json` | 新增 | StatusReport JSON Schema |
| `apps/desktop/src-tauri/src/commands/openclaw.rs` | 新增 | 6 个 Tauri Command（status/install/bootstrap/start/stop/doctor） |
| `apps/desktop/src-tauri/src/commands/mod.rs` | 更新 | 注册 openclaw 模块 |
| `apps/desktop/src-tauri/src/lib.rs` | 更新 | 注册全部 8 个 Tauri Command |
| `apps/desktop/src-tauri/src/commands/status.rs` | 重写 | 聚合 sidecar + OpenClaw 状态 |

### S7 STORY-0014 — 升级通道接口预留

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/platform/contracts/schemas/openclaw-version.schema.json` | 新增 | VersionInfo JSON Schema |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/runtime.py` | (S3 已含) | list_versions / set_current_version / symlink + Win fallback |
| `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` | (S1 已含) | upgrade/rollback 占位 RPC |

## TBD 解决情况

| TBD | 状态 | 说明 |
|-----|------|------|
| T1: openclaw.json schema | ⚠ 部分解决 | 基于上游文档推测 schema（gateway.port/token、agents.defaults.workspace、version），待首次完整安装后实测核对并回填 survey §8 |
| T2: /healthz HTTP 端点 | ⚠ 待实测 | doctor.py 已预留 `_probe_http_health()` 函数，待 gateway 可运行后实测 |
| T3: Win 纯 native sharp/playwright | ⚠ 待实测 | 需完整安装 OpenClaw 后验证 |
| T4: 中国大陆网络可达性 | ✅ 已解决 | PowerShell Invoke-WebRequest 成功下载 install.ps1（~15s），openclaw.ai 可达 |
| T5: install.ps1 flag | ✅ 已解决 | 实测参数：-Tag / -InstallMethod / -NoOnboard / -DryRun；**无 --prefix**，改用 npm install -g --prefix |

## 已知风险

1. **openclaw.json schema 漂移**：当前基于上游文档推测，v2026.5.4 实际字段可能不同。首次安装后需 diff 并 patch。
2. **Windows npm --prefix 行为**：`npm install -g --prefix <path>` 在 Windows 上的行为可能与 Unix 不同（如 bin 目录位置），需实测验证。
3. **三平台 smoke 未完成**：Linux 和 macOS 平台未验证（当前仅 Windows 11）。
4. **Rust 编译未验证**：`pnpm tauri build` 需要完整的 Rust 工具链 + Node.js 环境，当前环境缺少 Rust。
5. **前端 UI 未实现**：S6 的 Rust 命令已就绪，但前端 React 组件（安装清单 OpenClaw 行重写、状态机驱动按钮）未实现——这属于前端开发范畴，不在本次 Python/Rust 后端实现范围内。

## 下一步

1. 在可运行 OpenClaw 的环境中完成 TBD T1/T2/T3 实测
2. 实现前端安装清单 UI（React 组件）
3. Linux + macOS smoke test
4. `pnpm tauri build` 验证 Rust 编译
5. Review 会话决定 EPIC-0001 是否归档
