---
id: TASK-0055
title: QA 审核信息队列修复方案文档
status: completed
priority: P2
owner: "@QA"
assignee: ai
estimate: 0.25d
created: 2026-05-13
updated: 2026-05-13
related_specs: [[../../inbox/message-queue-fix]]
related_packages: [packages/apps/web]
tags: [task, review, qa]
---

# QA 审核信息队列修复方案文档

## 背景与目标
审核 `docs/inbox/message-queue-fix.md` 方案文档的逻辑完整性、边界条件覆盖和验收标准可执行性。

## 验收标准
- [ ] 三个缺陷的根因分析是否逻辑自洽、无矛盾
- [ ] 合并发送功能设计是否覆盖：勾选/不勾选、空队列、单消息等边界条件
- [ ] WS 断连修复方案是否考虑所有连接状态（connected/degraded/disconnected/connecting）
- [ ] 队列清理方案是否覆盖：正常流程、异常断连、超时
- [ ] 验收标准是否可量化、可逐条测试验证

## 设计要点
- 引用 [[../../inbox/message-queue-fix]]
- 重点关注 §3 修复方案是否覆盖所有边界条件

## 进展日志
- 2026-05-13 等待 QA 签收
- 2026-05-13 QA 审核完成，结论：**不通过（打回 in-progress）**
- 2026-05-13 产品经理已处理全部审核意见（6 P1 + 3 P2），方案文档已修正
  - P1-1 ✅ cross-ref 修正为 `../tasks/in-progress/STORY-0039-m3-func-chat-api`
  - P1-2 ✅ §3.1 新增 toggle 切换行为定义
  - P1-3 ✅ §3.1 新增 4096 字符上限
  - P1-4 ✅ §3.2 保留 ws=null 守卫 + sendChat 返回值语义表
  - P1-5 ✅ §3.5 新增并发回放竞争分析
  - P1-6 ✅ §3.4 新增 UI spec 同步说明
  - P2-1 ✅ §3.3 mergeEnabled 持久化澄清
  - P2-2 ✅ §3.1 空消息跳过
  - P2-3 ✅ §3.3 补充 disconnect() 清理行
  请求 QA 复审
- 2026-05-13 QA 复审完成，结论：**通过（批准进入开发）**

### 审核结论

逐项审核 `docs/inbox/message-queue-fix.md` 结果如下：

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 需求背景清晰 | ✅ 通过 | 三个缺陷描述完整，用户感知明确 |
| 验收标准可量化 | ✅ 通过 | 8 条验收标准均可逐条测试验证 |
| 正常流程覆盖 | ✅ 通过 | 合并/顺序发送、WS 排队、队列清理三路径完整 |
| 边界条件覆盖 | ❌ 不通过 | 见下方 P1-2~P1-5 |
| 错误路径覆盖 | ❌ 不通过 | 见下方 P1-4 |
| 无遗漏场景 | ❌ 不通过 | 见下方 P1-1~P1-5 |
| spec 交叉引用 | ❌ 不通过 | 见下方 P1-1、P1-6 |

### 阻塞问题（P1 — 必须修复后方可开发）

**P1-1 交叉引用失效**
`[[../tasks/_handoff/STORY-0039-m3-func-chat-api]]` 文件不存在（路径 `docs/tasks/_handoff/` 下无此文件）。建议移除或提供正确的引用路径。

**P1-2 合并发送 toggle 时队列已有消息的行为未定义**
§3.1：用户可能在 `pendingQueue` 不为空时切换 `mergeEnabled`。方案未定义此时队列中已有消息应使用新策略还是旧策略处理。建议：明确行为（如"当前批次用旧策略，下批次用新策略"；或"toggle 时先排空队列再切换"）。

**P1-3 合并消息总长度无上限**
§3.1：`\n` 拼接 N 条消息时未定义最大长度限制。单条消息过大可能触发 Gateway 拒绝或性能问题。建议：设定上限（如 4096 字符），超出时截断提示或分批发。

**P1-4 WS 断连修复方案对 ws=null 处理不完整**
§3.2：方案说"始终调用 `ws.sendChat()`"，但当 `ws` 为 `null` 时无法调用。同时，`_enqueueChatSend` 返回 `false` 有两种含义：(a) 成功入队 (b) 重复消息被丢弃，§3.2 的 UI 提示"Gateway 繁忙，消息已排队"无法区分。建议：
- 保留 `if (!ws)` 的空值守卫
- 改善 `sendChat` 返回值语义，或给出可区分入队/重复/失败的状态

**P1-5 WS 重连/EventLoop 衰退重叠态未覆盖**
§3.2：移除 `isSendReady()` 检查后，eventLoopDegraded + 重连同时进行时，`sendChat` 会入队 `_pendingSendQueue`。但 `_replayQueuedSends` 依赖 `_state === "connected"` 才开始回放（§3.1）。若此时 EventLoop 也正在恢复中，可能出现竞争条件。建议：明确 eventLoop 恢复时是否也触发 `_scheduleQueueReplay`，或说明该竞争无实际影响。

