"""
nexus_tool/scanner.py — Nexus-Tool 文件系统扫描
=================================================

从 artclaw ToolManager ``services/tool_scanner.py`` 复制并适配。

目录结构：
  - 内嵌工具（official / marketplace）：由调用方通过 ``bundled_nexus_tools_path`` 传入，
    工具随 wrapper 包分发，通过 ``importlib.resources`` 定位。
    ``{bundled_nexus_tools_path}/{source}/{dcc?}/{name}/manifest.json``
  - 用户工具（user）：``~/.artifexnexus/nexus-tools/user/{name}/manifest.json``

其中 source ∈ {official, marketplace, user}。

命名铁律：所有函数名/变量名必须包含 ``nexus_tool``，禁止裸 ``tool``。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import ScannedNexusTool

_VALID_SOURCES = ("official", "marketplace", "user")

# 默认 Nexus-Tool 根目录
_DEFAULT_NEXUS_TOOLS_ROOT = Path.home() / ".artifexnexus" / "nexus-tools"


def _parse_manifest(nexus_tool_dir: Path, source: str) -> Optional[ScannedNexusTool]:
    """解析单个 nexus-tool 目录的 manifest.json。

    ``source`` 由目录层级决定（不为 manifest 字段所动）。
    """
    manifest_path = nexus_tool_dir / "manifest.json"
    if not manifest_path.exists():
        return None

    try:
        text = manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(text)
    except Exception:
        return None

    name = manifest.get("name")
    if not name:
        return None

    impl = manifest.get("implementation", {})
    impl_type = impl.get("type", "script")

    # 从目录层级推导 source（权威），若 manifest 不一致则补丁
    manifest_source = manifest.get("source", source)
    if manifest_source != source:
        manifest = dict(manifest)
        manifest["source"] = source

    # 自动生成 id: {source}/{dirname}
    auto_id = f"{source}/{nexus_tool_dir.name}"
    if manifest.get("id") != auto_id:
        manifest = dict(manifest)
        manifest["id"] = auto_id

    author = manifest.get("author", "")
    created_at = manifest.get("createdAt", "")
    updated_at = manifest.get("updatedAt", "")

    # 回退：无时间戳时取文件系统时间
    if not created_at or not updated_at:
        try:
            import datetime as _dt
            stat = manifest_path.stat()
            if not created_at:
                created_at = _dt.datetime.fromtimestamp(
                    stat.st_ctime
                ).strftime("%Y-%m-%d %H:%M:%S")
            if not updated_at:
                updated_at = _dt.datetime.fromtimestamp(
                    stat.st_mtime
                ).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass

    return ScannedNexusTool(
        name=name,
        description=manifest.get("description", ""),
        version=manifest.get("version", "1.0.0"),
        source=source,
        target_dccs=manifest.get("targetDCCs", []),
        implementation_type=impl_type,
        nexus_tool_path=str(nexus_tool_dir),
        manifest=manifest,
        author=author,
        created_at=created_at,
        updated_at=updated_at,
    )


def _scan_source_dir(source_dir: Path, source_name: str,
                     seen: Dict[str, bool]) -> List[ScannedNexusTool]:
    """扫描一个 source 目录下的所有 nexus-tool。

    支持两种布局：
      - Flat:   {source_dir}/{name}/manifest.json
      - Nested: {source_dir}/{dcc}/{name}/manifest.json
    """
    results: List[ScannedNexusTool] = []
    if not source_dir.exists():
        return results

    for child in sorted(source_dir.iterdir()):
        if not child.is_dir():
            continue
        # Flat layout
        if (child / "manifest.json").exists():
            key = f"{source_name}/{child.name}"
            if key not in seen:
                parsed = _parse_manifest(child, source_name)
                if parsed is not None:
                    results.append(parsed)
                    seen[key] = True
        else:
            # Nested layout
            for nexus_tool_dir in sorted(child.iterdir()):
                if not nexus_tool_dir.is_dir():
                    continue
                key = f"{source_name}/{nexus_tool_dir.name}"
                if key not in seen:
                    parsed = _parse_manifest(nexus_tool_dir, source_name)
                    if parsed is not None:
                        results.append(parsed)
                        seen[key] = True
    return results


def scan_nexus_tools(
    nexus_tools_root: Optional[Path] = None,
    bundled_nexus_tools_path: Optional[Path] = None,
) -> List[ScannedNexusTool]:
    """扫描所有 nexus-tool 目录并返回发现列表。

    双路径架构：
      - 内嵌路径：``{bundled_nexus_tools_path}/{official,marketplace}/``（随包分发）
      - 用户路径：``~/.artifexnexus/nexus-tools/user/``（用户自创工具）

    扫描顺序（低优先级先，高优先级后覆盖）：
      1. official   (bundled_nexus_tools_path)
      2. marketplace (bundled_nexus_tools_path)
      3. user       (nexus_tools_root)
    """
    root = nexus_tools_root or _DEFAULT_NEXUS_TOOLS_ROOT
    results: List[ScannedNexusTool] = []
    seen: Dict[str, bool] = {}

    # 1-2. 内嵌路径：official + marketplace（随 wrapper 包分发）
    if bundled_nexus_tools_path is not None and bundled_nexus_tools_path.is_dir():
        for source_name in ("official", "marketplace"):
            source_dir = bundled_nexus_tools_path / source_name
            results.extend(_scan_source_dir(source_dir, source_name, seen))

    # 3. 用户路径：仅 user（~/.artifexnexus/nexus-tools/user/）
    user_dir = root / "user"
    results.extend(_scan_source_dir(user_dir, "user", seen))

    return results
