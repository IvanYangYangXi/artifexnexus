# 平台总览

## 一句话定位

Artifex Nexus = AI 驱动的创作平台，让 AI 直接与 DCC 软件交互。

---

## 五大能力板块

| 板块 | 功能 | 用户界面 |
|------|------|---------|
| **Chat** | 多会话 AI 对话、模型切换、上下文管理 | 左侧导航 → Chat，中央对话区 |
| **Skill** | 可安装的 AI 技能包（面向 DCC 操作/工作流） | 左侧导航 → Skills，浏览/安装/管理 |
| **Nexus-Tool** | 可安装的本地工具，支持触发器自动执行 | 左侧导航 → Tools，安装/管理/触发 |
| **DCC 桥接（MCP）** | 通过 MCP Server 操作 UE/Blender/Maya/Max | 右上角连接状态标识 |
| **通知系统** | Toast 气泡 + 铃铛通知中心 | 全局右下角 toast + 顶栏铃铛 |

---

## UI 布局速览

```
┌──────────┬──────────────────────────┬─────────────┐
│          │                          │  辅助面板    │
│  导航栏   │      主内容区             │  (折叠/展开)  │
│          │                          │             │
│ Chat     │                          │  预览       │
│ Skills   │                          │  工作流状态  │
│ Tools    │                          │  节点UI     │
│ Calendar │                          │             │
│ Settings │                          │             │
└──────────┴──────────────────────────┴─────────────┘
```

---

## 关键引导 Skill

以下 Skill 在需要时可主动加载获取操作指引：

| Skill | 用途 |
|-------|------|
| `nexus-agent-guide` | **本 Skill** — 平台操作全览 |
| `nexus-skill-manage` | Skill 管理：创建/安装/发布 |
| `nexus-tool-creator` | Nexus-Tool 创建与打包 |
| `nexus-installer-guide` | 安装向导操作指引 |

---

## 技术架构速查

- **桌面壳**：Tauri 2 应用，嵌入 Next.js 前端（端口 18790）
- **Gateway**：Node.js OpenClaw Gateway（端口 19789，WS + Control UI）
- **Sidecar**：Python JSON-RPC 进程，管理配置和安装
- **DCC 插件**：每个 DCC 一个 MCP Server（端口 18080-18083）
- **Skills/目录**：`~/.artifexnexus/skills/`
