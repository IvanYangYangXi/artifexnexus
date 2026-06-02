"""
skill_hub.py — 共享 SkillHub（Blender / Maya / Max / UE 通用）
===============================================================

全平台统一的 Skill 管理中心。零特定 DCC 依赖，
通过构造函数注入 DCC 差异（版本检测、Skills 目录、模块前缀）。

核心能力与 UE SkillHub 对齐：
  - 分层扫描 Skills/ 目录（official → marketplace → user → custom）
  - manifest.json + SKILL.md frontmatter 双重格式支持
  - 软件版本匹配
  - @skill_tool 装饰器发现（walk __dict__ → _artifex_skill_tool）
  - run_python 内部 API: execute_skill() / list_skills()
  - 文件变更热重载（轮询模式，无需 DCC 特有 API）

使用方式（DCC 侧初始化）:
    from artifex_nexus_sdk.skill_hub import SkillHub
    hub = SkillHub(
        dcc_name="blender",
        version_func=lambda: bpy.app.version_string,
        skills_dir="~/.artifexnexus/skills",
        module_prefix="blender_skill_",
    )
    hub.scan_and_register()
"""

from __future__ import annotations

import ast
import importlib
import importlib.util
import inspect
import json
import logging
import os
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from artifex_nexus_sdk.skill_manifest import (
    SkillManifest, ToolEntry, SoftwareVersion, ManifestValidationError,
    parse_manifest, validate_manifest,
    VALID_SOFTWARE,
)

logger = logging.getLogger("artifex_nexus.skill_hub")


# ============================================================================
# 1. 装饰器发现（runtime walk __dict__）
# ============================================================================

_DECORATED_SKILLS: Dict[str, dict] = {}


def _generate_schema_from_hints(func: Callable) -> dict:
    """从函数签名的 type hints 生成 JSON Schema。"""
    try:
        sig = inspect.signature(func)
    except (ValueError, TypeError):
        return {"type": "object", "properties": {}}

    properties: dict = {}
    required: list = []

    for param_name, param in sig.parameters.items():
        if param_name in ("self", "cls", "arguments"):
            continue
        prop: dict = {}
        annotation = param.annotation

        if annotation is str:
            prop["type"] = "string"
        elif annotation is int:
            prop["type"] = "integer"
        elif annotation is float:
            prop["type"] = "number"
        elif annotation is bool:
            prop["type"] = "boolean"
        elif annotation in (list, List):
            prop["type"] = "array"
        elif annotation in (dict, Dict):
            prop["type"] = "object"
        else:
            prop["type"] = "string"

        if param.default is inspect.Parameter.empty:
            required.append(param_name)
        else:
            prop["default"] = param.default
        properties[param_name] = prop

    schema = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _collect_decorated_from_module(module, module_name: str = "") -> None:
    """Walk 模块 __dict__ 查找 _artifex_skill_tool = True 的函数。

    与 Platform SkillHub 的发现机制完全对齐。
    """
    for obj_name, obj in vars(module).items():
        if not callable(obj):
            continue
        if not getattr(obj, "_artifex_skill_tool", False):
            continue
        tool_name = getattr(obj, "_artifex_skill_tool_name", obj_name)
        input_schema = _generate_schema_from_hints(obj)
        _DECORATED_SKILLS[tool_name] = {
            "name": tool_name,
            "description": (inspect.getdoc(obj) or "").split("\n")[0],
            "category": "general",
            "risk_level": "low",
            "input_schema": input_schema,
            "handler": obj,
            "module": module_name,
            "source_file": inspect.getfile(obj) if hasattr(obj, "__code__") else None,
        }


# ============================================================================
# 2. YAML Frontmatter 解析（零依赖，内联实现）
# ============================================================================

def _parse_yaml_frontmatter(content: str) -> Optional[dict]:
    """从 SKILL.md 解析 YAML frontmatter（零依赖）。"""
    lines = content.split("\n")
    if not lines or lines[0].strip() != "---":
        return None

    end_idx = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx < 0:
        return None

    fm_lines = lines[1:end_idx]
    result: dict = {}
    current_key: Optional[str] = None

    for line in fm_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" in stripped:
            colon_idx = stripped.index(":")
            key = stripped[:colon_idx].strip()
            value = stripped[colon_idx + 1:].strip()
            value = value.strip('"').strip("'")
            if key == "tags":
                if value.startswith("[") and value.endswith("]"):
                    inner = value[1:-1]
                    result[key] = [t.strip().strip('"').strip("'") for t in inner.split(",") if t.strip()]
                else:
                    result[key] = [value]
            else:
                result[key] = value

    return result


