"""
STORY-0048 · Skill/Nexus-Tool 内容迁移脚本
==========================================

从 artclaw_bridge 迁移到 Artifex Nexus 对应目录。

处理:
- 更新 categories.json（添加 comfyui）
- 复制 Skills（含 manifest.json software 字段转换 + 自动生成缺失的 manifest）
- 复制 Nexus-Tools（排除 __pycache__）
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Optional


# ── 路径常量 ──────────────────────────────────────────────────────────────────

ARTCLAW_ROOT = Path(r"D:\MyProject_D\artclaw_bridge")
PROJECT_ROOT = Path(r"D:\MyProject_D\artifexnexus")
CATEGORIES_JSON = (
    PROJECT_ROOT / "packages" / "platform" / "contracts" / "data" / "categories.json"
)
NEXUS_TOOLS_HOME = Path.home() / ".artifexnexus" / "nexus-tools"

SKILLS_SRC = ARTCLAW_ROOT / "skills"
TOOLS_SRC = ARTCLAW_ROOT / "tools"
SKILLS_DST = PROJECT_ROOT / "skills"

# ── software 字段映射：artclaw_bridge → categories.json ──────────────────────

SOFTWARE_MAP = {
    "unreal_engine": "unreal_engine",
    "universal": "universal",
    "blender": "blender",
    "maya": "maya",
    # comfyui 不在旧 manifest 中出现，但新生成时直接写 comfyui
}


# ═══════════════════════════════════════════════════════════════════════════════
# Step 1: 更新 categories.json
# ═══════════════════════════════════════════════════════════════════════════════

def update_categories_json():
    """在 categories.json 的 software 列表里添加 comfyui。"""
    with open(CATEGORIES_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    software_list = data.get("software", [])
    if "comfyui" not in software_list:
        software_list.append("comfyui")
        data["software"] = software_list
        print("  ✓ software 列表添加 'comfyui'")

    display = data.get("display", {}).get("software", {})
    if "comfyui" not in display:
        display["comfyui"] = "ComfyUI"
        data["display"]["software"] = display
        print("  ✓ display 映射添加 'comfyui': 'ComfyUI'")

    with open(CATEGORIES_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("[1/4] categories.json 更新完成\n")


# ═══════════════════════════════════════════════════════════════════════════════
# Step 2: 迁移 Skills（含 software 转换 + 自动生成缺失 manifest）
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_skill_md_frontmatter(path: Path) -> dict:
    """从 SKILL.md YAML frontmatter 提取元数据。"""
    content = path.read_text(encoding="utf-8")
    # 匹配 `---\n...\n---` frontmatter
    m = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not m:
        return {}
    frontmatter = m.group(1)
    result = {}
    for line in frontmatter.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            # 简单解析: key: value
            kv = line.split(":", 1)
            key = kv[0].strip()
            val = kv[1].strip()
            if val.startswith(">"):
                val = val[1:].strip()
            result[key] = val
    return result


def _infer_software_from_path(skill_dir_name: str, parent_dcc: str) -> str:
    """从目录路径推断 software 字段。"""
    dcc_dir = parent_dcc  # e.g., 'unreal', 'comfyui', 'universal'
    dcc_map = {
        "unreal": "unreal_engine",
        "blender": "blender",
        "maya": "maya",
        "max": "3ds_max",
        "houdini": "houdini",
        "comfyui": "comfyui",
        "universal": "universal",
        "substance_designer": "universal",
        "substance_painter": "universal",
        "unity": "universal",
    }
    return dcc_map.get(dcc_dir, "universal")


def _infer_category_from_name(name: str) -> str:
    """从 skill 名称推断 category。"""
    name_lower = name.lower()
    if "material" in name_lower:
        return "material"
    if "capture" in name_lower or "viewport" in name_lower:
        return "render"
    if "doc" in name_lower or "documentation" in name_lower:
        return "utils"
    if "architecture" in name_lower:
        return "utils"
    if "debug" in name_lower or "validation" in name_lower:
        return "utils"
    if "scene" in name_lower or "vision" in name_lower or "analyzer" in name_lower:
        return "scene"
    if "installer" in name_lower or "node-install" in name_lower:
        return "workflow"
    return "utils"


def _generate_manifest(skill_dir: Path, parent_dcc: str) -> dict:
    """为缺少 manifest.json 的 skill 自动生成 manifest。"""
    skill_md = skill_dir / "SKILL.md"
    fm = _parse_skill_md_frontmatter(skill_md) if skill_md.exists() else {}

    name = fm.get("name", skill_dir.name.lower().replace("-", "_"))
    # 确保 name 符合 ^[a-z][a-z0-9_]{0,63}$
    name = re.sub(r"[^a-z0-9_]", "_", name.lower())
    name = name[:64]

    software = _infer_software_from_path(skill_dir.name, parent_dcc)
    category = fm.get("category", _infer_category_from_name(name))

    manifest = {
        "manifest_version": "1.0",
        "name": name,
        "display_name": fm.get("display_name", skill_dir.name.replace("-", " ").title()),
        "description": fm.get("description", ""),
        "version": fm.get("version", "1.0.0"),
        "author": fm.get("author", "Ivan(杨己力)"),
        "license": fm.get("license", "MIT"),
        "software": software,
        "category": category,
        "risk_level": fm.get("risk_level", "low"),
        "dependencies": [],
        "tags": [],
        "entry_point": "__init__.py",
        "skill_tools": [
            {
                "name": name,
                "description": fm.get("description", ""),
            }
        ],
        "software_version": {},
    }
    return manifest


def _transform_manifest(manifest_path: Path) -> None:
    """将 manifest.json 从 artclaw_bridge 格式转换为 Artifex Nexus 格式。
    
    处理:
    - software: 'unreal_engine' → 'unreal'
    - tools → skill_tools（字段重命名）
    - 确保 skill_tools 至少有一个元素
    """
    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # software 映射
    old_software = data.get("software", "")
    new_software = SOFTWARE_MAP.get(old_software, old_software)
    if old_software != new_software:
        data["software"] = new_software
        print(f"    software: '{old_software}' → '{new_software}'")

    # tools → skill_tools 字段重命名
    if "tools" in data and "skill_tools" not in data:
        tools = data.pop("tools")
        data["skill_tools"] = tools
        print(f"    tools → skill_tools ({len(tools)} 项)")

    # 确保 skill_tools 非空（model validator 要求至少一个元素）
    if not data.get("skill_tools"):
        name = data.get("name", "unknown")
        desc = data.get("description", "")
        data["skill_tools"] = [{"name": name, "description": desc}]
        print(f"    [+] skill_tools 补全为默认值 (name={name})")

    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _copy_skill(skill_dir: Path, parent_dcc: str):
    """复制单个 skill 目录到目标。"""
    dst = SKILLS_DST / skill_dir.relative_to(SKILLS_SRC)
    dst.parent.mkdir(parents=True, exist_ok=True)

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(skill_dir, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

    # 如果有 manifest.json，转换格式
    manifest_path = dst / "manifest.json"
    if manifest_path.exists():
        _transform_manifest(manifest_path)
    else:
        # 自动生成 manifest.json
        gen = _generate_manifest(dst, parent_dcc)
        with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(gen, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"    [+] 自动生成 manifest.json (software={gen['software']}, category={gen['category']})")


def migrate_skills():
    """迁移 STORY-0048 指定的 8 个 skill。"""
    print("[2/4] 迁移 Skills...")
    SKILLS_DST.mkdir(parents=True, exist_ok=True)

    # (rel_path, dcc_dir)
    official_skills = [
        ("official/unreal/ue57_get_material_nodes", "unreal"),
        ("official/unreal/ue57_material_node_edit", "unreal"),
        ("official/comfyui/comfyui-node-installer", "comfyui"),
    ]

    marketplace_skills = [
        ("marketplace/unreal/ue57_generate_material_documentation", "unreal"),
        ("marketplace/unreal/ue57_viewport_capture", "unreal"),
        ("marketplace/unreal/ue5-architecture", "unreal"),
        ("marketplace/unreal/ue5-debug-validation", "unreal"),
        ("marketplace/universal/scene-vision-analyzer", "universal"),
    ]

    for rel_path, dcc in official_skills + marketplace_skills:
        src = SKILLS_SRC / rel_path
        if not src.exists():
            print(f"  ✗ 源不存在: {src}")
            continue
        print(f"  → {rel_path}")
        _copy_skill(src, dcc)

    print(f"  完成: {len(official_skills) + len(marketplace_skills)} 个 Skill\n")


# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: 迁移 Nexus-Tools（排除 __pycache__）
# ═══════════════════════════════════════════════════════════════════════════════

def migrate_nexus_tools():
    """迁移 STORY-0048 指定的 6 个 nexus-tool。"""
    print("[3/4] 迁移 Nexus-Tools...")
    NEXUS_TOOLS_HOME.mkdir(parents=True, exist_ok=True)

    nexus_tools = [
        ("marketplace/Blender对象命名规范检查", "marketplace/Blender对象命名规范检查"),
        ("marketplace/模型批量加前缀后缀", "marketplace/模型批量加前缀后缀"),
        ("marketplace/SM命名检查", "marketplace/SM命名检查"),
        ("marketplace/UV & 贴图利用率优化-UV重排", "marketplace/UV & 贴图利用率优化-UV重排"),
        ("marketplace/UV & 贴图利用率优化-贴图裁切", "marketplace/UV & 贴图利用率优化-贴图裁切"),
        ("marketplace/资产批量改名", "marketplace/资产批量改名"),
    ]

    for src_rel, dst_rel in nexus_tools:
        src = TOOLS_SRC / src_rel
        dst = NEXUS_TOOLS_HOME / dst_rel
        if not src.exists():
            print(f"  ✗ 源不存在: {src}")
            continue
        print(f"  → {dst_rel}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            shutil.rmtree(dst)
        # 排除 __pycache__ 和 .pyc
        shutil.copytree(
            src, dst,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )

    print(f"  完成: {len(nexus_tools)} 个 Nexus-Tool\n")


# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: 验证
# ═══════════════════════════════════════════════════════════════════════════════

def verify():
    """验证迁移结果。"""
    print("[4/4] 验证迁移结果...")

    errors = []

    # Skills
    skill_count = sum(1 for _ in SKILLS_DST.rglob("manifest.json"))
    print(f"  Skills manifest.json: {skill_count}")
    if skill_count != 8:
        errors.append(f"预期 8 个 Skill manifest.json，实际 {skill_count}")

    # Nexus-Tools
    nt_count = sum(1 for _ in NEXUS_TOOLS_HOME.rglob("manifest.json"))
    print(f"  Nexus-Tools manifest.json: {nt_count}")
    if nt_count != 8:
        errors.append(f"预期 6 个 Nexus-Tool manifest.json，实际 {nt_count}")

    # 检查无 __pycache__
    pycache_count = sum(1 for _ in NEXUS_TOOLS_HOME.rglob("__pycache__"))
    print(f"  Nexus-Tools __pycache__ 残留: {pycache_count}")
    if pycache_count > 0:
        errors.append(f"仍有 {pycache_count} 个 __pycache__ 目录")

    # 检查 software 字段不在合法枚举中
    for mf in SKILLS_DST.rglob("manifest.json"):
        with open(mf, "r", encoding="utf-8") as f:
            data = json.load(f)
        sw = data.get("software", "")
        if sw not in {"universal", "unreal_engine", "blender", "maya", "3ds_max", "houdini", "comfyui"}:
            errors.append(f"{mf}: software='{sw}' 不在合法枚举中")

    if errors:
        print(f"\n  ⚠️ 发现 {len(errors)} 个问题:")
        for e in errors:
            print(f"    - {e}")
    else:
        print("\n  ✅ 验证通过！")

    return len(errors) == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("STORY-0048 · Skill/Nexus-Tool 内容迁移")
    print("=" * 60)
    print()

    update_categories_json()
    migrate_skills()
    migrate_nexus_tools()
    success = verify()

    print()
    if success:
        print("🎉 迁移完成！")
    else:
        print("⚠️ 迁移完成但有遗留问题，请检查上述输出。")
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
