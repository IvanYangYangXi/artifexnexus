---
tags: [spec, openclaw, nexus-tool, exploration]
created: 2026-05-12
status: superseded-by-nexus-tool-runtime
---

# Codebase Exploration: SDK Injection, NexusToolData, and RPC Registration

> ⚠ **本文已被 [[nexus-tool-runtime]] 部分覆盖**——后者是 Nexus-Tool 运行流程的
> 单一权威 spec（含 2026-05-19 修复后的真实约束与不变量）。本文保留作为
> "代码勘探笔记"，记录早期实现细节；改运行流程相关代码前**请优先读
> [[nexus-tool-runtime]]**。

## 1. SDK Path Injection

### 1.1 Source Files

- **Sidecar**: `d:/MyProject_D/artifexnexus/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py`
- **Trigger Dispatcher**: `d:/MyProject_D/artifexnexus/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/trigger_dispatcher.py`
- **Actual SDK directory**: `d:/MyProject_D/artifexnexus/packages/dcc/shared/artifex_nexus_sdk/`
  - Contains: `__init__.py`, `context.py`, `event.py`, `logger.py`, `params.py`, `result.py`

### 1.2 How `sidecar.py` injects the SDK path (lines 81-116)

`_find_project_root()` walks up from `__file__` looking for `pnpm-workspace.yaml` (up to 10 parents, fallback: `parents[7]`).

```python
def _find_project_root() -> Path:
    current = Path(__file__).resolve().parent
    for _ in range(10):
        if (current / "pnpm-workspace.yaml").exists():
            return current
        current = current.parent
    return Path(__file__).resolve().parents[7]
```

`_inject_sdk_path()` computes the SDK parent and inserts into `sys.path[0]`:

```python
def _inject_sdk_path() -> None:
    _project_root = _find_project_root()
    _sdk_parent = _project_root / "packages" / "dcc" / "shared"
    _sdk_parent_str = str(_sdk_parent)
    if _sdk_parent.is_dir() and _sdk_parent_str not in sys.path:
        sys.path.insert(0, _sdk_parent_str)
```

**Called at start of `main()`** (line 1940). The injected path is `<project_root>/packages/dcc/shared/`, enabling `import artifex_nexus_sdk as sdk`.

### 1.3 How `trigger_dispatcher.py` injects the SDK path during tool execution

Has identical `_find_project_root()` and a `_get_sdk_path()`:

```python
@staticmethod
def _get_sdk_path() -> str:
    return str(TriggerDispatcher._find_project_root() / "packages" / "dcc" / "shared")
```

In `_execute_tool()` (lines 243-327), both tool dir AND SDK path are injected before dynamic import, then cleaned up in `finally`:

```python
tool_dir = reg["dir"]
sdk_parent = self._get_sdk_path()

if tool_dir not in sys.path:
    sys.path.insert(0, tool_dir)
if sdk_parent not in sys.path:
    sys.path.insert(0, sdk_parent)

try:
    # dynamic import + execute
finally:
    for p in reversed(paths_added):
        if p in sys.path:
            sys.path.remove(p)
```

### 1.4 CRITICAL GAP: `nexus-tool.run` for GENERAL tools does NOT inject SDK path

In `nexus_tool_rpc.py`, `_handle_nexus_tool_run()` (line 406-413) uses subprocess:

```python
proc = subprocess.run(
    ["python", str(main_py)],
    input=_json.dumps(run_args),
    capture_output=True,
    text=True,
    timeout=120,
    cwd=str(tool_dir),
)
```

**No `PYTHONPATH` or SDK injection in the subprocess environment.** General tools cannot `import artifex_nexus_sdk`. If your plan requires this, you need to add `env` with `PYTHONPATH` pointing to `packages/dcc/shared/`.

---

## 2. NexusToolData Structure

### 2.1 The dataclass (`models.py` lines 35-54)

```python
@dataclass
class NexusToolData:
    id: str                    # "{source}/{name}"
    name: str
    description: str = ""
    version: str = "0.0.0"
    source: str = "user"
    target_dccs: List[str] = field(default_factory=list)
    status: str = "installed"
    nexus_tool_path: str = ""
    implementation_type: str = "script"
    manifest: Dict[str, Any] = field(default_factory=dict)   # <-- KEY
    is_enabled: bool = True
    is_pinned: bool = False
    is_favorited: bool = False
    use_count: int = 0
    author: str = ""
    created_at: str = ""
    updated_at: str = ""
```

### 2.2 How `implementation.function` is stored

NOT a direct field. Nested inside `manifest: Dict[str, Any]` (raw JSON from `manifest.json`). Typical structure:

```json
{
    "type": "script",
    "entry": "main.py",
    "function": "main"
}
```

