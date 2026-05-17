"use client";

/**
 * RightPanel — D 区右侧面板（D1-D5）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §8
 * 所有面板内容区使用 ScrollFade 组件（滚动 + 底部过渡光晕）
 *
 * STORY-0048: D1-D3 接入真实 API，D5 接入 ToolDetailPanel。
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
  RefreshCw,
  Wrench,
  Loader2,
} from "lucide-react";

import {
  Button,
  CollapsiblePanel,
  CollapsiblePanelGroup,
} from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { PreviewFileContext, PreviewContext, PinnedSkillsContext, RunToolContext } from "./AppShell";
import { ToolDetailPanel } from "../skills/ToolDetailPanel";
import {
  type SkillItem,
  skillList,
} from "../../lib/skill/skill-api";
import {
  type NexusToolItem,
  nexusToolList,
  nexusToolRun,
} from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS } from "../../lib/skillsMock";

export function RightPanel() {
  const { previewFile } = React.useContext(PreviewFileContext);
  const { preview, setPreview, clearPreview } = React.useContext(PreviewContext);
  const { pinnedSkills, togglePin } = React.useContext(PinnedSkillsContext);
  const { runTool } = React.useContext(RunToolContext);

  // ─── 真实 API：Skill 列表 ─────────────────────────────────────────
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

  // ─── 真实 API：Tool 列表 ──────────────────────────────────────────
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

  // ─── Tool 分组（按 source → target_dccs 聚合）────────────────────
  const toolGroups = React.useMemo(() => {
    const map = new Map<string, NexusToolItem[]>();
    tools.forEach((t) => {
      const key = (t.target_dccs?.[0]) || "通用";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return Array.from(map.entries()).map(([dcc, items]) => ({ dcc, items }));
  }, [tools]);

  const handleToolClick = React.useCallback((tool: NexusToolItem) => {
    setPreview({
      kind: "nexus-tool-detail",
      title: tool.name,
      data: { toolId: tool.id, toolName: tool.name },
    });
  }, [setPreview]);

  const handleToolRunFromPanel = React.useCallback(async (tool: NexusToolItem) => {
    try {
      const result = await nexusToolRun(tool.id);
      setPreview({
        kind: "nexus-tool-run-result",
        title: `运行结果: ${tool.name}`,
        data: { ...result, toolId: tool.id },
      });
    } catch (e) {
      setPreview({
        kind: "nexus-tool-run-result",
        title: `运行失败: ${tool.name}`,
        data: { success: false, error: String(e), toolId: tool.id },
      });
    }
  }, [setPreview]);
  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel text-panel-foreground">
      <CollapsiblePanelGroup autoSaveId="artifex.shell.dpanel">
        {/* D1 最近使用 */}
        <CollapsiblePanel
          id="recent"
          order={1}
          title="最近使用"
          icon={<Clock className="h-3 w-3" />}
          badge={tools.filter(t => t.use_count > 0).length || undefined}
          defaultSize={20}
          minSize={10}
          actions={
            <Button size="icon" variant="ghost" className="h-5 w-5" aria-label="刷新" onClick={loadTools}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          }
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            {toolsLoading ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <ul className="space-y-px py-1 text-xs">
                {tools.filter(t => t.use_count > 0).slice(0, 10).map((t) => (
                  <li
                    key={t.id}
                    className="flex h-6 cursor-pointer items-center gap-2 rounded px-2 hover:bg-accent/40"
                    onClick={() => handleToolClick(t)}
                  >
                    <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                      {t.use_count}次
                    </span>
                  </li>
                ))}
                {tools.filter(t => t.use_count > 0).length === 0 && (
                  <li className="px-2 py-2 text-muted-foreground">暂无使用记录</li>
                )}
              </ul>
            )}
          </ScrollFade>
        </CollapsiblePanel>

        {/* D2 Skill 列表 */}
        <CollapsiblePanel
          id="skills"
          order={2}
          title="Skill 列表"
          icon={<Puzzle className="h-3 w-3" />}
          badge={skills.length || undefined}
          defaultSize={25}
          minSize={10}
          defaultOpen={false}
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            {skillsLoading ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <ul className="space-y-px py-1 text-xs">
                {skills.map((s) => (
                  <li
                    key={s.name}
                    className="flex h-6 items-center gap-2 rounded px-2 hover:bg-accent/40"
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
                      onClick={() => togglePin(s.name)}
                    >
                      {pinnedSkills.includes(s.name) ? (
                        <PinOff className="h-3 w-3 text-amber-400" />
                      ) : (
                        <Pin className="h-3 w-3" />
                      )}
                    </Button>
                  </li>
                ))}
                {skills.length === 0 && !skillsLoading && (
                  <li className="px-2 py-2 text-muted-foreground">暂无 Skill</li>
                )}
              </ul>
            )}
          </ScrollFade>
        </CollapsiblePanel>

        {/* D3 Tool 列表 */}
        <CollapsiblePanel
          id="tools"
          order={3}
          title="Tool 列表"
          icon={<Wrench className="h-3 w-3" />}
          badge={tools.length || undefined}
          defaultSize={25}
          minSize={10}
          defaultOpen={false}
        >
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
                            onClick={(e) => { e.stopPropagation(); runTool(t.name); }}
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {tools.length === 0 && !toolsLoading && (
                  <div className="px-2 py-2 text-muted-foreground">暂无 Tool</div>
                )}
              </div>
            )}
          </ScrollFade>
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
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            <div className="px-2 py-2 text-xs text-muted-foreground">
              <p>占位 · STORY-0038 接入真实文件树</p>
            </div>
          </ScrollFade>
        </CollapsiblePanel>

        {/* D5 上下文预览（STORY-0047 + ToolDetailPanel） */}
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
              <PreviewRenderer payload={preview} onClose={clearPreview} runTool={runTool} />
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
function PreviewRenderer({ payload, onClose, runTool }: {
  payload: { kind: string; title: string; data: unknown };
  onClose: () => void;
  runTool: (toolName: string) => void;
}) {
  if (payload.kind === "nexus-tool-run-result") {
    const data = payload.data as Record<string, unknown> | undefined;
    return (
      <div className="px-3 py-2 text-xs">
        <div className="mb-2 flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${data?.success ? "bg-emerald-400" : "bg-red-400"}`} />
          <span className="font-medium">{data?.dcc ? `在 ${data.dcc} 上运行` : "运行结果"}</span>
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
    return <ToolDetailPanel toolId={data.toolId} onRun={runTool} compact refreshKey={data.refreshKey} />;
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