**P1-6 UI spec 未同步**
§3.4 要在 `ChatInputArea` 增加 checkbox，但 `docs/specs/ui/web-chat-structure.md` 的 C3 输入区布局未包含此控件。建议：在方案中注明 spec 需要同步更新，或补充 UI diff。

### 建议优化（P2 — 不阻塞开发，建议修正）

- P2-1 `RESET_STATE` 时 `mergeEnabled` 是否重置未明确
- P2-2 空消息在合并发送中的行为（跳过 or 保留空行）未定义
- P2-3 `_pendingSendQueue` 在 `dispose()` 时是否清理未涉及

### 根因分析验证（源码对读结论）

已验证方案中引用的源码位置与行号准确：
- `gateway-ws.ts:1117-1147` — `_replayQueuedSends()` 去重逻辑 ✅
- `chat-service.ts:318-331` — `isSendReady()` 阻断 ✅
- `chat-service.ts:121-124` — `RESET_STATE` 未清理 pendingQueue ✅
- `gateway-ws.ts:368-410` — `sendChat()` / `_enqueueChatSend()` 入队机制 ✅

---

## 复审结论（2026-05-13）

### 审核清单复查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 需求背景清晰 | ✅ 通过 | 原有3缺陷 + 新增§2.4假连接/空回复根因分析完整，阶段链逻辑自洽 |
| 验收标准可量化 | ✅ 通过 | 14条验收标准均可逐条测试验证（去重安全、合并上限、空回复消除、假连接消除等） |
| 正常流程覆盖 | ✅ 通过 | 合并/顺序发送、WS排队、队列清理、延迟START_STREAMING、悲观初始化五路径完整 |
| 边界条件覆盖 | ✅ 通过 | 合并上限(10条/4096字符贪心打包)、toggle切换行为、空消息过滤、去重5s时间窗口 |
| 错误路径覆盖 | ✅ 通过 | ws=null守卫、sendChat三态返回值、_replaying互斥竞争保护、health宽限期内消息安全入队 |
| 无遗漏场景 | ✅ 通过 | 假连接+空回复双场景根因/修复覆盖完整、dispose()队列清理已确认、mergeEnabled持久化已明确 |
| spec交叉引用 | ✅ 通过 | STORY-0039路径已修正为`in-progress/`并确认存在、UI spec同步注释已添加 |

### 上次P1问题 — 全部修复 ✅

| P1 | 状态 | 验证 |
|----|------|------|
| P1-1 死链接 | ✅ 已修复 | 路径 `in-progress/STORY-0039-m3-func-chat-api`，文件存在 |
| P1-2 toggle行为 | ✅ 已修复 | §3.1 明确"下一轮processQueue()使用新策略" |
| P1-3 长度上限 | ✅ 已修复 | §3.1 10条上限 + 4096字符 + 贪心分包 + 100ms批间间隔 |
| P1-4 ws=null | ✅ 已修复 | §3.2 保留空值守卫，sendChat三态返回值语义表清晰 |
| P1-5 竞争条件 | ✅ 已修复 | §3.5 完整分析 _replaying 互斥链，确认无需额外同步 |
| P1-6 UI spec同步 | ✅ 已修复 | §3.4 已添加同步注释 |

### 新增内容审核（§2.4 + §3.6）

**§2.4 根因分析 — 优秀**
- 假连接根因链三阶段（乐观重置→宽限期盲区→空回复死锁）逻辑严密
- 行号引用准确（gateway-ws.ts:1059-1063, 748-753; chat-service.ts:333）
- 技术解释充分，非技术人员也可理解

**§3.6 修复方案 — 正确且充分**
- Fix A 延迟START_STREAMING：消除空回复根因，`sendChat()`返回false时不创建气泡 ✅
- Fix B 悲观初始化：`_eventLoopDegraded = true` + 宽限期15s→3s + health首次到达即更新 ✅
- 行为描述清晰（分5步说明转换链）

### P2 建议（不阻塞开发）

- **wsState映射细节**：§3.6计划要求UI在health确认前显示"connecting"而非"connected"，但方案未描述chat-service.ts中判断`_eventLoopDegraded`的代码变更。不过这不影响核心正确性——在3s宽限期内`isSendReady()`返回false，消息安全入队。建议在实现PR中注明此细节，或在验收标准中弱化为"重连后3s内消息不丢失/不假发送"。
- **验收标准重复行**：line 278-280 验收标准末4行有重复（TypeScript编译零错误 + 构建通过 出现2次），建议清理。

### 总评

方案文档从上一版的"有缺口但方向正确"升级为"覆盖面完整、边界清晰、可执行"。新增的假连接+空回复分析反映了对系统交互的深入理解。**批准进入开发阶段。**
