"""Artifex Nexus for Unreal — Python bootstrap.

由 ArtifexNexus C++ 模块在 PostEngineInit 阶段加载。

主要组件（待实现）：
- mcp_server.py     标准 MCP JSON-RPC 服务（主线程 tick 驱动）
- command_queue.py  线程安全命令队列（MCP 线程 → 主线程）
- context.py        UE 上下文采集（场景 / 选择 / 视口）
- bootstrap.py      生命周期管理

唯一注册的 MCP 工具：``run_python``（Gateway 端会带前缀变成 ``mcp_unreal_run_python``）
所有领域能力以 Skill 形式提供，通过 ``execute()`` 调用：

    from artifex_nexus.skill import execute
    result = execute("create_static_mesh", {"mesh_path": "/Game/...", "location": [0,0,0]})
"""
