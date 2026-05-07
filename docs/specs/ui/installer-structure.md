---
tags: [spec, ui, installer, M0]
created: 2026-05-04
status: accepted
---

# 安装向导 — UI 结构设计 / Installer Wizard UI Structure

> 范围：本 spec 只定义**信息架构 / 状态机 / 交互规则 / 线框骨架**。
> 不含具体视觉令牌（颜色/字体/间距），后者在 [[design-language]]（M3）统一。
> 实现归 [[../../tasks/backlog/EPIC-0000-m0-installer-wizard]] 系列 STORY。

## 1. 命名与定位

- 旧名：**首启向导（Setup Wizard）**
- 新名：**安装向导（Installer Wizard）**
- 入口位置：`apps/desktop` 启动后默认进入此页（已安装完成则进入 Status）
- 设计原则：
  1. 列表式，不是步骤式（无 Step 1/2/3 概念）
  2. 自顶向下"先底座、再界面、再 DCC、再外部 MCP 服务"
  3. 强依赖：OpenClaw 未就绪前禁止安装其他项
  4. UI 先行：本 spec 是实现的唯一布局/交互依据

## 2. 信息架构

```
安装向导（Installer Wizard）
├── 标题栏：Artifex Nexus · 安装向导
├── 全局工具条：[全局检测] [设置默认安装路径] [完成 / 进入应用]
├── 安装清单（Install List，主表）
│   ├── ⓘ OpenClaw                   ← 顶部固定，必装，不可折叠
│   ├── ⓘ Web UI                     ← 第二位，必装
│   ├── ▶ Blender         (M 已装 / N 可用)
│   ├── ▶ Unreal Engine   (M 已装 / N 可用)
│   ├── ▶ 3ds Max         (M 已装 / N 可用)
│   ├── ▶ Maya            (M 已装 / N 可用)
│   └── ▶ ComfyUI         (占位 · M8 启用)
├── 事件/日志面板（底部，可折叠，默认展开为 1/3 高度）
└── 设置抽屉（右侧，按需弹出）
```

> SP / SD / Houdini 等放入 [[../../tasks/backlog/EPIC-0009-m9-extra-dcc]]（M9），本期不渲染。

### 2.1 顶级条目字段

| 字段 | 含义 |
|---|---|
| icon | 16×16 品牌图标 |
| name | 显示名（如 "Unreal Engine"） |
| state | 见 §3 状态枚举（取**子项汇总**：见 §5.3） |
| actions | 三按钮：检测 / 设置 / 安装 |
| childCount | "已装 N · 可用 M · 已配置 K"（可展开类条目才显示） |

### 2.2 子项字段（DCC / ComfyUI 类）

| 字段 | 含义 | 示例 |
|---|---|---|
| label | 唯一标识（用户可改） | "Blender 4.2 主机" |
| version | DCC 版本 | "4.2.1" |
| installPath | DCC 安装路径 | `C:\Program Files\Blender Foundation\...` |
| projectPath | 工程路径（仅 UE 等需要） | `D:\Proj\MyGame` |
| scriptPath | 注入脚本路径（默认走仓内模板） | `<install>/plugins/blender/...` |
| state | 子项独立状态（§3） |
| actions | 子项按钮：检测 / 设置 / 安装 / 删除（详见 §5.4） |

## 3. 状态机

```
                ┌──────────────┐
                │ unavailable  │  系统不满足前置（如未装 DCC 本体）
                └──────┬───────┘
                       │ 检测后发现已具备前置
                       ▼
                ┌──────────────┐
                │   pending    │  等待前置依赖就绪（如 OpenClaw 未安装时其他项的初始状态）
                └──────┬───────┘
                       │ 前置依赖满足（如 OpenClaw 已安装）
                       ▼
                ┌──────────────┐
                │ not-installed│  前置已满足，可安装但尚未安装
                └──────┬───────┘
       点击"安装"或"重试" │
                       ▼
                ┌──────────────┐
                │  installing  │  ← 不可中断三按钮（除"取消"）
                └──┬─────────┬─┘
        成功 │              │ 失败
             ▼              ▼
      ┌───────────┐  ┌──────────┐
      │ installed │  │  failed  │  → 行内"查看详情"指向日志面板
      └─────┬─────┘  └────┬─────┘
            │             │ 重试
   检测发现新版│             ▼
            ▼          installing
      ┌───────────────┐
      │update-available│
      └───────────────┘
```

枚举（前端 / Tauri command 共用，落地到 contracts）：

```ts
type InstallItemState =
  | "unavailable"
  | "pending"
  | "not-installed"
  | "installing"
  | "installed"
  | "update-available"
  | "failed"
```

## 4. 三按钮规则

