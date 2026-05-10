---
tags: [analysis, M3, desktop, migration]
created: 2026-05-11
status: draft
---

# Desktop 模块逻辑分析 — 复刻到 Web UI 的参考文档

> 分析 `apps/desktop/src` 中系统模块和设置模块的完整逻辑，作为复刻到 `packages/apps/web` 的依据。

## 1. 系统模块（安装向导）

### 1.1 文件结构

```
apps/desktop/src/
├── routes/InstallerWizard.tsx          # 页面容器：状态机 + Context + 全局检测
├── features/installer/
│   ├── installer.types.ts             # InstallItem / InstallChildItem 类型
│   ├── installer.fixtures.ts          # FIXTURE_ITEMS 7行桩数据
│   ├── installer.i18n.ts              # 中文文案
│   ├── InstallList.tsx                # 列表容器（遍历 items）
│   ├── InstallItemRow.tsx             # 单行：图标+名称+状态+按钮+子项展开
│   ├── InstallChildRow.tsx            # 子项行：版本+路径+检测/设置/安装/删除
│   ├── StatusBadge.tsx                # 状态徽章组件
│   ├── LogPanel.tsx                   # 日志面板（可折叠+自动滚动+级别颜色）
│   ├── ReinstallConfirmDialog.tsx     # 重装确认弹窗
│   └── dccRegistry.ts                 # DCC 操作注册表（detect/install/uninstall）
```

### 1.2 状态机（InstallerWizard.tsx）

**InstallerState**:
```ts
{ items: InstallItem[]; logs: LogEntry[] }
```

**InstallerAction** (useReducer):
- SET_ITEMS / UPDATE_ITEM / DETECT / INSTALL_START / INSTALL_DONE / INSTALL_FAIL
- DETECT_CHILD / INSTALL_CHILD_START / INSTALL_CHILD_DONE / INSTALL_CHILD_FAIL
- UPDATE_CHILD / ADD_CHILD / DELETE_CHILD
- ADD_LOG / CLEAR_LOGS

**InstallerContext**: `{ state, dispatch, addLog }`

**依赖门禁**:
- `isOpenClawInstalled(items)`: OpenClaw state === "installed"
- `isInstallGated(item, items)`: 非 OpenClaw 行需 OpenClaw 已安装

### 1.3 安装清单（7行）

| id | name | expandable | 特殊逻辑 |
|----|------|-----------|---------|
| openclaw | OpenClaw | false | 真实安装链(install→bootstrap→start) + Web UI按钮 + 设置面板modal |
| web-ui | Web UI | false | pending状态，依赖OpenClaw |
| blender | Blender | true | DCC检测(真实API) + 子项安装 + mcp-bridge自动部署 |
| unreal | Unreal Engine | true | 添加子项时输入工程路径 |
| max | 3ds Max | true | 添加子项时输入版本号→自动计算路径 |
| maya | Maya | true | 同上 |
| comfyui | ComfyUI | true | comingSoon=true，固定unavailable |

### 1.4 InstallItemRow 按钮逻辑

**非 expandable 行（OpenClaw/Web UI）**:
- [检测] [设置] [Web UI(仅OpenClaw)] [安装/重装/重试]

**expandable 行（DCC）**:
- [检测] [安装/重装/重试] [添加] [设置]

**安装链（OpenClaw）**:
1. installOpenClaw("v2026.5.4") → 进度事件推日志
2. stopOpenClaw()（重装时先停旧Gateway）
3. bootstrapOpenClaw("v2026.5.4", preserveOpts)
4. startOpenClaw(port)
5. INSTALL_DONE → 自动同步 gatewayRunning/webUiAvailable

**安装链（DCC）**:
1. 检查 mcp-bridge 插件状态 → 未安装则自动部署 + 重启Gateway
2. 遍历 children，逐个 install(child.version)
3. 汇总结果 → INSTALL_DONE 或 INSTALL_FAIL

### 1.5 检测逻辑

