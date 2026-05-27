#!/usr/bin/env python3
"""Artifex Nexus Skill 合规检查器 v5。

检查项：
  A. SKILL.md frontmatter 合规（metadata.artifex_nexus.*）
  B. manifest.json schema 合规
  C. software/dcc 枚举 vs categories.json（唯一数据源，运行时动态读取）
  D. Skill 依赖完整性
  E. tags 格式检查
  F. __init__.py @skill_tool 装饰器合规（全平台统一，@ue_tool 已废弃）
"""
# ── SDK 头 ──
import os as _os, json as _json_mod
import artifex_nexus_sdk as sdk

def _load_manifest():
    return _json_mod.loads(
        open(_os.path.join(_os.path.dirname(__file__), "manifest.json"),
             encoding="utf-8").read()
    )
# ── SDK 头结束 ──

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("skill_compliance_checker")

# ============================================================================
# 路径与配置
# ============================================================================

def _resolve_path_variables() -> Dict[str, str]:
    """从 ~/.artifexnexus/config/artifexnexus.json 解析路径变量。"""
    cfg_path = Path.home() / ".artifexnexus" / "config" / "artifexnexus.json"
    project_root = ""
    try:
        if cfg_path.exists():
            cfg = json.loads(cfg_path.read_text("utf-8"))
            project_root = cfg.get("project_root", "")
    except Exception:
        pass
    return {
        "$skills_installed": str(Path.home() / ".artifexnexus" / ".openclaw" / "workspace" / "skills"),
        "$project_root": project_root,
        "$home": str(Path.home()),
    }


def _load_categories_enum(project_root: str) -> set:
    """从 categories.json 加载合法 software 枚举值（唯一数据源）。"""
    if not project_root:
        return set()
    cat_path = Path(project_root) / "packages" / "platform" / "contracts" / "data" / "categories.json"
    try:
        data = json.loads(cat_path.read_text("utf-8"))
        return set(data.get("software", []))
    except Exception:
        logger.warning("无法读取 categories.json: %s", cat_path)
        return set()


# ============================================================================
# Check A: SKILL.md frontmatter
# ============================================================================