| 按钮 | 可见 | 启用条件 | installing 中 |
|---|---|---|---|
| 检测 | 常显 | 任何状态可点 | disabled |
| 设置 | 常显 | 任何状态可点 | disabled |
| 安装 | 常显 | `state ∈ {not-installed, failed, update-available}` | disabled，文案变"安装中…" |

**重装**：当 `state = installed`，"安装"按钮变形为次要按钮"重装"，点击需弹二次确认。

**依赖门禁**：

- 当 `OpenClaw.state ≠ installed`：所有非 OpenClaw 顶级条目与子项的"**安装**"按钮 disabled，hover 显示 tooltip："需先安装 OpenClaw"。
- 非 OpenClaw 条目初始状态为 `pending`（等待前置依赖）；OpenClaw 安装完成后自动切换为 `not-installed`。
- 检测 / 设置 不受门禁限制。

## 5. 交互规则

### 5.1 进入向导

1. 默认折叠所有 DCC 类条目（OpenClaw / Web UI 不可折叠）。
2. OpenClaw 初始状态为 `not-installed`；其他项初始状态为 `pending`（等待 OpenClaw 就绪）。
3. **自动触发一次全局检测**（异步，骨架先渲染，行内显示"检测中"占位徽章）。
4. 检测完成后填充各项 state；OpenClaw 优先级最高，先收到结果先渲染。

### 5.2 全局工具条

- **全局检测**：等价于"对每行点检测"。
- **设置默认安装路径**：打开右侧抽屉，编辑 `~/.artifexnexus/` 之外可选用户偏好（仅展示，本期可只读）。
- **完成**：仅当 `OpenClaw.state = installed AND Web UI.state ∈ {installed, not-installed}` 可点。否则置灰，tooltip 解释。

### 5.3 顶级条目状态汇总规则（DCC 类）

子项数为 0 → 顶级 state = `not-installed`。
否则按以下优先级取最严重者：

```
installing > failed > update-available > unavailable > pending > not-installed > installed
```

显示文案统一："已装 N · 可用 M · 已配置 K"
其中：
- N = `state = installed` 的子项数
- M = 系统检测到的 DCC 实例数（含未配置）
- K = 用户已配置的子项数

### 5.4 子项操作

每个子项独立按钮组：检测 / 设置 / 安装 / 删除。

- **检测**：仅刷新该子项 state。
- **设置**：在右侧抽屉打开**该子项**的字段编辑器（label / version / 各路径 / scriptPath）。
- **安装**：与顶级"安装"同语义，独立状态机。
- **删除**：移除该子项配置（**不卸载 DCC 本体**），二次确认。

> 主表**不能新增子项**。新增统一在"设置抽屉"内完成（§5.5）。

### 5.5 设置抽屉（右侧 Drawer）

抽屉内容随触发按钮上下文切换：

| 触发 | 抽屉内容 |
|---|---|
| 顶级条目"设置" | 该 DCC 的"实例列表"管理：列出所有子项，可"+ 新增实例" / 编辑 / 删除 / 复制 |
| 子项"设置" | 单个实例的字段编辑表单 |
| 全局工具条"设置默认安装路径" | 全局偏好（默认安装根路径、是否自动检测、日志保留行数等） |

抽屉规则：

- 宽度：400px（最小）/ 640px（最大），可拖拽
- 不遮挡主表；遮罩透明 + 主表可滚
- 顶部含标题 + 关闭 + 保存按钮；保存后即时回写到主表

### 5.6 事件/日志面板（底部）

- 默认展开，占视口高 1/3，可折叠到 24px 标题条
- 行格式：`[时间] [项][子项?] [级别] 消息`
- 级别：info / warn / error，颜色徽章
- 操作：复制全部 / 清空 / 跟随最新行
- 失败行带"重试"按钮，等价于在主表点该项"安装"
- 容量：内存只保留最后 200 行，文件落 `~/.artifexnexus/logs/installer/<date>.log`

## 6. 关键流程

### 6.1 首次进入（裸机）

```
启动 Tauri → 路由 / → 安装向导
  → 自动全局检测（300ms 内骨架可见）
  → OpenClaw 状态: not-installed
     · Web UI / DCC 的"安装"按钮全部 disabled，状态为 pending
  → 用户点 OpenClaw "安装"
     → 状态 → installing；按钮换"安装中…"
     → 完成后 → installed
     → 全部门禁解锁：其他项 pending → not-installed，"安装"按钮亮起
  → 用户依次安装 Web UI / 自己用的 DCC
  → 顶部"完成"按钮亮起 → 进入 Status 页
```

### 6.2 多版本 UE 配置

```
用户点 "Unreal Engine" → 设置（顶级）
  → 抽屉：实例列表（空）
  → "+ 新增实例"
     → 表单：label="UE 5.4 主项目" / version=5.4 / installPath / projectPath
     → 保存
  → 关闭抽屉，主表 UE 行展开，新子项出现，state=not-installed
  → 子项"安装" → installing → installed
  → 子项汇总文案更新
```

