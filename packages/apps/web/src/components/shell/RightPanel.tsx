"use client";

/**
 * RightPanel — D 区右侧面板（D1-D5）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §8
 * 所有面板内容区使用 ScrollFade 组件（滚动 + 底部过渡光晕）
 *
 * STORY-0048: D1-D3 接入真实 API，D5 接入 ToolDetailPanel。
 * STORY-0054: 三态折叠/隐藏 + 双列模式。
 */

import * as React from "react";
import {
  Clock,
  Eye,
  EyeOff,
  FileText,
  FolderTree,
  Pin,
  PinOff,
  Play,
  Puzzle,
  Search,
  Wrench,
  Loader2,
} from "lucide-react";

import {
  Button,
  cn,
  CollapsiblePanel,
  CollapsiblePanelGroup,
  Input,
} from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { PreviewFileContext, PreviewContext, PinnedSkillsContext } from "./AppShell";
import { ToolDetailPanel } from "../skills/ToolDetailPanel";
import { SkillDetailPanel } from "../skills/SkillDetailPanel";
import { MarkdownPreview } from "../markdown/MarkdownPreview";
import { RunPanel } from "../skills/RunPanel";
import { ResourceExplorer } from "./ResourceExplorer";
import {
  type SkillItem,
  skillList,
} from "../../lib/skill/skill-api";
import {
  type NexusToolItem,
  nexusToolList,
} from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS } from "../../lib/skillsMock";
import { useRecentStore } from "../../lib/useRecentStore";
import type { CalendarTask } from "../../lib/calendar/types";
import { describeCron } from "../../lib/calendar/cron-utils";

