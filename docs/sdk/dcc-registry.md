# DCC Registry SDK

> 前端 DCC 操作注册表。安装向导通过此注册表自动适配所有 DCC。

## 接口定义

**位置**：`apps/desktop/src/features/installer/dccRegistry.ts`

```ts
interface DCCActions {
  detect: () => Promise<DCCDetectResult>;
  install: (version: string, force?: boolean) => Promise<DCCInstallResult>;
  uninstall: (version: string) => Promise<DCCUninstallResult>;
}

interface DCCDetectResult {
  versions: DCCVersionInfo[];
  addon_info: { name: string; version: string; dcc_min: string; dcc_max: string | null };
}

interface DCCInstallResult {
  success: boolean;
  method: "junction" | "symlink" | "copy" | null;
  target: string;
  error: string | null;
}
```

## 注册表

```ts
export const dccRegistry: Record<string, DCCActions> = {
  blender: {
    detect: async () => adaptBlenderDetect(await detectBlenderVersions()),
    install: (version, force) => installBlenderAddon(version, force),
    uninstall: (version) => uninstallBlenderAddon(version),
  },
  // M7 接入：
  // maya: { detect: detectMayaVersions, install: installMayaAddon, ... },
};
```

## 使用方式

安装向导自动适配：`InstallItemRow` 和 `InstallerWizard` 通过 `getDCCActions(item.id)` 获取操作，无需为每个 DCC 写分支。

```ts
const dccActions = getDCCActions(item.id);
if (dccActions) {
  const result = await dccActions.detect();
  // 自动填充子项、显示兼容状态...
}
```

## 新增 DCC

只需在 `dccRegistry` 中添加一行：

```ts
dccRegistry["maya"] = {
  detect: detectMayaVersions,
  install: (v) => installMayaAddon(v),
  uninstall: (v) => uninstallMayaAddon(v),
};
```

安装向导自动适配：检测按钮 → 子项填充 → 安装按钮 → 批量安装。

## 相关

- `[[dcc-installer]]` — DCC 插件安装 SDK
- `[[../specs/dcc-plugin-management]]` — 完整规范
