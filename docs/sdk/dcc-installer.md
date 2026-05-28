# DCC 插件安装 SDK

> 统一 DCC 插件安装/卸载/检测接口。所有 DCC（Blender / Maya / Max / UE）共用。

## Python API（通用接口）

**包**：`artifex_nexus.openclaw_wrapper.dcc_installer`

### 版本检测

#### `find_dcc_versions(dcc: str) → List[str]`

扫描本机已安装的 DCC 版本。

```python
versions = find_dcc_versions("blender")  # → ["5.1", "5.0", "4.2"]
versions = find_dcc_versions("maya")     # → ["2024", "2023"]  (M7)
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dcc` | `str` | ✅ | DCC 标识：`"blender"` / `"maya"` / `"max"` |

- **返回**：降序排列的版本号列表，无安装返回 `[]`

#### `is_dcc_addon_installed(dcc: str, dcc_version: str) → bool`

检查插件是否已安装到指定 DCC 版本。

```python
is_dcc_addon_installed("blender", "5.1")  # → True / False
```

### 安装/卸载

#### `install_dcc_addon(dcc: str, dcc_version: str, force: bool = False) → Dict`

安装插件到指定 DCC 版本。

```python
result = install_dcc_addon("blender", "5.1")
# → {"success": True, "method": "copy", "target": "...", "error": None}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `dcc` | `str` | ✅ | DCC 标识 |
| `dcc_version` | `str` | ✅ | DCC 版本号 |
| `force` | `bool` | ❌ | 跳过兼容性检查，默认 `False` |

| 返回字段 | 类型 | 说明 |
|----------|------|------|
| `success` | `bool` | 是否成功 |
| `method` | `"copy"` \| `None` | 安装方式 |
| `target` | `str` | 目标路径 |
| `error` | `str` \| `None` | 失败原因 |

#### `uninstall_dcc_addon(dcc: str, dcc_version: str) → Dict`

卸载插件。

```python
result = uninstall_dcc_addon("blender", "5.1")
# → {"success": True, "target": "...", "error": None, "message": "卸载成功"}
```

### 版本兼容

#### `get_addon_info() → Dict`

读取插件的 `bl_info` 元信息。

```python
info = get_addon_info()
# → {"name": "Artifex Nexus Bridge", "version": (5,0,0), "blender_min": (5,0,0), "blender_max": (5,1,9)}
```

#### `check_version_compatibility(dcc_version: str) → Tuple[bool, str]`

检查 DCC 版本是否兼容。

```python
compatible, reason = check_version_compatibility("5.1")
# → (True, "兼容 (5.0.0 ~ 5.1.9)")
```

**兼容规则**：`blender_min <= dcc_version <= blender_max`

### Gateway MCP Bridge

#### `install_gateway_mcp_bridge() → Dict`

部署 mcp-bridge 插件 + patch `openclaw.json` 配置。

#### `is_gateway_mcp_bridge_installed() → bool`

检查 mcp-bridge 是否已部署。

### 路径注入

#### `set_addon_src_dir(path: str) → None`

手动设置插件源目录。

## Blender 便捷别名（向后兼容）

以下函数是通用接口的 Blender 别名，行为完全一致：

```python
find_blender_versions()              # → find_dcc_versions("blender")
install_blender_addon(v, force)      # → install_dcc_addon("blender", v, force)
uninstall_blender_addon(v)           # → uninstall_dcc_addon("blender", v)
is_addon_installed(v)                # → is_dcc_addon_installed("blender", v)
```

## 新增 DCC

在 `_DCC_VERSION_SCAN_PATHS` 和 `_DCC_ADDON_PATH_TEMPLATES` 中添加映射即可：

```python
_DCC_VERSION_SCAN_PATHS["maya"] = os.path.join(
    os.path.expanduser("~"), "Documents", "maya",
)
_DCC_ADDON_PATH_TEMPLATES["maya"] = "{base}/{version}/scripts/"
```

### 安装流程

```
1. find_blender_versions() → 获取已安装版本列表
2. check_version_compatibility(version) → 兼容检查
3. install_blender_addon(version) → copy
   ├─ 自动调用 install_gateway_mcp_bridge()
   └─ 自动 patch openclaw.json
```

### 安装方式

```
copy（物理拷贝，唯一方式，遵循 ADR 0008）
```

## TypeScript API

**包**：`apps/desktop/src/ipc/openclaw.ts`

### `detectBlenderVersions() → Promise<BlenderDetectResult>`

检测本机 Blender 版本及插件安装状态。

```ts
const result = await detectBlenderVersions();
// result.versions → [{ version: "5.1", installed: true, compatible: true, ... }]
// result.addon_info → { name: "Artifex Nexus Bridge", version: "5.0.0", ... }
```

### `installBlenderAddon(version: string, force?: boolean) → Promise<BlenderInstallResult>`

安装插件到指定 Blender 版本。

```ts
const result = await installBlenderAddon("5.1");
// → { success: true, method: "copy", target: "...", error: null }
```

### `uninstallBlenderAddon(version: string) → Promise<BlenderUninstallResult>`

卸载插件。

```ts
const result = await uninstallBlenderAddon("5.1");
// → { success: true, target: "...", error: null }
```

### 类型定义

```ts
interface BlenderVersionInfo {
  version: string;          // "5.1"
  installed: boolean;
  compatible: boolean;
  compat_reason: string;    // "兼容 (5.0.0 ~ 5.1.9)"
}

interface BlenderDetectResult {
  versions: BlenderVersionInfo[];
  addon_info: {
    name: string;
    version: string;        // "5.0.0"
    blender_min: string;    // "5.0.0"
    blender_max: string | null;  // "5.1.9"
  };
}

interface BlenderInstallResult {
  success: boolean;
  method: "copy" | null;
  target: string;
  error: string | null;
}
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
