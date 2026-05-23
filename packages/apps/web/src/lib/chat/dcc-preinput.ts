/**
 * DCC Pre-Input SDK — 新对话时检测已连接 DCC MCP Server，自动构建上下文消息。
 *
 * 设计目标（对齐 docs/sdk/dcc-preinput.md）：
 * 1. 标准 Provider 接口，不同 DCC 各自实现
 * 2. 已连接 → 构建告知 AI 的消息（工具列表 + 用法）
 * 3. 未连接 → 构建用户指引 toast（右下角非阻塞提示）
 * 4. 多 DCC 合并为一条消息
 *
 * 扩容方式：实现 DCCPreInputProvider → 注册到 ALL_PROVIDERS 即可。
 */

import type { MCPBridgeStatus } from "../../ipc/openclaw";

// ─── Provider 接口 ──────────────────────────────────────────────────────────

export interface DCCPreInputProvider {
  /** MCP server key（对齐 Gateway plugin KNOWN_TOOLS 的 key） */
  serverKey: string;
  /** 人类可读名称 */
  displayName: string;

  /** 从 MCPBridgeStatus 判断当前 DCC 是否已连接 */
  checkConnected(status: MCPBridgeStatus): boolean;

  /** 已连接时：构建告知 AI 的上下文消息 */
  buildConnectedMessage(): string;

  /** 未连接时：构建用户指引文案（用于 toast 提示） */
  buildDisconnectedToast(): string;
}

// ─── Blender Provider ───────────────────────────────────────────────────────

const blenderProvider: DCCPreInputProvider = {
  serverKey: "blender-editor",
  displayName: "Blender",

  checkConnected(status) {
    return status.blenderConnected;
  },

  buildConnectedMessage() {
    return (
      `已连接 Blender MCP Server，可用工具：\n` +
      `- mcp_blender-editor_run_python — 在 Blender 中执行 Python 代码。` +
      `可设 get_context=true 获取当前场景状态（选中对象、模式、场景名等）；` +
      `也可传 code 执行任意 Blender Python API。\n` +
      `\n` +
      `请描述你的需求，我会通过 MCP 工具来操作。`
    );
  },

  buildDisconnectedToast() {
    return (
      `未检测到 Blender MCP Server 连接。请确认：\n` +
      `1. 已在 Blender 中安装 Artifex Nexus 插件\n` +
      `2. Blender 软件已打开\n` +
      `3. 「系统」面板中 MCP Server 端口已配置`
    );
  },
};

// ─── Unreal Engine Provider ──────────────────────────────────────────────────

const unrealProvider: DCCPreInputProvider = {
  serverKey: "unreal-editor",
  displayName: "Unreal Engine",

  checkConnected(status) {
    return status.unrealConnected;
  },

  buildConnectedMessage() {
    return (
      `已连接 Unreal Engine MCP Server，可用工具：\n` +
      `- mcp_unreal-editor_run_python — 在 Unreal Editor 中执行 Python 代码。` +
      `可设 get_context=true 获取当前编辑器状态（选中 Actors、视口/内容浏览器、模式、关卡名等）；` +
      `也可传 code 执行任意 Unreal Python API。\n` +
      `\n` +
      `请描述你的需求，我会通过 MCP 工具来操作。`
    );
  },

  buildDisconnectedToast() {
    return (
      `未检测到 Unreal Engine MCP Server 连接。请确认：\n` +
      `1. 已在 UE 项目中安装 ArtifexNexusForUnreal 插件\n` +
      `2. Unreal Editor 已打开并加载了项目\n` +
      `3. 「系统」面板中 MCP Server 端口已配置（默认 18080）`
    );
  },
};

// ─── 注册表 ─────────────────────────────────────────────────────────────────

/** 所有已注册的 DCC Pre-Input Provider（扩容时在此添加） */
export const ALL_PROVIDERS: DCCPreInputProvider[] = [
  blenderProvider,
  unrealProvider,
  // 未来扩容示例：
  // mayaProvider,
];

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/**
 * 构建新对话自动发送的上下文消息。
 * 返回 null 表示无已连接 DCC，不需要发送。
 */
export function buildPreInputMessage(status: MCPBridgeStatus): string | null {
  const connected = ALL_PROVIDERS.filter((p) => p.checkConnected(status));
  if (connected.length === 0) return null;

  const parts = connected.map((p) => p.buildConnectedMessage());
  return parts.join("\n\n---\n\n");
}

/**
 * 收集所有未连接 DCC 的指引 toast 文案。
 * 返回空数组表示全部已连接。
 */
export function buildDisconnectedToasts(status: MCPBridgeStatus): string[] {
  const disconnected = ALL_PROVIDERS.filter((p) => !p.checkConnected(status));
  return disconnected.map((p) => p.buildDisconnectedToast());
}
