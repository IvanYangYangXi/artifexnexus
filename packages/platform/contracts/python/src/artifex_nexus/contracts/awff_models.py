"""
AWFF (Artifex Nexus Workflow Format) Pydantic v2 models.

手写源（与 ``../../schemas/awff.schema.json`` 同步）。修改 schema 后请同步本文件。
"""

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any, Optional, Literal

from pydantic import BaseModel, Field


# --- enums ---------------------------------------------------------------

class NodeKind(str, Enum):
    TRIGGER = "trigger"
    TOOL = "tool"
    SKILL = "skill"
    AI_CHAT = "ai-chat"
    USER = "user"
    CONTROL = "control"
    DATA = "data"
    SCRIPT = "script"
    OUTPUT = "output"


class NodeType(str, Enum):
    TRIGGER_ON_DEMAND = "trigger.on-demand"
    TRIGGER_ON_SCHEDULE = "trigger.on-schedule"
    TOOL_RUN_TOOL = "tool.run-tool"
    SKILL_RUN_SKILL = "skill.run-skill"
    AI_CHAT_SEND_TO_CHAT = "ai-chat.send-to-chat"
    AI_CHAT_GET_CHAT_RESPONSE = "ai-chat.get-chat-response"
    AI_CHAT_AI_ANALYSIS = "ai-chat.ai-analysis"
    USER_USER_CHOICE = "user.user-choice"
    USER_INPUT_FORM = "user.input-form"
    CONTROL_CONDITION = "control.condition"
    CONTROL_TERMINATE = "control.terminate"
    CONTROL_LOOP = "control.loop"
    DATA_SET_VARIABLE = "data.set-variable"
    DATA_TRANSFORM = "data.transform"
    SCRIPT_RUN_PYTHON = "script.run-python"
    SCRIPT_RUN_SHELL = "script.run-shell"
    OUTPUT_SHOW_RESULT = "output.show-result"
    OUTPUT_EXPORT_FILE = "output.export-file"


class PortDataType(str, Enum):
    ANY = "any"
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    OBJECT = "object"
    ARRAY = "array"
    TRIGGER = "trigger"
    CONTROL = "control"


class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING = "waiting"
    BRANCHED = "branched"
    DONE = "done"
    SKIPPED = "skipped"
    ERROR = "error"


class RuntimeUI(str, Enum):
    NONE = "none"
    PANEL = "panel"
    MODAL = "modal"


class VariableType(str, Enum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    OBJECT = "object"
    ARRAY = "array"


# --- models --------------------------------------------------------------

class Meta(BaseModel):
    """AWFF 元数据。"""

    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    created_at: str = Field(..., alias="createdAt")
    updated_at: str = Field(..., alias="updatedAt")
    schema_version: Literal["0.1.0"] = Field(default="0.1.0", alias="schemaVersion")

    model_config = {"populate_by_name": True}


class Port(BaseModel):
    id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    data_type: PortDataType = Field(..., alias="dataType")
    required: bool = False
    multi: bool = False

    model_config = {"populate_by_name": True}


class Capabilities(BaseModel):
    can_pause: bool = Field(default=False, alias="canPause")
    can_branch: bool = Field(default=False, alias="canBranch")
    can_terminate: bool = Field(default=False, alias="canTerminate")
    runtime_ui: RuntimeUI = Field(default=RuntimeUI.NONE, alias="runtimeUI")

    model_config = {"populate_by_name": True}


class Position(BaseModel):
    x: float
    y: float


class Node(BaseModel):
    id: str = Field(..., min_length=1)
    kind: NodeKind
    type: NodeType
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    position: Position
    capabilities: Capabilities
    inputs: list[Port] = Field(default_factory=list)
    outputs: list[Port] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    status: Optional[NodeStatus] = None


class Edge(BaseModel):
    id: str = Field(..., min_length=1)
    source: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    source_handle: str = Field(..., alias="sourceHandle", min_length=1)
    target_handle: str = Field(..., alias="targetHandle", min_length=1)
    label: Optional[str] = None

    model_config = {"populate_by_name": True}


class Variable(BaseModel):
    name: str = Field(..., min_length=1)
    type: VariableType
    default: Any = None
    description: Optional[str] = None


class AWFF(BaseModel):
    """ArtifexNexusWorkflowFormat — 工作流顶层数据模型。"""

    meta: Meta
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    variables: list[Variable] = Field(default_factory=list)


__all__ = [
    "AWFF",
    "Capabilities",
    "Edge",
    "Meta",
    "Node",
    "NodeKind",
    "NodeStatus",
    "NodeType",
    "Port",
    "PortDataType",
    "Position",
    "RuntimeUI",
    "Variable",
    "VariableType",
]