# ============================================================================
# 3. AST 静态扫描 @skill_tool 装饰器
# ============================================================================

def _scan_skill_tools_ast(init_py: Path) -> List[dict]:
    """通过 AST 静态分析 __init__.py 发现 @skill_tool 声明。"""
    try:
        source = init_py.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(init_py))
    except Exception:
        return []

    tools = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        for deco in node.decorator_list:
            if isinstance(deco, ast.Call):
                func_name = ""
                if isinstance(deco.func, ast.Name):
                    func_name = deco.func.id
                elif isinstance(deco.func, ast.Attribute):
                    func_name = deco.func.attr
                if func_name != "skill_tool":
                    continue

                tool_name = node.name
                tool_desc = ""
                for kw in deco.keywords:
                    if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                        tool_name = kw.value.value
                    elif kw.arg == "description" and isinstance(kw.value, ast.Constant):
                        tool_desc = kw.value.value
                tools.append({"name": tool_name, "description": tool_desc})
    return tools


# ============================================================================
# 4. 版本匹配（内联，零 DCC 依赖）
# ============================================================================

def _parse_version(version_str: str) -> Tuple[int, ...]:
    """将版本字符串解析为整数元组。"""
    if not version_str:
        return (0,)
    cleaned = re.split(r"[-+]", version_str)[0].strip()
    parts = re.findall(r"\d+", cleaned)
    if not parts:
        return (0,)
    return tuple(int(p) for p in parts)


def _matches_version(
    skill_sw_version: Optional[SoftwareVersion],
    current_version: str,
) -> bool:
    """检查 Skill 是否兼容当前软件版本。"""
    if skill_sw_version is None:
        return True
    if not current_version:
        return True
    current = _parse_version(current_version)
    if skill_sw_version.min_version:
        if current < _parse_version(skill_sw_version.min_version):
            return False
    if skill_sw_version.max_version:
        if current > _parse_version(skill_sw_version.max_version):
            return False
    return True


# ============================================================================
# 5. 分层扫描配置
# ============================================================================

LAYER_DIRS = {
    "official": "official",
    "marketplace": "marketplace",
    "user": "user",
    "custom": "custom",
}

_LEGACY_LAYER_MAP = {
    "00_official": "official",
    "01_team": "marketplace",
    "02_user": "user",
    "99_custom": "custom",
}

LAYER_ORDER = ["official", "marketplace", "user", "custom"]

# 已知 DCC 子目录名
DCC_SUBDIRS = {"universal", "unreal", "maya", "max", "blender"}


# ============================================================================
# 6. SkillHub 核心类
# ============================================================================

