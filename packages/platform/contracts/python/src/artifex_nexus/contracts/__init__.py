"""artifex_nexus.contracts — 共享契约 / Shared contracts.

包含：
- ``schemas/``        JSON Schema 文件（唯一信息源）
- ``models``          pydantic v2 数据模型（手写或由 schemas 生成）
- ``platform_adapter`` PlatformAdapter ABC
- ``dcc_adapter``     BaseDCCAdapter ABC
- ``execution_context`` 跨 DCC 执行上下文 dataclass
- ``stream_event``    平台流事件枚举与 schema
"""
__version__ = "0.0.0"
