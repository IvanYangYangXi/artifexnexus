/**
 * inspector-panel.tsx — 通用 Inspector 容器（M10 数据 / M11 工作流共用）
 *
 * 设计：
 *   - 单一抽象 = 顶部分页 Tabs + 内容区
 *   - 不绑定具体内容，由消费者通过 `tabs` 数组传入 React 节点
 *   - 选中态由父组件 / 自身二选一（unControlled 时由 useState 管理）
 *   - 与 design tokens 对齐：bg-card / border / muted-foreground
 *
 * 使用：
 *   <InspectorPanel
 *     tabs={[
 *       { id: "node", label: "节点", content: <NodeInspector ... /> },
 *       { id: "edge", label: "连线", content: <EdgeInspector ... /> },
 *     ]}
 *     activeId={activeId}
 *     onChange={setActiveId}
 *   />
 */

import * as React from "react";
import { cn } from "../lib/cn";

export interface InspectorTab {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
  /** 是否禁用该 tab */
  disabled?: boolean;
}

export interface InspectorPanelProps {
  tabs: InspectorTab[];
  /** 受控：当前选中 id */
  activeId?: string;
  /** 受控：切换回调 */
  onChange?: (id: string) => void;
  /** 非受控时的默认 id */
  defaultActiveId?: string;
  /** 头部右侧操作槽 */
  headerExtra?: React.ReactNode;
  className?: string;
}

export function InspectorPanel({
  tabs,
  activeId: controlled,
  onChange,
  defaultActiveId,
  headerExtra,
  className,
}: InspectorPanelProps) {
  const [internalId, setInternalId] = React.useState<string | undefined>(
    defaultActiveId ?? tabs[0]?.id,
  );
  const activeId = controlled ?? internalId;
  const setActive = (id: string) => {
    if (controlled === undefined) setInternalId(id);
    onChange?.(id);
  };
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-card text-card-foreground",
        className,
      )}
      data-testid="inspector-panel"
    >
      <div className="flex items-center justify-between border-b border-border px-2">
        <div role="tablist" className="flex items-center gap-1 overflow-x-auto py-1">
          {tabs.map((t) => {
            const isActive = t.id === active?.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={isActive}
                disabled={t.disabled}
                onClick={() => !t.disabled && setActive(t.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                  t.disabled && "cursor-not-allowed opacity-50",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {headerExtra ? <div className="flex items-center gap-1">{headerExtra}</div> : null}
      </div>
      <div role="tabpanel" className="flex-1 overflow-auto p-3 text-sm">
        {active?.content}
      </div>
    </div>
  );
}
