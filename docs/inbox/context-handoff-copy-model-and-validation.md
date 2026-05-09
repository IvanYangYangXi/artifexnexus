---
tags: [context, handoff, install, deploy, M2]
created: 2026-05-09
status: accepted
---

# Context Handoff: 统一 Copy 安装模型 + 全局文件校验

> 本文件用于新对话 context 注入。涵盖 2026-05-09 跑通的部署方案及后续改进方向。

## 1. 背景：本次跑通了什么

### 完整链路
```
Blender 5.1 (addon 启用 → 自动启动 MCP Server @ ws://127.0.0.1:18083)
    ↕ WebSocket (MCP JSON-RPC)
OpenClaw Gateway (mcp-bridge 插件 → 注册 mcp_blender-editor_run_python 工具)
    ↕
AI Agent 可调用 Blender 操作
```

### 关键发现（OpenClaw v2026.5.4 部署铁律）

1. **Gateway 插件必须物理拷贝到 `dist/extensions/`**
   - 路径：`~/.artifexnexus/.openclaw/cli/v2026.5.4/node_modules/openclaw/dist/extensions/mcp-bridge/`
   - 原因：OpenClaw discovery 会 `fs.realpathSync()` 解析路径，NTFS junction 的 realpath 指向源码盘，被 trusted-root 安全检查拒绝
   - `OPENCLAW_BUNDLED_PLUGINS_DIR` env 同样被 trust 逻辑拒绝（不在 packageRoot 的 trusted 子目录列表中）

2. **`openclaw.plugin.json` 必须含 `activation` 字段**
   - 没有 `"activation": {"onStartup": true}` 的插件不会在 Gateway HTTP server 启动阶段加载
   - 即使 `plugins list` 显示 enabled，Gateway runtime 也会静默跳过

3. **配置路径必须通过 env 读取**
   - 隔离环境 `OPENCLAW_HOME=~/.artifexnexus/.openclaw/`
   - 插件代码中应使用 `process.env.OPENCLAW_CONFIG_PATH || OPENCLAW_HOME + "/openclaw.json"`

4. **Blender addon 目录名不能含点号**
   - Python import 系统将 `.` 视为子模块分隔符
   - 固定使用 `artifex_nexus`（不带版本号）
   - addon 目录即 `blender_addon/`（含 `__init__.py` + `bl_info`），不是其父目录

5. **子模块不能用相对导入**
   - 因为 addon 目录通过 `sys.path.insert` 加入搜索路径后直接 import
   - `from .base_adapter import ...` → `from base_adapter import ...`

6. **`contracts.tools` 必须预声明工具名（v2026.5.4 新增）**
   - `openclaw.plugin.json` 中 `contracts.tools: []`（空数组）= 静默拒绝所有 `registerTool()` 调用
   - 必须精确列出工具名，不支持通配符（内部使用 `Set.has()` 精确匹配）
   - 示例：`"contracts": {"tools": ["mcp_blender-editor_run_python", "mcp_blender-editor_get_context"]}`

7. **插件入口函数必须同步（v2026.5.4 的 `runPluginRegisterSync` 铁律）**
   - `async function(api)` → 直接 throw `"plugin register must be synchronous"`
   - `guarded.close()` 在 register 返回后立即执行，之后的 `registerTool()` 全部无效
   - 正确模式：同步 `function(api)` + 预注册静态工具定义 + 后台异步连接

8. **不能使用 Agent 的 `tools.allow` 排他性过滤**
   - `agents.list[].tools.allow` 是排他白名单，匹配 0 个工具时直接报错 `No callable tools remain`
   - 由于工具注册与 session 创建存在时序竞态，应完全移除 `tools` 字段

9. **注册表缓存必须手动刷新**
   - 修改 `openclaw.plugin.json` 后必须执行 `openclaw plugins registry --refresh`
   - 否则 Gateway 使用旧 `manifestHash` 对应的 contracts → 新声明的工具仍被拒绝

10. **`gateway.port` 必须与实际启动端口一致**
    - `openclaw.json` 中 `gateway.port` 值被 `openclaw dashboard` 等命令用于生成 Web UI URL
    - Tauri app 用 `--port 19789` 覆盖实际端口时，配置文件也要同步更新

---

## 2. 当前状态（改动总览）

