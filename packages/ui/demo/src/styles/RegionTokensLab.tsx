import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardSection,
  ToolCallGroup,
  type ToolCallData,
} from "@artifex-nexus/ui";

/**
 * Region Tokens 共存方案探索
 *
 * 问题：VS Code 风 4 层灰阶 token（titlebar/sidebar/panel）
 * 与风格 E 玻璃面（glass-surface）如何共存？
 *
 * 三种方案并列对比，每方案用同一组样本（顶栏 + 导航 + 主区 + D 区面板 + 一张玻璃卡片）。
 */

const TOOLS: ToolCallData[] = [
  {
    id: "t1",
    name: "mcp_blender_run_python",
    status: "done",
    durationMs: 312,
    args: { code: "bpy.ops..." },
    result: "OK",
  },
  {
    id: "t2",
    name: "mcp_blender_run_python",
    status: "running",
    args: { code: "obj.location = ..." },
  },
];

export function RegionTokensLab() {
  return (
    <div className="min-h-[calc(100vh-3rem)] bg-background px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <header>
          <div className="text-eyebrow">Region Tokens Lab</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            灰阶 token vs 玻璃面 · 共存策略
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            横向对比 3 种共存方式。同一组样本：顶栏 / 导航 / 主区 / D 面板 + 一张玻璃卡。
          </p>
        </header>

        <Plan1 />
        <Plan2 />
        <Plan3 />

        <footer className="rounded-md border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-muted-foreground">
          <div className="text-eyebrow mb-1">怎么看</div>
          <ul className="space-y-1">
            <li>
              <strong className="text-foreground">方案 1 推荐</strong>：保留三个灰阶 token，玻璃靠 Card variant 实现。
              主框架（顶栏 / 导航 / D 面板）是 <em>不透明</em> 的灰阶层，玻璃只用在飘起来的卡片 / 弹层。
            </li>
            <li>
              <strong className="text-foreground">方案 2</strong>：全玻璃。删除灰阶 token，所有区域都是半透明白底叠加，靠背景色统一。视觉最"高级"但识别度差。
            </li>
            <li>
              <strong className="text-foreground">方案 3</strong>：玻璃独立 token。新增 --glass-bg/--glass-border/--glass-shadow，
              可独立调校玻璃强度，灰阶不动。最灵活但概念最多。
            </li>
          </ul>
        </footer>
      </div>
    </div>
  );
}

/* ─────────────── 方案 1：灰阶不透明 + 玻璃只用在卡片/弹层 ─────────────── */

function Plan1() {
  return (
    <Plan
      title="方案 1 · 推荐 · 灰阶 + 玻璃分层"
      desc="主框架（顶栏 / 导航 / D 面板）= 不透明灰阶 token；玻璃面只用在卡片 / Dialog / Popover / Sheet（飘起来的前台元素）"
      sample={
        <Frame>
          {/* A 顶栏 — 用 titlebar token */}
          <div className="flex h-9 items-center gap-2 border-b border-white/[0.05] bg-titlebar px-3 text-titlebar-foreground">
            <span className="text-xs font-semibold">Artifex Nexus</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              titlebar
            </span>
          </div>
          <div className="flex h-[280px]">
            {/* B 导航 — 用 sidebar token */}
            <div className="w-32 border-r border-white/[0.05] bg-sidebar p-2 text-sidebar-foreground">
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                Modules
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="rounded px-1.5 py-1 bg-white/[0.05]">
                  💬 Chat
                </div>
                <div className="rounded px-1.5 py-1">⚡ Skills</div>
              </div>
            </div>
            {/* C 主区 — bg-background，玻璃 Card 浮起 */}
            <div className="flex-1 space-y-2 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                background + Card variant=glass
              </div>
              <Card variant="glass">
                <CardSection first>
                  <div className="text-eyebrow">玻璃卡片</div>
                  <div className="mt-1 text-sm font-medium">OpenClaw Gateway</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="secondary">running</Badge>
                    <Avatar className="h-5 w-5" ring="none">
                      <AvatarFallback className="text-[10px]">U</AvatarFallback>
                    </Avatar>
                  </div>
                </CardSection>
              </Card>
              <ToolCallGroup tools={TOOLS} />
            </div>
            {/* D 面板 — 用 panel token */}
            <div className="w-44 border-l border-white/[0.05] bg-panel p-2 text-panel-foreground">
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                D · Panel
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="rounded px-1.5 py-1">📄 file1.py</div>
                <div className="rounded px-1.5 py-1 bg-white/[0.04]">
                  📄 file2.py
                </div>
              </div>
            </div>
          </div>
        </Frame>
      }
      pros={[
        "概念最少：3 个灰阶 token + 1 个 Card glass variant",
        "性能好：主框架不 blur，只有 5-10 个浮起卡片用 blur",
        "VS Code 用户看着熟悉",
        "玻璃叠在不同灰阶上视觉自然分明",
      ]}
      cons={[
        "玻璃只在卡片/弹层出现，主框架不会有强烈的高级感",
        "需要文档明确何时用玻璃，避免到处滥用",
      ]}
    />
  );
}

/* ─────────────── 方案 2：全玻璃 / 删除灰阶 token ─────────────── */

