/**
 * 风格预览的共享样本数据。
 * 4 个风格页共用同一份内容，差别只在视觉。便于平等对照。
 */

export interface ToolCallSample {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  args: Record<string, unknown>;
  result?: string;
}

export const TOOL_CALLS: ToolCallSample[] = [
  {
    id: "tc1",
    name: "mcp_blender_run_python",
    status: "done",
    durationMs: 312,
    args: { code: "bpy.ops.mesh.primitive_cube_add(size=2)" },
    result:
      "<bpy_struct, Object('Cube')>\n  location: (0.0, 0.0, 0.0)\n  scale: (1.0, 1.0, 1.0)",
  },
  {
    id: "tc2",
    name: "mcp_blender_run_python",
    status: "done",
    durationMs: 184,
    args: {
      code: "obj = bpy.context.active_object\nobj.location = (2, 0, 0)",
    },
    result: "OK",
  },
  {
    id: "tc3",
    name: "mcp_blender_run_python",
    status: "running",
    args: {
      code: 'mat = bpy.data.materials.new("Steel")\nmat.diffuse_color = (0.6, 0.6, 0.7, 1.0)',
    },
  },
];

export const CHAT_USER =
  "在场景中央添加一个金属质感的立方体，并把它移动到 (2,0,0)。";

export const OPENCLAW_STATUS = {
  state: "running" as const,
  port: 18765,
  version: "v2026.5.4",
  versionMatched: true,
  uptime: "3h 24m",
  attached: ["Blender 4.2", "Unreal 5.7"],
};

export interface SampleSlots {
  /** 样本：OpenClaw 状态卡片（系统模块用） */
  StatusCard: () => React.ReactNode;
  /** 样本：工具调用双层折叠（chat 中显示） */
  ToolCallGroup: () => React.ReactNode;
  /** 样本：3 个状态按钮组 */
  Buttons: () => React.ReactNode;
  /** 样本：chat 输入框 */
  ChatInput: () => React.ReactNode;
}
