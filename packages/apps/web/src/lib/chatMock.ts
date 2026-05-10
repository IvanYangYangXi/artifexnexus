/**
 * Chat mock 数据 — STORY-0034 阶段使用
 * STORY-0039 接入 OpenClaw API 后替换
 */

export interface MockMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  /** 流式生成中 */
  isStreaming?: boolean;
  /** 工具调用（仅 assistant 消息） */
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
    content: `好的，我来帮你完成这个操作。我会通过 Blender MCP 工具执行以下步骤：

1. 创建一个立方体
2. 创建一个红色材质
3. 将材质应用到立方体上

让我开始执行...`,
    timestamp: "2026-05-10T10:00:02Z",
    toolCalls: [
      {
        id: "tc-1",
        name: "mcp_blender-editor_run_python",
        status: "completed",
        duration: "0.3s",
        input: `import bpy
bpy.ops.mesh.primitive_cube_add(size=2)
cube = bpy.context.active_object
cube.name = "RedCube"`,
        output: "立方体 'RedCube' 创建成功",
      },
      {
        id: "tc-2",
        name: "mcp_blender-editor_run_python",
        status: "completed",
        duration: "0.2s",
        input: `import bpy
mat = bpy.data.materials.new(name="RedMaterial")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (1, 0, 0, 1)`,
        output: "红色材质 'RedMaterial' 创建成功",
      },
      {
        id: "tc-3",
        name: "mcp_blender-editor_run_python",
        status: "completed",
        duration: "0.1s",
        input: `import bpy
cube = bpy.data.objects["RedCube"]
mat = bpy.data.materials["RedMaterial"]
cube.data.materials.append(mat)`,
        output: "材质已应用到立方体",
      },
    ],
  },
  {
    id: "msg-3",
    role: "assistant",
    content: `已完成！在 Blender 中创建了一个名为 **RedCube** 的立方体，并应用了红色材质。

你可以在 Blender 视口中看到它。如果需要调整大小、位置或颜色，请告诉我。`,
    timestamp: "2026-05-10T10:00:05Z",
  },
  {
    id: "msg-4",
    role: "user",
    content: "能把立方体放大两倍吗？",
    timestamp: "2026-05-10T10:01:00Z",
  },
  {
    id: "msg-5",
    role: "assistant",
    content: `当然可以。让我把 RedCube 的尺寸放大两倍。

\`\`\`python
import bpy
cube = bpy.data.objects["RedCube"]
cube.scale = (4, 4, 4)
\`\`\`

已完成！立方体现在是原来的两倍大小。`,
    timestamp: "2026-05-10T10:01:03Z",
  },
];

export const MOCK_SESSION_FILES = [
  { name: "scene.blend", action: "修改" as const },
  { name: "RedMaterial", action: "新建" as const },
];
