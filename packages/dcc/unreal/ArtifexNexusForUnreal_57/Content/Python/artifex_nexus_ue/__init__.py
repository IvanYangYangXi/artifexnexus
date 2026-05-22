"""Artifex Nexus for Unreal — Python bootstrap.

由 ArtifexNexus C++ Subsystem 在 PostEngineInit 阶段自动加载。

已实现组件：
- init_unreal.py        Python 初始化入口 + MCP Server 启停 API
- ue_mcp_server.py      MCP JSON-RPC over WebSocket 服务 (port 18080)
- dcc_event_intercept.py DCC 事件拦截 & 触发器系统
- ue_version_adapter.py UE 版本适配层
- knowledge_base.py     本地知识库查询
- skill_hub.py          Skill Hub 注册与执行
- skill_loader.py       Skill 加载辅助
- skill_manifest.py     Skill manifest 解析
- skill_version.py      版本匹配
- skill_conflict.py     冲突检测
- skill_mcp_tools.py    MCP 工具注册
- skill_mcp_resources.py MCP 资源注册
- tools/                context_provider / risk_confirmation / self_healing / static_guard / universal_proxy

唯一注册的 MCP 工具：``run_python``
所有领域能力以 Skill 形式提供，通过 MCP 调用。
"""
