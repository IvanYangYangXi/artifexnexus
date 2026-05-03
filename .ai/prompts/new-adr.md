# Prompt：新建一个 ADR

> 用法：复制给 AI，替换 `{{}}`。

---

请帮我新建一个 ADR 记录"{{决策标题}}"。

执行步骤：

1. 在 `docs/decisions/` 下找到当前最大编号 N，新建 `NNNN-{{kebab-slug}}.md`（编号 = N+1，4 位数）。
2. 用模板 `docs/templates/adr.md` 的结构（如不存在请先创建）。
3. frontmatter 必须包含：
   ```yaml
   ---
   tags: [adr]
   created: {{YYYY-MM-DD}}
   status: proposed   # proposed | accepted | deprecated | superseded-by-NNNN
   ---
   ```
4. 正文章节：**Context / Decision / Consequences / Alternatives Considered**。
5. 如果此决策影响架构，**同步更新** `docs/specs/系统架构设计.md` 的相关章节，并在 ADR 末尾用 `[[wiki-link]]` 互链。
6. 如果决策推翻旧 ADR，把旧 ADR 的 status 改为 `superseded-by-NNNN`。
