# Nexus-Tool 触发器启用/禁用持久化方案

> 决策日期：2026-05-19 | 状态：已完成（Phase A + Phase B）

## 背景

Nexus-Tool 触发器有**三个维度**的启用/禁用控制，各自有不同的存储位置和生效范围。之前 manifest 格式混乱（新旧字段并存），dispatcher 读取逻辑与 UI 写入逻辑不同步，导致"关了触发器但照样跑"。

## 三个维度

### 维度1：触发器条目级启用/禁用（Per-Trigger）

- **UI 位置**：工具详情面板 → 触发器标签页 → 每个触发器条目的开关
- **存储位置**：`manifest.json`（工具文件自身）→ `triggers[].enabled`
- **生效方**：`trigger_dispatcher._load_tools()` 读取 `t.get("enabled", True)`
- **RPC**：`nexus-tool.update { id, triggers }` → `installer.update_nexus_tool()` → 写 manifest.json
- **状态**：✅ 链路已通，需清理 manifest 格式

### 维度2：工具级触发总闸（Per-Tool）

- **UI 位置**：工具卡片上的"启用触发"/"禁用触发"按钮
- **存储位置**：`~/.artifexnexus/config/skills.json` → `nexus_tools.disabled` 数组
- **生效方**：`trigger_dispatcher._load_tools()` **当前不读取** ❌ → 需要修复
- **RPC**：`nexus-tool.enable/disable` → `config.enable_nexus_tool()` → 写 skills.json
- **关键缺口**：数据已持久化到 skills.json，但 dispatcher 不读 SkillConfig

### 维度3：DCC 级触发器总闸（Per-DCC）

- **UI 位置**：各 DCC 插件面板（如 Blender addon 面板中）
- **存储位置**：各 DCC 插件自行管理（不在本次改动范围）
- **状态**：✅ 已在 Blender 插件实现，符合预期，无需改动
- **设计原则**：用户即使未启用 Artifex 也能在 DCC 内控制；每个 DCC 独立，互不影响

## Manifest 格式规范（v2）

旧格式冗余字段：`trigger: { type, dcc, event }` 和 `execution: { mode }`。

新格式（扁平字段，保留所有有用的元数据）：

```json
{
  "triggers": [
    {
      "id": "uuid",
      "name": "触发规则名称",
      "description": "规则描述（保留）",
      "enabled": true,
      "triggerType": "event",
      "dcc": "blender",
      "eventType": "file.save.post",
      "executionMode": "notify",
      "useDefaultFilters": true,
      "conditions": {},
      "scheduleConfig": { "type": "interval", "interval": "30m" }
    }
  ]
}
```

## 实施计划

### Phase A：Manifest 格式清理 + dispatcher 对齐

| 步骤 | 文件 | 改动 |
|------|------|------|
| A1 | `tools/{official,marketplace}/*/manifest.json` (3个) | 删除 `trigger:{}` 和 `execution:{}` 冗余嵌套，保留扁平字段 |
| A2 | `trigger_dispatcher.py:170-178` | 读 `t.get("triggerType")` / `t.get("dcc")` / `t.get("eventType")` 替代旧嵌套 |
| A3 | 验证 `_rpc_helpers.py:_nt_data_to_dict` | 确认 triggers 透传无旧字段 |

### Phase B：补上工具总闸的 dispatcher 缺口

| 步骤 | 文件 | 改动 |
|------|------|------|
| B1 | `trigger_dispatcher._load_tools()` | 加载工具前读取 `SkillConfig.get_disabled_nexus_tools()`，跳过被禁用的工具 |

## 不改动的部分

- 维度3（DCC 总闸）：已在 Blender 插件实现，无需改动
- `description` 字段：保留，与旧格式清理无关
- `SkillConfig` 现有 API：`enable_nexus_tool()` / `disable_nexus_tool()` / `get_disabled_nexus_tools()` 已完善
- `nexus-tool-api.ts` 前端 API：链路已通，无需改动

## 已知问题与后续

### Blender 侧触发器也需读 SkillConfig（Phase B 的缺口）

Blender addon 内的 `trigger_dispatcher.py`（`packages/dcc/blender/.../trigger_dispatcher.py`）是 Blender 保存钩子的**实际执行路径**，目前**不读 SkillConfig**。工具卡片上"禁用触发"只影响 sidecar 侧，对 Blender 内直接执行无效。

**原因**：Blender addon 运行在 Blender Python 环境内，不一定能 import `artifex_nexus.core.skill_config`。可选的解决方案：
- 方案1：Blender dispatcher 直接读 `~/.artifexnexus/config/skills.json`（与 `_read_tool_sources_config()` 同模式）
- 方案2：通过 MCP bridge 查询工具启用状态
- 优先级：中（工具总闸在 Blender 内不生效，但不影响核心保存钩子功能）

### 修复记录

- 2026-05-19: 修复 Blender 侧 `trigger_dispatcher.py` 未同步更新导致的保存钩子失效
- 2026-05-19: 补漏 `official/universal/` 下 2 个 compliance-checker manifest 旧格式清理
- 2026-05-19: 修复用户实例工具 `Example-Blender对象命名规范检查 (实例)-01` 的混合格式 manifest
- 2026-05-19: 两个 dispatcher 加新旧格式 fallback — `t.get("triggerType") or t.get("trigger", {}).get("type")` 模式
- 2026-05-19: **修复 tool-sources.json 缺少用户实例工具目录** → bootstrap.py + sidecar.py 启动期确保
- 2026-05-19: **修复实例工具无 main.py 导致触发执行失败** → 两个 dispatcher `_execute_tool()` 加 parentPath fallback
- 2026-05-19: **修复 Blender dispatcher 不读工具总闸** → 直接读 skills.json（Blender 无法 import SkillConfig）
- 2026-05-19: **修复 tool_sources.py 去重** → `_normalize_path()` 剥离 Windows `\\?\` 前缀

## 教训汇总

1. **manifest schema 变更必须全局搜索所有读取点**：sidecar dispatcher + 各 DCC addon dispatcher + 用户实例目录
2. **tool-sources.json 是三端唯一数据源**：sidecar / Blender / 未来 DCC 都读它，新增目录类型必须注册环节闭环
3. **实例工具的脚本 fallback 是隐式约定**，需在 dispatcher 层显式实现（parentPath）
4. **DCC dispatcher 无法 import Python 包时，直接读 JSON**（skills.json 同理 tool-sources.json）
5. **Windows 路径 `\\?\` 前缀会导致去重失效**，写入前需统一规范化