### 已改的文件
| 文件 | 改了什么 |
|------|---------|
| `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/__init__.py` | 修复导入；addon 启用自动启动 MCP Server |
| `packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/blender_adapter.py` | 相对导入 → 绝对导入 |
| `packages/adapters/openclaw/gateway-plugin/openclaw.plugin.json` | 添加 activation + contracts.tools 精确工具名声明 |
| `packages/adapters/openclaw/gateway-plugin/src/index.ts` | 配置路径用 env；改为同步入口 + 预注册静态工具定义 + 后台异步连接 |
| `packages/adapters/openclaw/gateway-plugin/index.js` | 同上（esbuild CJS bundle 编译产物） |
| `packages/adapters/openclaw/wrapper/.../dcc_installer.py` | junction→copy；目录名去版本号；src 指向 blender_addon/；新增 registry refresh |
| `packages/adapters/openclaw/wrapper/.../assets/agents/artifex-nexus.preset.json.tpl` | 移除 `tools.allow` 排他性过滤 |
| `apps/desktop/src-tauri/src/fs_layout.rs` | test 断言数量 5→7 |
| `apps/desktop/src/features/installer/InstallItemRow.tsx` | mcp-bridge 安装后自动 restartGateway |
| `apps/desktop/src/features/installer/InstallChildRow.tsx` | 同上 |
| `docs/tasks/review/STORY-0028-gateway-mcp-bridge.md` | 添加部署实录 |
| `docs/tasks/review/STORY-0021-blender-addon-scaffold.md` | 添加部署实录 |

