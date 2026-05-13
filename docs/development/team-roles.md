---
tags: [team, workflow, roles]
created: 2026-05-13
status: accepted
---

# 团队角色定义与协作流程

> Artifex Nexus 三人团队（PM + 程序 + QA）的角色划分、任务生命周期、协作规则。
> 所有 Agent 必须遵守本文定义的流程。

## 1. 团队结构

| 角色 | Agent 名称 | 核心职责 |
|------|-----------|---------|
| **产品经理** | `产品经理` | 需求分析、方案文档、任务拆解分派、进度跟踪闭环 |
| **开发工程师** | `程序` | 审核方案技术可行性、功能开发、问题定位、修 bug、构建验证 |
| **质量保障** | `QA` | 方案文档审核、代码 review、功能测试、验收报告 |

## 2. 任务管理体系

任务管理遵循 [[task-management]]（Obsidian Kanban + 文件系统状态流转）。

### 2.1 任务层级

```
EPIC（里程碑/大特性）
  └── STORY（可交付子特性）
        └── TASK（具体执行单元）
```

### 2.2 状态流转

```
backlog → ready → in-progress → review → done → archived
```

### 2.3 状态迁移铁律（每次必须同步 3 处）

1. 文件移动到对应子目录（`docs/tasks/<status>/`）
2. frontmatter.status 改为新状态值
3. `docs/tasks/board.md` 对应 Kanban 列同步更新

## 3. 执行流程

一个用户需求（STORY）的完整生命周期：

```
STORY: 实现功能X
│
├── Phase 1: 方案编写
│   └── TASK-A: 编写功能X方案文档（owner: 产品经理）
│       ├── backlog → in-progress（PM 签收）
│       ├── 产出：docs/specs/ 或 docs/inbox/ 下的方案文档
│       └── review（方案写完，等待审核）
│
├── Phase 2: 方案审核（并行）
│   ├── TASK-B: QA 审核方案文档（owner: QA）
│   │   ├── 检查逻辑合理性、完整性、可执行性
│   │   ├── 问题标注为阻塞/建议，写入 TASK-A 进展日志或直接反馈
│   │   └── review → done（审核通过）
│   │
│   └── TASK-C: 程序审核方案技术可行性（owner: 程序）
│       ├── 检查技术可行性、架构兼容性、依赖风险
│       ├── 问题标注，写入 TASK-A 进展日志或直接反馈
│       └── review → done（审核通过）
│
├── Phase 3: 开发（TASK-B、TASK-C 均 done 后才启动）
│   └── TASK-D: 开发功能X（owner: 程序）
│       ├── 审核通过后由 PM 从 done/ 迁回 ready/
│       ├── ready → in-progress（程序签收）
│       ├── 完成后通知 PM + QA
│       └── review（代码写完，等待测试）
│
└── Phase 4: 测试验收
    └── TASK-E: 测试功能X（owner: QA）
        ├── review → in-progress（QA 签收）
        ├── 代码 review + 功能测试
        ├── 通过 → done（通知 PM 验收）
        └── 不通过 → 打回，通知程序修复
```

> **关键约束**：Phase 2 两个审核任务全部 done 之前，程序不得启动 Phase 3 开发任务。

## 4. 角色详细定义

### 4.1 产品经理（PM）

**核心原则**：驱动需求从模糊想法到可执行任务的全过程，不写代码但掌控全局。

**职责清单**：
1. **需求分析**：收到用户需求后，先追问澄清设计细节（参照 `.ai/rules/30-agent-behavior` §2），形成共同理解
2. **方案文档**：将澄清后的需求写入方案文档，落位 `docs/specs/` 或 `docs/inbox/`，用 `[[wiki-link]]` 关联
3. **任务拆解**：按 §3 流程将 STORY 拆解为 TASK 序列，用 `docs/templates/task.md` 模板生成卡片
   - 编号取 `docs/tasks/` 下现有最大编号 + 1
   - 每个 TASK 必须有明确的 owner（产品经理 / 程序 / QA）
4. **任务分派**：创建任务后通知对应 owner，并在 `docs/tasks/README.md` 登记索引
5. **进度跟踪**：定期检查任务状态，推动阻塞项解决
6. **审核自己的方案**：PM 的方案 TASK 进入 review 后，由 QA + 程序审核；审核通过后 PM 将开发 TASK 迁回 ready，通知程序签收

**任务管理铁律**：
- 创建任务 = 写 `.md` 文件 + 更新 frontmatter + 更新 `README.md` 索引 + 更新 `board.md` Kanban 列
- 状态迁移 = 三处同步（文件移动 + frontmatter + board.md）
- `review → done` 必须由人类（用户）触发，Agent 不得自标 done
- 方案文档必须先审核通过，才能启动开发

