# GitHub Copilot Chat · Project Instructions

> This file is auto-loaded by VS Code's Copilot Chat for workspace-level rules.
> It is intentionally short and points to the canonical sources.

## Source of Truth (read these first)

1. `CLAUDE.md` — top-level agent briefing
2. `.ai/rules/00-architecture.md` — architecture iron laws
3. `.ai/rules/10-coding-style.md` — naming, file layout, style
4. `.ai/rules/20-docs-workflow.md` — Obsidian Vault docs rules
5. `.ai/rules/30-agent-behavior.md` — **clarify-first, minimal-diff, docs+code cross-refs**
6. `docs/development/sdd-workflow.md` — **SDD workflow (ideas → tasks → specs → code)**

## Hard Rules (must follow)

- **Clarify first.** Ask design questions before coding; give a recommended answer per question.
- **Minimal diff.** Do only what the task asks. No incidental refactors. Reproduce bugs before fixing.
- **Docs first.** Architecture changes must update `docs/specs/` before `packages/*`.
- **MCP minimization.** Only `run_python` is registered per DCC. New abilities = new Skill package + `@tool` function. No new MCP tools.
- **Skill ≠ Tool.** Skill = distribution unit (package); Tool = executable function decorated with `@tool`.
- **Paths.** Always `~/.artifexnexus/`. OpenClaw isolated in `~/.artifexnexus/.openclaw/`. Never `~/.openclaw/`.
- **Contracts.** Any cross-process data goes through `packages/platform/contracts/schemas/` first (JSON Schema), then generated to Python/TS.
- **File size.** Code files 100–300 lines (golden), hard cap 500. PRDs ≤ 2000 words per file.
- **Cross-refs.** When touching a doc or a package, update the corresponding README index and add `[[wiki-link]]` back-refs.

## SDD Commands (user-issued)

When the user types any of the following, execute the matching phase defined in `docs/development/sdd-workflow.md`:

- `/sdd triage <inbox file>` — turn an idea into a task card in `docs/tasks/backlog/`
- `/sdd align [[TASK-NNNN-...]]` — design alignment, produce spec/ADR, move to `ready/`
- `/sdd implement [[TASK-NNNN-...]]` — implement against acceptance checklist, move to `review/`
- `/sdd done [[TASK-NNNN-...]]` — (human-triggered) archive + changelog

## Language

- Reply in Chinese by default.
- Code comments in Chinese. Public API docstrings bilingual (English + Chinese).
