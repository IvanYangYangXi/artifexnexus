# Fonts — Self-Hosted

本目录存放 Artifex Nexus 统一设计语言使用的两款字体的 **variable woff2** 文件：

| 文件 | 字体 | 用途 | 许可 |
|---|---|---|---|
| `Inter-Variable.woff2` | Inter (variable) | UI 正文 | SIL Open Font License 1.1 |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono (variable) | 代码/日志/终端 | SIL Open Font License 1.1 |

## 下载来源（首次初始化本地仓库后执行一次）

- Inter：<https://github.com/rsms/inter/releases> → `Inter-<ver>.zip` → `Inter.var.woff2`（重命名为 `Inter-Variable.woff2`）
- JetBrains Mono：<https://github.com/JetBrains/JetBrainsMono/releases> → `JetBrainsMono-<ver>.zip` → `fonts/variable/JetBrainsMono[wght].ttf`（需转为 woff2，或直接用 `JetBrainsMono-Variable.woff2` 若发布物包含）

## 一键脚本（推荐）

```bash
pnpm -C packages/ui run fonts:fetch
```

（脚本后续由 STORY-0038 或独立 TASK 补齐；当前先手工放置。）

## 降级（缺文件时）

若 woff2 缺失，`@font-face` 加载失败会自动回退到 `system-ui` / `ui-monospace`，
不影响布局，仅视觉略有差异。深度用户应确保文件齐全。

## Git 策略

字体 woff2 属于**二进制资源**，不适合 diff；
当前策略为**进 git**（单文件 ~300KB，两者合计 < 1MB，可接受），
后续若规模扩大可改为 LFS 或 CI 时下载。
