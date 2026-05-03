"""artifex_nexus.openclaw — OpenClaw 上行适配 / OpenClaw uplink adapter.

DCC 进程内运行。对应原 ``platforms/openclaw/openclaw_*.py``。

模块（待实现）：
- ws       连接核心（握手 / RPC / 事件分发）
- chat     公开 API（流式写文件 / cancel / session 管理 / 上下文注入）
- diagnose 独立诊断模块
- adapter  OpenClawAdapter，实现 ``contracts.PlatformAdapter``
"""

__version__ = "0.0.0"