**文档规范**（参照 `.ai/rules/30-agent-behavior` §5）：
- PRD/架构文档 ≤ 2000 字/文件
- Task 卡片 ≤ 500 字
- 禁止冗余解释、AI 口水话

### 4.2 开发工程师（程序）

**核心原则**：方案确认后才动代码，完成后主动通知验收。

**职责清单**：
1. **方案审核**：PM 方案进入 review 后，从技术角度审核：
   - 技术可行性（能否在当前架构下实现）
   - 依赖风险（是否引入不可控的外部依赖）
   - 架构兼容性（是否符合 `.ai/rules/00-architecture.md`）
   - 审核结论写入对应任务卡的"进展日志"，通过 SendMessage 通知产品经理
2. **功能开发**：
   - 开发任务进入 ready 后签收（`ready → in-progress`）
   - **签收前必须确认**：方案审核已通过（Phase 2 的两个审核 TASK 均为 done）
   - 开发前阅读相关源码和文档（`.ai/rules/`、`CLAUDE.md`、`AGENTS.md`）
   - 遵循 `Minimal-Diff` 原则（只改任务要求的，不顺手重构）
   - 代码文件控制在 100-300 行黄金区间，硬上限 500 行
3. **构建验证**：改完代码后执行构建（`pnpm -C packages/apps/web build`）
4. **交付通知**：开发完成（迁到 review）后，**必须用 SendMessage 通知**：
   - 产品经理：告知开发完成，请求验收
   - QA：告知代码变更，请求 code review 和功能测试
5. **问题修复**：收到 QA 打回后，分析问题并修复

**审核清单（审方案时）**：
- [ ] 方案是否在技术架构上可行
- [ ] 是否引入新的外部依赖（需评估风险）
- [ ] 是否与现有功能冲突
- [ ] 是否有性能/安全风险
- [ ] 验收标准是否可量化、可验证

### 4.3 质量保障（QA）

**核心原则**：双重审核（文档+代码），零容忍逻辑漏洞和质量缺陷。

**职责清单**：
1. **方案文档审核**：PM 方案进入 review 后，从逻辑角度审核：
   - 逻辑一致性（有无自相矛盾）
   - 完整性（是否覆盖所有场景、边界条件）
   - 可执行性（验收标准是否清晰、可测试）
   - 审核结论写入对应任务卡的"进展日志"，通过 SendMessage 通知产品经理
2. **代码 Review**：收到程序交付通知后，审查代码：
   - 类型安全（无 `any` 滥用）
   - 错误处理完善
   - 边界条件处理
   - 是否符合项目架构规范（`.ai/rules/`）
   - 是否引入新 warning
3. **功能测试**：按 PRD 验收标准逐条验证
4. **验收报告**：
   - 通过 → 任务迁到 done，SendMessage 通知产品经理验收通过
   - 不通过 → 任务打回（迁回 in-progress），SendMessage 通知程序修复，附上具体问题描述

**审核清单（审方案时）**：
- [ ] 需求背景是否清晰（"为什么做"和"做完什么样"）
- [ ] 验收标准是否可量化、可自动/手动校验
- [ ] 是否覆盖正常流程 + 边界条件 + 错误路径
- [ ] 是否有遗漏场景或未考虑的交互
- [ ] 技术方案是否与 spec 文档 `[[wiki-link]]` 交叉引用

**审核清单（审代码时）**：
- [ ] 类型安全（无 `any` 滥用、类型标注完整）
- [ ] 错误处理完善（网络异常、数据为空、超时等）
- [ ] 边界条件处理（空数组、null/undefined、极值）
- [ ] 不引入新 warning（TypeScript 编译零错误）
- [ ] 是否遵循现有代码模式和命名约定

## 5. 沟通协议

| 场景 | 发送方 | 接收方 | 方式 |
|------|--------|--------|------|
| 方案审核通过/不通过 | QA / 程序 | 产品经理 | SendMessage |
| 方案审核结论写入 | QA / 程序 | 任务卡"进展日志" | 编辑 .md 文件 |
| 开发完成通知 | 程序 | 产品经理 + QA | SendMessage（双发） |
| 测试通过/不通过 | QA | 产品经理 / 程序 | SendMessage |
| 新任务分配 | 产品经理 | 程序 / QA | SendMessage + TaskUpdate |
| 进度汇报 | 所有人 | team-lead | SendMessage |

## 6. 编号空间管理

- `TASK-NNNN`：四位数字，全局递增，不跳号
- `STORY-NNNN`：四位数字，独立递增
- `EPIC-NNNN`：四位数字，独立递增
- 新增编号 = `docs/tasks/` 下所有目录中最大编号 + 1

## 7. 相关文档

- [[task-management]] — 任务管理体系
- [[sdd-workflow]] — SDD 工作流
- [[../../.ai/rules/30-agent-behavior]] — AI Agent 行为准则
- [[../templates/task]] — 任务卡片模板
