## ADDED Requirements

### Requirement: 重装确认弹窗触发条件
当 OpenClaw 已处于 "installed" 或 "update-available" 状态时，用户点击"重装"按钮，
系统 SHALL 弹出确认对话框。首次安装（state = "not-installed"）时 SHALL 直接执行安装链，不弹窗。

#### Scenario: 已安装状态点击重装
- **WHEN** 用户在 InstallerWizard 中点击 OpenClaw 条目的"重装"按钮
- **AND** 当前状态为 "installed"
- **THEN** 系统弹出 ReinstallConfirmDialog

#### Scenario: 首次安装不弹窗
- **WHEN** 用户在 InstallerWizard 中点击 OpenClaw 条目的"安装"按钮
- **AND** 当前状态为 "not-installed"
- **THEN** 系统直接执行安装链，不弹窗

### Requirement: 确认弹窗保留选项列表
弹窗 SHALL 展示以下勾选项，每项默认勾选（checked）：

| 选项 ID | 显示文案 | 说明文案 |
|---------|---------|---------|
| preserveProviders | 保留已配置的供应商 | baseUrl、模型列表等 |
| preserveAuth | 保留鉴权凭据与绑定 | API Key 不删，profile 绑定不变 |
| preserveAgents | 保留 Agent 设置 | 默认模型、推理偏好等 |
| preservePlugins | 保留插件自定义配置 | memory-core dreaming 等 |

#### Scenario: 弹窗初始状态
- **WHEN** ReinstallConfirmDialog 打开
- **THEN** 所有 4 个勾选项 SHALL 为 checked 状态
- **AND** 标题显示"重新安装 OpenClaw"
- **AND** 底部有"确认重装"和"取消"两个按钮

#### Scenario: 用户取消
- **WHEN** 用户点击"取消"按钮
- **THEN** 弹窗关闭，不执行任何操作

#### Scenario: 用户确认
- **WHEN** 用户点击"确认重装"按钮
- **THEN** 弹窗关闭
- **AND** 安装链开始执行，传入用户选择的保留选项

### Requirement: 影响范围说明
弹窗 SHALL 在选项列表上方展示说明文案：
"重装会重新下载 CLI 并刷新基础配置（gateway/端口）。勾选的项目将在重装后自动恢复。"

#### Scenario: 说明文案可见
- **WHEN** ReinstallConfirmDialog 打开
- **THEN** 说明文案在选项列表上方可见
