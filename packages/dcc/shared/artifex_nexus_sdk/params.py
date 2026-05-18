"""params — 参数解析模块

从 manifest inputs 定义和调用方传入的 kwargs 中解析参数值。
与 artclaw_sdk.params.parse_params 兼容。
"""

from typing import Any, Dict, List


def parse_params(inputs: List[Dict[str, Any]], kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """解析工具参数。

    对每个 manifest inputs 条目：
    - 若 kwargs 中提供了该参数 → 使用 kwargs 值
    - 否则 → 使用 manifest 中定义的 default 值

    Args:
        inputs: manifest.json 的 inputs 数组，
                每项含 {"id": str, "default": Any, ...}
        kwargs: 调用方传入的关键字参数

    Returns:
        {param_id: resolved_value, ...}
    """
    params: Dict[str, Any] = {}
    for inp in inputs:
        param_id = inp.get("id", "")
        if not param_id:
            continue
        if param_id in kwargs:
            params[param_id] = kwargs[param_id]
        elif "default" in inp:
            params[param_id] = inp["default"]
    return params
