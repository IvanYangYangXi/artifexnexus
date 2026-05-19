## ADDED Requirements

### Requirement: bootstrap 支持 preserve_options 参数
`bootstrap()` 函数 SHALL 接受可选参数 `preserve_options: dict`，包含以下布尔键：
- `preserveProviders` (default: False)
- `preserveAuth` (default: False)
- `preserveAgents` (default: False)
- `preservePlugins` (default: False)

当任意键为 True 时，bootstrap SHALL 在写入新配置前先读取旧配置，
然后将对应节点深合并到新生成的配置中。

#### Scenario: 带保留选项的 bootstrap
- **WHEN** `bootstrap()` 被调用且 `preserve_options={"preserveProviders": True}`
- **AND** 旧 `openclaw.json` 存在且包含 `models.providers` 节点
- **THEN** 新写入的 `openclaw.json` SHALL 包含旧的 `models.providers` 数据
- **AND** gateway/browser 等基础配置使用新生成的值

#### Scenario: 无保留选项的 bootstrap（默认行为不变）
- **WHEN** `bootstrap()` 被调用且 `preserve_options` 为 None 或全 False
- **THEN** 行为与当前一致：生成全新默认配置并覆写

### Requirement: 保留节点映射关系
系统 SHALL 按以下映射保留 openclaw.json 中的节点：

| preserve_options 键 | 保留的 JSON 路径 |
|--------------------|----------------|
| preserveProviders | `models.providers` |
| preserveAuth | `auth.profiles` + `auth.order` |
| preserveAgents | `agents.defaults` + `agents.list` |
| preservePlugins | `plugins.entries`（与新默认合并，新默认优先级低） |

#### Scenario: 保留 providers
- **WHEN** `preserveProviders=True`
- **THEN** 旧 `models.providers` 整体写入新配置

#### Scenario: 保留 auth
- **WHEN** `preserveAuth=True`
- **THEN** 旧 `auth.profiles` 和 `auth.order` 整体写入新配置

#### Scenario: 保留 agents
- **WHEN** `preserveAgents=True`
- **THEN** 旧 `agents.defaults` 覆盖新配置中的 `agents.defaults`
- **AND** 旧 `agents.list` 覆盖新配置中的 `agents.list`

#### Scenario: 保留 plugins（合并而非覆盖）
- **WHEN** `preservePlugins=True`
- **THEN** 旧 `plugins.entries` 中的每个条目合并到新配置
- **AND** 新默认已有的条目（browser / file-transfer / memory-core）不被旧值覆盖

### Requirement: gateway.auth.token 始终重新生成
无论 preserve_options 如何设置，`gateway.auth.token` SHALL 始终使用新生成的随机值。
旧 token 不得保留。

#### Scenario: token 重新生成
- **WHEN** bootstrap 执行且旧配置有 `gateway.auth.token`
- **AND** `preserveAuth=True`
- **THEN** 新配置中的 `gateway.auth.token` SHALL 为新随机值，不等于旧值

### Requirement: openclaw.bootstrap RPC 参数扩展
sidecar 的 `openclaw.bootstrap` RPC SHALL 接受新的可选参数 `preserve_options: object`，
并透传给 Python `bootstrap()` 函数。

#### Scenario: RPC 传入 preserve_options
- **WHEN** 前端调用 `bootstrapOpenClaw("v2026.5.4", {preserveProviders: true, preserveAuth: true})`
- **THEN** sidecar 将 `preserve_options` 透传给 `bootstrap()`

### Requirement: 保留数据 schema 校验
通过 preserve 恢复的数据 SHALL 经过上游 `openclaw config patch --stdin` 写入，
确保符合上游 schema。不合法的字段被上游拒绝时，系统 SHALL log warn 但不阻塞 bootstrap。

#### Scenario: 旧数据包含不合法字段
- **WHEN** preserve 恢复的 providers 包含上游不接受的字段（如 `timeoutMs`）
- **THEN** `config patch` 报错
- **AND** 系统 log warn 并跳过该节点
- **AND** bootstrap 整体仍返回 success=True
