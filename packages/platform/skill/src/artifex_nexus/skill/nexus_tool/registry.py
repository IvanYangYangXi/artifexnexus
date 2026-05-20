"""
nexus_tool/registry.py — NexusToolRegistry 注册表
=====================================================

从 artclaw ToolManager ``services/tool_service.py`` 复制并适配。

职责：
    - 扫描 nexus-tools 目录 + 合并用户偏好
    - 列表查询（过滤 / 分页 / 排序 / 搜索）
    - 启停管理（enable / disable）
    - 运行（SDK 方法，不通过 Sidecar RPC 暴露）

命名铁律：所有类名/方法名/变量名必须包含 ``nexus_tool``，禁止裸 ``tool``。
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from artifex_nexus.core.skill_config import SkillConfig

from .models import NexusToolData, NexusToolResult
from .scanner import scan_nexus_tools

logger = logging.getLogger("artifex_nexus.skill.nexus_tool.registry")


class NexusToolRegistry:
    """Nexus-Tool 注册表：发现 / 查询 / 启停 / 运行。

    不依赖 FastAPI / HTTP，纯 Python SDK，供 sidecar 和 DCC 内 AI 代码使用。
    """

    def __init__(
        self,
        config: SkillConfig | None = None,
        nexus_tools_root: Path | None = None,
        tools_path: Path | None = None,
    ):
        self.config = config or SkillConfig()
        self._nexus_tools_root = nexus_tools_root
        self._tools_path = tools_path
        self._cache: List[NexusToolData] = []

    # ═══════════════════════════════════════════════════════════════════════
    # 内部：扫描 + 构建
    # ═══════════════════════════════════════════════════════════════════════

    def _scan_and_build(self) -> List[NexusToolData]:
        """扫描 nexus-tools 目录并与用户偏好合并。"""
        scanned = scan_nexus_tools(
            nexus_tools_root=self._nexus_tools_root,
            tools_path=self._tools_path,
        )
        disabled_set = self.config.get_disabled_nexus_tools()
        pinned_set = self.config.get_pinned_nexus_tools()
        fav_set = self.config.get_favorite_nexus_tools()

        result: List[NexusToolData] = []
        for s in scanned:
            nexus_tool_id = f"{s.source}/{s.name}"
            is_disabled = nexus_tool_id in disabled_set
            td = NexusToolData(
                id=nexus_tool_id,
                name=s.name,
                description=s.description,
                version=s.version,
                source=s.source,
                target_dccs=s.target_dccs,
                status="disabled" if is_disabled else "installed",
                nexus_tool_path=s.nexus_tool_path,
                manifest=s.manifest,
                is_enabled=not is_disabled,
                is_pinned=nexus_tool_id in pinned_set,
                is_favorited=nexus_tool_id in fav_set,
                author=s.author,
                created_at=s.created_at,
                updated_at=s.updated_at,
            )
            result.append(td)

        self._cache = result
        return result

    # ═══════════════════════════════════════════════════════════════════════
    # 查询
    # ═══════════════════════════════════════════════════════════════════════

    def list_nexus_tools(
        self,
        *,
        source: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
        sort_by: str = "name",
        sort_order: str = "asc",
    ) -> Tuple[List[NexusToolData], int]:
        """过滤 + 分页 + 排序的 nexus-tool 列表。"""
        items = self._scan_and_build()

        if source and source != "all":
            items = [t for t in items if t.source == source]
        if search:
            low = search.lower()
            items = [
                t for t in items
                if low in t.name.lower() or low in t.description.lower()
            ]

        reverse = sort_order == "desc"

        def sort_key(t: NexusToolData):
            primary = not t.is_pinned
            secondary = getattr(t, sort_by, t.name)
            if isinstance(secondary, str):
                secondary = secondary.lower()
            return (primary, secondary)

        items.sort(key=sort_key, reverse=reverse)
        if reverse:
            items.sort(key=lambda t: not t.is_pinned)

        total = len(items)
        start = (page - 1) * limit
        page_items = items[start : start + limit]
        return page_items, total

    def get_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """按 ID 获取单个 nexus-tool 详情。"""
        if not self._cache:
            self._scan_and_build()
        for t in self._cache:
            if t.id == nexus_tool_id:
                return t
        return None

    def search_nexus_tools(self, query: str) -> List[NexusToolData]:
        """模糊搜索 nexus-tool（名称 + 描述）。"""
        items = self._scan_and_build()
        low = query.lower()
        return [
            t for t in items
            if low in t.name.lower() or low in t.description.lower()
        ]

    # ═══════════════════════════════════════════════════════════════════════
    # 启停
    # ═══════════════════════════════════════════════════════════════════════

    def enable_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """启用 nexus-tool。"""
        td = self.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None
        td.is_enabled = True
        td.status = "installed"
        self.config.enable_nexus_tool(nexus_tool_id)
        return td

    def disable_nexus_tool(self, nexus_tool_id: str) -> Optional[NexusToolData]:
        """禁用 nexus-tool。"""
        td = self.get_nexus_tool(nexus_tool_id)
        if td is None:
            return None
        td.is_enabled = False
        td.status = "disabled"
        self.config.disable_nexus_tool(nexus_tool_id)
        return td

    # ═══════════════════════════════════════════════════════════════════════
    # 运行（纯 SDK 方法，不从 Sidecar RPC 暴露）
    # ═══════════════════════════════════════════════════════════════════════

    def run_nexus_tool(
        self, nexus_tool_id: str, params: Dict[str, Any] | None = None,
    ) -> NexusToolResult:
        """运行一个 nexus-tool（通用脚本，非 DCC 绑定）。

        DCC 绑定工具应由 OpenClaw MCP ``run_python`` 在 DCC 进程内执行。
        此方法仅适用于 targetDCCs 为 "general" 的通用工具。

        注意：此方法不通过 Sidecar RPC 暴露 —— 前端 [▶ 运行] 按钮
        应触发 DCC 内 run_python 而非 sidecar RPC。
        """
        params = params or {}
        td = self.get_nexus_tool(nexus_tool_id)
        if td is None:
            return NexusToolResult.fail(f"Nexus-Tool not found: {nexus_tool_id}")

        # DCC 绑定工具禁止本地执行
        _dcc_names = [entry.dcc for entry in td.target_dccs]
        if _dcc_names and not all(
            d in ("general", "universal") for d in _dcc_names
        ):
            dcc_list = ", ".join(_dcc_names)
            return NexusToolResult.fail(
                f"Nexus-Tool '{nexus_tool_id}' targets DCC [{dcc_list}]. "
                f"Please execute via OpenClaw MCP run_python in the DCC process."
            )

        # 通用脚本：subprocess 执行
        impl = td.manifest.get("implementation", {})
        entry = impl.get("entry", "main.py")
        function = impl.get("function", "")

        entry_path = Path(td.nexus_tool_path) / entry
        if not entry_path.exists():
            return NexusToolResult.fail(
                f"Entry script not found: {entry_path}"
            )

        try:
            if function:
                import sys
                params_repr = repr(params)
                code = (
                    f"import sys; "
                    f"sys.path.insert(0, {repr(str(entry_path.parent))}); "
                    f"import importlib.util; "
                    f"spec = importlib.util.spec_from_file_location("
                    f"'_nexus_tool', {repr(str(entry_path))}); "
                    f"mod = importlib.util.module_from_spec(spec); "
                    f"spec.loader.exec_module(mod); "
                    f"result = mod.{function}(**{params_repr}); "
                    f"import json; "
                    f"print(json.dumps(result) if not isinstance(result, str) "
                    f"else result)"
                )
                cmd = [sys.executable, "-c", code]
            else:
                cmd = [str(Path(__import__("sys").executable)), str(entry_path)]
                for k, v in params.items():
                    cmd += [f"--{k}", str(v)]

            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(entry_path.parent),
            )

            td.use_count += 1
            return NexusToolResult.ok({
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "success": proc.returncode == 0,
            })
        except subprocess.TimeoutExpired:
            return NexusToolResult.fail("Execution timed out (120s)")
        except Exception as exc:
            return NexusToolResult.fail(str(exc))

    # ═══════════════════════════════════════════════════════════════════════
    # 刷新
    # ═══════════════════════════════════════════════════════════════════════

    def refresh(self) -> int:
        """强制刷新缓存（重新扫描）。返回发现的 nexus-tool 数量。"""
        items = self._scan_and_build()
        return len(items)
