"""Artifex Nexus for Blender — addon entry.

Blender addon。Blender 启动时扫描 addons 目录，可通过 symlink 引用源码。

主要组件（待实现）：
- bootstrap.py        生命周期 / MCP 服务器启动 / bpy.app.timers 主线程接入
- command_queue.py    线程安全命令队列
- context.py          Blender 上下文采集
- skills/             Skill 模板（开发期；运行时由 SkillHub 从 ~/.artifexnexus/.openclaw/workspace/skills/ 加载）

唯一注册的 MCP 工具：``run_python``（Gateway 端会带前缀变成 ``mcp_blender_run_python``）
"""

bl_info = {
    "name": "Artifex Nexus",
    "author": "Ivan(杨己力)",
    "version": (0, 0, 0),
    "blender": (5, 1, 0),
    "category": "Development",
    "description": "AI-Agent bridge for Blender (Artifex Nexus)",
}