### 6.3 失败与重试

```
某子项 安装 → installing → failed
  · 行内徽章红色 + 文案"失败"
  · 行内"查看详情"链接 → 滚动并高亮日志面板对应段落
  · 主按钮"安装"自动变为"重试"
用户点"重试" → installing → ...
```

## 7. 线框（ASCII）

```
┌────────────────────────────────────────────────────────────────────┐
│ Artifex Nexus · 安装向导                                            │
│ [全局检测]  [默认设置]                                             │
├────────────────────────────────────────────────────────────────────┤
│  🦞  OpenClaw                                       ● 已安装        │
│      OpenClaw v0.x · 端口 19789                                    │
│      [检测]  [设置]  [重装]                                         │
├────────────────────────────────────────────────────────────────────┤
│  🌐  Web UI                                          ○ 待安装        │
│      Artifex Nexus 主界面                                          │
│      [检测]  [设置]  [安装]                                         │
├────────────────────────────────────────────────────────────────────┤
│ ▶ 🟧 Blender                       已装 1 · 可用 2 · 已配置 1        │
├────────────────────────────────────────────────────────────────────┤
│ ▼ 🟦 Unreal Engine                 已装 0 · 可用 1 · 已配置 2        │
│     ├─ UE 5.4 主项目              ⏳ 安装中…                        │
│     │  C:\UE_5.4 · D:\Proj\MyGame                                  │
│     │  [检测]  [设置]  [安装中…]  [删除]                            │
│     └─ UE 5.7 实验工程            ✕ 失败    [查看详情]              │
│        C:\UE_5.7 · D:\Proj\Lab                                     │
│        [检测]  [设置]  [重试]   [删除]                              │
├────────────────────────────────────────────────────────────────────┤
│ ▶ 🟪 3ds Max                       已装 0 · 可用 1 · 已配置 0        │
│ ▶ 🟫 Maya                          已装 0 · 可用 0 · 已配置 0        │
│ ▶ ⬛ ComfyUI                       占位 · M8 启用                   │
├──────────────── 事件 / 日志（▼ 折叠） ──────────────────────────────┤
│ 22:45:01  [Blender][4.2] info    检测：发现已安装                    │
│ 22:45:03  [UE][5.4 主项目] info  开始安装                          │
│ 22:45:09  [UE][5.7 实验] error   插件复制失败：拒绝访问              │
└────────────────────────────────────────────────────────────────────┘
```

## 8. 与已有架构的对接点

| 关注点 | 落位 | 备注 |
|---|---|---|
| Tauri command | `apps/desktop/src-tauri/src/commands/installer.rs` | 暴露 `detect_*`, `install_*`, `list_instances`, `set_instance` |
| 前端状态 | `apps/desktop/src/state/installer.ts`（新增） | reducer，键 = 顶级 id / 子项 id |
| Sidecar 调用 | 复用 `apps/desktop/src-tauri/src/sidecar/` | OpenClaw / Web UI 探测复用 |
| 日志落盘 | `~/.artifexnexus/logs/installer/<date>.log` | 与 OpenClaw 日志同根但独立子目录 |
| 配置 | `~/.artifexnexus/config/installer.json`（新增） | schema 在 [[../../../packages/platform/contracts/schemas/]] 下补 |

> 数据结构在 [[STORY-0002 实现期]] 落 contracts schema；本期 spec 不冻结字段名细节。

## 9. 非目标

- 本期不引入统一 design tokens（M3 EPIC-0003 完成后回填）。
- 本期不做"一键安装全部"按钮（M1 真实接入后再讨论）。
- 本期不做 i18n 切换 UI（仅文案 i18n-ready，渲染只中文）。
- 本期不做 SP / SD / Houdini 渲染（M9）。

## 10. 验收清单（与 STORY-0001 对齐）

- [x] 命名变更说明
- [x] 顶级条目清单 + DCC 子项字段表
- [x] 7 状态枚举与状态机图
- [x] OpenClaw 依赖门禁规则
- [x] 三按钮可见性 / 启用 / 重装变形规则
- [x] 设置抽屉 / 事件日志面板设计
- [x] 关键流程 3 例
- [x] 线框
- [x] 反链至 [[../../tasks/backlog/EPIC-0000-m0-installer-wizard]] 与 [[../../inbox/安装向导]]

## 11. OpenClaw 行专属规则（2026-05-07 增量，对应 STORY-0015/0016）

> EPIC-0001 第二批需求（设置面板 / Web UI 入口）让 OpenClaw 行的按钮组从 3 按钮升到 4 按钮。
> 本节是对 §4 / §7 的 OpenClaw 行特化覆盖，其它顶级条目仍按原 3 按钮规则。