class SkillHub:
    """Skill 管理中心（全平台统一）。

    职责:
      - 分层扫描 Skills/ 目录
      - 解析 manifest.json / SKILL.md 双重格式
      - 检测软件版本兼容性
      - 加载 Python 模块并发现 @skill_tool 装饰的函数
      - 提供 execute_skill() / list_skills() API
      - 文件变更轮询热重载（可选）

    参数:
        dcc_name:       DCC 标识，如 "blender", "maya", "3ds_max", "unreal_engine"
        version_func:   无参 callable，返回当前 DCC 版本字符串
        skills_dir:     Skills 根目录路径
        module_prefix:  模块名前缀，如 "blender_skill_"
    """

    def __init__(
        self,
        dcc_name: str,
        version_func: Callable[[], str],
        skills_dir: str,
        module_prefix: str = "dcc_skill_",
    ):
        self._dcc_name = dcc_name
        self._version_func = version_func
        self._module_prefix = module_prefix
        self._current_version = "unknown"

        self._loaded_modules: Dict[str, Any] = {}
        self._registered_skills: Dict[str, dict] = {}  # skill_name → info
        self._manifests: Dict[str, SkillManifest] = {}
        self._all_manifests: List[SkillManifest] = []

        self._skills_dir = self._resolve_skills_dir(skills_dir)
        self._ensure_layer_dirs()
        self._ensure_sys_path()

        # 文件监控状态（轮询模式）
        self._watch_enabled = False
        self._watch_interval = 2.0
        self._file_mtimes: Dict[str, float] = {}
        self._poll_thread = None
        self._poll_handle = None

        # 尝试检测当前版本
        try:
            self._current_version = self._version_func()
        except Exception:
            pass

        logger.info("SkillHub initialized: %s at %s (v%s)",
                     dcc_name, self._skills_dir, self._current_version)

    # ── 初始化辅助 ──

    @staticmethod
    def _resolve_skills_dir(path: str) -> Path:
        """解析 Skills 目录路径，展开 ~ 和环境变量。"""
        expanded = os.path.expanduser(os.path.expandvars(path))
        p = Path(expanded)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _ensure_layer_dirs(self) -> None:
        """确保分层目录存在。迁移旧目录名到新目录名。"""
        for old_name, new_name in _LEGACY_LAYER_MAP.items():
            old_path = self._skills_dir / old_name
            new_path = self._skills_dir / new_name
            if old_path.exists() and not new_path.exists():
                old_path.rename(new_path)
                logger.info("SkillHub: migrated %s → %s", old_name, new_name)

        for layer_dir_name in LAYER_DIRS.keys():
            (self._skills_dir / layer_dir_name).mkdir(exist_ok=True)

    def _ensure_sys_path(self) -> None:
        """将 Skills 目录加入 sys.path。"""
        skills_str = str(self._skills_dir)
        if skills_str not in sys.path:
            sys.path.insert(0, skills_str)

    def _detect_skills_dir(self) -> Path:
        """从配置文件或环境变量读取 Skills 目录（可覆盖）。"""
        config_path = Path.home() / ".artifexnexus" / "config.json"
        if config_path.exists():
            try:
                cfg = json.loads(config_path.read_text(encoding="utf-8"))
                installed = cfg.get("skills", {}).get("installed_path", "")
                if installed:
                    return Path(os.path.expanduser(installed))
            except Exception:
                pass
        return self._skills_dir

    # ── 公开接口 ──

    def scan_and_register(self) -> int:
        """分层扫描 Skills/ 目录，发现、验证并注册所有 Skill。

        Returns:
            注册的 Skill 数量
        """
        logger.info("SkillHub: scanning skills in %s", self._skills_dir)

        _DECORATED_SKILLS.clear()
        self._all_manifests.clear()
        self._manifests.clear()

        # 阶段 1: 按层级扫描
        for layer_dir_name in LAYER_ORDER:
            layer_path = self._skills_dir / layer_dir_name
            if not layer_path.exists():
                continue
            self._scan_layer(layer_path, LAYER_DIRS[layer_dir_name])

        # 阶段 2: 扁平扫描（install.py 安装的扁平目录）
        self._scan_flat_skills()

        logger.info("SkillHub: discovered %d skill(s)", len(self._all_manifests))

        # 阶段 3: 版本过滤
        compatible = []
        for m in self._all_manifests:
            sw_ok = m.software in ("universal", self._dcc_name)
            if not sw_ok:
                logger.debug("SkillHub: skipping %s (for %s, current: %s)",
                             m.name, m.software, self._dcc_name)
                continue
            if not _matches_version(m.software_version, self._current_version):
                logger.debug("SkillHub: skipping %s (version mismatch)", m.name)
                continue
            compatible.append(m)

        # 阶段 4: 加载模块并注册
        new_skills = 0
        for manifest in compatible:
            try:
                self._load_and_register_skill(manifest)
                self._manifests[manifest.name] = manifest
                new_skills += 1
            except Exception as e:
                logger.error("Failed to load skill %s: %s", manifest.name, e)
                traceback.print_exc()

        logger.info("SkillHub: registered %d skills (%d tools)",
                     new_skills, len(self._registered_skills))
        return new_skills

    def execute_skill(self, skill_name: str, params: dict = None) -> dict:
        """统一 Skill 执行入口（供 run_python 内部调用）。

        Usage:
            from artifex_nexus_sdk.skill_hub import get_skill_hub
            hub = get_skill_hub()
            result = hub.execute_skill("batch_rename", {"prefix": "SM_"})

        Returns:
            {"success": True, "result": ...} 或 {"success": False, "error": "..."}
        """
        if params is None:
            params = {}

        if skill_name not in self._registered_skills:
            return {"success": False, "error": f"Skill 未找到: {skill_name}"}

        info = self._registered_skills[skill_name]
        handler = info.get("handler")
        if not handler:
            return {"success": False, "error": f"Skill '{skill_name}' 没有 handler"}

        try:
            result = handler(params)
            return {"success": True, "result": result}
        except Exception as e:
            logger.exception("Skill execution error (%s): %s", skill_name, e)
            return {"success": False, "error": str(e)}

    def list_skills(self, category: str = None, software: str = None) -> list:
        """列出已注册的 Skill。

        Usage:
            from artifex_nexus_sdk.skill_hub import get_skill_hub
            hub = get_skill_hub()
            skills = hub.list_skills(category="material")

        Returns:
            [{"name": "...", "description": "...", ...}, ...]
        """
        results = []
        for name, info in self._registered_skills.items():
            manifest = info.get("manifest")
            entry = {
                "name": name,
                "description": info.get("description", ""),
            }
            if manifest:
                entry["category"] = getattr(manifest, "category", "")
                entry["software"] = getattr(manifest, "software", "")
                entry["version"] = getattr(manifest, "version", "")
                entry["display_name"] = getattr(manifest, "display_name", name)

            if category and entry.get("category") != category:
                continue
            if software and entry.get("software") != software:
                continue
            results.append(entry)
        return results

    def get_skill_list(self) -> List[dict]:
        """获取已注册的所有 Skill 信息（不含 handler），供外部查询。"""
        result = []
        for skill_name, info in self._registered_skills.items():
            manifest = self._manifests.get(info.get("manifest_name", ""))
            entry = {
                "name": info["name"],
                "description": info.get("description", ""),
                "category": info.get("category", "general"),
                "risk_level": info.get("risk_level", "low"),
                "source_file": info.get("source_file", ""),
                "source_layer": info.get("source_layer", "custom"),
            }
            if manifest:
                entry["version"] = manifest.version
                entry["display_name"] = manifest.display_name
                entry["author"] = manifest.author
                entry["software"] = manifest.software
                entry["tags"] = manifest.tags
            result.append(entry)
        return result

    def get_skill_info(self, skill_name: str) -> Optional[dict]:
        """获取单个 Skill 的详细信息。"""
        manifest = self._manifests.get(skill_name)
        if manifest:
            return manifest.to_dict()
        info = self._registered_skills.get(skill_name)
        if info:
            return {k: v for k, v in info.items() if not k.startswith("_") and k != "handler"}
        return None

    def get_skills_by_layer(self, layer: str) -> List[dict]:
        return [m.to_dict() for m in self._all_manifests if m.source_layer == layer]

    def get_skills_by_category(self, category: str) -> List[dict]:
        return [m.to_dict() for m in self._manifests.values() if m.category == category]

    # ── 扫描内部方法 ──

    def _scan_layer(self, layer_path: Path, layer_id: str) -> None:
        """扫描一个层级目录下的所有 Skill 包。"""
        if not layer_path.is_dir():
            return

        for entry in sorted(layer_path.iterdir()):
            if not entry.is_dir():
                continue
            if entry.name.startswith("_") or entry.name.startswith("."):
                continue

            has_manifest = (entry / "manifest.json").exists()
            has_skill_md = (entry / "SKILL.md").exists()

            if has_manifest or has_skill_md:
                self._parse_and_collect(entry, layer_id)
            elif entry.name in DCC_SUBDIRS:
                for sub_entry in sorted(entry.iterdir()):
                    if not sub_entry.is_dir():
                        continue
                    if sub_entry.name.startswith("_") or sub_entry.name.startswith("."):
                        continue
                    if (sub_entry / "manifest.json").exists() or (sub_entry / "SKILL.md").exists():
                        self._parse_and_collect(sub_entry, layer_id)
            else:
                # category 分组目录
                for sub_entry in sorted(entry.iterdir()):
                    if sub_entry.is_dir() and (
                        (sub_entry / "manifest.json").exists() or (sub_entry / "SKILL.md").exists()
                    ):
                        self._parse_and_collect(sub_entry, layer_id)

    def _scan_flat_skills(self) -> None:
        """扫描 Skills 目录下的扁平 Skill 包。"""
        if not self._skills_dir.is_dir():
            return

        skip_dirs = set(LAYER_DIRS.keys()) | set(_LEGACY_LAYER_MAP.keys()) | DCC_SUBDIRS | {"templates"}
        seen_names = {m.name for m in self._all_manifests}

        for entry in sorted(self._skills_dir.iterdir()):
            if not entry.is_dir():
                continue
            if entry.name.startswith("_") or entry.name.startswith("."):
                continue
            if entry.name in skip_dirs:
                continue

            if (entry / "manifest.json").exists() or (entry / "SKILL.md").exists():
                if entry.name not in seen_names:
                    self._parse_and_collect(entry, "installed")

    def _parse_and_collect(self, skill_dir: Path, layer_id: str) -> None:
        """解析一个 Skill 目录的 manifest 并收集。"""
        manifest_path = skill_dir / "manifest.json"
        skill_md_path = skill_dir / "SKILL.md"

        if manifest_path.exists():
            manifest, errors = parse_manifest(str(manifest_path))
            has_errors = any(e.severity == "error" for e in errors)

            if has_errors:
                if skill_md_path.exists():
                    logger.info("SkillHub: %s: manifest incomplete, falling back to SKILL.md",
                                skill_dir.name)
                    manifest = self._manifest_from_skill_md(skill_dir, skill_md_path)
                    if manifest is not None:
                        try:
                            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                            if raw.get("version"):
                                manifest.version = raw["version"]
                        except Exception:
                            pass
                else:
                    for e in errors:
                        if e.severity == "error":
                            logger.error("SkillHub: %s: %s", skill_dir.name, e)
                    return
            if manifest is None:
                return
            for e in errors:
                if e.severity == "warning":
                    logger.info("SkillHub: %s: %s", manifest.name, e)

        elif skill_md_path.exists():
            manifest = self._manifest_from_skill_md(skill_dir, skill_md_path)
            if manifest is None:
                return
            logger.info("SkillHub: %s: loaded from SKILL.md (no manifest.json)", skill_dir.name)
        else:
            return

        manifest.source_layer = layer_id
        manifest.source_dir = str(skill_dir)
        self._all_manifests.append(manifest)

    def _manifest_from_skill_md(self, skill_dir: Path, skill_md_path: Path) -> Optional[SkillManifest]:
        """从 SKILL.md frontmatter 构建 SkillManifest。"""
        try:
            content = skill_md_path.read_text(encoding="utf-8")
        except Exception as e:
            logger.error("SkillHub: cannot read %s: %s", skill_md_path, e)
            return None

        fm = _parse_yaml_frontmatter(content)
        if not fm or not fm.get("name"):
            logger.info("SkillHub: %s: SKILL.md missing name in frontmatter", skill_dir.name)
            return None

        fm_name = fm["name"].replace("-", "_")
        canonical_name = skill_dir.name
        # frontmatter name 是权威源；目录名不一致时仅记录日志
        if fm_name != canonical_name:
            logger.info("SkillHub: %s: frontmatter name '%s' differs from directory name '%s'",
                        skill_dir.name, fm_name, canonical_name)
        fm_desc = fm.get("description", "")

        init_py = skill_dir / "__init__.py"
        tools_from_ast = []
        if init_py.exists():
            tools_from_ast = _scan_skill_tools_ast(init_py)
        if not tools_from_ast:
            tools_from_ast = [{"name": fm_name, "description": fm_desc}]

        # metadata.artifexnexus 优先，顶层 fallback
        metadata = fm.get("metadata", {})
        ac_meta = metadata.get("artifexnexus", {}) if isinstance(metadata, dict) else {}

        def _ac(field, default=""):
            val = ac_meta.get(field) if isinstance(ac_meta, dict) else None
            if val is not None and val != "":
                return val
            return fm.get(field, default)

        # 推断 software
        _software = _ac("software", "")
        if not _software:
            if fm_name.startswith("ue") and len(fm_name) > 2 and fm_name[2:3].isdigit():
                _software = "unreal_engine"
            elif fm_name.startswith("maya"):
                _software = "maya"
            elif fm_name.startswith("max"):
                _software = "3ds_max"
            elif fm_name.startswith("blender"):
                _software = "blender"
            else:
                _software = "universal"

        _tags = _ac("tags", [])
        if isinstance(_tags, str):
            _tags = [t.strip() for t in _tags.split(",") if t.strip()]

        manifest = SkillManifest(
            manifest_version="1.0",
            name=fm_name,
            display_name=_ac("display_name", fm_name.replace("_", " ").title()),
            description=fm_desc,
            version=_ac("version", "1.0.0"),
            author=_ac("author", ""),
            license=fm.get("license", "MIT"),
            software=_software,
            category=_ac("category", "utils"),
            risk_level=_ac("risk_level", "low"),
            dependencies=[],
            tags=_tags,
            entry_point="__init__.py",
            tools=[ToolEntry(name=t["name"], description=t["description"]) for t in tools_from_ast],
            software_version=SoftwareVersion(),
        )
        return manifest

    def _load_and_register_skill(self, manifest: SkillManifest) -> None:
        """加载 Python 模块并注册所有 @skill_tool 声明的工具。"""
        skill_dir = Path(manifest.source_dir)
        entry_file = skill_dir / manifest.entry_point

        if not entry_file.exists():
            logger.info("  Skill %s: no entry point, SKILL.md-only (skipping Python load)",
                        manifest.name)
            return

        module_name = f"{self._module_prefix}{manifest.name}"

        skill_dir_str = str(skill_dir.parent)
        if skill_dir_str not in sys.path:
            sys.path.insert(0, skill_dir_str)

        spec = importlib.util.spec_from_file_location(module_name, str(entry_file))
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot create module spec for {entry_file}")

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        self._loaded_modules[module_name] = module

        # Walk __dict__ 发现 @skill_tool
        _collect_decorated_from_module(module, module_name)

        for tool_entry in manifest.tools:
            tool_name = tool_entry.name
            if tool_name in _DECORATED_SKILLS:
                info = _DECORATED_SKILLS[tool_name]
                info["manifest"] = manifest
                info["manifest_name"] = manifest.name
                info["source_layer"] = manifest.source_layer
                self._registered_skills[tool_name] = info
            else:
                logger.debug("SkillHub: tool '%s' in manifest but not decorated: %s",
                             tool_name, manifest.name)

        logger.info("  Loaded skill: %s v%s [%s] (%d tools)",
                     manifest.name, manifest.version, manifest.source_layer,
                     len(manifest.tools))

    # ── 文件监控（轮询模式）──

    def start_watching(self, interval: float = 2.0) -> None:
        """启动轮询式文件监控。

        Args:
            interval: 轮询间隔（秒），默认 2s。
        """
        if self._poll_thread is not None and self._poll_thread.is_alive():
            return
        self._watch_enabled = True
        self._watch_interval = interval
        self._file_mtimes: Dict[str, float] = {}
        self._record_initial_mtimes()

        # 启动后台线程
        import threading
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._poll_thread.start()
        logger.info("SkillHub: polling watcher started (interval=%.1fs)", interval)

    def stop_watching(self) -> None:
        """停止文件监控。"""
        self._watch_enabled = False
        self._poll_handle = None
        if self._poll_thread is not None and self._poll_thread.is_alive():
            self._poll_thread.join(timeout=3.0)
            self._poll_thread = None
        logger.info("SkillHub: watcher stopped")

    def _record_initial_mtimes(self) -> None:
        """记录初始文件修改时间。"""
        self._file_mtimes = {}
        for py_file in self._skills_dir.rglob("*.py"):
            if "__pycache__" in str(py_file):
                continue
            self._file_mtimes[str(py_file)] = py_file.stat().st_mtime
        for json_file in self._skills_dir.rglob("manifest.json"):
            self._file_mtimes[str(json_file)] = json_file.stat().st_mtime

    def _poll_loop(self) -> None:
        """轮询线程主循环。"""
        while getattr(self, "_watch_enabled", False):
            try:
                time.sleep(self._watch_interval)
                self._check_file_changes()
            except Exception:
                logger.debug("Poll watcher error", exc_info=True)

    def _check_file_changes(self) -> None:
        """检查文件变更并触发重载。"""
        changed = False
        for py_file in self._skills_dir.rglob("*.py"):
            if "__pycache__" in str(py_file):
                continue
            key = str(py_file)
            old_mtime = self._file_mtimes.get(key)
            try:
                new_mtime = py_file.stat().st_mtime
            except Exception:
                continue
            if old_mtime is not None and new_mtime > old_mtime:
                changed = True
                logger.info("SkillHub: file changed: %s", py_file.name)
            self._file_mtimes[key] = new_mtime

        for json_file in self._skills_dir.rglob("manifest.json"):
            key = str(json_file)
            old_mtime = self._file_mtimes.get(key)
            try:
                new_mtime = json_file.stat().st_mtime
            except Exception:
                continue
            if old_mtime is not None and new_mtime > old_mtime:
                changed = True
                logger.info("SkillHub: manifest.json changed: %s", json_file.parent.name)
            self._file_mtimes[key] = new_mtime

        if changed:
            logger.info("SkillHub: changes detected, rescanning...")
            self.scan_and_register()

    # ── Skill 管理 ──

    def enable_skill(self, skill_name: str) -> bool:
        """启用一个被禁用的 Skill（当前框架未集成禁用状态，预留接口）。"""
        logger.info("SkillHub: enable_skill not yet implemented: %s", skill_name)
        return False

    def disable_skill(self, skill_name: str) -> bool:
        """禁用一个 Skill。

        从注册表和 manifest 中移除，并卸载对应模块（支持同会话重载）。
        """
        if skill_name in self._manifests:
            manifest = self._manifests[skill_name]
            for t in manifest.tools:
                self._registered_skills.pop(t.name, None)
            del self._manifests[skill_name]
            # 卸载模块（支持 re-scan 时重新加载）
            module_name = f"{self._module_prefix}{skill_name}"
            self._loaded_modules.pop(module_name, None)
            sys.modules.pop(module_name, None)
            logger.info("SkillHub: disabled skill '%s'", skill_name)
            return True
        return False

    def auto_name(self, description: str) -> str:
        """根据描述和当前 DCC 环境自动生成 Skill 名称。

        命名规范: {dcc_prefix}{skill_name}
        """
        dcc_prefix_map = {
            "unreal_engine": "ue57_",
            "maya": "maya_",
            "3ds_max": "max_",
            "blender": "blender_",
        }
        prefix = dcc_prefix_map.get(self._dcc_name, "")

        desc_ascii = re.sub(r'[^\w\s]', '', description.lower())
        stop_words = {'a', 'an', 'the', 'in', 'on', 'for', 'to', 'of', 'and', 'or', 'with'}
        words = [w for w in desc_ascii.split() if w and w not in stop_words]
        name_part = "_".join(words[:4]) or "unnamed_skill"

        candidate = f"{prefix}{name_part}"
        if candidate not in self._registered_skills:
            return candidate
        for i in range(2, 100):
            if f"{candidate}_{i}" not in self._registered_skills:
                return f"{candidate}_{i}"
        return candidate


# ============================================================================
# 7. 模块级单例
# ============================================================================

# 全局单例（每个 DCC 进程一个）
_skill_hub_instance: Optional[SkillHub] = None


def init_skill_hub(
    dcc_name: str,
    version_func: Callable[[], str],
    skills_dir: str,
    module_prefix: str = "dcc_skill_",
) -> SkillHub:
    """初始化全局 SkillHub 单例。

    每个 DCC 启动时调用一次：
        hub = init_skill_hub("blender", lambda: bpy.app.version_string,
                             "~/.artifexnexus/skills", "blender_skill_")
        hub.scan_and_register()
        hub.start_watching()
    """
    global _skill_hub_instance
    _skill_hub_instance = SkillHub(
        dcc_name=dcc_name,
        version_func=version_func,
        skills_dir=skills_dir,
        module_prefix=module_prefix,
    )
    return _skill_hub_instance


def get_skill_hub() -> Optional[SkillHub]:
    """获取全局 SkillHub 单例。"""
    return _skill_hub_instance
