# 文档协作规则（Obsidian Vault）

`docs/` 是 Obsidian Vault，也是项目"单一信息源"。所有架构与决策必须先落到 docs。

## 强约束

1. **改架构 → 先改 `docs/specs/`**，再改 `packages/*`。AI 应主动拒绝"只改代码不改文档"的请求。
2. **重大决策 → 立刻新建 ADR**：`docs/decisions/NNNN-<slug>.md`（编号递增，4 位）。模板 `docs/templates/adr.md`。
3. **跨链接用 `[[wiki-link]]`**（Obsidian 风格），不要用相对路径。
4. **每个文件必须有 frontmatter**：

   ```yaml
   ---
   tags: [spec, architecture]
   created: 2026-05-02
   status: draft   # draft | review | accepted | superseded
   ---
   ```

## 目录职责

| 目录 | 内容 |
|------|------|
| `docs/vision/` | 长期愿景：北极星、路线图、非目标 |
| `docs/specs/` | **唯一权威**：架构规格、协议、子系统设计、安装、数据模型 |
| `docs/decisions/` | ADR — 关键决策记录 |
| `docs/development/` | 开发者上手与约定、Skill 编写指南 |
| `docs/inbox/` | 用户/作者的灵感、需求、临时想法（每周清理） |
| `docs/templates/` | Obsidian 模板（adr / idea / skill） |
| `docs/changelog/` | 用户向 changelog |
| `docs/assets/` | 图片 / 附件 |

## 不许做的事

- 不要在 `packages/*/README.md` 写长篇文档；最多写 5~20 行 + 链到 docs。
- 不要在代码注释里堆架构说明；放到 `docs/specs/` 并在注释里链过去。
- 不要写"Skill 用户使用文档"——Skill 给 AI 用，AI 看 SKILL.md / manifest.json 就够了；只为 Skill 作者写编写指南（在 `docs/development/skill-authoring/`）。
