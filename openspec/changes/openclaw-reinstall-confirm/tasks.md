## 1. 后端：bootstrap 选择性保留

- [x] 1.1 `bootstrap.py` — `bootstrap()` 新增 `preserve_options: Optional[dict] = None` 参数
- [x] 1.2 `bootstrap.py` — 在 `_write_config` 之前读取旧配置（`read_config()`），按 preserve_options 深合并
- [x] 1.3 `bootstrap.py` — 保留逻辑：preserveProviders → `models.providers`；preserveAuth → `auth.profiles` + `auth.order`；preserveAgents → `agents.defaults` + `agents.list`；preservePlugins → `plugins.entries`（合并策略）
- [x] 1.4 `bootstrap.py` — 确保 `gateway.auth.token` 始终重新生成（不受 preserveAuth 影响）
- [ ] 1.5 单元测试：`tests/test_bootstrap.py` — 覆盖 preserve_options 各组合场景

## 2. Sidecar RPC 参数扩展

- [x] 2.1 `sidecar.py` — `_handle_openclaw_bootstrap` 解析 `params.get("preserve_options")` 并透传给 `bootstrap()`
- [ ] 2.2 集成测试：验证 RPC 带 preserve_options 参数正常透传

## 3. Tauri 命令 + 前端 IPC 扩展

- [x] 3.1 `openclaw_config.rs` 或 `openclaw.rs` — `openclaw_bootstrap` 命令新增 `preserve_options: Option<Value>` 参数
- [x] 3.2 `ipc/openclaw.ts` — `bootstrapOpenClaw()` 新增可选 `preserveOptions` 参数
- [x] 3.3 TypeScript 类型：`PreserveOptions` interface 定义

## 4. 前端：ReinstallConfirmDialog 组件

- [x] 4.1 新建 `apps/desktop/src/features/installer/ReinstallConfirmDialog.tsx`
- [x] 4.2 弹窗 UI：标题 + 说明文案 + 4 个勾选项（默认全勾） + 确认/取消按钮
- [x] 4.3 CSS Module 样式（复用 SettingsPanel.module.css 或新建 installer 级别样式）
- [x] 4.4 组件 props：`onConfirm(options: PreserveOptions)` / `onCancel()`

## 5. 前端：InstallItemRow 集成

- [x] 5.1 `InstallItemRow.tsx` — 当 item.state 为 "installed" 时，handleInstall 先 setState 显示弹窗
- [x] 5.2 弹窗确认后，将 preserveOptions 传入 `bootstrapOpenClaw(version, preserveOptions)`
- [x] 5.3 弹窗取消后，不执行任何操作

## 6. 验收测试

- [ ] 6.1 手动验收：已安装状态重装 → 弹窗出现 → 确认后 provider/auth 保留
- [ ] 6.2 手动验收：取消勾选"保留供应商"→ 重装后 models.providers 为空
- [ ] 6.3 手动验收：首次安装场景 → 不弹窗
- [ ] 6.4 Python pytest：preserve_options 各场景覆盖
- [ ] 6.5 前端 Vitest：ReinstallConfirmDialog 渲染 + 交互测试
