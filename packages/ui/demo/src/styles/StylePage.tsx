import type { ReactNode } from "react";

export interface StylePageProps {
  title: string;
  subtitle: string;
  /** 设计哲学的 3 行说明 */
  philosophy: string[];
  /** 主基调：用什么 className 包整个页面背景 */
  rootClassName?: string;
  /** 4 个核心样本槽 */
  statusCard: ReactNode;
  toolCallGroup: ReactNode;
  buttons: ReactNode;
  chatInput: ReactNode;
}

/**
 * 风格预览页通用容器：左侧设计说明，右侧 4 个核心样本。
 * 4 套风格用统一的样本类型，唯一变量 = 视觉。
 */
export function StylePage({
  title,
  subtitle,
  philosophy,
  rootClassName = "",
  statusCard,
  toolCallGroup,
  buttons,
  chatInput,
}: StylePageProps) {
  return (
    <div className={`min-h-[calc(100vh-3rem)] ${rootClassName}`}>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Style Lab · 风格探索
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            {philosophy.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1 w-1 rounded-full bg-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Slot title="OpenClaw 状态卡片">{statusCard}</Slot>
          <Slot title="按钮（3 状态）">{buttons}</Slot>
          <Slot title="工具调用 · 双层折叠" wide>
            {toolCallGroup}
          </Slot>
          <Slot title="Chat 输入框" wide>
            {chatInput}
          </Slot>
        </div>
      </div>
    </div>
  );
}

function Slot({
  title,
  children,
  wide,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "md:col-span-2" : ""}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
