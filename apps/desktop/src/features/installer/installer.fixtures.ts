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
    children: [
      {
        label: "Blender 4.2 主机",
        version: "4.2.1",
        installPath: "C:\\Program Files\\Blender Foundation\\Blender 4.2",
        projectPath: "",
        scriptPath: "<install>/plugins/blender/init.py",
        state: "pending",
      },
      {
        label: "Blender 4.4 实验",
        version: "4.4.0",
        installPath: "D:\\Tools\\Blender-4.4",
        projectPath: "",
        scriptPath: "<install>/plugins/blender/init.py",
        state: "pending",
      },
    ],
  },
  {
    id: "unreal",
    name: zh.itemUnreal,
    iconKey: "unreal",
    state: "pending",
    expandable: true,
    children: [
      {
        label: "UE 5.4 主项目",
        version: "5.4.2",
        installPath: "C:\\Program Files\\Epic Games\\UE_5.4",
        projectPath: "D:\\Proj\\MyGame",
        scriptPath: "<install>/plugins/unreal/init.py",
        state: "pending",
      },
    ],
  },
  {
    id: "max",
    name: zh.itemMax,
    iconKey: "max",
    state: "pending",
    expandable: true,
    children: [
      {
        label: "3ds Max 2024",
        version: "2024.2",
        installPath: "C:\\Program Files\\Autodesk\\3ds Max 2024",
        projectPath: "",
        scriptPath: "<install>/plugins/max/init.ms",
        state: "pending",
      },
    ],
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
