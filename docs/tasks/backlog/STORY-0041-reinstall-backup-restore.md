# STORY-0041: OpenClaw 重装流程重构（备份-全新安装-恢复）

## 背景

当前重装流程使用"就地合并"策略（`_apply_preserve_options`），存在以下问题：

1. **路径漂移**：OpenClaw v2026.5.4 把 agent state 从 `state/agents/` 迁移到 `.openclaw/agents/`，但保留逻辑只保留了 `openclaw.json` 中的元数据，凭证文件（`auth-profiles.json`）留在旧路径
2. **残留污染**：旧版本的 rejected config、.bak 文件、漂移端口配置等残留在目录中
3. **缺少记忆保留**：memory-core 的 SQLite 数据和梦境文件没有保留选项

## 设计：三阶段重装

```
Phase 1: BACKUP → Phase 2: CLEAN INSTALL → Phase 3: RESTORE
```

### Phase 1: BACKUP

备份目标：`~/.artifexnexus/.reinstall-backup/`（不在 `.openclaw/` 内，不会被清理影响）

按勾选项收集：

| 保留项 | 备份的数据源 |
|--------|-------------|
| 供应商 (Providers) | `openclaw.json` → `models.providers` 片段 |
| API 凭据 (Auth) | `openclaw.json` → `auth.profiles` + `auth.order` 片段 **+** `.openclaw/agents/*/agent/auth-profiles.json` **+** `state/agents/*/agent/auth-profiles.json`（兼容旧路径） |
| Agent 配置 | `openclaw.json` → `agents.defaults` + `agents.list` 片段 |
| 插件配置 | `openclaw.json` → `plugins.entries` 片段 |
| 记忆 (Memory) | `state/memory/*.sqlite` + `workspace/memory/`（梦境） |

输出：`backup-manifest.json`（记录每个备份文件的来源、目标路径、时间戳）

### Phase 2: CLEAN INSTALL

1. 停止 Gateway
2. 彻底删除 `.openclaw/` 目录内容（保留 `cli/` 和 `.reinstall-backup/`）
3. 重新 `bootstrap()`（生成全新 openclaw.json + 目录结构）

### Phase 3: RESTORE

按 `backup-manifest.json` 逐项恢复到新版本**正确的路径**：

- providers/auth → `openclaw config patch` 写入新 `openclaw.json`
- `auth-profiles.json` → 写入 `.openclaw/agents/<id>/agent/`（新路径）
- memory SQLite → 写入 `state/memory/` 或 `.openclaw/memory/`
- `workspace/memory/` → 原位复制回去
- 验证（`openclaw doctor --json`）
- 成功后删除 `.reinstall-backup/`
- 重启 Gateway

### 新增 UI 勾选项

```
[x] 供应商配置（Provider）    — baseUrl、协议、模型列表
[x] API 凭据（Auth）         — API Key / Token
[ ] Agent 配置               — Agent 预设、system prompt
[ ] 插件配置                 — MCP Bridge、Browser 等
[x] 记忆（Memory）           — AI 长期记忆、梦境整理数据  ← 新增
```

## 数据布局参考（v2026.5.4 实测）

```
~/.artifexnexus/.openclaw/
├── openclaw.json                              # 主配置
├── .openclaw/                                 # CLI 运行时状态（v2026.5.4 新）
│   ├── agents/<id>/agent/auth-profiles.json   # 凭证文件（新路径）
│   ├── identity/device.json
│   └── logs/
├── state/                                     # 旧版运行时状态
│   ├── agents/<id>/agent/auth-profiles.json   # 凭证文件（旧路径，可能被新版忽略）
│   ├── agents/<id>/sessions/                  # 会话历史
│   ├── memory/<agent>.sqlite                  # memory-core SQLite
│   └── plugin-skills/
├── workspace/
│   ├── memory/.dreams/                        # 梦境系统（session-corpus/）
│   ├── memory/dreaming/{deep,light,rem}/      # 梦境整理 markdown
│   └── skills/{official,team,user}/           # 用户技能
└── cli/v2026.5.4/                             # CLI 安装（不清理）
```

## 涉及文件

- `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py` — 重构 `bootstrap()` + 新增 `backup_for_reinstall()` / `restore_from_backup()`
- `packages/apps/web/src/components/settings/` — 重装 UI 增加"记忆"勾选项
- `packages/apps/web/src/ipc/openclaw.ts` — 新增 backup/restore IPC
- `apps/desktop/src-tauri/src/commands/` — 新增对应 Tauri 命令

## 优先级

M3 后期 / M4 前期。当前已通过手动复制 `auth-profiles.json` 到新路径临时解决。

## 附加问题（同 STORY 一起解决）

### A. 对话反应延迟 ~85s（Pi 运行时会话唤醒问题）

**症状**：每条消息从发送到首次 thinking 开始要 75-85 秒。后续 LLM 推理只需 6-14 秒。

**根因**：Agent 配置了 `agentRuntime: { id: "pi" }`，但没有显式设置 heartbeat 间隔。Pi 运行时在会话空闲后进入低功耗轮询模式，新消息需要等待一个轮询周期才被拾取。

**延迟分解**：
```
85 秒总延迟
├── ~75-78s → 会话唤醒 / 通道路由 / 上下文准备（首次 LLM 调用前）
├── ~14s   → 首轮 reasoning/thinking（LLM 推理）
├── ~7s    → 后续工具调用 + thinking
```

**修复方案**：在 `openclaw.json` 的 `agents.defaults` 或 agent 配置中缩短心跳间隔：
```json
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "15 seconds"
      }
    }
  }
}
```

**补充发现**（2026-05-12 00:47）：实际延迟 ~10s 更可能是 **Control UI 设备认证超时回退** 导致：
- 客户端发 `connect` RPC 时未传 `device` 字段
- Gateway `dangerouslyDisableDeviceAuth: true` 跳过了 device auth
- 但客户端/Gateway 内部可能仍有 10s 超时回退逻辑
- 修复方向：connect params 中传 `device: null` 告知 Gateway 无需 device auth
- 已在 `gateway-ws.ts` 中加入 `device: null`，待验证是否消除延迟

### B. 模型/Provider 信息存储方式优化

**当前问题**：
- 前端 Settings UI 使用 `auth.profiles` + `auth.order` + 独立 `auth-profiles.json` 的复杂多文件方式存储 API Key
- Gateway embedded agent 实际查找 auth 走的是 `state/agents/<id>/agent/auth-profiles.json`
- CLI 的 `models auth paste-token` 写的是 `.openclaw/agents/<id>/agent/auth-profiles.json`
- 两个路径不一致导致 CLI 能找到 token 但 Gateway 找不到

**参考旧版本**（`C:\Users\yangjili\.openclaw\openclaw.json`）：
- 旧版直接在 `models.providers.<id>.apiKey` 内联存储 token
- 简单、一个文件管理、Gateway 直接支持
- 新版也兼容这种方式（已验证 `infer model run` 成功）

**修复方案**：
1. bootstrap 生成的默认配置改用内联 `apiKey` 方式
2. Settings UI 保存 API Key 时直接 patch `models.providers.<id>.apiKey`（走 `openclaw config patch`）
3. 不再依赖 `auth-profiles.json` 文件（或作为 fallback）
4. 对齐旧版配置格式，provider id 用有意义的名称（如 `netease-codemaker`）而非 `custom`

## 关联

- STORY-0039：Chat/Gateway 连接问题（触发发现本问题）
- STORY-0020：原始 preserve 逻辑实现
