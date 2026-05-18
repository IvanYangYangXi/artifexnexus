"""result — 结果封装模块

提供统一的工具执行结果返回格式。
与 artclaw_sdk.result 兼容。
"""

from typing import Any, Dict, Optional


def success(data: Any = None, message: str = "") -> Dict[str, Any]:
    """成功结果。

    Args:
        data: 返回数据（可以是 dict / list / str 等）
        message: 人类可读的描述信息

    Returns:
        {"action": "allow", "data": ..., "message": ...}
    """
    result: Dict[str, Any] = {"action": "allow"}
    if data is not None:
        result["data"] = data
    if message:
        result["message"] = message
    return result


def fail(code: str, message: str, data: Any = None) -> Dict[str, Any]:
    """失败结果。

    Args:
        code: 错误码（如 "NO_INPUT", "IMPORT_ERROR"）
        message: 错误描述
        data: 可选的附加数据

    Returns:
        {"action": "error", "code": ..., "reason": ..., "data": ...}
    """
    result: Dict[str, Any] = {
        "action": "error",
        "code": code,
        "reason": message,
    }
    if data is not None:
        result["data"] = data
    return result


def allow(reason: str = "", data: Any = None) -> Dict[str, Any]:
    """允许操作通过。

    用于触发器事件中表示"检查通过，无需拦截"。

    Args:
        reason: 通过原因
        data: 可选的附加数据

    Returns:
        {"action": "allow", "reason": ...}
    """
    result: Dict[str, Any] = {"action": "allow"}
    if reason:
        result["reason"] = reason
    if data is not None:
        result["data"] = data
    return result


def reject(reason: str, data: Any = None, code: Optional[str] = None) -> Dict[str, Any]:
    """拒绝操作。

    用于触发器事件中表示"检查不通过，应拦截操作"。

    Args:
        reason: 拒绝原因
        data: 可选的附加数据
        code: 可选的错误码

    Returns:
        {"action": "reject", "reason": ..., "data": ...}
    """
    result: Dict[str, Any] = {"action": "reject", "reason": reason}
    if data is not None:
        result["data"] = data
    if code:
        result["code"] = code
    return result