**OpenClaw**: `getOpenClawStatus()` → gateway_running/cli_installed/version_mismatch
**DCC**: `dccActions.detect()` → 返回版本列表 + 兼容性 + addon_info
**其他**: `simulateDetect()` 随机桩

### 1.6 日志面板

- 可折叠，自动滚动到底
- 级别颜色：info(蓝) / warn(黄) / error(红)
- 保留最后200行
- 清空按钮

---

## 2. Gateway 状态面板

### 2.1 GatewayStatusCard.tsx

**Props**: `{ status: GatewayStatus | null; onAfterAction: () => Promise<void> }`

**状态显示**:
- running → 绿点 + "运行中" + PID/端口/启动时间
- stopped → 灰点 + "未运行"
- errored → 红点 + "异常" + last_error横幅

**按钮**:
- [▶ 启动 Gateway] / [↻ 重启 Gateway]（根据状态切换）
- [🌐 OpenClaw Web UI]（仅running时可点）
- [🚀 Artifex Nexus Web UI]（永远disabled，M3实装）

**操作**:
- startGateway() / restartGateway() → onAfterAction() 刷新状态
- openOpenClawWebUi() → 系统浏览器打开

### 2.2 useGatewayPolling.ts

轮询 Gateway 状态（3s间隔），running时拉取。

---

## 3. 设置模块

### 3.1 SettingsPanel.tsx

**结构**: Modal外壳 + 三Tab + 加载/保存/二次确认

**Tab**:
- ProvidersTab: 模型提供商管理
- AuthProfilesTab: 认证配置（高级模式）
- DefaultAgentTab: Agent预设

**状态管理**: useReducer + settingsReducer
- LOAD_START / LOAD_SUCCESS / LOAD_ERROR
- 各种字段修改 action
- buildPatchFromState() → patchOpenClawConfig()

**数据流**:
1. 打开 → dumpOpenClawConfig() → LOAD_SUCCESS
2. 修改 → dispatch field actions
3. 保存 → buildPatchFromState() → patchOpenClawConfig()
4. 关闭 → 检测 dirty → 二次确认

### 3.2 ProvidersTab.tsx

**功能**:
- 左侧 Provider 列表（可选中）
- 右侧详情：名称/Protocol/Base URL/API Key/模型列表
- 模板 picker（OpenAI/DeepSeek/Anthropic/...）
- 高级折叠：自定义headers/timeout/maxTokens
- 测试连接按钮
- 获取远程模型列表按钮
- 内联 Auth section

### 3.3 AuthProfilesTab.tsx

**功能**:
- 认证配置列表（名称/类型/API Key）
- 添加/删除/编辑

### 3.4 DefaultAgentTab.tsx

**功能**:
- Agent预设选择
- 系统提示词编辑
- 保存/重置为默认

---

## 4. 复刻策略

### 4.1 可复用的逻辑

| 模块 | 复用方式 |
|------|---------|
| installer.types.ts | 直接复制类型定义 |
| installer.fixtures.ts | 直接复制桩数据 |
| installer.i18n.ts | 直接复制文案 |
| dccRegistry.ts | 直接复制（IPC调用通过 window.__TAURI__） |
| InstallerWizard reducer | 直接复制 useReducer 逻辑 |
| GatewayStatusCard 逻辑 | 复制状态判断+按钮行为 |
| SettingsPanel reducer | 复制 settingsReducer |

### 4.2 需要适配的部分

| 模块 | 适配 |
|------|------|
| IPC 调用 | `invoke()` → `window.__TAURI__.invoke()` |
| CSS Modules | → Tailwind CSS（StyleE 玻璃风格） |
| InstallItemRow 渲染 | 保持逻辑，换 Tailwind 样式 |
| LogPanel | 保持逻辑，换 Tailwind 样式 |
| SettingsPanel Modal | → 内嵌页面（非弹窗） |

### 4.3 不可用的功能（Web UI 限制）

- `window.prompt()` 添加子项 → 改用内联输入框
- `openExternal()` 打开浏览器 → 通过 Tauri shell
- CSS Module 样式 → 全部换 Tailwind