### 2.3 How code accesses it

```python
# trigger_dispatcher.py line 259-261:
impl = manifest.get("implementation", {})
entry = impl.get("entry", "main.py")
function = impl.get("function", "main")
```

### 2.4 Serialization via `_nt_data_to_dict()` (`_rpc_helpers.py` lines 171-207)

```python
def _nt_data_to_dict(ntd: Any) -> dict:
    manifest: dict = getattr(ntd, "manifest", None) or {}
    result = {
        "id": ntd.id,
        "name": ntd.name,
        # ... other direct fields ...
        "implementation": manifest.get("implementation", {}),  # <-- INCLUDED
        "inputs": manifest.get("inputs", []),
        "outputs": manifest.get("outputs", []),
        "presets": manifest.get("presets", []),
        "triggers": manifest.get("triggers", []),
        "default_filters": manifest.get("defaultFilters", {}),
    }
    return result
```

The frontend receives `implementation` as a **sibling field** (not nested under `manifest`).

---

## 3. Sidecar RPC Method Registration

### 3.1 Two patterns

**Pattern A -- Inline** in `sidecar.py`:
```python
def _handle_ping(req_id: Any, _params: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": "pong"}
```

**Pattern B -- Module dictionary** (imported + unpacked):
```python
# At top of sidecar.py:
from . import nexus_tool_rpc as _nexus_tool_rpc

# In METHOD_TABLE (line 1683):
METHOD_TABLE: dict[str, Any] = {
    # ... inline handlers ...
    **_skill_rpc.SKILL_METHODS,
    **_nexus_tool_rpc.NEXUS_TOOL_METHODS,   # line 1741
}
```

### 3.2 The NEXUS_TOOL_METHODS dict (`nexus_tool_rpc.py` lines 673-689)

```python
NEXUS_TOOL_METHODS = {
    "nexus-tool.list": _handle_nexus_tool_list,
    "nexus-tool.detail": _handle_nexus_tool_detail,
    "nexus-tool.create": _handle_nexus_tool_create,
    "nexus-tool.update": _handle_nexus_tool_update,
    "nexus-tool.delete": _handle_nexus_tool_delete,
    "nexus-tool.enable": _handle_nexus_tool_enable,
    "nexus-tool.disable": _handle_nexus_tool_disable,
    "nexus-tool.pin": _handle_nexus_tool_pin,
    "nexus-tool.unpin": _handle_nexus_tool_unpin,
    "nexus-tool.favorite": _handle_nexus_tool_favorite,
    "nexus-tool.unfavorite": _handle_nexus_tool_unfavorite,
    "nexus-tool.publish": _handle_nexus_tool_publish,
    "nexus-tool.run": _handle_nexus_tool_run,
    "nexus-tool.fetch_types": _handle_nexus_tool_fetch_types,
    "nexus-tool.batch": _handle_nexus_tool_batch,
}
```

### 3.3 Dispatch logic (`sidecar.py` lines 1749-1779)

```python
def handle_request(request: dict) -> dict:
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    handler = METHOD_TABLE.get(method)
    if handler is None:
        return {"jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"}}

    try:
        return handler(req_id, params)
    except Exception as e:
        return {"jsonrpc": "2.0", "id": req_id,
                "error": {"code": -32603, "message": f"Internal error: {e}"}}
```

### 3.4 How to add `nexus-tool.result`, `nexus-tool.cancel`, `nexus-tool.ack`

Follow **Pattern B** -- **no changes needed to `sidecar.py`**:

1. Define handlers in `nexus_tool_rpc.py` with signature `(req_id, params) -> dict`
2. Add them to `NEXUS_TOOL_METHODS` dict
3. They auto-merge into `METHOD_TABLE` via `**_nexus_tool_rpc.NEXUS_TOOL_METHODS` on line 1741

---

## Summary: Key File Paths

| Purpose | Absolute Path |
|---------|---------------|
| SDK directory | `d:/MyProject_D/artifexnexus/packages/dcc/shared/artifex_nexus_sdk/` |
| SDK parent (inject target) | `d:/MyProject_D/artifexnexus/packages/dcc/shared/` |
| Sidecar main | `d:/MyProject_D/artifexnexus/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` |
| Trigger dispatcher | `d:/MyProject_D/artifexnexus/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/trigger_dispatcher.py` |
| NexusToolData models | `d:/MyProject_D/artifexnexus/packages/platform/skill/src/artifex_nexus/skill/nexus_tool/models.py` |
| RPC helpers (serialization) | `d:/MyProject_D/artifexnexus/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/_rpc_helpers.py` |
| Nexus tool RPC handlers | `d:/MyProject_D/artifexnexus/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/nexus_tool_rpc.py` |
