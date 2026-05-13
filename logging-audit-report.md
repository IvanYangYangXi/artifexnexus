# Logging Audit Report — Artifex Nexus Python Codebase

**Date:** 2026-05-13  
**Scope:** 6 Python source directories, 41 total `.py` files  
**Exclusions:** `__pycache__/`, test files, `.pyc` artifacts

---

## Executive Summary

| Directory | Files | Production Code? | Logging Status |
|---|---|---|---|
| `openclaw/uplink/src/` | 2 | No (stubs) | N/A |
| `openclaw/wrapper/src/` | 18 | **Yes** | **Mixed — see details** |
| `platform/core/src/` | 2 | No (empty) | N/A |
| `platform/skill/src/` | 12 | No (stubs/TODOs) | N/A |
| `platform/cli/src/` | 5 | No (skeleton) | N/A |
| `platform/contracts/python/src/` | 2 | No (empty) | N/A |

**The only directory containing production code is `openclaw/wrapper/src/`.** All other directories are stubs, skeletons, or empty namespace packages. The audit below focuses on the wrapper directory's 18 files.

---

## Detailed File-by-File Audit: `openclaw/wrapper/src/`

### 1. `__init__.py` — `artifex_nexus/__init__.py`
- **Content:** Namespace marker comment only
- **Verdict:** N/A

### 2. `__init__.py` — `artifex_nexus/openclaw_wrapper/__init__.py`
- **Content:** Package docstring only
- **Verdict:** N/A

---

### 3. `_subprocess.py` — CRITICAL (subprocess factory)

**Logging setup:** `logger = logging.getLogger(__name__)` (imported, defined)

**Public functions:**
- `is_windows()` — trivially returns bool, no logging needed
- `find_openclaw_bin(openclaw_home)` — searches fs for CLI binary
- `build_openclaw_env(openclaw_home)` — constructs env dict
- `popen_kwargs(...)` — constructs kwargs dict
- `run_openclaw(cli_args, openclaw_home, ...)` — spawns subprocess

**Issues found:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `find_openclaw_bin` | 97-155 | **No logger defined/referenced anywhere.** The function falls through 3 resolution strategies (symlink, current.txt, directory scan) with zero logging. If all strategies miss, returns `None` silently | HIGH |
| 2 | `find_openclaw_bin` | 127-128 | `OSError` catch on symlink resolve is silent — no log | LOW |
| 3 | `find_openclaw_bin` | 139-140 | `OSError` catch on `current.txt` read is silent — no log | LOW |
| 4 | `find_openclaw_bin` | 148-149 | `OSError` catch on `cli_dir.iterdir()` is silent — no log | LOW |
| 5 | `run_openclaw` | 234-285 | **Exit:** No log at successful return. `subprocess.CompletedProcess` is returned raw — callers can't tell whether `returncode=0` without checking | MEDIUM |
| 6 | `run_openclaw` | 269-271 | `FileNotFoundError` raised without log — caller must catch and log. This is intentional (throwing), but a `logger.debug()` before the raise would aid debugging | LOW |

**Error handling blocks:** All `OSError` catches in `find_openclaw_bin` are `pass` — silent. This is intentional (best-effort resolution), but a `logger.debug()` inside each would add diagnostic value.

**External calls:** `subprocess.run()` in `run_openclaw` — no before/after logging.

**Recommendation:** Add `logger.debug()` at each resolution step in `find_openclaw_bin` so diagnostics reveal *which* strategy failed. Add `logger.info()` call-site in `run_openclaw` before spawn (command + args summary).

---

### 4. `agent_preset.py` — GOOD

**Logging setup:** `logger = logging.getLogger(__name__)` — well-used

**Covered:**
- `_run_config_get` → `logger.warning` on subprocess fail / JSON parse fail; `logger.debug` on non-zero exit
- `_run_config_patch` → `logger.warning` on subprocess fail / non-zero exit
- `install_default_preset` → `logger.warning` on user-modified skip
- Bootstrap call-site → `logger.info` / `logger.warning` on install result

