"""``artifex`` 顶层命令 / Top-level CLI.

子命令规划（与原 artclaw CLI 对齐，前缀改为 artifex）：

    artifex skill create <name> [--category --software --template --description]
    artifex skill generate "<自然语言描述>" [--category --software]
    artifex skill test <name> [--software --dry-run]
    artifex skill package <name> [--output --format]
    artifex skill publish <name> [--target --message]
    artifex skill install <source> [--source-type --software]
    artifex skill list [--category --software --source]
    artifex skill info|enable|disable|uninstall|update <name>

    artifex install [--link | --copy]    # 一键部署到 ~/.artifexnexus/
    artifex doctor                       # 健康检查 + 完整性自修复
    artifex web                          # 启动 Web UI
"""
from __future__ import annotations

import typer

from .commands import skill as skill_cmd

app = typer.Typer(
    name="artifex",
    help="Artifex Nexus — The AI-Agent Bridge for Digital Creation",
    no_args_is_help=True,
)
app.add_typer(skill_cmd.app, name="skill", help="Skill 管理（创建/测试/打包/发布/安装/列表/启停）")


@app.command()
def version() -> None:
    """打印 CLI 版本 / Print CLI version."""
    from . import __version__
    typer.echo(f"artifex {__version__}")


if __name__ == "__main__":
    app()
