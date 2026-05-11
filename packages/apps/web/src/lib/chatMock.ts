/**
 * Chat mock 数据 — STORY-0034 阶段使用
 * STORY-0039 接入 OpenClaw API 后替换
 *
 * @deprecated STORY-0039 完成后，MockMessage 和 MOCK_MESSAGES 已由
 *   src/lib/chat/types.ts 中的 ChatMessage 替代。
 *   MOCK_AGENTS / MOCK_MODELS / MOCK_CONVERSATIONS / MOCK_SESSION_FILES
 *   仍可用于 dev 模式和 UI 占位。
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
    content: "请展示一下 Markdown 渲染效果，包括标题、表格、代码块、链接等",
    timestamp: "2026-05-10T10:02:00Z",
  },
  {
    id: "msg-5",
    role: "assistant",
    content: `# Markdown 渲染效果展示

## 文本格式

这是**加粗文字**，这是*斜体文字*，这是~~删除线~~，这是\`行内代码\`。

## 链接与图片

访问 [Artifex Nexus 文档](https://github.com) 了解更多。

## 表格

| DCC | 版本 | 状态 | 备注 |
|-----|------|------|------|
| Blender | 5.1 | ✅ 已连接 | 支持建模/材质 |
| Maya | 2026 | 🔜 即将支持 | M7 阶段 |
| Unreal | 5.5 | 🔜 即将支持 | M7 阶段 |
| 3ds Max | 2026 | 🔜 即将支持 | M7 阶段 |

## 代码块

\`\`\`python
import bpy

def create_sphere(radius=1.0, location=(0, 0, 0)):
    """在 Blender 中创建一个球体"""
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius,
        location=location
    )
    return bpy.context.active_object

# 创建球体
sphere = create_sphere(radius=2.0)
print(f"创建球体: {sphere.name}")
\`\`\`

\`\`\`json
{
  "name": "RedCube",
  "material": {
    "type": "Principled BSDF",
    "color": [1, 0, 0, 1]
  }
}
\`\`\`

## 分割线

---

## 列表

### 有序列表
1. 第一步：安装 Blender 插件
2. 第二步：启动 Gateway
3. 第三步：开始对话

### 无序列表
- 🎨 Blender 建模
- 🏗️ Maya 动画
- 🎮 Unreal 蓝图

### 嵌套列表
- 建模工具
  - Blender
  - Maya
- 引擎
  - Unreal Engine 5
  - Unity

## 引用块

> **提示**：这是引用块，用于突出重要信息。
> 
> 可以包含多行内容，支持 **Markdown** 格式。

## 任务列表

- [x] 安装 Blender 插件
- [x] 配置 MCP Server
- [ ] 测试工具调用
- [ ] 部署到生产环境

以上就是 Markdown 渲染的全部效果展示。`,
    timestamp: "2026-05-10T10:02:03Z",
  },
];

export const MOCK_SESSION_FILES = [
  { name: "scene.blend", action: "修改" as const },
  { name: "RedMaterial", action: "新建" as const },
];
