// 安装清单桩数据（7 行 + DCC 子项，零真实逻辑）。
// Install list fixture data (7 rows + DCC children, zero real logic).

import type { InstallItem } from "./installer.types";
import { t } from "./installer.i18n";

const zh = t.zhCN;

/** 7 行桩数据：OpenClaw / Web UI / Blender / UE / Max / Maya / ComfyUI 占位 */
export const FIXTURE_ITEMS: InstallItem[] = [
  {
    id: "openclaw",
    name: zh.itemOpenClaw,
    iconKey: "openclaw",
    state: "not-installed",
    expandable: false,
  },
  {
    id: "web-ui",
    name: zh.itemWebUI,
    iconKey: "web-ui",
    state: "pending",
    expandable: false,
  },
  {
    id: "blender",
    name: zh.itemBlender,
    iconKey: "blender",
    state: "pending",
    expandable: true,
    // STORY-0027：children 初始为空，检测后动态填充
    children: [],
  },
  {
    id: "unreal",
    name: zh.itemUnreal,
    iconKey: "unreal",
    state: "pending",
    expandable: true,
    // UE 不需要扫描安装目录，由用户手动添加工程条目
    children: [],
  },
  {
    id: "max",
    name: zh.itemMax,
    iconKey: "max",
    state: "pending",
    expandable: true,
    children: [],
  },
  {
    id: "maya",
    name: zh.itemMaya,
    iconKey: "maya",
    state: "pending",
    expandable: true,
    children: [],
  },
  {
    id: "comfyui",
    name: zh.itemComfyUI,
    iconKey: "comfyui",
    state: "unavailable",
    expandable: true,
    comingSoon: true,
    children: [],
  },
];