**Gaps (minor):**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `read_lock` | 341-349 | `OSError` / `json.JSONDecodeError` caught — returns `None` silently. No log for corrupted lock file | LOW |
| 2 | `install_default_preset` | 396-471 | Step 1 (render) raises `OSError`/`ValueError` → returned as error; **not logged** before return | LOW |
| 3 | `install_default_preset` | 463-466 | `write_lock` fails with `OSError` → returned as error; **not logged** before return | LOW |

**Verdict:** Generally well-logged. Minor gaps in error-return paths where the caller might not log either.

---

### 5. `bootstrap.py` — GOOD

**Logging setup:** `logger = logging.getLogger(__name__)` — extensively used

**Covered:**
- `_apply_preserve_options` → `logger.info` at each preserve step
- `_migrate_auth_profiles_files` → `logger.info` on migrate, `logger.warning` on fail
- `_install_workspace_identity_files` → `logger.warning` on missing source / write fail; `logger.info` on success
- `_try_install_default_agent_preset` → `logger.info` / `logger.warning` throughout
- `bootstrap` → step-by-step: `logger.info` on mcp-bridge install, `logger.warning` on agent preset / mcp-bridge failure
- `reset_config_port_if_drifted` → `logger.warning` on drift detection, `logger.info` on heal, `logger.warning` on failure

**Gaps (minor):**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `bootstrap` | 468-577 | **Entry not logged.** No `logger.info("bootstrap 开始")`. Exit success/failure returned via `BootstrapResult` — no structured log on result | MEDIUM |
| 2 | `bootstrap` | 563-577 | Exception catch — `error_message=str(e)` returned in `BootstrapResult`, but **NOT logged** via `logger.exception` | MEDIUM |
| 3 | `is_bootstrap_done` | 580-591 | Pure bool check — acceptable to skip logging | NONE |
| 4 | `read_config` | 594-617 | `json.JSONDecodeError` / `OSError` / `UnicodeDecodeError` → returns `None` with **no log**. This is the BOM-strip codepath (STORY-0039 fix). A debug log would help when config is silently unreadable | LOW |
| 5 | `get_gateway_port` | 620-630 | Config read fails → returns default port with **no log** | LOW |
| 6 | `get_gateway_token` | 633-665 | All fallback paths silent — acceptable for a getter, but `logger.debug` on legacy path hit would aid deprecation tracking | LOW |

**Verdict:** Well-logged. The missing `logger.exception` in bootstrap's catch-all is the most notable gap.

---

### 6. `config_io.py` — EXCELLENT

**Logging setup:** `logger = logging.getLogger(__name__)` — thoroughly used

**Covered:**
- `_run_config_get` / `_run_config_patch` → warning/debug on subprocess failures
- `dump_config` → `logger.warning` on JSON read fallback
- `fetch_remote_models` → `logger.info` on success with model count
- `read_extras` → `logger.warning` on parse failure
- `set_auth_token` → good validation + subprocess error handling

**Gaps (minor):**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `dump_config` | 421-484 | Entry/exit not logged. No log statement in the main config dump flow when succeeding (performance path reads file directly) | LOW |
| 2 | `patch_config` | 492-534 | Success return not logged. `extras_patch` write path catches OSError but success path is silent | LOW |
| 3 | `test_provider` | 556-628 | Entry/exit not logged. spawn + parse is all self-contained in return value | LOW |
| 4 | `fetch_remote_models` | 789-904 | **HTTP error handling is comprehensive** (401/403/404/timeout) but errors are only in result struct — **not logged**. The success path IS logged (line 903). Asymmetric | MEDIUM |

**Verdict:** Very well-logged. The asymmetry in `fetch_remote_models` (success logged, errors not logged) is the main finding.

---

### 7. `dcc_installer.py` — MIXED

**Logging setup:** `logger = logging.getLogger(__name__)` — used, but inconsistently

