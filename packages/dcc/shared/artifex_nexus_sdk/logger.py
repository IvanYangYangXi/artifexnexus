"""logger — 工具日志模块

为 Nexus Tool 脚本提供轻量级日志接口。
与 artclaw_sdk.logger.get_tool_logger 兼容。
"""

import logging
import sys
from typing import Optional


def get_tool_logger(name: str) -> logging.Logger:
    """获取工具专用 logger。

    自动配置格式和输出流（stderr），避免与 DCC 主 logger 冲突。

    Args:
        name: 工具名称，自动添加 "artifex.tool." 前缀

    Returns:
        logging.Logger 实例
    """
    logger_name = f"artifex.tool.{name}"
    logger = logging.getLogger(logger_name)

    # 避免重复添加 handler
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(
            "[%(name)s] %(levelname)s: %(message)s"
        ))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False

    return logger