function Plan2() {
  return (
    <Plan
      title="方案 2 · 全玻璃"
      desc="删除 titlebar/sidebar/panel token，所有区域统一用半透明白底叠加；靠背景色（bg-background + 渐变）统一基调"
      sample={
        <Frame>
          <div className="flex h-9 items-center gap-2 border-b border-white/[0.06] bg-white/[0.04] backdrop-blur-md px-3">
            <span className="text-xs font-semibold">Artifex Nexus</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              white/[0.04]
            </span>
          </div>
          <div className="flex h-[280px]">
            <div className="w-32 border-r border-white/[0.06] bg-white/[0.025] backdrop-blur-md p-2">
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                Modules
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="rounded px-1.5 py-1 bg-white/[0.08]">
                  💬 Chat
                </div>
                <div className="rounded px-1.5 py-1">⚡ Skills</div>
              </div>
            </div>
            <div className="flex-1 space-y-2 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                C 区也半透明
              </div>
              <Card variant="glass">
                <CardSection first>
                  <div className="text-eyebrow">玻璃卡片</div>
                  <div className="mt-1 text-sm font-medium">嵌套玻璃</div>
                </CardSection>
              </Card>
              <ToolCallGroup tools={TOOLS} />
            </div>
            <div className="w-44 border-l border-white/[0.06] bg-white/[0.04] backdrop-blur-md p-2">
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                D · Panel
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="rounded px-1.5 py-1">📄 file1.py</div>
                <div className="rounded px-1.5 py-1 bg-white/[0.06]">
                  📄 file2.py
                </div>
              </div>
            </div>
          </div>
        </Frame>
      }
      pros={[
        "视觉一致性最高，全玻璃高级感",
        "Token 更少（删 3 个 region token）",
      ]}
      cons={[
        "区域识别度差：顶栏 / 导航 / D 面板视觉差异变小",
        "性能差：所有面都 blur，弱机器卡顿",
        "玻璃叠玻璃会出现“灰糊”现象（多层透明叠加颜色饱和度下降）",
        "VS Code 习惯用户会觉得扁平、找不到边界",
      ]}
    />
  );
}

/* ─────────────── 方案 3：玻璃独立 token ─────────────── */

function Plan3() {
  return (
    <Plan
      title="方案 3 · 玻璃独立 token"
      desc="新增 --glass-bg / --glass-border / --glass-shadow 三个专用 token；灰阶 token 不动。Card 玻璃 variant 用新 token，可独立调强度"
      sample={
        <Frame>
          {/* 与方案 1 一致的灰阶框架 */}
          <div className="flex h-9 items-center gap-2 border-b border-white/[0.05] bg-titlebar px-3 text-titlebar-foreground">
            <span className="text-xs font-semibold">Artifex Nexus</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              灰阶不变
            </span>
          </div>
          <div className="flex h-[280px]">
            <div className="w-32 border-r border-white/[0.05] bg-sidebar p-2 text-sidebar-foreground">
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                Modules
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="rounded px-1.5 py-1 bg-white/[0.05]">
                  💬 Chat
                </div>
                <div className="rounded px-1.5 py-1">⚡ Skills</div>
              </div>
            </div>
            <div className="flex-1 space-y-2 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                glass token 可独立调强度
              </div>
              {/* 演示：3 档玻璃强度 */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["弱", "border-white/[0.04] bg-white/[0.02] backdrop-blur-md"],
                  ["默认", "border-white/[0.08] bg-white/[0.04] backdrop-blur-xl"],
                  ["强", "border-white/[0.14] bg-white/[0.08] backdrop-blur-2xl"],
                ].map(([label, cls]) => (
                  <div
                    key={label}
                    className={`rounded-[12px] p-3 ${cls}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </div>
                    <div className="mt-1 text-xs">玻璃强度</div>
                  </div>
                ))}
              </div>
              <ToolCallGroup tools={TOOLS} />
            </div>
            <div className="w-44 border-l border-white/[0.05] bg-panel p-2 text-panel-foreground">
              <div className="text-[10px] uppercase tracking-wider opacity-60">
                D · Panel
              </div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="rounded px-1.5 py-1">📄 file1.py</div>
                <div className="rounded px-1.5 py-1 bg-white/[0.04]">
                  📄 file2.py
                </div>
              </div>
            </div>
          </div>
        </Frame>
      }
      pros={[
        "灵活：玻璃强度可主题化（如 macOS 偏强、Linux 偏弱）",
        "与方案 1 视觉等同，但抽象更彻底",
        "未来要出“半玻璃 / 实心玻璃”variant 时不混乱",
      ]}
      cons={[
        "概念多：开发者要记“灰阶 vs 玻璃”两套 token 体系",
        "短期价值低：M3 阶段没有对玻璃强度调档需求",
        "增加文档维护成本",
      ]}
    />
  );
}

/* ─────────────── 子构件 ─────────────── */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-white/[0.06] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
      {children}
    </div>
  );
}

function Plan({
  title,
  desc,
  sample,
  pros,
  cons,
}: {
  title: string;
  desc: string;
  sample: React.ReactNode;
  pros: string[];
  cons: string[];
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      {sample}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
          <div className="text-eyebrow text-emerald-300/70">优点</div>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {pros.map((p, i) => (
              <li key={i} className="text-emerald-200/85">
                + {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-rose-500/20 bg-rose-500/[0.04] p-3">
          <div className="text-eyebrow text-rose-300/70">缺点</div>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {cons.map((c, i) => (
              <li key={i} className="text-rose-200/85">
                − {c}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

void Button;
