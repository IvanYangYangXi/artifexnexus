## Context

当前 OpenClaw 安装向导中的"重装"按钮执行链路：
`installOpenClaw()` → `bootstrapOpenClaw()` → `bootstrap()` → `_write_config()` → 覆写 `openclaw.json`

`openclaw.json` 包含用户所有配置：provider 定义、模型列表、auth 绑定、agent 默认设置。
覆写后用户必须重新配置一切。凭证文件（auth-profiles.json）和 workspace 人格文件不受影响。

**首次安装**场景不需要确认弹窗（没有已有配置可保留）。
**已安装状态下的重装**才需要弹窗确认。

## Goals / Non-Goals

**Goals:**
- 重装前弹出确认对话框，展示保留选项
- 按用户选择在重装后恢复保留的数据
- 首次安装不弹窗，体验无变化
- 重装后 gateway 设置（port/token）始终使用新值（避免端口冲突）

**Non-Goals:**
- 不做全量配置导入/导出（属于独立 STORY）
- 不支持从外部文件恢复配置
- 不实现 undo/回滚机制

## Decisions

### D1: 弹窗时机 — 在 handleInstall 内、install RPC 之前

**选择**：前端在触发安装链之前弹窗，拿到用户选项后传入 bootstrap RPC。
**理由**：最小侵入，不需要改变安装链的整体流程。

### D2: 保留逻辑放在 Python bootstrap 内

**选择**：`bootstrap()` 新增 `preserve_options: dict` 参数。bootstrap 执行前先
`read_config()` 读取旧配置，生成新配置后按选项深合并保留部分。
**理由**：保留逻辑和配置生成在同一层，避免跨层传递大量数据。

**备选**：前端先读取旧配置 → bootstrap 后用 config patch 写回。
**弃选原因**：多一次 CLI cold start（~2.5s），且前端不该感知 config 内部结构。

### D3: 默认保留全部 — 重装只刷新 gateway/plugins/browser 基础配置

**选择**：所有保留选项默认勾选。用户需要主动取消勾选才能"真正恢复出厂"。
**理由**：符合"最小惊讶原则"，大多数用户重装是为了修复 CLI 或基础配置问题，
不想丢失 provider/model 设置。

### D4: gateway.auth.token 始终重新生成

**选择**：无论保留选项如何，gateway token 始终重新生成（新 random hex）。
**理由**：安全考虑。重装后 Tauri 会拿到新 token 用于 WebUI 连接，
旧 token 不应该继续有效。

### D5: 保留项粒度

| 保留项 | config 中的路径 | 说明 |
|--------|----------------|------|
| models.providers | `models.providers` | 所有供应商 + 模型定义 |
| auth 绑定 | `auth.profiles` + `auth.order` | profile 元数据 + 绑定关系 |
| agent 设置 | `agents.defaults` + `agents.list` | 默认模型、workspace 等 |
| plugins 自定义 | `plugins.entries` (非核心的) | 用户额外加的 plugin |

凭证文件 `auth-profiles.json`、workspace 文件、memory-core 数据不在 openclaw.json 里，
bootstrap 本就不碰它们，无需额外保护。

## Risks / Trade-offs

- **[Risk] 旧配置字段与新版 schema 不兼容**
  → Mitigation: 保留的数据通过 `config patch --stdin` 重新写入（走 schema validate），
  不合法的字段会被上游拒绝，此时 log warn 但不阻塞。

- **[Risk] 保留了旧 provider 但 model API 格式已变**
  → Mitigation: 这是 OpenClaw 升级问题，不在本 STORY 范围。用户可在设置面板修改。

- **[Trade-off] 弹窗增加了重装操作的步骤**
  → Acceptable: 重装是低频操作，多一步确认比丢数据好。
