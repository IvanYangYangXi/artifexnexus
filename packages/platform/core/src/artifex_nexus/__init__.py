"""Artifex Nexus 共享核心 / Shared core for the OpenClaw bridge.

对应原 artclaw_bridge 的 ``core/`` 目录。所有 DCC 适配、OpenClaw 适配复用本包。
（按 ADR 0006 收敛范围，本桥仅服务 OpenClaw；本包提供 OpenClaw 之外亦稳定的通用能力，
 但不再为虚构的"其他 AI 平台"保留抽象层。）

Counterpart of legacy ``artclaw_bridge.core``. Shared by all DCC and OpenClaw adapters.
Per ADR 0006 the bridge only targets OpenClaw; this package provides primitives that are
useful regardless of OpenClaw specifics, but no longer reserves abstraction for other
hypothetical AI platforms.

子模块（待迁移）：
- bridge_protocol  ← bridge_core.py        WebSocket RPC 协议
- config           ← bridge_config.py      统一配置中心 (~/.artifexnexus/config/artifexnexus.json)
- diagnostics      ← bridge_diagnostics.py
- health_check
- integrity_check
- memory           ← memory_core.py        三层记忆（内存/文件/向量）
- event_bus        ← 新增（统一事件总线，供 Skill / 状态变化广播）
"""
# 命名空间包：与 artifex_nexus.skill / artifex_nexus.contracts 共享顶层命名空间
