---
tags: [spec, openclaw, agent, preset, M1]
created: 2026-05-07
updated: 2026-05-07
status: draft
version: v2-post-spike
related_story: "[[../tasks/backlog/STORY-0017-openclaw-agent-preset]]"
related_specs:
  - "[[openclaw-upstream-survey]]"
  - "[[openclaw-wrapper-install]]"
  - "[[openclaw-settings-panel]]"
  - "[[skill-system]]"
---

# Artifex Nexus 默认 Agent 预设（v2 · spike 后真相版）

> 面向：STORY-0017 implement。本文规定 OpenClaw 安装完成后自动注入的"Artifex Nexus
> 默认 agent"的内容、注入位置、幂等规则。
>
> **版本说明**：v1（2026-05-07 09:00）列了 ABC 三种注入位置候选（YAML 文件 /
> openclaw.json / CLI）；T8 spike 后确认 OpenClaw 实际用 `agents.list[]` 数组承载
> agent 预设，且字段名是 `systemPromptOverride` / `skills` 而非自定义命名。
> 故按真相重写为 v2。详细 spike 产物见 [[openclaw-upstream-survey]] §15。

## 1. 目的

OpenClaw 装完即开箱可用：用户首启就能在 Control UI / DCC chat 框得到一个**已经知道
Artifex Nexus 是什么、能调什么 MCP 工具、要遵守什么调用约定**的 agent。否则每个用户
都要自己写 system prompt，体验不连贯。

## 2. Preset 内容（v1.0.0，2026-05-07）

### 2.1 元数据 → openclaw.json 字段映射

| Preset 概念 | openclaw.json 路径（`agents.list[N]`） | 值 |
|---|---|---|
| ID | `id` | `"artifex-nexus"` |
| 显示名 | `name` | `"Artifex Nexus（DCC 桥默认助手）"` |
| 是否默认 | `default` | `true` |
| 工作区 | `workspace` | `"{{OPENCLAW_HOME}}/workspace"`（bootstrap 注入实际路径） |
| Agent runtime | `agentRuntime.id` | `"pi"`（OpenClaw 内置默认） |
| 模型绑定 | `model` | **不写**，让 agent 继承 `agents.defaults.model`（由 STORY-0015 设置面板控制） |
| 工具白名单 | `skills` | `["run_python"]`（M1 唯一 MCP 工具；M2/M3 后扩） |
| 推理模式 | `reasoningDefault` | `"on"`（让用户看到推理过程） |
| 思考强度 | `thinkingDefault` | `"adaptive"` |
| 详细程度 | `verboseDefault` | `"on"` |
| 工具进度 | `toolProgressDetail` | `"explain"` |
| 系统提示 | `systemPromptOverride` | 见 §2.2 全文 |

> wrapper 自己维护的元数据（`version` / `installedAt` / `checksum`）**不写入 openclaw.json**，
> 落到 `~/.artifexnexus/.openclaw/state/artifex-nexus-preset.lock` 单独文件（见 §4）。

### 2.2 System Prompt（中文，写入 `systemPromptOverride` 字段）

```
你是 Artifex Nexus 的默认 agent，一个把 AI 与数字内容创作工具（DCC）连起来的桥。

【你工作的项目】
- 项目名：Artifex Nexus
- 定位：AI Agent ↔ DCC 的桥（让 AI 能驱动 Unreal Engine / Blender 做事）
- 平台底座：OpenClaw（你正运行在它的 Gateway 内）
- 已支持的 DCC：Unreal Engine 5.7、Blender 5.1
- 后续规划：ComfyUI 工作流、Maya、Houdini（M8/M9）

【你能用的 MCP 工具】
唯一通用工具：`run_python`（Gateway 会按 DCC 自动加前缀，例如 `mcp_unreal_run_python`、
`mcp_blender_run_python`）。每个 DCC 的 run_python 在该 DCC 进程内执行 Python，
能拿到该 DCC 的原生 API（unreal.* / bpy.*）。

【调用约定】
1. 用户描述意图后，先判断在哪个 DCC 执行：未明示就问一句，不要默认。
2. 写 run_python 代码前，先用一两句话告诉用户你要做什么、产出是什么、可能的副作用。
3. 一次执行一个原子操作，避免一段脚本干多件事；多步任务分多次 run_python。
4. 始终用 try/except 兜底；执行结果用 `print(json.dumps(...))` 结构化返回，
   便于你下一轮解析。
5. 中文与用户沟通；代码注释中文；变量名与 API 用英文（DCC 原生命名）。

【Skill 体系】
Artifex Nexus 有自己的 Skill SDK（`from artifex_nexus.skill import tool, ToolResult`）。
当用户的需求复用价值高，建议提示："这个流程可以沉淀成一个 Skill，要我帮你写吗？"
但不要主动改写用户已有 Skill；列出/调用 Skill 用 `list_skills()` / `execute()`。

【安全边界】
- 不直接读写用户工作区之外的文件（workspace 由 Gateway 注入到 run_python env）。
- 涉及"删除资产 / 覆盖工程文件 / 执行 shell 命令"的操作必须先口头确认。
- API Key、token、密码绝不写进代码或日志。
- 不调用 OpenClaw 内置的 browser 自动化访问外网，除非用户显式要求。

【沟通风格】
简洁、专业、不啰嗦；不会的就说不会；解决了就说"完成"，并附一句"下一步建议"。
```

