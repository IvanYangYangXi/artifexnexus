---
id: STORY-0030
kind: story
title: 安装向导"检测"按钮增加部署文件校验
status: backlog
priority: P2
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-09
parent: "[[EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "apps/desktop/src"
  - "packages/adapters/openclaw/wrapper"
tags: [story, deploy, validation, checksum, detector, M2]
---

# STORY-0030 · 安装向导"检测"按钮增加部署文件校验

## 用户故事
作为用户，点击安装向导中的"检测"按钮时，不仅能看到 DCC 版本的安装状态，还能知道已安装的插件文件是否完整、是否被篡改、是否有新版本可更新。

## 背景
- 后端已完成：`dcc_installer.py::validate_all_deployments()` + sidecar RPC `openclaw.deploy.validate`（见 `STORY-0028` 部署实录）
- 每次安装时自动在 `~/.artifexnexus/.openclaw/state/deploy-manifest.json` 记录文件 sha256 校验和
- 当前前端"检测"按钮只检查目录是否存在（`is_dcc_addon_installed()`），不做文件完整性校验

## 验收标准
- [ ] 新建 `openclaw_deploy_validate` Tauri 命令（Rust），调用 sidecar RPC `openclaw.deploy.validate`
- [ ] 新建前端 IPC 函数 `validateDeployments()`，返回 `DeployValidationResult[]`
- [ ] `InstallItemRow.tsx` 的 DCC 父行"检测"流程末尾调用 `validateDeployments()`，结果推到日志面板
- [ ] `InstallChildRow.tsx` 的子行"检测"流程同样增加校验调用
- [ ] 校验结果摘要显示在日志面板：`ok N / outdated N / corrupted N / missing N`
- [ ] "检测"按钮文案不变，校验为追加行为（不替代现有安装状态检测）

## 技术要点

### 1. 新增 Tauri 命令（`apps/desktop/src-tauri/src/commands/openclaw.rs`）
```rust
#[tauri::command]
pub async fn openclaw_deploy_validate(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("openclaw.deploy.validate", json!({}))
}
```
注册到 `lib.rs` 的 `generate_handler![]` 列表。

### 2. 注册 Tauri invoke 权限（`apps/desktop/src-tauri/capabilities/default.json`）

### 3. 新增前端 IPC 函数（`apps/desktop/src/ipc/openclaw.ts`）
```ts
export interface DeployValidationItem {
  id: string;
  status: "ok" | "outdated" | "missing" | "corrupted";
  target: string;
  sourceVersion: string;
  currentVersion?: string;
  deployedAt: string;
  details: string;
  missing_files?: string[];
  corrupted_files?: string[];
}

export interface DeployValidationResult {
  deployments: DeployValidationItem[];
  summary: {
    total: number;
    ok: number;
    outdated: number;
    missing: number;
    corrupted: number;
  };
}

export async function validateDeployments(): Promise<DeployValidationResult> {
  return invoke<DeployValidationResult>("openclaw_deploy_validate");
}
```

### 4. 前端检测流程集成（`InstallItemRow.tsx` + `InstallChildRow.tsx`）

在现有 `handleDetect` 末尾追加：

```ts
// 部署文件校验（追加到现有检测流程末尾）
try {
  const validation = await validateDeployments();
  const { summary } = validation;
  if (summary.total > 0) {
    const parts: string[] = [];
    if (summary.ok > 0) parts.push(`✅ ${summary.ok} 正常`);
    if (summary.outdated > 0) parts.push(`🔄 ${summary.outdated} 可更新`);
    if (summary.corrupted > 0) parts.push(`⚠️ ${summary.corrupted} 损坏`);
    if (summary.missing > 0) parts.push(`❌ ${summary.missing} 缺失`);
    addLog(item.id, "info", `部署校验: ${parts.join(" · ")}`);
    // 异常项逐条输出
    for (const dep of validation.deployments) {
      if (dep.status !== "ok") {
        addLog(item.id, "warn", `  ${dep.id}: ${dep.status} — ${dep.details}`);
      }
    }
  }
} catch {
  // 静默：校验失败不阻断检测流程
}
```

## 依赖
- ← [[../review/STORY-0028-gateway-mcp-bridge]]（后端 RPC `openclaw.deploy.validate` 已就绪）
- ← [[../review/STORY-0026-dcc-installer-blender]]（`validate_all_deployments()` 已实现）

## 非范围
- 不实现自动修复（corrupted → 一键重装 留到 M4）
- 不实现定时轮询校验
- 不实现通知/弹窗提醒
