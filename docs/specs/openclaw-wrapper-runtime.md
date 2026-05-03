---
tags: [spec, openclaw, runtime, isolation]
created: 2026-05-03
status: draft
---

# OpenClaw Wrapper — 运行时（Runtime）

> 总览：[[openclaw-wrapper]]。本文讲"**装完以后它每天是怎么跑的**"。

## 1. 进程模型

```
Tauri 壳（UI + Rust 后端）
 ├─► child: OpenClaw 主进程（Python）
 │    └─► 内部子线程：MCP server (run_python) / Gateway / Skill loader
 ├─► child: 按需拉起的 DCC 对应 MCP server（UE/Blender 侧由 DCC 内部起，壳不直接管）
 └─► IPC: Tauri Command（UI ↔ Rust）；Rust ↔ Python 走 stdio + 本地 HTTP/WS
```

- **单实例**：通过 `~/.artifexnexus/run/app.lock` 文件锁保证。
- 子进程日志统一落 `~/.artifexnexus/logs/openclaw-YYYYMMDD.log`，滚动 7 天。
- 壳退出 → SIGTERM 子进程 → 5s 超时 SIGKILL。

## 2. 目录布局（用户数据）

```
~/.artifexnexus/
├── config/
│   └── artifexnexus.json          # 配置中心，契约见 contracts/schemas
├── .openclaw/                     # 与外部 ~/.openclaw/ 物理隔离
│   ├── vendor/                    # OpenClaw 源快照（壳写入，启动只读）
│   ├── workspace/
│   │   └── skills/{official,team,user}/
│   ├── state/                     # OpenClaw 自己的运行状态
│   └── venv/                      # uv 管理的虚拟环境
├── logs/
├── cache/
└── run/
    ├── app.lock
    └── ports.json                 # 当前选定端口快照
```

## 3. 隔离策略（强约束）

1. **环境变量隔离**：子进程只继承白名单环境变量；显式设置
   - `OPENCLAW_HOME=~/.artifexnexus/.openclaw`
   - `OPENCLAW_CONFIG_DIR=~/.artifexnexus/config`
   - `PYTHONHOME=<install>/runtime/python`
   - `PYTHONPATH` 只包含 vendor 与官方 skill 路径
2. **路径隔离**：源码/状态/配置都必须走 `OPENCLAW_HOME`，代码审计禁止出现 `~/.openclaw/`（CI lint）
3. **端口隔离**：见 §4

## 4. 端口探测与自愈

**策略**：默认 `14523`，冲突时在 `14523–14599` 段内自增，写回 `artifexnexus.json.openclaw.port` 与 `run/ports.json`。

```python
def pick_port(preferred: int = 14523, window: int = 77) -> int:
    """返回首个可绑定的端口。"""
```

- 探测方法：`bind(127.0.0.1, p)` 成功即视为空闲，随后 close 释放给真实服务用（TOCTOU 可接受，冲突后重试一次）
- UI 行为：若最终选定端口 ≠ preferred，右上角 toast："端口已切换为 14524（14523 被占用）"
- 外部已装 OpenClaw 仍用 14523 运行时 → 互不干扰

## 5. 配置中心

所有可变参数集中于 `~/.artifexnexus/config/artifexnexus.json`，字段契约见
`packages/platform/contracts/schemas/config.schema.json`。壳启动流程：

```
load config → validate by schema → apply → (冲突时) 端口探测 → 写回
```

配置 UI 在壳内表单；不鼓励手工编辑，但手工编辑结果在启动时也会被 schema 校验。

## 6. 状态面板（UI）

主界面三区：

1. **Status**：OpenClaw 进程健康、端口、CPU/内存、连通 DCC 数
2. **Skills**：已装 Skill 列表（official / team / user），可 enable/disable
3. **Plugins**：UE / Blender 插件投放状态 + 一键同步

按钮：Start / Stop / Restart / Open Log / Open Data Dir。

## 7. 健康检查（doctor）

壳内置 `doctor` 按钮，对外也暴露 `artifex doctor` CLI（用于脚本化）。检查项：

- [ ] `~/.artifexnexus/` 目录结构完整
- [ ] `artifexnexus.json` 通过 schema 校验
- [ ] OpenClaw 端口可 bind / 当前进程响应
- [ ] UE / Blender 插件链接/副本版本匹配
- [ ] 官方 Skill 完整性

失败项给出"一键修复"建议（尽量幂等）。

## 8. 卸载钩子

- 壳卸载时：停进程、释放锁、清 `<install>/`
- 用户数据：**默认保留**；只在用户勾选"清除数据"时才删 `~/.artifexnexus/`

## 9. 验收标准

- [ ] 子进程日志落盘、滚动、UI 可查
- [ ] 端口探测在 14523 被占时自动切换并写回
- [ ] 杀掉壳进程后，所有子进程在 5s 内终止
- [ ] 外部 `~/.openclaw/` 在全生命周期内 0 读 0 写（用 fs audit 验证）

## 相关

- [[openclaw-wrapper]] · [[openclaw-wrapper-install]] · [[openclaw-wrapper-ipc]] · [[openclaw-wrapper-dev]]
- [[../decisions/0002-vendor-openclaw-fork]]