### 2.3 工具白名单：`skills` 字段语义

T8 spike 发现 `agents.list[].skills` 是**字符串数组，已配的 skill ID 列表**。

OpenClaw 的 "skill" 概念**与 Artifex Nexus 的 Skill SDK 不是同一个东西**：
- OpenClaw skill = MCP tool / capability 入口
- Artifex Nexus Skill = `@tool` 装饰的 Python 函数包

我们的预设要往 OpenClaw `skills` 字段写的是**"对应 OpenClaw 侧 MCP 工具的注册名"**。
v1.0.0 暂只有 `["run_python"]`（这是 OpenClaw gateway 暴露的工具名前缀；具体注册名
需 STORY-0017 implement 时跑 `openclaw skills list` 实测确认）。

> ⚠ 待 STORY-0017 implement 时实测：`openclaw skills list --json`，确认 run_python
> 在上游叫什么名字（可能是 `mcp.run_python` / `gateway.run_python` 等）。如名字不同，
> 本节字段值要回填。

### 2.4 模型绑定：故意不写

`agents.list[<artifex-nexus>].model` **故意省略**，OpenClaw 会自动继承
`agents.defaults.model`。这样用户在 STORY-0015 设置面板切换默认模型时，
Artifex Nexus 默认 agent 自动跟随，无需重新注入预设。

## 3. 注入实现（spike 后定方案 = 走 `config patch`）

T8 spike 三个候选最终选定：

- ❌ **A** YAML 文件（`workspace/agents/<id>.yaml`）：上游不读这种文件，作废
- ✅ **B** `openclaw.json` 的 `agents.list[]` 数组（**主路径**）
- ⚠ **C** CLI `openclaw agents add`：能用，但**不支持 `--system-prompt` 参数**，
  无法注入预设核心内容；可选作"创建占位"，但仍要走 B 补 prompt

最终方案：**走 `openclaw config patch --stdin` 直接 patch `agents.list[]`**。

### 3.1 注入伪代码

```python
def install_default_preset(openclaw_home: Path, openclaw_bin: Path) -> None:
    """注入 Artifex Nexus 默认 agent 预设（幂等）。"""
    lock_path = openclaw_home / "state" / "artifex-nexus-preset.lock"

    # 1. 渲染模板
    preset = _render_v1_0_0(openclaw_home)
    new_checksum = _sha256(json.dumps(preset, sort_keys=True))

    # 2. 幂等检查
    if lock_path.exists():
        lock = json.loads(lock_path.read_text())
        if lock["version"] == "1.0.0" and lock["checksum"] == new_checksum:
            return  # 已经是最新版，跳过
        if _is_modified_by_user(openclaw_bin, openclaw_home, lock):
            log.warn("用户已自定义 Artifex Nexus preset，跳过更新")
            return

    # 3. 读现有 agents.list（patch 对数组是 replace，必须先读再合并）
    existing = _config_get(openclaw_bin, openclaw_home, "agents.list")
    merged = _upsert_by_id(existing or [], preset)  # 同 id 替换，否则追加

    # 4. patch 写入
    patch = {"agents": {"list": merged}}
    _config_patch(openclaw_bin, openclaw_home, patch)

    # 5. 写 lock
    lock_path.write_text(json.dumps({
        "version": "1.0.0",
        "installedAt": datetime.now(timezone.utc).isoformat(),
        "checksum": new_checksum,
    }, indent=2))
```

### 3.2 关键陷阱：`config patch` 对数组是 replace

T8 spike 后看 schema 描述：`config patch` 的合并语义是 "objects merge recursively,
**arrays/scalars replace**, and null deletes a path"。

意味着如果 patch 只发 `{agents: {list: [<artifex-nexus-preset>]}}`，**会把用户自己加的
其它 agent 全部干掉**。所以 §3.1 步骤 3 必须先 `config get agents.list` 读出来再合并。

## 4. 幂等三态与 lock 文件

### 4.1 lock 文件位置与 schema

```
~/.artifexnexus/.openclaw/state/artifex-nexus-preset.lock
```

```json
{
  "version": "1.0.0",
  "installedAt": "2026-05-07T13:23:40+08:00",
  "checksum": "sha256:abc123..."
}
```

### 4.2 三态行为

| 场景 | 检测条件 | 行为 |
|---|---|---|
| 首次安装 | lock 不存在 | 直接 upsert + 写 lock |
| 重复 bootstrap，预设未被改 | lock.checksum == 当前 openclaw.json 中 artifex-nexus 的 checksum | 跳过 |
| 重复 bootstrap，预设被用户改 | checksum 不一致 | log.warn 并**不覆盖**；提示用户走"重置"按钮 |
| 设置面板"重置默认 agent 预设" | 走 `reset_default(force=True)` RPC | 强制 upsert + 更新 lock；UI 二次确认 |
| 预设版本升级 v1.0.0 → v1.1.0 | lock.version 旧 | 旧版 + 未被用户改 → 升；用户改过 → warn |

