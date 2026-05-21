---
tags: [adr, skill, agent, junction, system-prompt]
created: 2026-05-21
status: accepted
---

# ADR 0009 — 多 Agent Skill 共享：Junction + 禁用 systemPromptOverride

## Context

Artifex Nexus 使用 OpenClaw 作为 AI 网关，支持多 agent（如 `artifex-nexus` 主 agent +
`twelve` 专用 agent）。每个 agent 有独立 `workspace/`，OpenClaw 按
`<workspace>/skills/*/SKILL.md` 扫描可用 Skill 并注入系统提示的 `<available_skills>` 块。

**问题**：agent 配置了 `systemPromptOverride` 字段后，OpenClaw 的
`buildEmbeddedSystemPrompt()` 被整体跳过，导致 Skill 注入段丢失，agent 看不到已安装的 Skill。

**此外**，非主 agent（如 `twelve`）的 `workspace-twelve/skills/` 初始为空，
即使移除 systemPromptOverride，仍需一种机制让所有 agent 共享同一套已安装 Skill。

## Decision

### 1. 禁止 agent 配置 `systemPromptOverride`

`openclaw.json` 中 agent 条目不设置 `systemPromptOverride` 字段。

**理由**：
- OpenClaw v2026.5.4 源码 `selection-BfCSa_QL.js:4696` 中，
  当 `systemPromptOverrideText` 存在时，跳过 `buildEmbeddedSystemPrompt()`，
  后者是 `<available_skills>` 块的唯一注入点。
- 删除该字段后，`resolveSystemPromptOverride()` 返回 `undefined`，
  `??` fallback 到 `buildEmbeddedSystemPrompt({..., skillsPrompt})`，skills 自动注入。

**Agent 专属指令替代方案**：写入各 workspace 的 `AGENTS.md`（OpenClaw 在会话启动时自动注入为 Project Context）。

### 2. 多 Agent Skill 共享：目录联结（Junction）

所有非主 agent workspace 的 `skills/` 通过 **Windows `mklink /J`（目录联结）**
指向主 `workspace/skills/`。

**理由**：
- OpenClaw 使用 `tryRealpath()` / `fs.realpathSync()` 处理目录路径，
  与 NTFS Junction 兼容（Junction 在文件系统层面透明解析）。
- **与 ADR 0008 不同**：ADR 0008 弃用 Junction 是因为 OpenClaw 的
  `trusted-root` 安全检查拒绝跨卷 realpath 的插件目录。
  但 **workspace/skills/ 不在 trusted-root 检查范围内**（workspace 是通用文件读写区域，
  不受插件加载的安全策略约束）。
- 比 `shutil.copytree` 更优：无需维护两份副本，安装/卸载自动双向同步。
- 比 symlink 更可靠：Windows `mklink /J` 不需要管理员权限，
  `Path.is_symlink()` 无效但 PowerShell 可检测 `ReparsePoint` 属性。

### 3. 联结自动创建（bootstrap 集成）

`bootstrap.py` 新增 `_ensure_skills_junctions()` 函数，在 `_try_install_official_skills()`
之后调用。遍历 `openclaw.json` 中所有 agent 的 `workspace` 字段，为主 workspace
之外的每个 workspace 创建 `skills/` 联结。

**幂等规则**：
- 已是 Junction → 跳过
- 已是 Unix symlink → 跳过
- 已是实体目录 → **warn 跳过**（不覆盖用户数据）
- 不存在 → 创建 Junction

## Consequences

**正向**：
- 所有 agent 自动看到全部已安装 Skill，无需手动复制
- systemPromptOverride 不再阻断 skills 注入
- Agent 专属指令通过 `AGENTS.md` 维护，支持多 agent 差异化配置
- 安装/卸载一次，所有 agent 即时反映

**负向**：
- Junction 在 Git for Windows 中可能引起混淆（`git status` 可能报告类型变更）
- 备份/恢复流程需额外验证 Junction 不会被误删目标目录（已通过 `os.walk` 默认不跟随 Junction 规避）

## 源码引用

| 要点 | OpenClaw 源码位置 |
|------|------------------|
| systemPromptOverride 阻断 skills | `selection-BfCSa_QL.js:4696` — `params.systemPromptOverrideText ? overridePath : buildEmbeddedSystemPrompt(...)` |
| compact 路径同样阻断 | `compact-lAepOpat.js:652` — `resolveSystemPromptOverride({...}) ?? buildEmbeddedSystemPrompt({..., skillsPrompt})` |
| buildEmbeddedSystemPrompt 含 skillsPrompt | `system-prompt-B7rmkgZ5.js` — `buildSkillsSection(skillsPrompt)` |
| workspace skills 扫描 | `workspace-DCAF4Xii.js` — `resolveSkillsPromptForRun()` → 遍历 `workspace/skills/*/SKILL.md` |
| AGENTS.md 注入 | `plan-DgTF53E9.js:48-59` — 会话启动时自动读取 workspace 的 SOUL.md + AGENTS.md |

## 相关

- `[[../specs/skill-system]]`
- `[[../../packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/bootstrap.py]]` — `_ensure_skills_junctions()`
- `[[../../packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/_rpc_helpers.py]]` — `_resolve_skill_install_dir()`
- `[[../../packages/platform/skill/src/artifex_nexus/skill/installer.py]]` — `SkillInstaller._target_skill_dir()`
