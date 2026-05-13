# CLAUDE.md

本文件供 Claude Code（及兼容 AGENTS.md 协议的 AI 助手）自动读取。

> **TL;DR**：先读 `.ai/context/project-overview.md`，再读 `.ai/rules/00-architecture.md`，
> 然后做事。文档变更优先于代码变更。

## 强约束

1. 遵守 `.ai/rules/` 下所有规则（尤其 `30-agent-behavior.md` 的对齐优先、最小改动原则；以及 `50-logging-standards.md` 的零静默 catch、关键节点必埋点）。
2. 改架构必先改 `docs/specs/`，再改 `packages/*`。
3. **不要新增 MCP 工具**——新增能力 = 新增 Skill 包 + `@tool` 函数。
4. **Skill ≠ Tool**：Skill 是包，Tool 是包内被 `@tool` 装饰的函数。
5. 不要使用 `~/.openclaw/` 等旧路径，统一 `~/.artifexnexus/`，OpenClaw 隔离在 `~/.artifexnexus/.openclaw/`。
6. 跨进程数据先在 `packages/platform/contracts/schemas/` 定义 JSON Schema，再派生 Python/TS。
7. 代码文件 ≤ 500 行（黄金区 100–300）；PRD/架构文档 ≤ 2000 字，大则按模块拆。
8. **接单先追问设计细节**、给推荐答案；**只做任务要求的事**，不顺手重构。
9. **SDD 流程**：想法→任务→规格→实现→合并，一律按 `docs/development/sdd-workflow.md`；
   收到 `/sdd triage|align|implement|done` 口令即进入对应阶段。
10. **改 `apps/` 必跑对应 `tauri build` / `pnpm build`，不能只跑 `pnpm build` 然后说"编译完了"**。
    详见 `.ai/rules/40-build-and-release.md`。汇报时必须给出 `.exe` / installer 的大小与时间戳作为证据。

## 常用入口

- 包索引、目标、术语：`.ai/context/`
- 复用 prompt：`.ai/prompts/`
- 架构文档：`docs/specs/`
- 决策记录：`docs/decisions/`
- 灵感/需求：`docs/inbox/`
- **SDD 工作流**：`docs/development/sdd-workflow.md`
- **任务管理**：`docs/development/task-management.md` + `docs/tasks/`

## 命令

```bash
pnpm install                                  # 安装 JS/TS 依赖
uv sync --all-packages                        # 安装 Python 依赖（workspace）
pnpm build                                    # turbo 构建所有 TS 包（仅前端 / Node 包；不出 .exe）
pnpm py:test                                  # pytest
pnpm dev --filter=@artifex-nexus/web          # 启 Web UI
artifex install --link                        # 部署到 ~/.artifexnexus/（源码引用模式）
artifex doctor                                # 健康检查

# 桌面壳：改了 apps/desktop/** 必须用下面这条出 .exe / installer
# （仅跑上面的 `pnpm build` 不算编译完成，详见 .ai/rules/40-build-and-release.md）
set PATH=%USERPROFILE%\.cargo\bin;%PATH%      # Win：cargo 不在 PATH 时先注入
pnpm -C apps/desktop tauri build              # 出 src-tauri/target/release/artifex-nexus-desktop.exe
                                              #   + bundle/nsis/Artifex Nexus_<ver>_x64-setup.exe
```

## 回答风格

- 默认中文。
- 代码注释中文；公共 API docstring 中英双语。
- 引用文件用反引号包路径，例如 `packages/platform/skill/src/...`。
