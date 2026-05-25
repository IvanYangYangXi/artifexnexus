# DCC 检测指南

## 概览

Artifex Nexus 安装向导通过 **Tauri IPC → Python Sidecar** 链自动检测本机已安装的 DCC 软件（Blender / Maya / 3ds Max）。

---

## 检测架构

```
SystemPage.tsx (UI) → ipc.detectXxxVersions() → Tauri invoke → Rust 命令
  → JSON-RPC over stdio → Python sidecar → dcc_installer.py::find_xxx_versions()
```

## 按键约定

| DCC | Sidecar DCC Key | UI Fixture ID | Rust IPC 命令 |
|-----|----------------|---------------|--------------|
| Blender | `blender` | `blender` | `openclaw_dcc_blender_detect` |
| Maya | `maya` | `maya` | `openclaw_dcc_maya_detect` |
| 3ds Max | `3ds_max` | `3ds_max` | `openclaw_dcc_max_detect` |

> **关键规则**：UI 中 fixture ID 必须与代码中 ID 完全一致。ID 用 `3ds_max` 而非 `max`。
> 任何 `it.id === "max"` 都无法匹配 fixture `{ id: "3ds_max" }`，导致 UI 不显示。

---

## Blender 检测

### 检测策略
`%APPDATA%/Blender Foundation/Blender/` 目录扫描。

### 版本格式
`major.minor`（如 `4.3`、`5.1`）

### 安装路径
```
%APPDATA%/Blender Foundation/Blender/{version}/scripts/addons/artifex_nexus_vX.X.X/
```

---

## Maya 检测

### 检测策略（三层，按优先级）

| # | 策略 | 说明 |
|---|------|------|
| 1 | 注册表 | `HKLM\SOFTWARE\Autodesk\Maya\{version}\Setup\InstallPath`，验证 `maya.exe` 存在 |
| 2 | Program Files 扫描 | `C:\Program Files\Autodesk\Maya{version}\bin\maya.exe` |
| 3 | 用户目录回退 | `~/Documents/maya/{version}/` 目录扫描 |

### 版本格式
年份（如 `2023`、`2025`）

### 安装路径
```
~/Documents/maya/{version}/scripts/artifex_nexus/
```
另有 `userSetup.py` 启动脚本 + locale 同步（`zh_CN/scripts/` 等）。

### 与 artclaw 对照
- artclaw 路径：`~/Documents/maya/{version}/scripts/DCCClawBridge`
- artifex 路径：`~/Documents/maya/{version}/scripts/artifex_nexus/`
- **基础目录一致** ✅

---

## 3ds Max 检测

### 检测策略（四层，按优先级）

| # | 策略 | 说明 |
|---|------|------|
| 1 | Autodesk 专用注册表 | `HKLM\SOFTWARE\Autodesk\3dsMax` — **注意**：子键是内部版本号 `25.0` 而非年份 `2023` |
| 2 | Windows 卸载列表 | `Uninstall` 注册表中正则匹配 `3ds Max 20XX` |
| 3 | Program Files 扫描 | `C:\Program Files\Autodesk\3ds Max {version}\3dsmax.exe` |
| 4 | 用户偏好目录回退 | `%LOCALAPPDATA%/Autodesk/3dsMax/{version}/` |

### 注册表内部版本号映射

Autodesk 3ds Max 在 `HKLM\SOFTWARE\Autodesk\3dsMax` 下使用 **内部版本号**：

| 注册表键 | 内部版本 | 对应年份 | 公式 |
|---------|---------|---------|------|
| `23.0` | 23 | 2021 | `1998 + 23` |
| `24.0` | 24 | 2022 | `1998 + 24` |
| `25.0` | 25 | 2023 | `1998 + 25` |
| `26.0` | 26 | 2024 | `1998 + 26` |
| `27.0` | 27 | 2025 | `1998 + 27` |

转换函数 `_max_registry_key_to_year()` 同时支持 `"25.0"` → `2023` 和 `"2023"` → `2023` 双格式。

**验证实际安装**：仅当子键下有 `Installdir` 或 `Location` 值且路径存在时，才计入有效版本。
空键（如 23.0/24.0 无 InstallDir）为残留注册表项，会被过滤。

### 安装路径
```
%LOCALAPPDATA%/Autodesk/3dsMax/{version}/ENU/scripts/artifex_nexus/
```
另有 `startup/artifex_startup.py` + `artifex_startup.ms` 启动脚本 + locale 同步。

### 与 artclaw 对照
- artclaw 路径：`%LOCALAPPDATA%/Autodesk/3dsMax/{version}/ENU/scripts/DCCClawBridge`
- artifex 路径：`%LOCALAPPDATA%/Autodesk/3dsMax/{version}/ENU/scripts/artifex_nexus/`
- **基础目录一致** ✅

artclaw 还额外支持 `{version} - 64bit` 目录格式（新版 Max 偏好目录命名），artifex 暂未实现此行文后续补充。

---

## 常见陷阱

### 1. ID 不一致导致检测结果不显示
fixture 中 `id: "3ds_max"`，但代码中 `it.id === "max"` → 永远匹配不上。
**解决**：统一使用 fixture 中定义的 ID（`3ds_max`）。

### 2. 注册表内部版本号格式（3ds Max 独有）
`"25.0".isdigit()` 返回 `False`（含小数点），原代码直接跳过。
**解决**：`_max_registry_key_to_year()` 处理带点格式。

### 3. 空注册表键（残留项）
部分注册表子键无 `Installdir` 值（如只装了 2023 但有 23.0/24.0 残留键）。
**解决**：通过 `QueryValueEx(ver_key, "Installdir")` 验证。

### 4. Web IPC 模块缺失 Maya/Max 函数
`packages/apps/web/src/ipc/openclaw.ts` 只有 Blender 的 IPC 封装，缺少 Maya/Max 的 TypeScript 类型和函数。Rust 后端已注册命令，但前端壳没调用。
**解决**：在 web 版 IPC 文件补上 `detectMayaVersions` / `detectMaxVersions` 等 6 个函数。
