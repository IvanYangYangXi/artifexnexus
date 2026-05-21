/**
 * Skills/Tools mock 数据 — STORY-0035 阶段使用
 * STORY-0040 接入真实 API 后替换
 *
 * DCC_LABELS 硬编码作为 fallback，运行时优先从 skill.categories.get RPC 动态加载。
 * software 字段统一为 DCCEntry[] 格式 ({dcc, minVersion?, maxVersion?})。
 */

// DCCEntry 类型（与 nexus-tool-api.ts 对齐）
export interface DCCEntry {
  dcc: string;
  minVersion?: string;
  maxVersion?: string;
}

export type SkillStatus = "installed" | "not_installed" | "update_available" | "disabled";
export type SkillSource = "official" | "marketplace" | "user";
export type DCC = "blender" | "maya" | "3ds_max" | "unreal_engine" | "houdini" | "comfyui" | "substance_painter" | "substance_designer" | "unity" | "general";

export interface MockSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SkillSource;
  status: SkillStatus;
  software: DCCEntry[];
  author: string;
  modifiedDate: string;
  favorited: boolean;
}

export interface MockTool {
  id: string;
  name: string;
  skillName: string;
  skillId: string;
  description: string;
  source: SkillSource;
  status: SkillStatus;
  software: DCCEntry[];
  author: string;
  version: string;
  modifiedDate: string;
  triggerCount: number;
  triggerTypes: string[];
  favorited: boolean;
}

export const DCC_LABELS: Record<DCC, string> = {
  blender: "Blender",
  maya: "Maya",
  "3ds_max": "3ds Max",
  unreal_engine: "Unreal Engine",
  houdini: "Houdini",
  comfyui: "ComfyUI",
  substance_painter: "Substance Painter",
  substance_designer: "Substance Designer",
  unity: "Unity",
  general: "通用",
};

export const SOURCE_LABELS: Record<SkillSource, string> = {
  official: "官方",
  marketplace: "市集",
  user: "我的",
};

export const STATUS_LABELS: Record<SkillStatus, string> = {
  installed: "已安装",
  not_installed: "可安装",
  update_available: "有更新",
  disabled: "已禁用",
};

export const MOCK_SKILLS: MockSkill[] = [
  {
    id: "sk-1", name: "blender-modeling", version: "v1.2.3",
    description: "Blender 建模工具集，包含创建基本几何体、修改器应用、材质管理等常用操作",
    source: "official", status: "installed", software: [{ dcc: "blender" }],
    author: "Ivan(杨己力)", modifiedDate: "2026-05-08", favorited: true,
  },
  {
    id: "sk-2", name: "ue-blueprint", version: "v0.9.0",
    description: "Unreal Engine 蓝图操作工具，支持创建/编辑蓝图节点、编译蓝图、管理变量",
    source: "official", status: "installed", software: [{ dcc: "unreal_engine" }],
    author: "Ivan(杨己力)", modifiedDate: "2026-05-06", favorited: false,
  },
  {
    id: "sk-3", name: "image-gen", version: "v2.0.1",
    description: "AI 图像生成工具，支持 Stable Diffusion / ComfyUI 工作流调用",
    source: "marketplace", status: "not_installed", software: [{ dcc: "comfyui" }, { dcc: "general" }],
    author: "Ivan(杨己力)", modifiedDate: "2026-05-09", favorited: false,
  },
  {
    id: "sk-4", name: "maya-rigging", version: "v1.0.0",
    description: "Maya 骨骼绑定工具，自动生成人体骨骼、IK/FK 切换、控制器创建",
    source: "official", status: "update_available", software: [{ dcc: "maya" }],
    author: "Ivan(杨己力)", modifiedDate: "2026-05-10", favorited: false,
  },
  {
    id: "sk-5", name: "my-custom-tools", version: "v0.1.0",
    description: "个人自定义工具集，包含常用脚本和快捷操作",
    source: "user", status: "disabled", software: [{ dcc: "blender" }, { dcc: "unreal_engine" }],
    author: "Ivan(杨己力)", modifiedDate: "2026-05-05", favorited: false,
  },
  {
    id: "sk-6", name: "houdini-terrain", version: "v3.1.0",
    description: "Houdini 地形生成工具，支持程序化地形、侵蚀模拟、高度图导出",
    source: "marketplace", status: "not_installed", software: [{ dcc: "houdini" }],
    author: "Ivan(杨己力)", modifiedDate: "2026-04-28", favorited: true,
  },
];

export const MOCK_TOOLS: MockTool[] = [
  {
    id: "t-1", name: "create_cube", skillName: "blender-modeling", skillId: "sk-1",
    description: "在 Blender 中创建立方体，支持自定义尺寸和位置",
    source: "official", status: "installed",
    software: [{ dcc: "blender" }], author: "Ivan(杨己力)", version: "v1.2.3",
    modifiedDate: "2026-05-08", triggerCount: 2, triggerTypes: ["事件", "定时"], favorited: true,
  },
  {
    id: "t-2", name: "set_material", skillName: "blender-modeling", skillId: "sk-1",
    description: "为选中物体设置材质，支持颜色、金属度、粗糙度等参数",
    source: "official", status: "installed",
    software: [{ dcc: "blender" }], author: "Ivan(杨己力)", version: "v1.2.3",
    modifiedDate: "2026-05-08", triggerCount: 1, triggerTypes: ["事件"], favorited: false,
  },
  {
    id: "t-3", name: "delete_object", skillName: "blender-modeling", skillId: "sk-1",
    description: "删除 Blender 场景中的指定物体",
    source: "official", status: "installed",
    software: [{ dcc: "blender" }], author: "Ivan(杨己力)", version: "v1.2.3",
    modifiedDate: "2026-05-08", triggerCount: 0, triggerTypes: [], favorited: false,
  },
  {
    id: "t-4", name: "create_actor", skillName: "ue-blueprint", skillId: "sk-2",
    description: "在 Unreal 关卡中创建 Actor，支持指定类和位置",
    source: "official", status: "installed",
    software: [{ dcc: "unreal_engine" }], author: "Ivan(杨己力)", version: "v0.9.0",
    modifiedDate: "2026-05-06", triggerCount: 3, triggerTypes: ["事件", "定时", "手动"], favorited: false,
  },
  {
    id: "t-5", name: "compile_blueprint", skillName: "ue-blueprint", skillId: "sk-2",
    description: "编译指定的蓝图，检查错误并输出编译日志",
    source: "official", status: "installed",
    software: [{ dcc: "unreal_engine" }], author: "Ivan(杨己力)", version: "v0.9.0",
    modifiedDate: "2026-05-06", triggerCount: 1, triggerTypes: ["手动"], favorited: false,
  },
  {
    id: "t-6", name: "txt2img", skillName: "image-gen", skillId: "sk-3",
    description: "文生图：输入提示词，调用 Stable Diffusion 生成图像",
    source: "marketplace", status: "not_installed",
    software: [{ dcc: "comfyui" }], author: "Ivan(杨己力)", version: "v2.0.1",
    modifiedDate: "2026-05-09", triggerCount: 0, triggerTypes: [], favorited: false,
  },
];
