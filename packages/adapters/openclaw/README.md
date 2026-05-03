# Adapter: OpenClaw

OpenClaw 平台的全套适配，对应原项目 `platforms/openclaw/`。

```
openclaw/
├── uplink/                # DCC 进程内运行：上行 WebSocket RPC（Python）
│   └── src/artifex_nexus/openclaw/
│       ├── ws.py          ← openclaw_ws.py     连接核心
│       ├── chat.py        ← openclaw_chat.py   聊天 API（流式/cancel/session）
│       ├── diagnose.py    ← openclaw_diagnose.py
│       └── adapter.py     ← OpenClawAdapter（实现 contracts.PlatformAdapter）
│
├── gateway-plugin/        # OpenClaw Gateway 进程内运行：下行 MCP 桥接（TypeScript）
│   └── src/index.ts       ← 原 platforms/openclaw/gateway/index.ts
│
└── config-templates/      # 配置模板（snippet / single-dcc / multi-dcc）
```

OpenClaw 本身（gateway 运行时）由 `vendor/openclaw/` 锁定版本提供，安装到 `~/.artifexnexus/.openclaw/`。
