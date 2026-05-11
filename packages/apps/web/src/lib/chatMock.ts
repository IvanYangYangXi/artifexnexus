/**
 * Chat mock 数据 — STORY-0034 阶段使用
 * STORY-0039 接入 OpenClaw API 后替换
 *
 * @deprecated STORY-0039 完成后，所有 MockMessage / MOCK_MESSAGES / MOCK_AGENTS
 *   / MOCK_MODELS / MOCK_CONVERSATIONS / MOCK_SESSION_FILES 均已被真实 Gateway
 *   API 和数据服务替代。本文件保留仅用于参考和单元测试。
 *
 *   替代方案：
 *   - MockMessage → src/lib/chat/types.ts 中的 ChatMessage
 *   - MOCK_AGENTS → src/lib/chat/gateway-api.ts fetchGatewayAgents()
 *   - MOCK_MODELS → src/lib/chat/gateway-api.ts fetchGatewayModels()
 *   - MOCK_CONVERSATIONS → src/lib/chat/chat-service.ts useChatService().sessions
 *   - MOCK_SESSION_FILES → 由 tool call 事件实时派生（STORY-0040）
 *   - MOCK_MESSAGES → useChatService().messages（真实对话）
 */

export interface MockMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolCalls?: MockToolCall[];
}

export interface MockToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  duration?: string;
  input?: string;
  output?: string;
}

/** 以下 mock 数据仅供测试参考，生产代码不应导入 */

export const MOCK_AGENTS = [
  { id: "artifex-nexus", name: "Artifex Nexus" },
  { id: "custom", name: "自定义 Agent" },
];

export const MOCK_MODELS = [
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "deepseek-chat", name: "DeepSeek Chat" },
  { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
];

export const MOCK_CONVERSATIONS = [
  { id: "conv-1", name: "Blender 建模帮助", updatedAt: "2026-05-10T10:00:00Z" },
  { id: "conv-2", name: "UE5 蓝图调试", updatedAt: "2026-05-09T18:00:00Z" },
  { id: "conv-3", name: "新对话", updatedAt: "2026-05-10T12:00:00Z" },
];

export const MOCK_MESSAGES: MockMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "帮我在 Blender 中创建一个立方体，并给它设置红色材质",
    timestamp: "2026-05-10T10:00:00Z",
  },
  {
    id: "msg-2",
    role: "assistant",
    content: "好的，我来帮你完成这个操作...",
    timestamp: "2026-05-10T10:00:02Z",
    toolCalls: [
      {
        id: "tc-1",
        name: "mcp_blender-editor_run_python",
        status: "completed",
        duration: "2.3",
        input: 'import bpy; bpy.ops.mesh.primitive_cube_add()',
        output: "立方体创建成功",
      },
    ],
  },
];

export const MOCK_SESSION_FILES = [
  { name: "main.py", action: "新建" as const },
  { name: "config.json", action: "修改" as const },
  { name: "temp.log", action: "删除" as const },
];
