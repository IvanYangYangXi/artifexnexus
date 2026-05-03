"""``artifex skill *`` 子命令骨架 / Skill subcommand skeleton.

具体实现 TODO，按 docs/specs/skill-system.md 第 N 节执行。
"""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=True)


@app.command("create")
def create(
    name: str,
    category: str = typer.Option(None),
    software: str = typer.Option("universal"),
    template: str = typer.Option("basic"),
    description: str = typer.Option(""),
) -> None:
    """创建 Skill 脚手架 / Scaffold a new Skill."""
    typer.echo(f"[TODO] create skill {name} ({software}/{category}, template={template})")


@app.command("list")
def list_skills(
    category: str = typer.Option(None),
    software: str = typer.Option(None),
    source: str = typer.Option(None),
) -> None:
    """列出 Skill / List skills."""
    typer.echo("[TODO] list skills")


@app.command("install")
def install(source: str) -> None:
    """安装 Skill / Install a skill from local/git/registry."""
    typer.echo(f"[TODO] install {source}")


@app.command("test")
def test(name: str, dry_run: bool = typer.Option(False, "--dry-run")) -> None:
    """离线测试 Skill（不依赖 AI 平台）/ Offline test."""
    typer.echo(f"[TODO] test {name} dry_run={dry_run}")
