/**
 * Skills/Tools mock 数据 — STORY-0035 阶段使用
 * STORY-0040 接入真实 API 后替换
 */

export type SkillStatus = "installed" | "not_installed" | "update_available" | "disabled";
export type SkillSource = "official" | "marketplace" | "user";
export type DCC = "blender" | "maya" | "max" | "unreal" | "houdini" | "comfyui" | "general";
export type ImplType = "skill_wrapper" | "script" | "composite";

export interface MockSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  source: SkillSource;
  status: SkillStatus;
  targetDCCs: DCC[];
  author: string;
  updatedAt: string;
  rating: number;
  downloads: number;
  pinned: boolean;
}

export interface MockTool {
  id: string;
  name: string;
  skillName: string;
  skillId: string;
  description: string;
  source: SkillSource;
  status: SkillStatus;
  implType: ImplType;
  targetDCCs: DCC[];
  author: string;
  version: string;
  rating: number;
  downloads: number;
  triggerCount: number;
  triggerTypes: string[];
  favorited: boolean;
}

export const DCC_LABELS: Record<DCC, string> = {
  blender: "Blender",
  maya: "Maya",
  max: "3ds Max",
  unreal: "Unreal",
  houdini: "Houdini",
  comfyui: "ComfyUI",
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

export const IMPL_LABELS: Record<ImplType, string> = {
  skill_wrapper: "包装",
  script: "脚本",
  composite: "组合",
};

export const MOCK_SKILLS: MockSkill[] = [
  {
    id: "sk-1",
    name: "blender-modeling",
    version: "v1.2.3",
    description: "Blender 建模工具集，包含创建基本几何体、修改器应用、材质管理等常用操作",
    source: "official",
    status: "installed",
    targetDCCs: ["blender"],
    author: "Artifex Team",
    updatedAt: "2026-05-08T10:00:00Z",
    rating: 4.8,
    downloads: 1234,
    pinned: true,
  },
  {
    id: "sk-2",
    name: "ue-blueprint",
    version: "v0.9.0",
    description: "Unreal Engine 蓝图操作工具，支持创建/编辑蓝图节点、编译蓝图、管理变量",
    source: "official",
    status: "installed",
    targetDCCs: ["unreal"],
    author: "Artifex Team",
    updatedAt: "2026-05-06T14:00:00Z",
    rating: 4.5,
    downloads: 892,
    pinned: false,
  },
  {
    id: "sk-3",
    name: "image-gen",
    version: "v2.0.1",
    description: "AI 图像生成工具，支持 Stable Diffusion / ComfyUI 工作流调用",
    source: "marketplace",
    status: "not_installed",
    targetDCCs: ["comfyui", "general"],
    author: "Community",
    updatedAt: "2026-05-09T08:00:00Z",
    rating: 4.2,
    downloads: 567,
    pinned: false,
  },
  {
    id: "sk-4",
    name: "maya-rigging",
    version: "v1.0.0",
    description: "Maya 骨骼绑定工具，自动生成人体骨骼、IK/FK 切换、控制器创建",
    source: "official",
    status: "update_available",
    targetDCCs: ["maya"],
    author: "Artifex Team",
    updatedAt: "2026-05-10T06:00:00Z",
    rating: 4.6,
    downloads: 345,
    pinned: false,
  },
  {
    id: "sk-5",
    name: "my-custom-tools",
    version: "v0.1.0",
    description: "个人自定义工具集，包含常用脚本和快捷操作",
    source: "user",
    status: "disabled",
    targetDCCs: ["blender", "unreal"],
    author: "我",
    updatedAt: "2026-05-05T12:00:00Z",
    rating: 0,
    downloads: 12,
    pinned: false,
  },
  {
    id: "sk-6",
    name: "houdini-terrain",
    version: "v3.1.0",
    description: "Houdini 地形生成工具，支持程序化地形、侵蚀模拟、高度图导出",
    source: "marketplace",
    status: "not_installed",
    targetDCCs: ["houdini"],
    author: "TerrainCraft",
    updatedAt: "2026-04-28T16:00:00Z",
    rating: 4.9,
    downloads: 2100,
    pinned: false,
  },
];

export const MOCK_TOOLS: MockTool[] = [
  {
    id: "t-1",
    name: "create_cube",
    skillName: "blender-modeling",
    skillId: "sk-1",
    description: "在 Blender 中创建立方体，支持自定义尺寸和位置",
    source: "official",
    status: "installed",
    implType: "skill_wrapper",
    targetDCCs: ["blender"],
    author: "Artifex Team",
    version: "v1.2.3",
    rating: 4.8,
    downloads: 1234,
    triggerCount: 2,
    triggerTypes: ["事件", "定时"],
    favorited: true,
  },
  {
    id: "t-2",
    name: "set_material",
    skillName: "blender-modeling",
    skillId: "sk-1",
    description: "为选中物体设置材质，支持颜色、金属度、粗糙度等参数",
    source: "official",
    status: "installed",
    implType: "skill_wrapper",
    targetDCCs: ["blender"],
    author: "Artifex Team",
    version: "v1.2.3",
    rating: 4.7,
    downloads: 1100,
    triggerCount: 1,
    triggerTypes: ["事件"],
    favorited: false,
  },
  {
    id: "t-3",
    name: "delete_object",
    skillName: "blender-modeling",
    skillId: "sk-1",
    description: "删除 Blender 场景中的指定物体",
    source: "official",
    status: "installed",
    implType: "script",
    targetDCCs: ["blender"],
    author: "Artifex Team",
    version: "v1.2.3",
    rating: 4.3,
    downloads: 980,
    triggerCount: 0,
    triggerTypes: [],
    favorited: false,
  },
  {
    id: "t-4",
    name: "create_actor",
    skillName: "ue-blueprint",
    skillId: "sk-2",
    description: "在 Unreal 关卡中创建 Actor，支持指定类和位置",
    source: "official",
    status: "installed",
    implType: "skill_wrapper",
    targetDCCs: ["unreal"],
    author: "Artifex Team",
    version: "v0.9.0",
    rating: 4.5,
    downloads: 800,
    triggerCount: 3,
    triggerTypes: ["事件", "定时", "手动"],
    favorited: false,
  },
  {
    id: "t-5",
    name: "compile_blueprint",
    skillName: "ue-blueprint",
    skillId: "sk-2",
    description: "编译指定的蓝图，检查错误并输出编译日志",
    source: "official",
    status: "installed",
    implType: "composite",
    targetDCCs: ["unreal"],
    author: "Artifex Team",
    version: "v0.9.0",
    rating: 4.4,
    downloads: 750,
    triggerCount: 1,
    triggerTypes: ["手动"],
    favorited: false,
  },
  {
    id: "t-6",
    name: "txt2img",
    skillName: "image-gen",
    skillId: "sk-3",
    description: "文生图：输入提示词，调用 Stable Diffusion 生成图像",
    source: "marketplace",
    status: "not_installed",
    implType: "skill_wrapper",
    targetDCCs: ["comfyui"],
    author: "Community",
    version: "v2.0.1",
    rating: 4.2,
    downloads: 567,
    triggerCount: 0,
    triggerTypes: [],
    favorited: false,
  },
];
