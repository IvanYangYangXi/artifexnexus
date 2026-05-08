// DCC 注册表：统一管理所有 DCC 的检测/安装/卸载操作。
// DCC registry: unified API for detect/install/uninstall across all DCCs.
//
// 新增 DCC 时只需在此注册，InstallItemRow 和 InstallerWizard 自动适配。

import {
  detectBlenderVersions,
  installBlenderAddon,
  uninstallBlenderAddon,
} from "../../ipc/openclaw";
import type {
  BlenderDetectResult,
  BlenderInstallResult,
  BlenderUninstallResult,
} from "../../ipc/openclaw";

// ── 通用 DCC 操作接口 ──────────────────────────────────────────────────

/** 单个 DCC 版本检测结果 */
export interface DCCVersionInfo {
  version: string;
  installed: boolean;
  compatible: boolean;
  compat_reason: string;
}

/** 检测结果 */
export interface DCCDetectResult {
  versions: DCCVersionInfo[];
  addon_info: {
    name: string;
    version: string;
    dcc_min: string;
    dcc_max: string | null;
  };
}

/** 安装结果 */
export interface DCCInstallResult {
  success: boolean;
  method: "junction" | "symlink" | "copy" | null;
  target: string;
  error: string | null;
}

/** 卸载结果 */
export interface DCCUninstallResult {
  success: boolean;
  target: string;
  error: string | null;
  message?: string;
}

/** DCC 操作集合 */
export interface DCCActions {
  /** 检测本机已安装的 DCC 版本 */
  detect: () => Promise<DCCDetectResult>;
  /** 安装插件到指定 DCC 版本 */
  install: (version: string, force?: boolean) => Promise<DCCInstallResult>;
  /** 卸载插件 */
  uninstall: (version: string) => Promise<DCCUninstallResult>;
}

// ── 注册表 ─────────────────────────────────────────────────────────────

/** 将 Blender 检测结果转换为通用格式 */
function adaptBlenderDetect(r: BlenderDetectResult): DCCDetectResult {
  return {
    versions: r.versions.map((v) => ({
      version: v.version,
      installed: v.installed,
      compatible: v.compatible,
      compat_reason: v.compat_reason,
    })),
    addon_info: {
      name: r.addon_info.name,
      version: r.addon_info.version,
      dcc_min: r.addon_info.blender_min,
      dcc_max: r.addon_info.blender_max,
    },
  };
}

/** DCC 注册表：key = InstallItem.id */
export const dccRegistry: Record<string, DCCActions> = {
  // STORY-0027：Blender（M2 首发）
  blender: {
    detect: async () => adaptBlenderDetect(await detectBlenderVersions()),
    install: (version, force) => installBlenderAddon(version, force),
    uninstall: (version) => uninstallBlenderAddon(version),
  },
  // M7 接入：
  // maya: { detect: detectMayaVersions, install: installMayaAddon, ... },
  // max: { detect: detectMaxVersions, install: installMaxAddon, ... },
  // unreal: { detect: detectUnrealVersions, install: installUnrealAddon, ... },
};

/** 检查 item.id 是否已注册 DCC 操作 */
export function isDCCRegistered(id: string): boolean {
  return id in dccRegistry;
}

/** 获取 DCC 操作（未注册返回 undefined） */
export function getDCCActions(id: string): DCCActions | undefined {
  return dccRegistry[id];
}