### 4.3 "用户是否改过" 的判断

```python
def _is_modified_by_user(openclaw_bin, openclaw_home, lock) -> bool:
    """从 openclaw.json 读出当前 artifex-nexus agent，对比 lock.checksum。"""
    current = _config_get(openclaw_bin, openclaw_home, "agents.list")
    if not current:
        return False  # 用户删了，按未改处理（重新注入）
    found = next((a for a in current if a["id"] == "artifex-nexus"), None)
    if not found:
        return False
    current_checksum = _sha256(json.dumps(found, sort_keys=True))
    return current_checksum != lock["checksum"]
```

## 5. 与 sidecar 的对接

新增 sidecar JSON-RPC 方法：

| 方法 | 入参 | 返回 | 语义 |
|---|---|---|---|
| `openclaw.agent_preset.status` | `{}` | `{installed: bool, version: string, modifiedByUser: bool, lockPath: string}` | 探测预设状态 |
| `openclaw.agent_preset.reset_default` | `{force: bool}` | `{success: bool, error?: string}` | 强制重装预设；force=true 允许覆盖用户改动 |

bootstrap.py 内部直接调内部函数（不走 RPC，因为 RPC 要 gateway 跑起来才能用），
仅"重置"按钮走 RPC。

## 6. 模板变量

`packages/adapters/openclaw/wrapper/src/.../assets/agents/artifex-nexus.preset.json.tpl`：

```json
{
  "id": "artifex-nexus",
  "default": true,
  "name": "Artifex Nexus（DCC 桥默认助手）",
  "workspace": "{{OPENCLAW_WORKSPACE}}",
  "agentRuntime": { "id": "pi" },
  "skills": ["run_python"],
  "reasoningDefault": "on",
  "thinkingDefault": "adaptive",
  "verboseDefault": "on",
  "toolProgressDetail": "explain",
  "systemPromptOverride": {{SYSTEM_PROMPT_JSON}}
}
```

替换变量：
- `{{OPENCLAW_WORKSPACE}}` → `<openclaw_home>/workspace` 的实际路径
- `{{SYSTEM_PROMPT_JSON}}` → §2.2 全文经 `json.dumps()` 转义后的 JSON 字符串

模板单独存为 `.json.tpl` 而不是 inline string，方便 v1.1+ 改 prompt 时只动模板文件。

## 7. 测试要点

- 单测：`agent_preset.py` 三场景（首次 / 重复未改 / 重复已改）+ checksum + lock 格式 ≥ 8 个用例
- 单测：模板变量替换、JSON 转义（system prompt 含特殊字符）
- 单测：`_upsert_by_id` 函数（空数组 / 同 id 替换 / 不同 id 追加 / 多个同 id 取首条）
- 集成：`bootstrap` 后调 `openclaw config get agents.list --json`，断言含 `artifex-nexus` 条目
- E2E（M1 smoke）：装完 OpenClaw → 打开 Control UI（依赖 STORY-0016）→ agent 列表见
  `Artifex Nexus（DCC 桥默认助手）` → 选中后能 chat → agent 自我介绍提及 "Artifex Nexus" 与 "DCC 桥"

## 8. 未来演进

- v1.1：M2 Blender 插件就绪后，preset 内"已支持的 DCC"自动同步实际可用列表（模板变量化）
- v1.2：M4 Skill 系统就绪后，preset 提示语接入真实 `list_skills()` 输出，并把
  Artifex Nexus skill ID 加入 `skills` 数组
- v2.0：英文版 system prompt（i18n 切换）

## 9. 实测约束 / TBD

| # | 项 | 何时解 |
|---|---|---|
| Q1 | OpenClaw `skills` 字段是否就是字面 `["run_python"]`，还是要带前缀（如 `mcp.run_python`） | STORY-0017 implement 时 `openclaw skills list --json` 实测 |
| Q2 | `agentRuntime.id="pi"` 是默认值还是必填 | implement 时实测，可能能省略 |
| Q3 | `config patch` 对 `agents.list` 数组的 replace 行为，是否在 `--strict-json` 模式下能切成 merge | 看 [[openclaw-upstream-survey]] §13.6，估计不能；策略已采用"先 get 后合并" |
| Q4 | OpenClaw v2026.5.4 是否支持 system prompt 的多行字符串（YAML literal block 等价） | implement 时实测；JSON `\n` 转义即可 |

## 相关

- [[../tasks/backlog/STORY-0017-openclaw-agent-preset]]
- [[openclaw-upstream-survey]] §15（spike 真相）
- [[openclaw-settings-panel]] §9
- [[skill-system]]
- [[../../.ai/context/project-overview]]
