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

  // ─── 清理 react-resizable-panels 脏布局数据（双列模式结构动态变化，持久化有害）──
  React.useEffect(() => {
    try {
      // getPanelGroupKey(autoSaveId) → `react-resizable-panels:${autoSaveId}`
      // 核弹式清理：删除所有 react-resizable-panels 相关数据
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("react-resizable-panels")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      if (keysToRemove.length > 0) {
        console.log("[RightPanel] 清理了 react-resizable-panels 脏数据:", keysToRemove);
      }
    } catch { /* ignore */ }
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
        autoSaveId="artifex.shell.dpanel"
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
          defaultSize={20}
          minSize={10}
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
          defaultSize={25}
          minSize={10}
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
          defaultSize={25}
          minSize={10}
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
          defaultSize={20}
          minSize={10}
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
          defaultSize={preview || previewFile ? 30 : 10}
          minSize={8}
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

  // fallback: raw JSON
  return <FallbackPreview payload={payload} />;
}

function FallbackPreview({ payload }: { payload: { kind: string; title: string; data: unknown } }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

