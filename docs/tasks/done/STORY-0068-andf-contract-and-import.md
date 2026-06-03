---
id: STORY-0068
kind: story
title: ANDF 数据契约 + CSV/JSON 导入与类型推断
status: done
priority: P0
owner: "@ivan"
assignee: ai
estimate: 3d
created: 2026-06-03
updated: 2026-06-03T22:20
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/andf-format]]"
related_packages:
  - "packages/platform/contracts"
  - "packages/apps/web"
tags: [story, data, contract, csv, json, M10]
---

# STORY-0068 · ANDF 契约 + CSV/JSON 导入与类型推断

## 背景与目标

按 `.ai/rules/00-architecture.md` §7「契约即源」铁律：
跨语言数据结构必须先在 `packages/platform/contracts/schemas/` 定义 JSON Schema，
再派生 Python pydantic 与 TS 类型。本 STORY 产出 ANDF 契约本体，
并实现纯前端的 CSV / JSON 数组解析 + 类型推断（首版不需要 sidecar 参与）。

## 范围 / 非范围

- 范围：
  - `docs/specs/andf-format.md` ANDF 数据契约文档（≤ 2000 字）
  - `packages/platform/contracts/schemas/andf.schema.json` JSON Schema
  - 派生 TS 类型（Web UI 用）
  - 派生 Python pydantic（未来 sidecar 复用，首版仅校验生成正确即可）
  - CSV 解析：表头 → 字段，行解析，类型推断（number / boolean / datetime / url / string）
  - JSON 数组解析：`Array<Record<string, ...>>` → ANDF
  - 字段类型用户可手动覆盖
- 非范围：Excel(.xlsx) 解析、流式大文件、加密 CSV、远程 URL 导入

## 验收标准

- [x] `docs/specs/andf-format.md` accepted
- [x] `andf.schema.json` 语法有效（JSON Schema draft 2020-12），TS codegen + build 通过
- [x] TS 类型 + Python pydantic v2 双端派生完成
- [x] CSV 单测：`name,n,b\nfoo,1,true\nbar,2,false` 推断为 `string / number / boolean` (14 tests pass)
- [x] JSON 数组单测：`[{x:1,y:"a"}]` → `x:number / y:string` (12 tests pass)
- [x] 错误用例覆盖：EMPTY_HEADER / UNEVEN_ROW / EMPTY_FILE / INVALID_JSON / NOT_ARRAY
- [x] 解析器纯 TS，位于 `packages/apps/web/src/features/data/parser/`
- [x] 新增代码 web typecheck 0 新错误（仅预存 2 个不相关错误）

## 设计要点

- ANDF 字段：`schema / meta / columns / rows / view`
- 类型推断顺序：boolean → number → datetime（ISO 8601）→ url（http(s)://）→ string
- view 配置最小集：`{type, encoding}`，详细 encoding 字段交给 STORY-0069 之后扩展
- 解析器是纯 TS 模块，放 `packages/apps/web/src/features/data/parser/`，不上 sidecar

## 进展日志

- 2026-06-03 created
- 2026-06-03 implemented：andf.schema.json + andf-format.md + TS/Python 双端类型 + CSV/JSON 解析器 + 26 tests pass + contracts build 修补（dist 拷贝）
- 2026-06-03 review 通过（AC 8/8，vitest 26/26 + pydantic 实例化 OK + contracts build OK），迁 done/
