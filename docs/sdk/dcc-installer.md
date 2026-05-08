# DCC 插件安装 SDK

> 统一 DCC 插件安装/卸载/检测接口。所有 DCC（Blender / Maya / Max / UE）共用。

## Python API

**包**：`artifex_nexus.openclaw_wrapper.dcc_installer`

```python
from artifex_nexus.openclaw_wrapper.dcc_installer import (
    # 版本检测
    find_blender_versions,          # → List[str]  扫描本机已安装版本
    is_addon_installed,             # → bool       检查插件是否已安装

    # 安装/卸载
    install_blender_addon,          # → Dict       安装插件（junction/symlink/copy）
    uninstall_blender_addon,        # → Dict       卸载插件

    # 版本兼容
    get_addon_info,                 # → Dict       读取 bl_info 元信息
    check_version_compatibility,    # → (bool, str) 版本兼容检查

    # Gateway MCP Bridge
    install_gateway_mcp_bridge,     # → Dict       部署 mcp-bridge + patch 配置
    is_gateway_mcp_bridge_installed,  # → bool

    # 路径注入
    set_addon_src_dir,              # → None       手动设置插件源目录
)
```

### 安装流程

```
1. find_blender_versions() → 获取已安装版本列表
2. check_version_compatibility(version) → 兼容检查
3. install_blender_addon(version) → junction/symlink/copy
   ├─ 自动调用 install_gateway_mcp_bridge()
   └─ 自动 patch openclaw.json
```

### 安装方式优先级

```
junction (Windows) > symlink > copy (fallback)
```

## TypeScript API

**包**：`apps/desktop/src/ipc/openclaw.ts`

```ts
// IPC 函数
detectBlenderVersions(): Promise<BlenderDetectResult>
installBlenderAddon(version: string, force?: boolean): Promise<BlenderInstallResult>
uninstallBlenderAddon(version: string): Promise<BlenderUninstallResult>
```

**注册表**：`apps/desktop/src/features/installer/dccRegistry.ts`

```ts
// 注册新 DCC（一行）
dccRegistry["maya"] = {
  detect: detectMayaVersions,
  install: (v) => installMayaAddon(v),
  uninstall: (v) => uninstallMayaAddon(v),
};
```

## Sidecar RPC

| 方法 | 参数 | 返回 |
|------|------|------|
| `openclaw.dcc.{dcc}.detect` | — | `{versions, addon_info}` |
| `openclaw.dcc.{dcc}.install` | `version, force?` | `{success, method, target, error?}` |
| `openclaw.dcc.{dcc}.uninstall` | `version` | `{success, target, error?}` |
| `openclaw.gateway.mcp_bridge.install` | — | `{success, method, target, error?}` |
| `openclaw.gateway.mcp_bridge.status` | — | `{installed}` |

## 相关

- `[[dcc-registry]]` — 前端 DCC 注册表
- `[[../specs/dcc-plugin-management]]` — 完整规范