### 运行时部署状态
| 位置 | 当前状态 |
|------|---------|
| `C:\...\dist\extensions\mcp-bridge\` | 物理目录（xcopy 复制） |
| `%APPDATA%\Blender\5.1\scripts\addons\artifex_nexus\` | junction → `blender_addon/` |
| `~/.artifexnexus/.openclaw/extensions/` | 空目录（旧 junction 已删） |
| `installs.json` 中 mcp-bridge | 路径指向 C 盘 dist（正确） |

---

## 3. 待做：统一 Copy 模型 + 全局校验

> **状态（2026-05-09）**：代码已全部迁移为 copy 模式 + manifest 校验。见下方实施记录。

### 3.1 改动范围

需要将 **所有** 安装部署从 junction/symlink 改为 copy：

| 部署目标 | 当前方式 | 改为 | 状态 |
|---------|---------|------|------|
| Gateway mcp-bridge → dist/extensions/ | ✅ 已改为 copy | 保持 | ✅ 已完成 |
| Blender addon → AppData/.../addons/ | junction | **改为 copy** | ✅ 已完成 |
| (M4) Maya plugin | 未实现 | copy | 🔜 M4 |
| (M4) Max plugin | 未实现 | copy | 🔜 M4 |

### 3.1.1 实施记录（2026-05-09）

**代码清理**：
- 删除 `_link_or_copy_dir()` 废弃函数（dcc_installer.py）
- 删除 `_try_junction()` / `_try_symlink_dir()` 废弃函数
- 保留 `_is_junction_or_symlink()` / `_remove_link_or_dir()` 用于旧安装迁移清理
- `install_dcc_addon()` / `install_gateway_mcp_bridge()` 均直接使用 `shutil.copytree()`

**校验机制**：
- 新增 `deploy-manifest.json` 部署清单（路径：`OPENCLAW_HOME/state/deploy-manifest.json`）
- 新增 `validate_all_deployments()` 全局校验函数 → 返回 `{id, status: ok/outdated/missing/corrupted}`
- 安装时自动记录 manifest（`_record_deployment()`），卸载时自动移除（`_remove_from_manifest()`）
- 校验对比 sha256 + 版本号，支持 outdated 检测
- 新增 RPC 入口 `openclaw.deploy.validate`（sidecar.py METHOD_TABLE）

**测试**：
- 修复 3 个旧测试（`test_get_addon_dir_name` / `test_install_force_incompatible` / 删除 `test_link_or_copy_dir_fallback`）
- 新增 8 个 manifest 校验测试（`TestDeployManifest` 类，28 测试全绿）

### 3.2 全局文件校验机制设计（建议）

```
~/.artifexnexus/state/deploy-manifest.json
```

Schema:
```json
{
  "version": 1,
  "deployments": [
    {
      "id": "gateway-mcp-bridge",
      "source": "packages/adapters/openclaw/gateway-plugin",
      "target": "C:\\...\\dist\\extensions\\mcp-bridge",
      "method": "copy",
      "files": [
        {"path": "index.js", "sha256": "abc123...", "size": 15983},
        {"path": "openclaw.plugin.json", "sha256": "def456...", "size": 612},
        {"path": "package.json", "sha256": "789ghi...", "size": 252}
      ],
      "deployedAt": "2026-05-09T13:16:00Z",
      "sourceVersion": "5.0.0"
    },
    {
      "id": "blender-addon-5.1",
      "source": "packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon",
      "target": "C:\\...\\Blender\\5.1\\scripts\\addons\\artifex_nexus",
      "method": "copy",
      "files": [
        {"path": "__init__.py", "sha256": "...", "size": 8062},
        {"path": "mcp_server.py", "sha256": "...", "size": ...},
        ...
      ],
      "deployedAt": "2026-05-09T13:36:00Z",
      "sourceVersion": "5.0.0"
    }
  ]
}
```

### 3.3 校验流程

1. **安装时**：遍历 src 所有文件，计算 sha256 + size → 写入 manifest
2. **全局检测时**（`openclaw.doctor` 或 Tauri 状态页"检测"按钮）：
   - 遍历 manifest 中每个 deployment
   - 对比 target 中文件的 sha256 与 manifest 是否一致
   - 返回 `{id, status: "ok" | "outdated" | "missing" | "corrupted"}`
3. **重装/更新**：删除 target → 重新 copy → 更新 manifest
   - "重装" ≡ "更新"（同一逻辑，只是 UI 措辞不同）
4. **版本比较**：`manifest.sourceVersion` vs 当前源码 `bl_info.version` / `package.json.version`
   - 不一致 → 提示"有新版本可更新"

### 3.4 需要更新的 spec 文档

- `docs/specs/openclaw-wrapper-runtime.md` — 安装策略段落
- `docs/specs/dcc-plugin-install.md`（如存在）— 部署方式
- `docs/decisions/` — 新建 ADR："从 junction 迁移到 copy + manifest 校验"
- `.ai/rules/00-architecture.md` 第 6 节 "安装与引用规则" — 更新描述

### 3.5 `_link_or_copy_dir` 函数处理

保留该函数但标记 deprecated？或直接删除？建议：
- 删除 junction/symlink 分支
- 重命名为 `_copy_dir_with_manifest(src, dst, deployment_id)` → 同时生成校验记录

---

## 4. 相关代码入口（快速定位）

| 功能 | 文件 | 关键函数/行 |
|------|------|------------|
| Gateway 插件安装 | `dcc_installer.py:643` | `install_gateway_mcp_bridge()` |
| Blender 安装 | `dcc_installer.py:171` | `install_dcc_addon()` |
| 安装方式选择 | `dcc_installer.py:558` | `_link_or_copy_dir()` |
| OpenClaw plugins 目录定位 | `dcc_installer.py:624` | `_get_openclaw_plugins_dir()` |
| Blender addon 源码定位 | `dcc_installer.py:55` | `_get_addon_src_dir()` |
| 注册表刷新 | `dcc_installer.py:783` | `_refresh_plugin_registry()` |
| 前端安装按钮 | `InstallItemRow.tsx:352` | `doInstall()` |
| 前端子行安装 | `InstallChildRow.tsx:145` | `handleChildInstall()` |
| sidecar RPC 入口 | `sidecar.py:793` | `_handle_openclaw_gateway_mcp_bridge_install()` |
| sidecar Blender RPC | `sidecar.py:725` | `_handle_openclaw_dcc_blender_install()` |
| bootstrap 配置生成 | `bootstrap.py:145` | `_build_default_config()` |

---

## 5. 项目规范提醒

- 改架构先改 docs（`.ai/rules/00-architecture.md` 第 6 节）
- ADR 模板在 `docs/templates/adr.md`
- 代码注释中文，公共 API docstring 中英双语
- Python：ruff line-length=100
- 文件不超过 500 行（黄金区 100-300）
- 改 `apps/` 必须跑 `pnpm tauri build` 出包验证