### 11.1 4 按钮组

| 按钮 | 启用条件 | 点击行为 | 关联 STORY |
|---|---|---|---|
| 检测 | 任何状态 | 调 `openclaw.status` RPC | 已实现（S6） |
| 设置 | `state ∈ {installed, update-available}` | 打开 OpenClaw 设置面板 modal（详见 [[../openclaw-settings-panel]]） | STORY-0015 |
| Web UI | `state = installed` AND `gateway_running = true` AND `web_ui_available = true` | 调 `openclaw.web.get_url` 拿 URL，用 tauri-plugin-shell 打开默认浏览器 | STORY-0016 |
| 安装 / 重装 | 同 §4 通用规则 | 同 §4 | 已实现 |

**门禁覆盖**：
- 设置：`state ∉ {installed, update-available}` → disabled，tooltip "请先安装 OpenClaw"
- Web UI：
  - `state ≠ installed` → disabled，tooltip "请先安装 OpenClaw"
  - `gateway_running = false` → disabled，tooltip "Gateway 未运行"
  - `web_ui_available = false`（spike 后确认 OpenClaw 不带内建 Web UI）→ disabled，tooltip "当前版本未提供 Web UI"

### 11.2 4 按钮线框（替换 §7 OpenClaw 行）

```
├──────────────────────────────────────────────────────────────────────┤
│  🦞  OpenClaw                                       ● 已安装          │
│      OpenClaw v2026.5.4 · 端口 19789 · http://127.0.0.1:19789/ui     │
│      [检测]  [设置]  [Web UI]  [重装]                                  │
├──────────────────────────────────────────────────────────────────────┤
```

### 11.3 设置面板触发后的子流程

```
点"设置" → 打开 SettingsPanel modal
  → modal 内 RPC openclaw.config.read_models → 渲染 provider 列表
  → 用户改 / 测试 / 保存 → RPC openclaw.config.write_models
  → 关 modal 回主表，OpenClaw 行可能短暂显示"重启 Gateway 中…"（如更改影响运行时）
```

### 11.4 Web UI 入口子流程

```
点 "Web UI" → RPC openclaw.web.get_url
  → 返回 { url, available, reason? }
  → available = true: tauri-plugin-shell::open(url) → 默认浏览器打开
  → available = false: toast 显示 reason，按钮置灰
```

### 11.5 与状态汇总（§5.3）的关系

OpenClaw 不可折叠、无子项，状态汇总不涉及。但 OpenClaw 行的 `state` 现在多依赖一个
来源 `web_ui_available`（来自 `openclaw.status` 扩展返回字段，STORY-0016 spike 后引入）。

### 11.6 验收清单（追加）

- [ ] OpenClaw 行渲染 4 按钮（检测 / 设置 / Web UI / 安装|重装）
- [ ] 设置按钮在 not-installed / installing / failed 状态下置灰 + 正确 tooltip
- [ ] Web UI 按钮在 OpenClaw 不带内建 Web UI 时永久置灰，tooltip 准确
- [ ] 设置面板的 modal 关闭时不丢已编辑未保存内容（弹二次确认 "丢弃修改？"）
- [ ] Web UI 在默认浏览器打开，桌面应用自身不接管该窗口

## 相关

- [[../../inbox/安装向导]] — 原始需求
- [[../../tasks/backlog/EPIC-0000-m0-installer-wizard]] — 本期 EPIC
- [[../../tasks/backlog/STORY-0001-installer-ui-structure-spec]] — 本期 STORY
- [[../../tasks/backlog/STORY-0002-installer-list-shell]] — 直接消费本 spec 的实现 STORY
- [[../../tasks/done/STORY-0002-installer-list-shell]] — 安装清单骨架（已 done）
- [[../../tasks/done/STORY-0003-installer-status-state-machine]] — 状态机 + 依赖门禁（done）
- [[../../tasks/done/STORY-0004-installer-dcc-expandable]] — DCC 子项展开（done）
- [[../../tasks/review/STORY-0005-installer-tauri-build-artifact]] — Tauri 可分发产物（review）
- [[../../tasks/review/STORY-0006-merge-installer-into-desktop]] — 合并 installer 到 desktop（review）
- [[../openclaw-wrapper-install]] — 安装包/路径/分发底层规约
- [[../openclaw-wrapper-runtime]] — OpenClaw 运行时（被本向导调起）
- [[../openclaw-settings-panel]] — OpenClaw 设置面板（STORY-0015）
- [[../openclaw-agent-preset]] — Artifex Nexus 默认 agent 预设（STORY-0017）
- [[../../tasks/backlog/STORY-0015-openclaw-settings-panel]]
- [[../../tasks/backlog/STORY-0016-openclaw-web-ui-entry]]
- [[../../tasks/backlog/STORY-0017-openclaw-agent-preset]]
