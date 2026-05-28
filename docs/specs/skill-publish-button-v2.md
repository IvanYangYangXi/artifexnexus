---
tags: [spec, skill, development]
created: 2026-05-28
status: draft
---

# SkillList 发布/更新按钮 — 对齐 ArtClaw 双按钮模型

## 改动范围
仅 `SkillList.tsx`（1 个文件）

## 按钮逻辑（对齐 ArtClaw）

| 条件 | 按钮 A | 样式 A | 行为 A | 按钮 B | 样式 B | 行为 B |
|------|--------|--------|--------|--------|--------|--------|
| `needs_update && needs_publish` | **更新** | `default` | skillSync | **发布** | `default` | 用户层→弹窗 / 非用户→skillPublish |
| 仅 `needs_update` | **更新** | `default` | skillSync | **发布** | `outline` | 同上 |
| 仅 `needs_publish` | **更新** | — (不显示) | — | **发布** | `default` | 同上 |
| 无 pending | **更新** | — (不显示) | — | **发布** | `outline` (+ 用户层紫色) | 同上 |

**颜色标准（项目现有）：**
- 高亮 = `variant="default"`（实心主色按钮）
- 常规 = `variant="outline"`（轮廓按钮）
- 用户层常规发布 = `variant="outline"` + `text-purple-400`

## 实施步骤

### Step 1: 导入 skillCheckSync + SyncStateInfo
### Step 2: 新增 syncStates 状态
### Step 3: loadSkills 扩展 — Promise.allSettled 批量查 sync 状态
### Step 4: 替换 L344-360 旧按钮 → 新双按钮逻辑
### Step 5: TS 编译验证