**Covered:**
- `set_addon_src_dir` → `logger.info` on setting
- `_get_addon_src_dir` → `logger.info` on resolution steps
- `install_dcc_addon` → `logger.info` on start; `logger.error` on failure; `logger.info` on success
- `uninstall_dcc_addon` → `logger.info` on start
- `_record_deployment` / `_remove_from_manifest` → `logger.info`
- `install_gateway_mcp_bridge` → `logger.info` entry + per-file debug
- `_patch_openclaw_config_for_mcp_bridge` → `logger.info` / `logger.warning` / `logger.error`
- `_refresh_plugin_registry` → `logger.info` / `logger.warning`
- `validate_all_deployments` → no entry/exit log

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `find_dcc_versions` | 170-191 | `OSError` on `os.scandir` is silent `pass`. File system errors will be invisible | MEDIUM |
| 2 | `get_dcc_port` | 298-340 | File I/O read (`json.load(f)`) wrapped in bare `except Exception: pass`. Corrupted config file returns default port with **zero indication** | HIGH |
| 3 | `set_dcc_port` | 343-410 | File I/O read/write with `try/except Exception` returning error dicts — **no logging** of the actual exception (except those returned as strings to caller) | MEDIUM |
| 4 | `get_addon_info` | 439-476 | File I/O read wrapped in `except Exception` → returns defaults with **no log**. Corrupted `__init__.py` will silently appear as version (5,0,0) | MEDIUM |
| 5 | `_get_gateway_plugin_src_dir` | 876-889 | Raises `RuntimeError` with no log before raise | LOW |
| 6 | `_compute_file_sha256` | 586-598 | File open with no error handling or logging. Will propagate raw OSError | LOW |
| 7 | `validate_all_deployments` | 774-871 | **No entry/exit log.** Loops over all deployments, determines statuses, returns list — all silent | MEDIUM |
| 8 | `check_mcp_bridge_freshness` | 1134-1193 | Pure return-value pattern — no log of success/failure/outdated status | LOW |
| 9 | `install_gateway_mcp_bridge` | 912-1006 | `_record_deployment` exception caught with `logger.warning` (good), but the `_patch_openclaw_config_for_mcp_bridge` and `_refresh_plugin_registry` calls have no error visibility to caller — they're fire-and-forget | MEDIUM |

**Verdict:** Inconsistent. The core install/uninstall paths are well-logged but utility/validation functions are mostly silent. Silent `except Exception: pass` in file I/O is a real risk.

---

### 8. `doctor.py` — EXCELLENT

**Logging setup:** `logger = logging.getLogger(__name__)` — used throughout

This is a health-check module. All paths return typed result structs with error messages. No missing logging at critical paths. The `_probe_tcp`, `_probe_lock`, `_probe_upstream_doctor` functions all return `ChannelResult` with messages.

**Verdict:** No gaps. Well-structured diagnostic module.

---

### 9. `gateway_log.py` — N/A (utility class)

This is a ring buffer data structure (`GatewayLogBuffer`). No I/O logging is applicable — it's an in-memory collection. It has no external calls.

**Verdict:** N/A

---

### 10. `gateway_state.py` — N/A (state singleton)

Pure in-memory state management with thread-safe setter/getter functions. No external calls, no error handling blocks, no logging needed.

**Verdict:** N/A

---

### 11. `installer.py` — MIXED

**Logging setup:** `logger = logging.getLogger(__name__)` — defined but barely used

**Covered:**
- Progress yields provide structured events (NDJSON parsing, progress percent)
- Error events are yielded as `ProgressEvent(phase="error")`

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `_install_unix` | 133-195 | **No logging.** Subprocess spawn (`curl_proc`, `bash_proc`) is entirely silent. PID of spawned processes not logged. All error detection is in stderr collection at the end | HIGH |
| 2 | `_install_windows` | 202-306 | **No logging.** `npm install` spawn is entirely silent except for progress event yields. PID not logged. | HIGH |
| 3 | `install_openclaw` | 398-453 | Entry logged? No. Exit logged? No. Does yield progress events but **no logger.info/error calls** | MEDIUM |
| 4 | `get_install_result` | 490-529 | Error classification is done in pure Python logic (no spawn) but zero logging of the classification decision | LOW |
| 5 | `_check_version_match` | 474-487 | `subprocess.run` for `--version` has **no logging** | LOW |
| 6 | `_create_windows_wrapper` | 309-344 | File I/O (wrapper script creation) with **no logging** | LOW |

