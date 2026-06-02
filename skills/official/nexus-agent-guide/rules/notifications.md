# 通知系统规则（气泡 + 铃铛）

Artifex Nexus 桌面应用的右下角 toast 气泡和右上角铃铛通知中心，是统一的用户反馈通道。

---

## 系统架构

```
通知来源 ──→ NotificationStore (React Context + localStorage)
                 ├──→ toast() sonner 气泡（右下角弹出）
                 └──→ NotificationBell（铃铛 + Badge + Popover 历史列表）
```

- 每次 `addNotification()` 自动触发 toast 气泡
- 通知历史最大 50 条，持久化到 localStorage
- 点击铃铛可查看历史列表，点击条目弹出详情 Dialog

---

## 三种通知通道选择

| 通道 | 适用场景 | 延迟 |
|------|----------|:--:|
| **Python 文件桥接** | 外部 Python 脚本、DCC 工具内部通知（DCC 进程无法直接访问 WebView） | ~3s |
| **Gateway WebSocket** | Gateway 内 cron 任务、Gateway 插件 | 实时 |
| **Tauri IPC / 前端通知** | 桌面应用 WebView 内前端代码、RunPanel 工具执行结果 | 实时 |

### 通道选择决策

```
你要从哪里发通知？
├─ 外部 Python 脚本 → 通道 A（Python 文件桥接）
├─ Gateway cron 任务 → 通道 B（Gateway WS）
├─ Tauri WebView 前端代码 → 通道 C（Tauri IPC）
├─ DCC 内 Python 工具（Blender/Maya/Max 等） → 通道 A（写文件到 pending_notifications/）
└─ 通过 RunPanel 运行的工具 → 前端自动通知（工具无需自行发送）
```

---

## Nexus-Tool 自动通知

通过 Artifex Nexus RunPanel 触发的工具，执行完成后 **前端自动发送通知**（无需工具代码自行发通知）：

| 工具类型 | 识别条件 | 成功通知 | 失败通知 |
|----------|---------|----------|----------|
| 合规检查类 | `data.issues_found` 或 `data.report` 存在 | `"检查 N 个 Tool，全部通过"` (success) 或 `"检查 N 个 Tool，X 个错误，Y 个警告"` (warning/error) | — |
| 资产扫描类 | `data.csv_path` 存在 或 `data.groups + data.total_scanned` | `"扫描 N 个资产，发现 K 个重复组（M 个资产）\nCSV: /path/to/file"` (success)，CSV 路径同时写到 detail | `"执行失败 [step]: {错误}"` (error)，traceback 进 detail |
| 普通工具（有输出） | 其他 `data.stdout > 3 字符` | `"执行成功（输出 N 字符）"` (success) | `"执行失败 [step]: {错误}"` (error) |
| 普通工具（无输出） | 其他 | `"执行成功"` (success) | `"执行失败 [step]: {错误}"` (error) |

- 通知标题格式：`工具: {工具名称}`
- 合规检查类通知的 `detail` 字段附完整 report（铃铛点开可查看）
- 失败通知的 `detail` 字段附 `error_type` + 完整 `traceback`
- 超时也会触发通知：`"执行失败: 执行超时（超过 {N} 秒）"`（N 来自「设置 → 默认工具超时」，默认 300s）
- 用户手动取消**不触发通知**

**关键约定**：工具脚本只需返回标准 dict（含 `success: bool`、可选 `error / step / traceback / csv_path` 等）。
前端 `RunPanel.maybeNotify` 会自动识别字段生成对应通知。**不要**在工具内手写
`_notify` / `_toast` 文件桥接 —— 会导致重复通知（前端自动 + 工具自发）。

---

## 通知数据结构

```json
{
  "type": "success",
  "title": "通知标题（显示在 toast 和铃铛列表）",
  "message": "通知详情内容",
  "source": "script:my-identifier"
}
```

| 字段 | 必需 | 说明 |
|------|:---:|------|
| `type` | ✅ | `info` / `success` / `warning` / `error` |
| `title` | ✅ | 通知标题 |
| `message` | ✅ | 通知详情 |
| `source` | 可选 | 来源标识 |

---

## 子文档

- 通道 A 详细指引 → `notifications-python.md`
- 通道 B 详细指引 → `notifications-gateway.md`
- 通道 C 详细指引 → `notifications-tauri.md`