def _check_frontmatter(skill_dir: Path) -> Dict[str, Any]:
    """检查 SKILL.md YAML frontmatter 合规性。"""
    issues: List[Dict[str, str]] = []
    data: Dict[str, Any] = {"version": None, "software": None, "name": None}

    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        issues.append({"severity": "error", "message": "SKILL.md 文件不存在"})
        return {"issues": issues, "data": data}

    try:
        content = skill_md.read_text("utf-8")
    except Exception as e:
        issues.append({"severity": "error", "message": f"无法读取 SKILL.md: {e}"})
        return {"issues": issues, "data": data}

    m = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not m:
        issues.append({"severity": "error", "message": "SKILL.md 缺少 YAML frontmatter"})
        return {"issues": issues, "data": data}

    fm_text = m.group(1)
    # 解析 frontmatter 中的简单字段
    for line in fm_text.split("\n"):
        kv = re.match(r'^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+?)\s*$', line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip().strip('"\'')
            if key == "name":
                data["name"] = val
            elif key == "version" and not data["version"]:
                data["version"] = val

    # 检查 metadata.artifex_nexus 块
    _check_artifex_nexus_metadata(fm_text, data, issues)

    return {"issues": issues, "data": data}


def _check_artifex_nexus_metadata(
    fm_text: str, data: Dict[str, Any], issues: List[Dict[str, str]]
) -> None:
    """检查 metadata.artifex_nexus.* 字段。"""
    # 提取 metadata 下的 artifex_nexus 块
    block_match = re.search(
        r'metadata\s*:[^\n]*\n((?:\s+\S[^\n]*\n)*)',
        fm_text, re.MULTILINE
    )
    if not block_match:
        issues.append({"severity": "warning", "message": "SKILL.md 缺少 metadata 块"})
        return

    meta_text = block_match.group(1)
    has_artifex_nexus = any("artifex_nexus" in line for line in meta_text.split("\n"))
    if not has_artifex_nexus:
        issues.append({"severity": "warning", "message": "metadata 中缺少 artifex_nexus 子块"})
        return

    # software（必需）
    sw_match = re.search(r'software\s*:\s*([^\n]+)', meta_text)
    if not sw_match:
        issues.append({"severity": "error",
                       "message": "metadata.artifex_nexus 中缺少 software（必需）"})

    # 检查 version
    ver_match = re.search(
        r'artifex_nexus\s*:[^\n]*\n((?:\s+\S[^\n]*\n)*?)\s+version\s*:\s*([^\n]+)',
        meta_text
    )
    if not ver_match:
        # 可能 version 在 artifex_nexus 块外部
        ver_simple = re.search(r'version\s*:\s*([^\n]+)', meta_text)
        if ver_simple:
            data["version"] = ver_simple.group(1).strip().strip('"\'')
        else:
            issues.append({"severity": "error", "message": "metadata.artifex_nexus 中缺少 version（必需）"})
    else:
        data["version"] = ver_match.group(2).strip().strip('"\'')

    # 验证 version 格式
    if data["version"] and not _is_valid_semver(data["version"]):
        issues.append({"severity": "error", "message": f"version 不是合法 semver: {data['version']}"})

    # author（必需）
    author_match = re.search(r'author\s*:\s*([^\n]+)', meta_text)
    if not author_match:
        issues.append({"severity": "warning",
                       "message": "metadata.artifex_nexus 中缺少 author（建议填写）"})

    # risk_level（可选，但如有则校验值）
    risk_text = meta_text
    risk_match = re.search(r'risk_level\s*:\s*([^\n]+)', risk_text)
    if risk_match:
        risk_val = risk_match.group(1).strip().strip('"\'')
        valid_risks = {"low", "medium", "high", "critical"}
        if risk_val not in valid_risks:
            issues.append({"severity": "warning",
                           "message": f"risk_level={risk_val!r}，合法值: {sorted(valid_risks)}"})


# ============================================================================
# Check B: manifest.json schema
# ============================================================================

def _check_manifest_schema(
    skill_dir: Path, categories_enum: set
) -> List[Dict[str, str]]:
    """检查 manifest.json schema 合规性。"""
    issues: List[Dict[str, str]] = []

    mf = skill_dir / "manifest.json"
    if not mf.exists():
        # 只有 SKILL.md 没有 manifest.json 不算 error — 运行时由 SKILL.md 驱动
        issues.append({"severity": "info", "message": "无 manifest.json（可选）"})
        return issues

    try:
        data = json.loads(mf.read_text("utf-8"))
    except Exception as e:
        issues.append({"severity": "error", "message": f"manifest.json JSON 解析失败: {e}"})
        return issues

    # name
    if not data.get("name"):
        issues.append({"severity": "error", "message": "manifest.json 缺少 name"})
    elif data["name"] != skill_dir.name:
        issues.append({"severity": "warning",
                       "message": f"manifest.json name={data['name']!r} ≠ 目录名 {skill_dir.name!r}"})

    # software 枚举检查
    sw = data.get("software", [])
    if isinstance(sw, list):
        for si, item in enumerate(sw):
            dcc = item.get("dcc", "") if isinstance(item, dict) else str(item)
            if dcc and categories_enum and dcc not in categories_enum:
                issues.append({"severity": "error",
                               "message": f"software[{si}].dcc={dcc!r} 不在合法枚举 {sorted(categories_enum)} 中"})
    elif isinstance(sw, str):
        if sw and categories_enum and sw not in categories_enum:
            issues.append({"severity": "error",
                           "message": f"software={sw!r} 不在合法枚举 {sorted(categories_enum)} 中"})

    # entry_point
    ep = data.get("entry_point", "")
    if ep and not (skill_dir / ep).exists():
        issues.append({"severity": "error", "message": f"entry_point={ep!r} 文件不存在"})

    # dependencies 格式
    deps = data.get("dependencies", [])
    if not isinstance(deps, list):
        issues.append({"severity": "error", "message": "dependencies 必须是数组"})

    return issues


# ============================================================================
# Check C: software/dcc 枚举（已在 B 中检查，此处为去重入口）
# ============================================================================

_CHECK_ENUM = _check_manifest_schema  # B 中已覆盖


# ============================================================================
# Check D: Skill 依赖完整性
# ============================================================================

def _check_dependencies(
    installed_dir: Path, source_map: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """检查已安装 Skill 的依赖完整性。"""
    issues: List[Dict[str, Any]] = []

    for skill_dir in sorted(installed_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        mf = skill_dir / "manifest.json"
        if not mf.exists():
            continue
        try:
            manifest = json.loads(mf.read_text("utf-8"))
        except Exception:
            continue

        deps = manifest.get("dependencies", [])
        if not isinstance(deps, list):
            continue

        for dep in deps:
            dep_name = re.split(r'[>=<]', str(dep))[0].strip()
            dep_installed = (installed_dir / dep_name).exists()
            dep_in_source = dep_name in source_map

            if not dep_installed:
                issues.append({
                    "severity": "warning" if dep_in_source else "error",
                    "skill": skill_dir.name,
                    "dependency": dep,
                    "message": (
                        f"依赖 {dep_name!r} 未安装（源码库有，可 install）"
                        if dep_in_source else
                        f"依赖 {dep_name!r} 未安装且在源码库中未找到"
                    ),
                })
    return issues


# ============================================================================
# Check E: tags 格式
# ============================================================================

def _check_tags(skill_dir: Path) -> List[Dict[str, str]]:
    """检查 manifest.json tags 格式（必须是 string[]）。"""
    issues: List[Dict[str, str]] = []
    mf = skill_dir / "manifest.json"
    if not mf.exists():
        return issues
    try:
        data = json.loads(mf.read_text("utf-8"))
    except Exception:
        return issues

    tags = data.get("tags", [])
    if not isinstance(tags, list):
        issues.append({"severity": "error",
                       "message": f"tags 必须是数组，当前类型: {type(tags).__name__}"})
        return issues

    for ti, tag in enumerate(tags):
        if not isinstance(tag, str):
            issues.append({"severity": "error",
                           "message": f"tags[{ti}]={tag!r} 不是字符串"})
    return issues


# ============================================================================
# Check F: __init__.py @skill_tool 装饰器合规（全平台统一）
# ============================================================================

#: 合法的 @skill_tool 导入路径
_SKILL_TOOL_IMPORT_PATTERNS = [
    # 共享 SDK（推荐）
    r'from\s+artifex_nexus_sdk\.decorator\s+import\s+.*\bskill_tool\b',
    r'from\s+artifex_nexus_sdk\s+import\s+.*\bskill_tool\b',
    # 平台 SDK（兼容）
    r'from\s+artifex_nexus\.skill(?:\.decorator)?\s+import\s+.*\bskill_tool\b',
    r'from\s+artifex_nexus\.skill\.decorator\.core\s+import\s+.*\bskill_tool\b',
]

#: 已废弃的装饰器导入（@ue_tool / skill_hub.tool）
_DEPRECATED_IMPORT_PATTERNS: Dict[str, str] = {
    "ue_tool": r'from\s+skill_hub\s+import\s+tool\s+as\s+ue_tool',
    "skill_hub_tool": r'from\s+skill_hub\s+import\s+tool\b',
}

#: 所有装饰器名（@skill_tool 为主，其余标记为废弃）
_VALID_TOOL_DECORATORS = {"skill_tool"}
_DEPRECATED_DECORATORS = {"ue_tool", "tool", "artclaw_tool"}


def _check_init_py(skill_dir: Path) -> List[Dict[str, str]]:
    """检查 __init__.py 中 @skill_tool 装饰器合规性。

    全平台统一为 @skill_tool。@ue_tool / @artclaw_tool 已废弃。
    """
    issues: List[Dict[str, str]] = []
    init_py = skill_dir / "__init__.py"
    if not init_py.exists():
        issues.append({"severity": "info", "message": "无 __init__.py（纯知识型 Skill，无工具函数）"})
        return issues

    try:
        content = init_py.read_text("utf-8")
    except Exception as e:
        issues.append({"severity": "error", "message": f"无法读取 __init__.py: {e}"})
        return issues

    # 检查 @skill_tool 导入
    has_skill_tool_import = any(
        re.search(pat, content) for pat in _SKILL_TOOL_IMPORT_PATTERNS
    )

    # 检查是否有废弃装饰器导入
    deprecated_import: Optional[str] = None
    for key, pattern in _DEPRECATED_IMPORT_PATTERNS.items():
        if re.search(pattern, content):
            deprecated_import = key
            break

    # 已废弃装饰器
    if deprecated_import:
        issues.append({"severity": "error",
                       "message": f"使用了已废弃的装饰器导入（{deprecated_import}），"
                                  "请改用 from artifex_nexus_sdk.decorator import skill_tool"})

    # 缺少合法装饰器但有函数
    if not has_skill_tool_import and not deprecated_import:
        if "def " in content:
            issues.append({"severity": "warning",
                           "message": "__init__.py 有函数但未导入 @skill_tool"})

    # 扫描所有 @skill_tool 装饰的函数
    decorator_pattern = r'@(' + '|'.join(_VALID_TOOL_DECORATORS | _DEPRECATED_DECORATORS) + r')\s*(?:\([^)]*\))?\s*\n\s*def\s+(\w+)'
    tool_funcs = re.findall(decorator_pattern, content)
    for decorator_name, fn_name in tool_funcs:
        if decorator_name in _DEPRECATED_DECORATORS:
            issues.append({"severity": "error",
                           "message": f"@{decorator_name} 已废弃，请改用 @skill_tool"})
            continue
        fn_match = re.search(
            rf'def\s+{fn_name}\s*\(([^)]*)\)',
            content
        )
        if fn_match:
            params = fn_match.group(1)
            if "**kwargs" not in params and "**kw" not in params:
                issues.append({"severity": "warning",
                               "message": f"@skill_tool 函数 {fn_name}() 签名缺少 **kwargs"})

    # ── software-装饰器 一致性检查 ──

    # 读取 manifest.json 获取 software 字段
    try:
        manifest_path = skill_dir / "manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text("utf-8"))
            raw_sw = manifest.get("software", [])
        else:
            raw_sw = []
    except Exception:
        raw_sw = []

    # 标准化 software 为 set
    if isinstance(raw_sw, str):
        software_set = {raw_sw}
    elif isinstance(raw_sw, list):
        software_set = set()
        for item in raw_sw:
            if isinstance(item, dict):
                dcc = item.get("dcc", "")
                if dcc:
                    software_set.add(dcc)
            elif isinstance(item, str):
                software_set.add(item)
    else:
        software_set = set()

    # DCC SkillHub 未实现的集合（规划中，装饰器可提前写入）
    _SKILLHUB_PLANNED_DCCS = frozenset({
        "blender", "maya", "3ds_max", "houdini",
        "comfyui", "substance_painter", "substance_designer", "unity",
    })

    # DCC SkillHub 规划中 —— 装饰器可提前写入，SkillHub 完成后自动生效
    only_planned = bool(software_set) and software_set.issubset(_SKILLHUB_PLANNED_DCCS)
    if only_planned and has_skill_tool_import:
        issues.append({"severity": "info",
                       "message": "目标 DCC SkillHub 规划中，@skill_tool 暂不会被自动发现；"
                                  "装饰器可保留（SkillHub 完成后自动生效），AI 当前通过 run_python 执行"})

    return issues


# ============================================================================
# 工具函数
# ============================================================================

def _is_valid_semver(version: str) -> bool:
    """检查是否为合法 semver 格式。"""
    return bool(re.match(r'^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$', version.strip()))


def _scan_source_skills(source_root: Path) -> Dict[str, Any]:
    """扫描源码 skills/{source}/{name}/ 二层结构。"""
    result: Dict[str, Any] = {}
    if not source_root.exists():
        return result

    for source_dir in sorted(source_root.iterdir()):
        if not source_dir.is_dir() or source_dir.name.startswith("."):
            continue
        layer = source_dir.name
        for skill_dir in sorted(source_dir.iterdir()):
            if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").exists():
                continue
            result[skill_dir.name] = {"layer": layer, "path": skill_dir}
    return result


# ============================================================================
# 主入口
# ============================================================================

def check_skill_compliance(**kwargs) -> Dict[str, Any]:
    """
    检查 Skill 合规性。

    Args:
        source_root: 源码 skills 目录路径（默认从配置读取）
        installed_root: 已安装 skills 目录路径（默认 ~/.artifexnexus/.openclaw/workspace/skills）

    Returns:
        {success, total_checked, issues_found, issues: [...], report}
    """
    manifest = _load_manifest()
    parsed = sdk.params.parse_params(manifest.get("inputs", []), kwargs)

    variables = _resolve_path_variables()
    project_root = variables.get("$project_root", "")
    installed_root_str = parsed.get("installed_root", "") or variables["$skills_installed"]
    source_root_str = parsed.get("source_root", "")

    # 源码根目录
    if source_root_str:
        source_root = Path(source_root_str)
    elif project_root:
        source_root = Path(project_root) / "skills"
    else:
        source_root = Path("skills")

    installed_root = Path(installed_root_str).expanduser()

    # 加载 categories.json 枚举
    categories_enum = _load_categories_enum(project_root)

    # 扫描源码
    source_map = _scan_source_skills(source_root)

    total_checked = 0
    all_issues: List[Dict[str, Any]] = []

    # 检查已安装目录中的每个 Skill
    if installed_root.exists():
        for skill_dir in sorted(installed_root.iterdir()):
            if not skill_dir.is_dir():
                continue
            total_checked += 1
            skill_name = skill_dir.name

            # A: SKILL.md frontmatter
            fm_result = _check_frontmatter(skill_dir)
            for iss in fm_result["issues"]:
                iss["skill"] = skill_name
                iss["check"] = "frontmatter"
            all_issues.extend(fm_result["issues"])

            # B: manifest.json schema
            for iss in _check_manifest_schema(skill_dir, categories_enum):
                iss["skill"] = skill_name
                iss["check"] = "manifest_schema"
            all_issues.extend(_check_manifest_schema(skill_dir, categories_enum))

            # E: tags 格式
            for iss in _check_tags(skill_dir):
                iss["skill"] = skill_name
                iss["check"] = "tags"
            all_issues.extend(_check_tags(skill_dir))

            # F: __init__.py @skill_tool
            for iss in _check_init_py(skill_dir):
                iss["skill"] = skill_name
                iss["check"] = "skill_tool"
            all_issues.extend(_check_init_py(skill_dir))

    else:
        all_issues.append({"severity": "error", "check": "setup",
                           "message": f"已安装目录不存在: {installed_root}"})

    # D: 依赖完整性
    if installed_root.exists():
        dep_issues = _check_dependencies(installed_root, source_map)
        for iss in dep_issues:
            iss["check"] = "dependencies"
        all_issues.extend(dep_issues)

    # 生成报告
    errors = [i for i in all_issues if i.get("severity") == "error"]
    warnings = [i for i in all_issues if i.get("severity") == "warning"]
    infos = [i for i in all_issues if i.get("severity") == "info"]

    success = len(errors) == 0
    report_lines = [
        f"Skill 合规检查完成：{total_checked} 个 Skill，"
        f"错误 {len(errors)}，警告 {len(warnings)}，提示 {len(infos)}",
    ]
    if categories_enum:
        report_lines.append(f"枚举来源: categories.json ({len(categories_enum)} 个 software 值)")
    else:
        report_lines.append("⚠️ 无法读取 categories.json，跳过 software 枚举检查")

    report_lines.append("")
    for label, items in [("错误", errors), ("警告", warnings)]:
        if items:
            report_lines.append(f"【{label}】")
            for i in items:
                skill_tag = f"[{i.get('skill', '?')}] " if i.get("skill") else ""
                report_lines.append(f"  • {skill_tag}{i['message']}")

    return sdk.result.success(data={
        "total_checked": total_checked,
        "issues_found": len(errors) + len(warnings),
        "issues": all_issues,
        "report": "\n".join(report_lines),
        "success": success,
    }, message=report_lines[0]) if success else sdk.result.fail(
        "ISSUES_FOUND",
        report_lines[0],
        data={
            "total_checked": total_checked,
            "issues_found": len(errors) + len(warnings),
            "issues": all_issues,
            "report": "\n".join(report_lines),
            "success": success,
        })


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    result = check_skill_compliance()
    print(result["report"])
