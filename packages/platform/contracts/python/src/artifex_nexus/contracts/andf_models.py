"""
ANDF (Artifex Nexus Data Format) Pydantic v2 models.

auto-generated from ``../../schemas/andf.schema.json`` — 手改请同步 Schema 源。
"""

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ColumnType(str, Enum):
    """列数据类型 / Column data type."""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    DATETIME = "datetime"
    URL = "url"


class Column(BaseModel):
    """列定义 / Column definition."""

    name: str = Field(..., min_length=1, description="列名，在同一 ANDF 实例内唯一")
    type: ColumnType = Field(..., description="列数据类型")
    nullable: bool = Field(default=False, description="是否允许空值")
    visible: bool = Field(default=True, description="是否在视图中默认显示")
    index: Optional[int] = Field(default=None, ge=0, description="列在原始数据源中的序号")


class Meta(BaseModel):
    """ANDF 元数据 / ANDF metadata."""

    source: Optional[str] = Field(default=None, description="原始文件名或来源标识")
    imported_at: str = Field(
        default_factory=lambda: datetime.now().astimezone().isoformat(),
        alias="importedAt",
        description="导入时间 (ISO 8601)",
    )
    row_count: int = Field(..., alias="rowCount", ge=0, description="数据行数")
    column_count: int = Field(..., alias="columnCount", ge=1, description="列数")

    model_config = {"populate_by_name": True}


class ViewType(str, Enum):
    """视图类型 / View type."""

    TABLE = "table"
    CARD = "card"
    LIST = "list"
    TREE = "tree"
    BAR = "bar"
    PIE = "pie"
    LINE = "line"
    SCATTER = "scatter"
    SPATIAL_PLOT = "spatial-plot"
    HEATMAP = "heatmap"


class View(BaseModel):
    """视图配置 / View configuration."""

    type: ViewType = Field(..., description="视图类型标识")
    encoding: dict[str, Any] = Field(
        default_factory=dict,
        description="视图字段映射（free-form object）",
    )


class ANDF(BaseModel):
    """ANDF 数据模型 / Artifex Nexus Data Format model."""

    meta: Meta = Field(..., description="元数据")
    columns: list[Column] = Field(..., min_length=1, description="列定义列表")
    rows: list[dict[str, Any]] = Field(default_factory=list, description="数据行")
    view: Optional[View] = Field(default=None, description="视图配置")

    model_config = {"json_schema_extra": {"examples": []}}
