## Why

当前 InstallerWizard 的"重装"操作会无条件执行 `bootstrap()` → `_write_config()`，
直接覆写 `openclaw.json`，导致用户**丢失所有已配置的 provider、模型列表、auth 绑定关系、
agents.defaults 等设置**。用户每次重装后必须从头配置，体验极差且容易误操作。

需要一个确认弹窗让用户选择性保留/恢复配置。

## What Changes

- 新增：重装前弹出确认对话框，展示可选保留项（默认全部勾选）
- 修改：`bootstrap()` 后端逻辑支持 `preserve_options` 参数，按选项深合并已有配置
- 修改：前端 `InstallItemRow` 在已安装状态下点击"重装"时先弹窗确认

## Capabilities

### New Capabilities
- `reinstall-confirm-dialog`: 重装确认弹窗 UI 组件，包含勾选项列表、影响说明和确认/取消按钮
- `bootstrap-selective-preserve`: bootstrap 选择性保留逻辑，重装时按用户选项深合并已有配置数据

### Modified Capabilities
<!-- 无现有 spec 需要修改 -->

## Impact

- **前端**：`apps/desktop/src/features/installer/InstallItemRow.tsx`（弹窗触发逻辑）
- **前端**：新增 `apps/desktop/src/features/installer/ReinstallConfirmDialog.tsx`
- **后端**：`packages/adapters/openclaw/wrapper/.../bootstrap.py`（`bootstrap()` 函数签名变更，增加 preserve 逻辑）
- **Sidecar RPC**：`openclaw.bootstrap` 参数扩展（新增 `preserve_options`）
- **Tauri 命令**：`openclaw_bootstrap` 参数透传
- **前端 IPC**：`bootstrapOpenClaw()` 参数扩展