export function RightPanel() {
  const { previewFile } = React.useContext(PreviewFileContext);
  const { preview, setPreview, clearPreview, ensurePanelOpen } = React.useContext(PreviewContext);
  const { pinnedSkills, togglePin } = React.useContext(PinnedSkillsContext);
  const { recentItems, addRecentSkill, addRecentTool } = useRecentStore();
  // tool run panel: triggered via PreviewContext, see PreviewRenderer

  // ─── 列归属持久化 ──────────────────────────────────────
  const COLUMN_STORAGE_KEY = "artifex.shell.dpanel.columnAssignments";
  const [columnAssignments, setColumnAssignments] = React.useState<Record<string, "left" | "right">>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const handleColumnChange = React.useCallback((assignments: Record<string, "left" | "right">) => {
    setColumnAssignments(assignments);
    try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(assignments)); } catch {}
  }, []);

  // ─── 真实 API：Skill 列表 ───────────────────────────────────────
  const [skills, setSkills] = React.useState<SkillItem[]>([]);
  const [skillsLoading, setSkillsLoading] = React.useState(true);
  React.useEffect(() => {
    (async () => {
      try {
        const result = await skillList({ limit: 50 });
        setSkills(result.items);
      } catch { /* sidecar 不可用时静默 */ }
      finally { setSkillsLoading(false); }
    })();
  }, []);

  // ─── 真实 API：Tool 列表 ────────────────────────────────────────
  const [tools, setTools] = React.useState<NexusToolItem[]>([]);
  const [toolsLoading, setToolsLoading] = React.useState(true);
  const loadTools = React.useCallback(async () => {
    try {
      setToolsLoading(true);
      const result = await nexusToolList({ limit: 200 });
      setTools(result.items);
    } catch { /* sidecar 不可用时静默 */ }
    finally { setToolsLoading(false); }
  }, []);
  React.useEffect(() => { loadTools(); }, [loadTools]);

  // ─── 搜索状态 ────────────────────────────────────────────────
  const [skillSearch, setSkillSearch] = React.useState("");
  const [toolSearch, setToolSearch] = React.useState("");

  // ─── 过滤列表 ─────────────────────────────────────────────────
  const filteredSkills = React.useMemo(() => {
    // 只显示已安装的 Skill
    const installed = skills.filter((s) => s.installed);
    if (!skillSearch.trim()) return installed;
    const q = skillSearch.toLowerCase();
    return installed.filter((s) =>
      (s.display_name || s.name).toLowerCase().includes(q)
    );
  }, [skills, skillSearch]);

  const filteredTools = React.useMemo(() => {
    if (!toolSearch.trim()) return tools;
    const q = toolSearch.toLowerCase();
    return tools.filter((t) => t.name.toLowerCase().includes(q));
  }, [tools, toolSearch]);

  // ─── Skill 点击 → D5 预览 ─────────────────────────────────────
  const handleSkillClick = React.useCallback((s: SkillItem) => {
    setPreview({
      kind: "skill-detail",
      title: s.display_name || s.name,
      data: { skillName: s.name },
    });
  }, [setPreview]);

  /** 从最近使用记录中跳转到 Skill 详情（只传必要字段，不构造假 SkillItem） */
  const handleRecentSkillClick = React.useCallback((skillName: string, displayName: string) => {
    setPreview({
      kind: "skill-detail",
      title: displayName || skillName,
      data: { skillName },
    });
  }, [setPreview]);

  /** 从最近使用记录中跳转到 Tool 详情（只传必要字段，不构造假 NexusToolItem） */
  const handleRecentToolClick = React.useCallback((toolId: string, toolName: string) => {
    setPreview({
      kind: "nexus-tool-detail",
      title: toolName,
      data: { toolId, toolName },
    });
  }, [setPreview]);

  // ─── Tool 分组（按 source → software 聚合）────────────────────
  const toolGroups = React.useMemo(() => {
    const map = new Map<string, NexusToolItem[]>();
    filteredTools.forEach((t) => {
      const first = t.software?.[0];
      const key = (typeof first === "string" ? first : first?.dcc) || "general";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return Array.from(map.entries()).map(([dcc, items]) => ({ dcc, items }));
  }, [filteredTools]);

  const handleToolClick = React.useCallback((tool: NexusToolItem) => {
    setPreview({
      kind: "nexus-tool-detail",
      title: tool.name,
      data: { toolId: tool.id, toolName: tool.name },
    });
  }, [setPreview]);

  const handleToolRunFromPanel = React.useCallback((tool: NexusToolItem) => {
    addRecentTool(tool.id, tool.name);
    setPreview({
      kind: "nexus-tool-run",
      title: `运行: ${tool.name}`,
      data: { toolId: tool.id },
    });
  }, [setPreview, addRecentTool]);
  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel text-panel-foreground">
      <CollapsiblePanelGroup
        dualColumn
        defaultColumnRatio={40}
        columnAssignments={columnAssignments}
        onColumnChange={handleColumnChange}
      >
        {/* D1 最近使用 */}
        <CollapsiblePanel
          id="recent"
          order={1}
          title="最近使用"
          icon={<Clock className="h-3 w-3" />}
          badge={recentItems.length || undefined}
          defaultSize={18}
          minSize={12}
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            <ul className="space-y-px py-1 text-xs">
              {recentItems.map((item) => (
                <li
                  key={`${item.type}-${item.type === "pin" ? item.name : item.id}`}
                  className="flex h-6 items-center gap-2 rounded px-2 hover:bg-accent/40"
                >
                  <span
                    className="truncate text-[11px] cursor-pointer flex-1 min-w-0"
                    onClick={() => {
                      if (item.type === "pin") {
                        handleRecentSkillClick(item.name, item.displayName);
                      } else {
                        handleRecentToolClick(item.id, item.name);
                      }
                    }}
                  >
                    {"displayName" in item ? item.displayName : item.name}
                  </span>
                  {item.type === "pin" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!pinnedSkills.includes(item.name)) {
                          addRecentSkill(item.name, item.displayName);
                        }
                        togglePin(item.name);
                      }}
                    >
                      {pinnedSkills.includes(item.name) ? (
                        <PinOff className="h-3 w-3" />
                      ) : (
                        <Pin className="h-3 w-3" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        addRecentTool(item.id, item.name);
                        setPreview({
                          kind: "nexus-tool-run",
                          title: `运行: ${item.name}`,
                          data: { toolId: item.id },
                        });
                      }}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              ))}
              {recentItems.length === 0 && (
                <li className="px-2 py-2 text-muted-foreground">暂无使用记录</li>
              )}
            </ul>
          </ScrollFade>
        </CollapsiblePanel>

        {/* D2 Skill 列表 */}
        <CollapsiblePanel
          id="skills"
          order={2}
          title="Skill 列表"
          icon={<Puzzle className="h-3 w-3" />}
          badge={filteredSkills.length || undefined}
          defaultSize={22}
          minSize={14}
          defaultOpen={false}
        >
          <div className="flex h-full flex-col overflow-hidden">
            <div className="relative shrink-0 px-2 pb-1">
              <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-6 pl-6 text-[11px]"
                placeholder="搜索 Skill..."
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
                {skillsLoading ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </div>
                ) : (
                  <ul className="space-y-px py-1 text-xs">
                    {filteredSkills.map((s) => (
                      <li
                        key={s.name}
                        className="flex h-6 cursor-pointer items-center gap-2 rounded px-2 hover:bg-accent/40"
                        onClick={() => handleSkillClick(s)}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                        />
                        <span className="truncate">{s.display_name || s.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {s.version}
                        </span>
                        <div className="flex-1" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isCurrentlyPinned = pinnedSkills.includes(s.name);
                            if (!isCurrentlyPinned) {
                              addRecentSkill(s.name, s.display_name || s.name);
                            }
                            togglePin(s.name);
                          }}
                        >
                          {pinnedSkills.includes(s.name) ? (
                            <PinOff className="h-3 w-3 text-amber-400" />
                          ) : (
                            <Pin className="h-3 w-3" />
                          )}
                        </Button>
                      </li>
                    ))}
                    {filteredSkills.length === 0 && !skillsLoading && (
                      <li className="px-2 py-2 text-muted-foreground">
                        {skillSearch.trim() ? "无匹配 Skill" : "暂无 Skill"}
                      </li>
                    )}
                  </ul>
                )}
              </ScrollFade>
            </div>
          </div>
        </CollapsiblePanel>

        {/* D3 Tool 列表 */}
        <CollapsiblePanel
          id="tools"
          order={3}
          title="Tool 列表"
          icon={<Wrench className="h-3 w-3" />}
          badge={filteredTools.length || undefined}
          defaultSize={22}
          minSize={14}
          defaultOpen={false}
        >
          <div className="flex h-full flex-col overflow-hidden">
            <div className="relative shrink-0 px-2 pb-1">
              <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-6 pl-6 text-[11px]"
                placeholder="搜索 Tool..."
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
                {toolsLoading ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </div>
                ) : (
                  <div className="py-1 text-xs">
                    {toolGroups.map((g) => (
                      <div key={g.dcc} className="mb-1">
                        <div className="px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {DCC_LABELS[g.dcc as keyof typeof DCC_LABELS] || g.dcc}
                        </div>
                        <ul className="space-y-px">
                          {g.items.map((t) => (
                            <li
                              key={t.id}
                              className="flex h-6 cursor-pointer items-center gap-2 rounded px-3 font-mono hover:bg-accent/40"
                              onClick={() => handleToolClick(t)}
                            >
                              <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="truncate">{t.name}</span>
                              <div className="flex-1" />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => { e.stopPropagation(); handleToolRunFromPanel(t); }}
                              >
                                <Play className="h-3 w-3" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {filteredTools.length === 0 && !toolsLoading && (
                      <div className="px-2 py-2 text-muted-foreground">
                        {toolSearch.trim() ? "无匹配 Tool" : "暂无 Tool"}
                      </div>
                    )}
                  </div>
                )}
              </ScrollFade>
            </div>
          </div>
        </CollapsiblePanel>

        {/* D4 资源管理器 */}
        <CollapsiblePanel
          id="explorer"
          order={4}
          title="资源管理器"
          icon={<FolderTree className="h-3 w-3" />}
          defaultSize={18}
          minSize={12}
          defaultOpen={false}
        >
          <ResourceExplorer />
        </CollapsiblePanel>

        {/* D5 上下文预览 */}
        <CollapsiblePanel
          id="preview"
          order={5}
          title={preview ? `预览: ${preview.title}` : previewFile ? `预览: ${previewFile.name}` : "上下文预览"}
          icon={<FileText className="h-3 w-3" />}
          defaultSize={preview || previewFile ? 22 : 10}
          minSize={preview || previewFile ? 12 : 8}
          defaultOpen={!!(preview || previewFile)}
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            {preview ? (
              <PreviewRenderer payload={preview} onClose={clearPreview} />
            ) : previewFile ? (
              <div className="px-3 py-2">
                <div className="mb-1 text-[10px] text-muted-foreground">
                  {previewFile.name}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                  {previewFile.content}
                </pre>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-2 py-3 text-center text-[11px] text-muted-foreground">
                <FileText className="h-4 w-4" />
                <p>点击 Nexus-Tool 名以查看详情</p>
              </div>
            )}
          </ScrollFade>
        </CollapsiblePanel>
      </CollapsiblePanelGroup>
    </div>
  );
}

/** D5 预览渲染器 — kind → 渲染组件注册表 */
function PreviewRenderer({ payload, onClose }: {
  payload: { kind: string; title: string; data: unknown };
  onClose: () => void;
}) {
  if (payload.kind === "nexus-tool-run-result") {
    const data = payload.data as Record<string, unknown> | undefined;
    return (
      <div className="px-3 py-2 text-xs">
        <div className="mb-2 flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${data?.success ? "bg-emerald-400" : "bg-red-400"}`} />
          <span className="font-medium">{data?.dcc ? `在 ${DCC_LABELS[data.dcc as keyof typeof DCC_LABELS] || data.dcc} 上运行` : "运行结果"}</span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed max-h-[300px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    );
  }

  if (payload.kind === "nexus-tool-detail") {
    const data = payload.data as { toolId: string; toolName: string; refreshKey?: number } | undefined;
    if (!data?.toolId) return <FallbackPreview payload={payload} />;
    return <ToolDetailPanel toolId={data.toolId} compact refreshKey={data.refreshKey} />;
  }

  if (payload.kind === "calendar-task-detail") {
    const data = payload.data as { task: import("../../lib/calendar/types").CalendarTask } | undefined;
    if (!data?.task) return <FallbackPreview payload={payload} />;
    return <TaskDetailPreview task={data.task} />;
  }

  if (payload.kind === "skill-detail") {
    const data = payload.data as { skillName: string; refreshKey?: number } | undefined;
    if (!data?.skillName) return <FallbackPreview payload={payload} />;
    return <SkillDetailPanel skillName={data.skillName} compact refreshKey={data.refreshKey} />;
  }

  if (payload.kind === "nexus-tool-run") {
    const data = payload.data as { toolId: string } | undefined;
    if (!data?.toolId) return <FallbackPreview payload={payload} />;
    return <RunPanel toolId={data.toolId} compact />;
  }

  if (payload.kind === "file-preview") {
    const data = payload.data as { content: string; filePath: string } | undefined;
    if (!data) return <FallbackPreview payload={payload} />;

    // .md 文件使用 Markdown 渲染
    const isMarkdown = /\.md$/i.test(data.filePath);

    return (
      <div className="px-3 py-2">
        <div className="mb-1 text-[10px] text-muted-foreground break-all">
          {data.filePath}
        </div>
        {isMarkdown ? (
          <div className="max-h-[500px] overflow-y-auto">
            <MarkdownPreview
              content={data.content.length > 10000 ? data.content.slice(0, 10000) + "\n\n---\n\n*（文件较大，仅显示前 10000 字符）*" : data.content}
            />
          </div>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed max-h-[400px]">
            {data.content.length > 5000 ? data.content.slice(0, 5000) + "\n...(文件较大，仅显示前 5000 字符)" : data.content}
          </pre>
        )}
      </div>
    );
  }

  if (payload.kind === "image-preview") {
    const data = payload.data as { filePath: string; fileName?: string } | undefined;
    if (!data?.filePath) return <FallbackPreview payload={payload} />;
    return <ImagePreview filePath={data.filePath} fileName={data.fileName} />;
  }

  // fallback: raw JSON
  return <FallbackPreview payload={payload} />;
}

// ─── 日历任务详情预览 ──────────────────────────────────────────────

function TaskDetailPreview({ task }: { task: CalendarTask }) {
  const [sessions, setSessions] = React.useState<Array<{
    sessionKey: string;
    title: string;
    updatedAt: number;
    totalTokens: number;
  }>>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);

  // 加载由当前 cron 任务触发的对话列表（仅 OpenClaw 任务）
  React.useEffect(() => {
    if (task.source !== "openclaw" || !task.agentId || !task.jobId) return;

    let cancelled = false;
    setSessionsLoading(true);

    (async () => {
      try {
        const { getSessionsList } = await import("../../ipc/openclaw");
        // 拉取该 agent 的所有会话，然后按 cron job ID 过滤
        const result = await getSessionsList({
          agentId: task.agentId,
          limit: 200,
        });
        if (cancelled) return;

        // 过滤属于当前 cron 任务的会话
        // sessionKey 模式: agent:{agentId}:cron:{jobId} 或 agent:{agentId}:cron:{jobId}:run:{uuid}
        const cronPrefix = `agent:${task.agentId}:cron:${task.jobId}`;
        const filtered = result.sessions
          .filter((s) =>
            s.sessionKey === cronPrefix ||
            s.sessionKey.startsWith(cronPrefix + ":")
          )
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 10)
          .map((s) => ({
            sessionKey: s.sessionKey || "",
            title: s.title || `对话 ${s.sessionId?.slice(0, 8) || ""}`,
            updatedAt: s.updatedAt,
            totalTokens: s.totalTokens,
          }));

        setSessions(filtered);
      } catch { /* silent */ }
      finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [task.source, task.agentId, task.jobId]);

  const scheduleDesc = React.useMemo(() => {
    switch (task.scheduleType) {
      case "interval": return `间隔执行 · 每${task.interval}`;
      case "cron": return `Cron 表达式 · ${task.cron ? describeCron(task.cron) : task.cron}`;
      case "once": {
        const time = task.runAt ? new Date(task.runAt).toLocaleString("zh-CN") : "未指定";
        return `单次执行 · ${time}`;
      }
    }
  }, [task]);

  const handleSwitchSession = React.useCallback((sessionKey: string) => {
    // 通过设置 chat-view 的 sessionKey 实现对话切换
    const event = new CustomEvent("artifex:switch-session", {
      detail: { sessionKey },
    });
    window.dispatchEvent(event);
  }, []);

  return (
    <div className="px-3 py-2 text-xs space-y-3">
      {/* 标题 + 来源 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: task.color || "#888" }}
          />
          <span className="font-medium text-sm">{task.title}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={cn(
            "rounded px-1.5 py-px font-medium",
            task.source === "nexus-tool"
              ? "bg-blue-400/15 text-blue-400"
              : "bg-green-400/15 text-green-400",
          )}>
            {task.source === "nexus-tool" ? "Nexus-Tool" : "OpenClaw"}
          </span>
          <span className={cn(
            "rounded px-1.5 py-px font-medium",
            task.enabled
              ? "bg-emerald-400/15 text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}>
            {task.enabled ? "已启用" : "已禁用"}
          </span>
          {task.isHighFreq && (
            <span className="rounded bg-amber-400/15 px-1.5 py-px text-amber-400 font-medium">
              ⚡ 高频
            </span>
          )}
        </div>
      </div>

      {/* 调度详情 */}
      <div className="rounded bg-muted/20 p-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground shrink-0 w-12">调度</span>
          <span className="font-medium">{scheduleDesc}</span>
        </div>
        {task.source === "nexus-tool" && task.toolName && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0 w-12">工具</span>
            <span className="font-medium text-primary">{task.toolName}</span>
          </div>
        )}
        {task.runTimes.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground shrink-0 w-12 mt-0.5">执行</span>
            <span className="text-[10px] text-muted-foreground break-all">
              {task.runTimes.length > 10
                ? `本月 ${task.runTimes.length} 次执行`
                : task.runTimes.map((rt) => new Date(rt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })).join(", ")}
            </span>
          </div>
        )}
      </div>

      {/* OpenClaw 关联对话列表 */}
      {task.source === "openclaw" && task.jobId && (
        <div className="rounded bg-muted/20 p-2 space-y-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-muted-foreground text-[10px]">
              关联对话 ({sessionsLoading ? "加载中..." : `${sessions.length} 条`})
            </span>
          </div>
          {sessions.length === 0 && !sessionsLoading && (
            <div className="text-[10px] text-muted-foreground py-1">
              暂无关联对话记录
            </div>
          )}
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.sessionKey}
                onClick={() => handleSwitchSession(s.sessionKey)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] hover:bg-accent/30 transition-colors"
              >
                <span className="truncate flex-1 font-medium">{s.title}</span>
                <span className="text-muted-foreground shrink-0">
                  {new Date(s.updatedAt).toLocaleDateString("zh-CN")}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {s.totalTokens > 1000
                    ? `${(s.totalTokens / 1000).toFixed(1)}k`
                    : s.totalTokens}
                </span>
                <span className="text-[9px] text-primary shrink-0">切换 →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FallbackPreview({ payload }: { payload: { kind: string; title: string; data: unknown } }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

// ─── 图像预览组件（支持 png/jpg/tga + 通道控制） ──────────────

/** 简易 TGA 解码器 — 支持 24/32 位未压缩 TGA */
function decodeTGA(buffer: ArrayBuffer): { data: Uint8Array; width: number; height: number } | null {
  try {
    const view = new DataView(buffer, 0, 18);
    const idLen = view.getUint8(0);
    const imageType = view.getUint8(2);
    const width = view.getUint16(12, true);
    const height = view.getUint16(14, true);
    const depth = view.getUint8(16);
    const descriptor = view.getUint8(17);
    const flipY = !(descriptor & 0x20); // bit 5 = 0 → top-left origin

    // 仅支持未压缩 RGB (2) 和 RGBA (2)
    if (imageType !== 2) return null;
    if (depth !== 24 && depth !== 32) return null;

    const bytesPerPixel = depth / 8;
    const headerSize = 18 + idLen;
    const pixelData = new Uint8Array(buffer, headerSize);

    // 输出 RGBA
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcY = flipY ? height - 1 - y : y;
      for (let x = 0; x < width; x++) {
        const srcIdx = (srcY * width + x) * bytesPerPixel;
        const dstIdx = (y * width + x) * 4;
        out[dstIdx]     = pixelData[srcIdx + 2] || 0; // R (TGA is BGR)
        out[dstIdx + 1] = pixelData[srcIdx + 1] || 0; // G
        out[dstIdx + 2] = pixelData[srcIdx]     || 0; // B
        out[dstIdx + 3] = depth === 32 ? pixelData[srcIdx + 3] : 255; // A
      }
    }
    return { data: out, width, height };
  } catch {
    return null;
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tga: "image/x-targa",
};

type ImageChannel = "r" | "g" | "b" | "a";

function ImagePreview({ filePath, fileName }: { filePath: string; fileName?: string }) {
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [channels, setChannels] = React.useState<Record<ImageChannel, boolean>>({
    r: true, g: true, b: true, a: true,
  });
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  const ext = React.useMemo(() => {
    const name = fileName || filePath;
    return name.split(".").pop()?.toLowerCase() || "";
  }, [fileName, filePath]);

  const isNativeImage = ext !== "tga";
  const mimeType = IMAGE_EXTENSIONS[ext] || "image/png";

  // 加载图像
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");

        if (isNativeImage) {
          // PNG/JPG 等原生格式：通过 Rust 命令读取 base64 → data URL
          const result = await invoke<{ ok: boolean; data: string; mime: string; error?: string }>("read_file_base64", { path: filePath });
          if (!result.ok) { setError(result.error || "读取失败"); setLoading(false); return; }
          const url = `data:${result.mime};base64,${result.data}`;
          setImageUrl(url);
          const img = new Image();
          img.onload = () => { if (!cancelled) { imgRef.current = img; setLoading(false); drawCanvas(); } };
          img.onerror = () => { if (!cancelled) { setError("无法解码图像"); setLoading(false); } };
          img.src = url;
        } else {
          // TGA 等非原生格式：读取二进制 + 手动解码
          const result = await invoke<{ ok: boolean; data: string; mime: string; error?: string }>("read_file_base64", { path: filePath });
          if (!result.ok) { setError(result.error || "读取失败"); setLoading(false); return; }
          // base64 → ArrayBuffer
          const binary = atob(result.data);
          const buf = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
          const decoded = decodeTGA(buf.buffer);
          if (!decoded) { setError("TGA 解码失败"); setLoading(false); return; }

          const blob = new Blob([decoded.data as BlobPart], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          setImageUrl(url);
          const img = new Image();
          img.onload = () => { if (!cancelled) { imgRef.current = img; setLoading(false); drawCanvas(); } };
          img.onerror = () => { if (!cancelled) { setError("无法解码 TGA 图像"); setLoading(false); } };
          img.src = url;
        }
      } catch (e) {
        if (!cancelled) {
          setError(`读取失败: ${(e as Error).message}`);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, isNativeImage]);

  // 通道控制 → 重新绘制 canvas
  const drawCanvas = React.useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    // 应用通道过滤
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = channels.r ? data[i] : 0;     // R
      data[i + 1] = channels.g ? data[i + 1] : 0; // G
      data[i + 2] = channels.b ? data[i + 2] : 0; // B
      data[i + 3] = channels.a ? data[i + 3] : 255; // A (不透明)
    }
    ctx.putImageData(imageData, 0, 0);
  }, [channels]);

  React.useEffect(() => {
    if (imageUrl && !loading) drawCanvas();
  }, [channels, imageUrl, loading, drawCanvas]);

  const toggleChannel = (ch: ImageChannel) => {
    setChannels(prev => ({ ...prev, [ch]: !prev[ch] }));
  };

  const channelLabels: { ch: ImageChannel; label: string; color: string }[] = [
    { ch: "r", label: "R", color: "bg-red-500" },
    { ch: "g", label: "G", color: "bg-green-500" },
    { ch: "b", label: "B", color: "bg-blue-500" },
    { ch: "a", label: "A", color: "bg-gray-400" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 文件名 + 通道控制 */}
      <div className="flex shrink-0 items-center gap-2 px-2 py-1 border-b border-border/30">
        <span className="truncate text-[10px] text-muted-foreground flex-1 min-w-0">
          {fileName || filePath}
        </span>
        <div className="flex items-center gap-0.5">
          {channelLabels.map(({ ch, label, color }) => (
            <button
              key={ch}
              className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-mono transition-colors ${
                channels[ch]
                  ? `${color} text-white`
                  : "bg-muted/30 text-muted-foreground"
              }`}
              onClick={() => toggleChannel(ch)}
              title={channels[ch] ? `隐藏 ${label} 通道` : `显示 ${label} 通道`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 图像区域 */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#1a1a1a] flex items-center justify-center">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中...
          </div>
        )}
        {error && (
          <div className="text-xs text-red-400">{error}</div>
        )}
        {!loading && !error && (
          isNativeImage && Object.values(channels).every(Boolean) ? (
            <img
              src={imageUrl!}
              alt={fileName || filePath}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
          )
        )}
      </div>
    </div>
  );
}