**Verdict:** **This module has a logger imported but never called.** All error reporting flows through the `ProgressEvent` yield pattern — which requires the caller to consume the iterator fully. If the caller drops the iterator early, no error is logged anywhere. This is the most concerning gap in the entire codebase.

---

### 12. `mcp_bridge.py` — GOOD

**Logging setup:** `logger = logging.getLogger(__name__)` — used

**Covered:**
- `connect` → `logger.error` on missing websockets; `logger.info` on connect; `logger.warning` on failure
- `_async_connect` → `logger.info` on MCP handshake success
- `disconnect` → `logger.info`

**Gaps (minor):**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `call_tool` | 186-252 | Tool call failures return error dicts but **not logged**. The error is embedded in the MCP response — caller must check `isError: True` | MEDIUM |
| 2 | `_async_call_tool` | 254-281 | On MCP error: raises `RuntimeError` — caller catches in `call_tool`. **No log at raise point** | LOW |
| 3 | `check_blender_mcp_connection` | 309-336 | Connection failure returns dict — **not logged** | LOW |
| 4 | `check_blender_mcp_server_running` | 339-366 | Pure TCP probe — returns bool, no log needed | NONE |

**Verdict:** Good for a bridge module. The main gap is tool call failures being silently returned to caller.

---

### 13. `ports.py` — POOR

**Logging setup:** **None** — no `logging` import at all

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `pick_port` | 68-98 | Port scanning loop with **no logging**. Raises `RuntimeError` without prior log. Caller gets a bare exception with no context about which ports were tried | MEDIUM |
| 2 | `is_port_available` | 31-42 | Pure socket bind test — logging not strictly necessary but debug-level would help | LOW |
| 3 | `read_last_port` | 128-146 | File I/O (json.loads) with **no logging** on silent `pass` for JSONDecodeError/KeyError/ValueError | MEDIUM |
| 4 | `write_last_port` | 149-164 | File I/O (json.dumps + write) — **no error handling, no logging** | MEDIUM |

**Verdict:** **ports.py has zero logging.** Socket probing + file I/O with no diagnostic output. In production, port conflicts are one of the hardest things to debug remotely.

---

### 14. `runtime.py` — GOOD (with gaps)

**Logging setup:** `logger = logging.getLogger(__name__)` — extensively used

