"""
对话列表 RPC handler（STORY-0039 M3）。

JSON-RPC handler for listing OpenClaw Gateway sessions:

- ``openclaw.sessions.list`` — 读取 sessions.json，返回分页的对话列表

Sessions are stored at:
  ``~/.artifexnexus/.openclaw/state/agents/<agentId>/sessions/sessions.json``

Each session entry contains sessionKey, sessionId, updatedAt, model, etc.
We extract a human-readable title from the first user message via Gateway HTTP.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# 默认 agent ID（对齐 openclaw.json 中配置的默认 agent）
DEFAULT_AGENT_ID = "artifex-nexus"

# 默认分页大小
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _get_openclaw_home() -> Path:
    """获取 OPENCLAW_HOME 路径；缺省走 ``~/.artifexnexus/.openclaw/``。"""
    home = os.environ.get("OPENCLAW_HOME", "")
    if home:
        return Path(home)
    return Path.home() / ".artifexnexus" / ".openclaw"


def _params_home(params: dict) -> Path:
    """从 params 中解析 openclaw_home 路径。"""
    raw = params.get("openclaw_home", "")
    if raw:
        return Path(raw).expanduser().resolve()
    return _get_openclaw_home()


def _read_sessions_json(home: Path, agent_id: str) -> dict:
    """读取 sessions.json，返回原始 dict。

    Read sessions.json and return raw dict mapping sessionKey → metadata.
    """
    sessions_file = home / "state" / "agents" / agent_id / "sessions" / "sessions.json"
    if not sessions_file.exists():
        return {}
    try:
        with open(sessions_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("读取 sessions.json 失败: %s", e)
        return {}


def _extract_session_summary(session_key: str, entry: dict) -> Optional[dict]:
    """从 sessions.json 的单条 entry 提取前端需要的摘要信息。

    Extract frontend-friendly session summary from a sessions.json entry.

    Returns:
        dict with: sessionKey, sessionId, title, createdAt, updatedAt,
        model, agentId, status
        or None if the entry is invalid/deleted.
    """
    session_id = entry.get("sessionId")
    if not session_id:
        return None

    # 跳过已删除的 session（文件名含 .deleted.）
    session_file = entry.get("sessionFile", "")
    if ".deleted." in session_file:
        return None

    # 跳过 dreaming/system sessions
    chat_type = entry.get("chatType", "")
    if chat_type in ("dreaming", "system", "subagent"):
        return None

    # 提取时间
    updated_at = entry.get("updatedAt") or entry.get("lastInteractionAt") or 0
    started_at = entry.get("sessionStartedAt") or 0

    # 尝试从 sessionKey 提取可读标题
    # sessionKey 格式: "agent:<agentId>:<sessionName>"
    parts = session_key.split(":", 2)
    session_name = parts[2] if len(parts) >= 3 else session_key

    # 标题：优先用 session name，后续可从第一条消息推导
    title = session_name
    if title == "main":
        title = "主对话"
    elif title.startswith("session-"):
        # session-<timestamp> 格式，转为时间显示
        try:
            ts = int(title.replace("session-", ""))
            from datetime import datetime
            dt = datetime.fromtimestamp(ts / 1000)
            title = dt.strftime("对话 %m-%d %H:%M")
        except (ValueError, OSError):
            pass

    return {
        "sessionKey": session_key,
        "sessionId": session_id,
        "title": title,
        "createdAt": started_at,
        "updatedAt": updated_at,
        "model": entry.get("model", ""),
        "modelProvider": entry.get("modelProvider", ""),
        "status": entry.get("status", ""),
        "totalTokens": entry.get("totalTokens", 0),
    }


def handle_sessions_list(req_id: Any, params: dict) -> dict:
    """``openclaw.sessions.list`` RPC：返回分页的对话列表。

    Args (params):
        agent_id (str): Agent ID，默认 "artifex-nexus"。
        offset (int): 分页偏移，默认 0。
        limit (int): 每页条数，默认 20，最大 100。
        openclaw_home (str): OPENCLAW_HOME 路径。

    Returns:
        ``{ sessions, total, offset, limit, has_more }``

        - ``sessions``: list — 对话摘要列表（按 updatedAt 降序）
        - ``total``: int — 总对话数
        - ``offset``: int — 当前偏移
        - ``limit``: int — 当前页大小
        - ``has_more``: bool — 是否还有更多
    """
    try:
        home = _params_home(params)
        agent_id = params.get("agent_id", DEFAULT_AGENT_ID)
        offset = max(0, int(params.get("offset", 0)))
        limit = min(MAX_PAGE_SIZE, max(1, int(params.get("limit", DEFAULT_PAGE_SIZE))))

        # 读取 sessions.json
        raw_sessions = _read_sessions_json(home, agent_id)

        # 提取有效 session 摘要
        summaries = []
        for session_key, entry in raw_sessions.items():
            if not isinstance(entry, dict):
                continue
            summary = _extract_session_summary(session_key, entry)
            if summary:
                summaries.append(summary)

        # 按 updatedAt 降序排列（最近活跃的在前）
        summaries.sort(key=lambda s: s["updatedAt"], reverse=True)

        total = len(summaries)
        page = summaries[offset: offset + limit]

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "sessions": page,
                "total": total,
                "offset": offset,
                "limit": limit,
                "has_more": (offset + limit) < total,
            },
        }

    except Exception as exc:
        logger.exception("openclaw.sessions.list 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32603,
                "message": f"读取对话列表失败: {exc}",
            },
        }
