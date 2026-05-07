# 编译与发布

> 强约束：改了哪儿，必须用对应级别的命令完整编译——**不要只跑 `pnpm build`**
> 然后声称 "改完了"。这条规则因为 2026-05-07 的失误（v3 内联 Auth 改完只跑了
> `pnpm build` 没出 .exe）而新增；任何 agent 与人类提交者都要遵守。

## 1. 修改路径 → 必须执行的编译命令对照表

| 修改的目录 | 最低必须命令 | 备注 |
|---|---|---|
| `apps/desktop/src/**`（前端 React/TS） | `pnpm -C apps/desktop tauri build` | **不能只跑 `pnpm build`**；后者只出 `dist/` 前端产物，不出 `.exe` |
| `apps/desktop/src-tauri/**`（Rust / tauri 配置） | `pnpm -C apps/desktop tauri build` | 同上；Rust 改动仅 `cargo check` 不算合格 |
| `apps/desktop/src-tauri/Cargo.toml` 加依赖 | `pnpm -C apps/desktop tauri build` + 检查 `cargo audit` | |
| `apps/desktop/installer-assets/**` | `pnpm -C apps/desktop tauri build` | bundle 资源会被 NSIS/WiX 重新打入 |
| `apps/web/**` | `pnpm -C apps/web build` | |
| `packages/<ts pkg>/**` | `pnpm -C <path> build`（或仓库根 `pnpm build` 跑 turbo） | TS 包出 `dist/` 即可 |
| `packages/<py pkg>/**` | `pnpm -C <path> py:test` 或 `python -m pytest` | Python 不需 build，但**必须跑测试** |
| `packages/adapters/openclaw/wrapper/**`（sidecar） | `python -m pytest packages/adapters/openclaw/wrapper` + apps/desktop 重编 | sidecar 被 desktop 内嵌；改了 sidecar 必须连带 desktop 重编 |
| `docs/**` 仅文档 | 无须编译 | 但需检查 wiki-link、frontmatter |

## 2. `pnpm build` vs `pnpm tauri build` 语义辨析

| 命令 | 输出 | 何时用 |
|---|---|---|
| `pnpm -C apps/desktop build` | `apps/desktop/dist/index.html` + `assets/*.js`/`*.css`，仅前端产物 | 调试 vite、看前端体积、不打包桌面壳时 |
| `pnpm -C apps/desktop tauri build` | 上述前端产物 **+** `apps/desktop/src-tauri/target/release/artifex-nexus-desktop.exe` **+** `bundle/nsis/Artifex Nexus_<ver>_x64-setup.exe` | **任何 apps/desktop 改动后的标准动作** |
| `cargo build --release` | 仅 `target/release/*.exe`，不打 installer | 仅验证 Rust 端能链接，不出可分发包 |
| `cargo check --release` | 不产出二进制，只检查类型 | 快速排错，**不可作为最终验证** |

> **要点**：`pnpm build` 是 turbo 全包构建（含 `apps/desktop`），但对 desktop 来说**仅触发它的前端 vite 子步骤，不触发 Cargo + bundle**。
> 想出可分发桌面应用，**必须** `pnpm tauri build`。

## 3. 验收清单（agent 在汇报"改完了"前必须自检）

修改 `apps/desktop/**` 后必须满足：

- [ ] `pnpm -C apps/desktop typecheck` ✅
- [ ] `pnpm -C apps/desktop vitest run` ✅（如果有测试覆盖到改动点）
- [ ] `pnpm -C apps/desktop tauri build` ✅
- [ ] 检查产物时间戳：`apps/desktop/src-tauri/target/release/artifex-nexus-desktop.exe` 必须 ≥ 本次改动开始时间
- [ ] 检查 installer：`apps/desktop/src-tauri/target/release/bundle/nsis/Artifex Nexus_<package.version>_x64-setup.exe` 应存在且为新时间戳
- [ ] 在汇报里**显式列出 .exe 与 setup.exe 的大小与时间戳**，作为"已编译"的客观证据

## 4. 平台前置条件

`pnpm tauri build` 在 Windows 上要求：

| 工具 | 默认安装位置 | 失败现象 |
|---|---|---|
| Rust toolchain | `%USERPROFILE%\.cargo\bin\` | `program not found: cargo` |
| MSVC build tools | VS 2022 Build Tools | `link.exe not found` |
| WebView2 Runtime | 系统已带（Win11+） | 启动后白屏 |
| NSIS（可选，Tauri 自带 sidecar） | Tauri 自动下载 | bundle/nsis 步骤报 NSIS 缺失 |

如果 `cargo` 不在 PATH，agent 应当在执行命令前注入：

```bat
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
```

而**不是**直接说"我没法编译"。

## 5. 失败兜底

若 `pnpm tauri build` 因网络 / NSIS 下载失败，可以降级到：

```bash
cd apps/desktop && set PATH=%USERPROFILE%\.cargo\bin;%PATH% && cargo build --release --manifest-path src-tauri/Cargo.toml
```

至少能验证 Rust 端 + 前端联编通过；但**最终交付前必须补一次完整 `pnpm tauri build`**，否则 installer 不可用。

## 6. 反例（2026-05-07 真实失误）

错误流程：

> "v3 内联 Auth 改完，pnpm typecheck ✅、pnpm vitest run ✅、`pnpm build` ✅（72 模块 / dist 235.94 kB），编译通过。"

为什么错：`pnpm build` 只跑了 `tsc && vite build`，输出在 `dist/`；用户去看 `src-tauri/target/release/` 发现 `.exe` 时间戳还是几小时前的旧的，**说明改动并没进可分发的桌面应用**。

正确流程应该是：

> "v3 内联 Auth 改完，pnpm typecheck ✅、pnpm vitest run ✅、`pnpm tauri build` ✅（artifex-nexus-desktop.exe 11.36 MB / Artifex Nexus_0.1.0_x64-setup.exe 2.44 MB，时间戳 2026-05-07 18:06）。"

## 相关

- [[../../docs/specs/ui/installer-structure]] §11 — apps/desktop 下的 OpenClaw 行
- [[../../apps/desktop/src-tauri/tauri.conf.json]] — bundle 配置
