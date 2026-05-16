"""Phase 2 integration test."""
import tempfile
import json
from pathlib import Path
from artifex_nexus.skill import (
    SkillHub, SkillRegistry,
    compare_skill_dirs, detect_layer_conflicts,
    SyncState, SkillToolResult,
)

# ── 1. Create test Skill dirs ─────────────────────────────
tmp_root = Path(tempfile.mkdtemp())
official = tmp_root / "00_official"
user = tmp_root / "02_user"

for d in [official / "test_skill", user / "test_skill"]:
    d.mkdir(parents=True)

manifest = {
    "name": "test_skill",
    "version": "1.0.0",
    "software": "universal",
    "category": "测试",
    "risk_level": "low",
    "skill_tools": [{"name": "hello_tool", "description": "Test tool"}],
    "entry_point": "__init__.py",
}
for d in [official, user]:
    (d / "test_skill" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )

tool_code = '''
from artifex_nexus.skill import skill_tool, SkillToolResult

@skill_tool(name="hello_tool", description="Says hello")
def say_hello(name: str = "World") -> SkillToolResult:
    return SkillToolResult.success(f"Hello, {name}!")
'''
for d in [official, user]:
    (d / "test_skill" / "__init__.py").write_text(tool_code, encoding="utf-8")

print("1. Test dirs created OK")

# ── 2. SkillHub scan + load ──────────────────────────────
hub = SkillHub(layer_sources={"00_official": official, "02_user": user})
count = hub.scan_all_skills()
assert count == 2, f"Expected 2 skills (one per layer), got {count}"
print(f"2. Scanned: {count} skills OK")

entry = hub.get_entry("test_skill")
assert entry is not None
assert entry.layer == "00_official", f"Expected official layer, got {entry.layer}"
print(f"   Entry: name={entry.name}, layer={entry.layer}, version={entry.version} OK")

instance = hub.load_skill("test_skill")
assert instance.is_loaded
assert "hello_tool" in instance.skill_tool_names
print(f"3. Loaded: name={instance.name}, tools={instance.skill_tool_names}, is_loaded={instance.is_loaded} OK")

# ── 3. Execute tool ──────────────────────────────────────
result = hub.execute_skill_tool("hello_tool", {"name": "Artifex"}, skill_name="test_skill")
assert result.is_success
assert "Hello, Artifex!" in str(result.data)
print(f"4. Execute: success={result.is_success}, data={result.data} OK")

# ── 4. Layer conflict detection ─────────────────────────
layer_skills = {"00_official": ["test_skill"], "02_user": ["test_skill"]}
conflicts = detect_layer_conflicts(layer_skills)
assert len(conflicts) == 1
c = conflicts[0]
assert c.active_layer == "00_official"
assert "02_user" in c.shadowed_layers
print(f"5. Layer conflict: skill={c.skill_name}, active={c.active_layer}, shadowed={c.shadowed_layers} OK")

# ── 5. compare_skill_dirs ────────────────────────────────
status = compare_skill_dirs(
    installed_dir=official / "test_skill",
    source_dir=user / "test_skill",
)
# Same content, should be SYNCED
assert status.state == SyncState.SYNCED, f"Expected SYNCED, got {status.state}"
print(f"6. compare_skill_dirs: state={status.state.value}, changed={len(status.changed_files)} files OK")

# ── 6. NO_SOURCE test ────────────────────────────────────
status_ns = compare_skill_dirs(
    installed_dir=official / "test_skill",
    source_dir=tmp_root / "nonexistent",
)
assert status_ns.state == SyncState.NO_SOURCE
print(f"7. NO_SOURCE test: state={status_ns.state.value} OK")

# ── 7. SkillRegistry ─────────────────────────────────────
registry = SkillRegistry(hub)
matches = registry.list_by_software("unreal", "5.4.1")
assert len(matches) == 1, f"Expected 1 universal skill matching unreal, got {len(matches)}"
print(f"8. list_by_software: {len(matches)} skills OK")

results = registry.search("test")
assert len(results) == 1
print(f"9. search('test'): {len(results)} results OK")

best = registry.find_matching("test_skill", "unreal", "5.4.1")
assert best is not None
print(f"10. find_matching: name={best.name}, layer={best.layer} OK")

# ── 8. reload_skills ──────────────────────────────────────
count2 = hub.reload_skills()
assert count2 == 2
assert hub.get_instance("test_skill") is None  # cleared
print(f"11. reload_skills: {count2} re-scanned, instances cleared OK")

# ── 9. execute with default hub ──────────────────────────
from artifex_nexus.skill import set_default_hub, execute_skill_tool
set_default_hub(hub)
result2 = execute_skill_tool("hello_tool", {"name": "World"}, skill_name="test_skill")
assert result2.is_success
assert "Hello, World!" in str(result2.data)
print(f"12. execute() convenience function: {result2.data} OK")

print("\n=== ALL 12 TESTS PASSED ===")
