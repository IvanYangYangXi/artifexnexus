"""event — 触发器事件解析模块

将 kwargs 解析为结构化的 EventData 对象，提供 asset_path、
asset_name、asset_class 等属性访问。
与 artclaw_sdk.event.parse 兼容。
"""

from typing import Any, Dict


class EventData:
    """结构化事件数据，提供属性式访问。

    兼容 artclaw_sdk 的 event 对象接口：
    - evt.asset_path
    - evt.asset_name
    - evt.asset_class
    - evt.event_type
    """

    def __init__(self, data: Dict[str, Any]):
        self._data = data

    @property
    def asset_path(self) -> str:
        return self._data.get("asset_path", "")

    @property
    def asset_name(self) -> str:
        return self._data.get("asset_name", "")

    @property
    def asset_class(self) -> str:
        return self._data.get("asset_class", "")

    @property
    def event_type(self) -> str:
        return self._data.get("event_type", "")

    @property
    def dcc_type(self) -> str:
        return self._data.get("dcc_type", "")

    @property
    def timing(self) -> str:
        return self._data.get("timing", "post")

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def __repr__(self) -> str:
        return f"EventData({self._data})"


def parse(kwargs: Dict[str, Any]) -> EventData:
    """从 kwargs 解析事件数据。

    支持两种输入格式：
    1. event_data dict（触发器路径）
    2. 直接 kwargs（手动调用路径）

    Args:
        kwargs: 调用方传入的关键字参数

    Returns:
        EventData 实例，提供属性式访问
    """
    # 触发器路径：event_data 是一个 dict
    if "event_data" in kwargs and isinstance(kwargs["event_data"], dict):
        return EventData(kwargs["event_data"])

    # 手动调用路径：直接从 kwargs 提取
    return EventData(kwargs)