**Covered:**
- `start_gateway` → `logger.info` on command start, pid, reuse, cleanup, controlUi healing, orphan cleanup
- `stop_gateway` → covered via `_force_kill` (no log, but that's intentional)
- `_health_monitor_loop` → `logger.warning` on crash, `logger.error` on rate limit, `logger.info` on restart
- `_cleanup_orphan_gateways` → `logger.warning` / `logger.info` throughout
- `is_running` → `_is_openclaw_gateway_pid` has thorough diagnostics

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `_is_pid_alive` | 264-296 | **No logging.** `subprocess.run(["tasklist", ...]) ` or `os.kill(pid, 0)` failures are silent. A PID existence check failing because tasklist timed out vs PID truly dead are indistinguishable | MEDIUM |
| 2 | `_force_kill` | 903-916 | **No logging.** `taskkill /T /F` or `os.kill(SIGKILL)` — success/failure not logged. If it fails, the only clue is 5 seconds later when `_wait_pid_dead` times out | MEDIUM |
| 3 | `_list_pids_on_port` | 919-997 | All exceptions swallowed with **no log**. `FileNotFoundError` on missing `ss`/`lsof` could silently return empty list leading to wrong port assessment | MEDIUM |
| 4 | `_describe_pid` | 1000-1039 | All exceptions swallowed with **no log** | LOW |
| 5 | `_is_openclaw_process` | 1042-1099 | All catch blocks silent | LOW |
| 6 | `get_status` | 1356-1402 | Aggregation function — no entry/exit log. Status with `version_mismatch=True` is not logged | MEDIUM |
| 7 | `set_current_version` | 1320-1348 | Symlink creation / current.txt write with **no logging** of success/failure | LOW |
| 8 | `_get_pid_on_port` | 1248-1266 | `subprocess.check_output` — all exceptions swallowed silently | MEDIUM |

**Verdict:** Good but the "detective" functions (`_is_pid_alive`, `_force_kill`, `_list_pids_on_port`, `_get_pid_on_port`) are all silent. These are diagnostic tools that should log when they fail to provide results.

---

### 15. `sidecar.py` — GOOD

**Logging setup:** Uses `sys.stderr.write()` as explicit boot-time logging (before `logging` module is configured) — excellent pattern

**Covered:**
- Boot markers: `[sidecar.boot] python entrypoint reached`, `[sidecar.boot] all submodules imported`, `[sidecar.boot] atexit registered`, `[sidecar.boot] signal handlers installed`
- Main loop: `[sidecar.main] entering stdin loop`, `[sidecar.main] stdin EOF, exiting`
- RPC tracking: `[sidecar.rpc] in: <preview>`, `[sidecar.rpc] out: <method>`
- Parse errors: JSON decode failure yields RPC error response

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `handle_request` | 1191-1215 | All RPC handlers are wrapped in `try/except` (line 1208-1215) but the exception is **NOT logged** — only reflected in the RPC error response. The sidecar log won't show what internal error occurred | HIGH |
| 2 | `_shutdown_gateway_quietly` | 1218-1245 | **Intentionally silent** (atexit safety) — but could `sys.stderr.write()` a shutdown message before stopping | LOW |
| 3 | All `_handle_*` functions | Various | Each handler wraps in `try/except Exception` returning error dict. **No `logger.exception()` inside any handler.** The callers of these handlers (Rust sidecar manager) get the error code but no diagnostic detail | HIGH |
| 4 | `_signal_handler` | 1255-1265 | Signal receipt not logged | LOW |

**Verdict:** Boot-time logging is excellent. The critical gap: **no RPC handler logs exceptions.** If `openclaw.bootstrap` or `openclaw.start` fails inside the handler, the sidecar stderr shows nothing — only the JSON-RPC error response carries the message. This makes production debugging nearly impossible for handler-level failures.

---

### 16. `sidecar_gateway.py` — GOOD

**Logging setup:** `logger = logging.getLogger(__name__)` — used

**Covered:**
- `handle_gateway_auth_info` → `logger.exception` on fail
- `handle_gateway_status` → `logger.warning` on state mismatch; `logger.info` on state recovery
- `handle_gateway_start` → `logger.warning` on PortBusyError; `logger.exception` on fail
- `handle_gateway_tail_log` → `logger.exception` on fail
- `handle_web_open` → `logger.warning` on spawn fail; `logger.exception` on fail

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `handle_gateway_status` | 173-292 | Success path has no entry/exit log. Only abnormal conditions are logged | LOW |
| 2 | `handle_gateway_start` | 300-375 | Success path (idempotent return / start success) has **no log** | LOW |
| 3 | `handle_gateway_tail_log` | 390-446 | Success path has **no log**. Only validation errors and exceptions logged | LOW |

**Verdict:** Good error logging. The handlers write `logger.exception()` on failure — correct pattern. Success paths could benefit from `logger.info()` for audit trail but that's lower priority.

---

### 17. `sidecar_sessions.py` — MIXED

**Logging setup:** `logger = logging.getLogger(__name__)` — used

**Covered:**
- `_read_sessions_json` → `logger.warning` on read failure
- `handle_sessions_list` → `logger.exception` on top-level fail
- `handle_sessions_history` → `logger.warning` on transcript read failure; `logger.exception` on top-level fail

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `handle_sessions_list` | 126-189 | **No entry/exit logging on success.** Opens, reads, parses sessions.json, returns page — all silent | LOW |
| 2 | `handle_sessions_history` | 192-299 | **No entry/exit logging on success.** Reads transcript .jsonl file, filters messages, returns — all silent | LOW |
| 3 | `_extract_session_summary` | 65-123 | Pure data transformation — no logging needed | NONE |

**Verdict:** Error paths are logged. Success paths are silent — acceptable for read-only data access.

---

### 18. `web_ui.py` — MIXED

**Logging setup:** `logger = logging.getLogger(__name__)` — used sparingly

**Covered:**
- `get_web_url` → `logger.warning` when dashboard URL has no token

**Gaps:**

| # | Function | Line | Gap | Severity |
|---|---|---|---|---|
| 1 | `get_web_url` | 112-195 | **No entry/exit log.** Config compose path (fast path) succeeds silently. Fallback spawn path catches errors — errors returned in result, **not logged** | MEDIUM |
| 2 | `get_web_url` | 160-169 | Subprocess spawn failures caught → returned in `WebUrlResult` with **no log** | MEDIUM |
| 3 | `_build_url_from_config` | 83-98 | Config read with **no logging** | LOW |

**Verdict:** `get_web_url` has a `logger` but barely uses it. Subprocess spawn failures are silently returned to caller.

---

## Summary of Critical Gaps

### 🔴 HIGH severity (must fix for production debugging)

| # | File | Function | Gap |
|---|---|---|---|
| 1 | `installer.py` | `_install_unix`, `_install_windows` | Logger imported but **never called**. All errors only accessible via iterator consumption |
| 2 | `dcc_installer.py` | `get_dcc_port` | Silent `except Exception: pass` on corrupted config file read |
| 3 | `sidecar.py` | `handle_request` + all handlers | **No `logger.exception()` in any RPC handler.** Handler exceptions are silently converted to JSON-RPC error responses — no stderr trace |
| 4 | `_subprocess.py` | `find_openclaw_bin` | **Zero logging.** Silent failure through 3 resolution strategies |

### 🟡 MEDIUM severity (should fix)

| # | File | Function | Gap |
|---|---|---|---|
| 5 | `bootstrap.py` | `bootstrap` | Catch-all `except Exception` returned via `BootstrapResult` but **not logged** via `logger.exception()` |
| 6 | `config_io.py` | `fetch_remote_models` | Success logged, HTTP errors **not logged** — asymmetric |
| 7 | `runtime.py` | `_is_pid_alive`, `_force_kill`, `_list_pids_on_port` | Diagnostic functions have **no logging** |
| 8 | `ports.py` | All functions | **No logging module imported.** Port conflicts are hard to debug |
| 9 | `dcc_installer.py` | `validate_all_deployments` | No entry/exit logging for validation sweep |
| 10 | `runtime.py` | `get_status` | `version_mismatch=True` not logged |
| 11 | `web_ui.py` | `get_web_url` | Subprocess failures returned silently |
| 12 | `mcp_bridge.py` | `call_tool` | Tool call failures not logged |

### 🟢 LOW severity (nice to have)

| # | File | Issue |
|---|---|---|
| 13 | `agent_preset.py` | Lock file read failures silently return `None` |
| 14 | `bootstrap.py` | `read_config` silently returns `None` on corrupt JSON |
| 15 | `dcc_installer.py` | `get_addon_info` silently returns defaults on parse failure |
| 16 | Various | Entry/exit logging missing at many public function boundaries |

---

## Overall Assessment

**The OpenClaw wrapper is a well-structured production codebase with above-average logging coverage.** The patterns are correct: modules have loggers, `logger.exception()` is used in top-level error handlers, and the sidecar has explicit boot-time stderr markers for pre-logging-config diagnostics.

**The main systemic issue:** **Silent exception swallowing in file I/O and subprocess calls.** Multiple files have `except Exception: pass` patterns that suppress real errors (`dcc_installer.get_dcc_port`, `runtime._list_pids_on_port`, `ports.read_last_port`). In production, these become invisible failures.

**The second systemic issue:** **Asymmetry.** Functions that log success often don't log errors (`config_io.fetch_remote_models`), and functions that log errors often don't log success (`sidecar_gateway.handle_gateway_start`). Full audit trail requires both.

**The third systemic issue:** **installer.py imports a logger but never uses it.** This is the most gaping hole — the install process has zero log output for its subprocess operations.

---

## Non-Production Directories

| Directory | Files | Status |
|---|---|---|
| `openclaw/uplink/src/` | 2 | Empty namespace + docstring stub |
| `platform/core/src/` | 2 | Empty namespace + version string |
| `platform/skill/src/` | 12 | All `TODO: 迁移自原项目对应模块` stubs |
| `platform/cli/src/` | 5 | Typer skeleton, all commands `[TODO]` |
| `platform/contracts/python/src/` | 2 | Namespace + docstring only |

These directories contain no production logic and require no logging audit.
