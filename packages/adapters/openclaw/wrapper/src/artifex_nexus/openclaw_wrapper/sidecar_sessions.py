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
import re
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


def _extract_first_message_title(session_file: str) -> Optional[str]:
    """从 transcript .jsonl 文件提取第一条用户消息作为标题。

    仅读取前若干行，找到第一条 role=user 的消息后立即返回。
    截取前 30 字，超出加 …。
    """
    if not session_file:
        return None
    try:
        sf_path = Path(session_file)
        if not sf_path.exists():
            return None
        with open(sf_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("type") != "message":
                    continue
                msg = record.get("message", {})
                if msg.get("role") != "user":
                    continue
                content = msg.get("content", "")
                if isinstance(content, list):
                    text_parts = [
                        p.get("text", "")
                        for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    ]
                    text = " ".join(text_parts)
                elif isinstance(content, str):
                    text = content
                else:
                    continue
                if text:
                    # 去掉 Gateway 自动添加的时间戳前缀（如 "[Thu 2026-05-14 18:15 GMT+8]"）
                    text = re.sub(r'^\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*', '', text)
                    if text:
                        return text[:30] + ("…" if len(text) > 30 else "")
                break
    except Exception:
        pass
    return None


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

    # 标题：优先从 transcript 第一条用户消息提取，其次用 session name
    title = session_name
    first_msg_title = _extract_first_message_title(session_file)
    if first_msg_title:
        title = first_msg_title
    elif title == "main":
        title = "主对话"
    elif title.startswith("session-"):
        # session-<timestamp> 格式，转为时间显示（兜底）
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
        "hasTranscript": bool(session_file and Path(session_file).exists()),
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
        agent_id = params.get("agent_id")
        # params.get("agent_id") 在 Tauri invoke 传入 null 时返回 None（key 存在但值为 None），
        # 不会回退到默认值。显式处理 None / "" / "__all__" → 扫描所有 agent 目录。
        if agent_id in (None, "", "__all__"):
            agent_id = None  # sentinel: 扫描全部
        offset = max(0, int(params.get("offset", 0)))
        limit = min(MAX_PAGE_SIZE, max(1, int(params.get("limit", DEFAULT_PAGE_SIZE))))

        # 读取 sessions.json：单 agent 或全部 agent
        summaries = []
        if agent_id is not None:
            agent_ids = [agent_id]
        else:
            # 扫描所有 agent 目录
            agents_dir = home / "state" / "agents"
            agent_ids = []
            if agents_dir.exists():
                for d in agents_dir.iterdir():
                    if d.is_dir() and (d / "sessions" / "sessions.json").exists():
                        agent_ids.append(d.name)

        for aid in agent_ids:
            raw_sessions = _read_sessions_json(home, aid)
            for session_key, entry in raw_sessions.items():
                if not isinstance(entry, dict):
                    continue
                summary = _extract_session_summary(session_key, entry)
                if summary:
                    # 从 sessionKey 提取 agentId（用于前端按 agent 筛选）
                    summary["agentId"] = aid
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


def handle_sessions_history(req_id: Any, params: dict) -> dict:
    """``openclaw.sessions.history`` RPC：读取指定对话的历史消息。

    直接从 session transcript .jsonl 文件读取，不依赖 Gateway WS。

    Args (params):
        session_key (str): 对话 sessionKey，如 "agent:artifex-nexus:main"。
        agent_id (str): Agent ID，默认 "artifex-nexus"。
        limit (int): 最多返回多少条消息，默认 50。
        openclaw_home (str): OPENCLAW_HOME 路径。

    Returns:
        ``{ messages }`` — 消息列表（最近 limit 条，按时间正序）
    """
    try:
        home = _params_home(params)
        agent_id = params.get("agent_id", DEFAULT_AGENT_ID)
        session_key = params.get("session_key", "")
        limit = min(200, max(1, int(params.get("limit", 50))))

        if not session_key:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32602, "message": "缺少 session_key 参数"},
            }

        # 从 sessions.json 找到对应 session 的 transcript 文件路径
        raw_sessions = _read_sessions_json(home, agent_id)
        entry = raw_sessions.get(session_key, {})
        session_file = entry.get("sessionFile", "")

        if not session_file:
            # 尝试通过 sessionId 查找
            session_id = entry.get("sessionId", "")
            if session_id:
                sessions_dir = home / "state" / "agents" / agent_id / "sessions"
                session_file = str(sessions_dir / f"{session_id}.jsonl")

        if not session_file or not Path(session_file).exists():
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"messages": []},
            }

        # 读取 .jsonl 文件，提取 user/assistant 消息
        messages = []
        try:
            with open(session_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if record.get("type") != "message":
                        continue

                    msg = record.get("message", {})
                    role = msg.get("role", "")
                    if role not in ("user", "assistant"):
                        continue

                    # 提取文本内容
                    content_parts = msg.get("content", [])
                    text = ""
                    if isinstance(content_parts, str):
                        text = content_parts
                    elif isinstance(content_parts, list):
                        text_parts = []
                        for part in content_parts:
                            if isinstance(part, dict) and part.get("type") == "text":
                                text_parts.append(part.get("text", ""))
                        text = "\n".join(text_parts)

                    if not text:
                        continue

                    messages.append({
                        "id": record.get("id", ""),
                        "role": role,
                        "content": text,
                        "timestamp": record.get("timestamp", ""),
                    })
        except OSError as e:
            logger.warning("读取 session transcript 失败: %s", e)

        # 只返回最近 limit 条
        if len(messages) > limit:
            messages = messages[-limit:]

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"messages": messages},
        }

    except Exception as exc:
        logger.exception("openclaw.sessions.history 失败")
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32603, "message": f"读取对话历史失败: {exc}"},
        }
