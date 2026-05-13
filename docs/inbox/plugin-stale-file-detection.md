---
tags: [proposal, install, detect, mcp-bridge, stale-files]
created: 2026-05-13
status: implemented
---

# 插件安装/检测过时文件方案

## 背景

MCP Bridge 插件存在 4 份文件副本，Gateway 实际加载的是 bundled extensions 下的 `index.js`。
如果开发者只改了 `src/index.ts` 而没有手动重新编译，`install_gateway_mcp_bridge()` 拷贝的
就是过时的 `index.js`，导致 bug 修复未生效。

此外，当前检测体系存在多个缺口：`deploy-manifest.json` 从未生成、安装检测只判存在不判内容、
全局校验空跑。

## 现状分析

### 文件四副本

| 文件 | 路径 | Gateway 加载？ |
|------|------|:---:|
| 源码 | `gateway-plugin/src/index.ts` | 否 |
| 根级 JS | `gateway-plugin/index.js` | 否（仅构建产物） |
| dist/ | `gateway-plugin/dist/index.js` | 否 |
| **Bundled** | `~/.artifexnexus/.openclaw/cli/v*/node_modules/openclaw/dist/extensions/mcp-bridge/index.js` | ✅ **是** |

当前 `install_gateway_mcp_bridge()` 用 `shutil.copytree` 整树拷贝，把 `src/`、`node_modules/`、`dist/`
全复制过去。`index.js` 如果未重新编译就是过时的。

### 检测体系缺口

| 检测项 | 当前实现 | 问题 |
|--------|---------|------|
| `is_gateway_mcp_bridge_installed()` | 只检查 `openclaw.plugin.json` 存在 | 不检查 `index.js`，不检查文件是否为最新 |
| `validate_all_deployments()` | 遍历 `deploy-manifest.json` 逐文件 SHA-256 | manifest 文件从未生成 → 永远返回空列表 |
| `openclaw.gateway.mcp_bridge.status` | 返回 `installed` + Blender 连通性 | 无 `upToDate` / `stale` 字段 |
| 全局部署校验 RPC | `openclaw.deploy.validate` → `validate_all_deployments()` | 空跑 |
| DCC 检测 RPC | `openclaw.dcc.blender.detect` 只判 `installed` | 不判是否过时 |

### 构建工具可用性

| 工具 | 用户环境 | 说明 |
|------|---------|------|
| Node.js | ✅ v24.13.1 | 用户已安装 |
| tsc (TypeScript) | ✅ v5.9.3 | 通过 npx 可用 |
| esbuild | ❌ 未安装 | 全局 npm 为空，项目无 esbuild 依赖 |
| npm | ✅ | 但全局无包 |

## 设计决策

### 决策 1：构建不在安装阶段做

**理由**：

1. **其他安装功能均不做构建**：`install_openclaw()`（下载）、`install_dcc_addon()`（拷贝）、
   `bootstrap()`（写配置）都不构建任何东西，统一依赖预构建产物。
2. **用户环境不保证有构建工具**：esbuild 未安装，tsc 虽可用但无 bundling 能力。
3. **项目规范**（`00-architecture.md` §10）要求"优先使用高层语言"（TS/Python > Rust），
   但构建属于 monorepo 基础设施，应在仓库侧完成。
4. **`dcc-plugin-management.md` §7.5** 已将"编译"和"拷贝"分为两步：
   > 编译：esbuild CJS bundle → `index.js`
   > 方式：物理拷贝

   **构建应在 monorepo 侧做**（通过 `package.json` 的 `build` script），
   `install_gateway_mcp_bridge()` 只负责把 **已构建好的** `index.js` 拷贝到 bundled 目录。

### 决策 2：以 `index.js` SHA-256 作为过时判断依据

不使用 `package.json` 的 `version` 字段（因为修 bug 不一定会 bump 版本），
改用 **源码 `index.js` vs 部署 `index.js` 的 SHA-256 对比**。

### 决策 3：bootstrap 时自动创建 deploy-manifest

`bootstrap()` 完成后调用 `install_gateway_mcp_bridge()` → 自动生成 `deploy-manifest.json`。
这样 `validate_all_deployments()` 立即可用。

---

## 改动方案

### A. `dcc_installer.py` — 安装函数改造

#### A1. `install_gateway_mcp_bridge()` 只拷贝必要文件

```python
# 改造前：shutil.copytree(src_dir, target_dir)  # 整树拷贝
# 改造后：只拷贝 Gateway 实际需要的文件
REQUIRED_FILES = ["index.js", "openclaw.plugin.json"]
for fname in REQUIRED_FILES:
    src = os.path.join(src_dir, fname)
    tgt = os.path.join(target_dir, fname)
    if os.path.isfile(src):
        shutil.copy2(src, tgt)
```

#### A2. 拷贝前校验 `index.js` 存在

```python
index_js = os.path.join(src_dir, "index.js")
if not os.path.isfile(index_js):
    return {
        "success": False,
        "error": f"index.js 未构建，请先运行 `pnpm build` 或手动编译"
    }
```

### B. `dcc_installer.py` — 新增过时检测函数

#### B1. `check_mcp_bridge_freshness()`

```python
def check_mcp_bridge_freshness() -> Dict:
    """对比源码 index.js 与部署 index.js 的 SHA-256。
    
    Returns:
        {
            "upToDate": bool,
            "sourceHash": str | None,      # 源码 index.js 的 SHA-256
            "deployedHash": str | None,    # 部署 index.js 的 SHA-256
            "error": str | None,
        }
    """
```

#### B2. `is_gateway_mcp_bridge_installed()` 加强

```python
def is_gateway_mcp_bridge_installed() -> bool:
    """检查 mcp-bridge 插件是否已正确部署。
    
    条件：openclaw.plugin.json 存在 + index.js 存在 + 大小 > 0
    """
    target_dir = _get_openclaw_plugins_dir() / "mcp-bridge"
    manifest = target_dir / "openclaw.plugin.json"
    index_js = target_dir / "index.js"
    return manifest.exists() and index_js.exists() and index_js.stat().st_size > 0
```

### C. `sidecar.py` — RPC 扩展

#### C1. `openclaw.gateway.mcp_bridge.status` 增加 `upToDate` 字段

```python
# 现有返回：
#   {"installed": bool, "blenderConnected": bool, ...}
# 新增：
#   {"upToDate": bool, "sourceHash": str|null, "deployedHash": str|null}
```

#### C2. 新增 `openclaw.deploy.repair` RPC（可选）

一键重装过时插件：`install_gateway_mcp_bridge()` + registry refresh。

### D. `bootstrap.py` — 启动时自动部署

```python
# bootstrap() 末尾，在 _try_install_default_agent_preset() 之后：
try:
    from . import dcc_installer as _dcc
    result = _dcc.install_gateway_mcp_bridge()
    if result["success"]:
        logger.info("bootstrap: mcp-bridge 插件已自动部署")
except Exception:
    logger.warning("bootstrap: mcp-bridge 自动部署失败（不影响启动）", exc_info=True)
```

这样首次 bootstrap 就会生成 `deploy-manifest.json`，后续 `validate_all_deployments()`
能正常工作。

---

## 关于 Gateway 日志中的 ERROR 级别

用户观察到：

```
15:37:53 INFO  [mcp-bridge] Registered tool: mcp_blender-editor_run_python
15:37:53 ERROR [mcp-bridge] Pre-registration complete: 1 registered, 0 failed
```

源码中两行都使用 `logger.info`，三份 `index.js`（根级/dist/bundled）的 SHA-256 一致，
确认代码无误。`Pre-registration complete` 被标为 ERROR 可能是：

1. **Gateway 仍在运行旧版**：重启 Gateway 后应恢复正常级别
2. **OpenClaw Gateway 日志渲染问题**：`[mcp-bridge]` 前缀可能触发特定规则
3. **Gateway 内部将 plugin logger 的输出统一标记为 ERROR**

建议：重启 Gateway 验证，如果仍为 ERROR 则排查 OpenClaw 上游 logger 行为。

---

## 合规范自检

根据 `.ai/rules/` 规范：

- [x] **SDK/API 审查**（30-agent-behavior §2.1）：`check_mcp_bridge_freshness()` 是通用检测函数，
  后续 Maya/Max/UE 的 gateway plugin 可复用。先放在 `dcc_installer.py` 内，M7 接入第二个 DCC
  时提取到 `sdk/` 目录。
- [x] **单一源**（20-docs-workflow）：部署的唯一入口是 `install_gateway_mcp_bridge()`，
  不存在多个函数做同样的事。
- [x] **构建不属于安装**（00-architecture §10 + dcc-plugin-management §7.5）：
  构建在 monorepo 侧完成，安装只拷贝预构建产物。
- [x] **改动最小化**（30-agent-behavior §3）：不改 Blender addon 安装逻辑，不改端口管理，
  不改 config patch 逻辑。只改 gateway mcp-bridge 相关函数。
- [x] **物理拷贝**（00-architecture §6 + ADR 0008）：保持 `shutil.copy2`，不引入 junction/symlink。
- [x] **文档-代码交叉引用**（30-agent-behavior §4）：本文档需注册到 `docs/inbox/`，
  ADR 不新建（属 ADR 0008 的细化实现，非新决策）。

---

## 相关

- `[[./context-handoff-copy-model-and-validation]]` — 实施手册
- `[[../decisions/0008-copy-model-deploy-manifest]]` — ADR 0008
- `[[../specs/dcc-plugin-management]]` — DCC 插件管理规范
