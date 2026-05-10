"use client";

/**
 * RightPanel — D 区右侧面板（D1-D5）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §8
 * 所有面板内容区使用 ScrollFade 组件（滚动 + 底部过渡光晕）
 */

import * as React from "react";
import {
  Clock,
  FileText,
  FolderTree,
  Puzzle,
  RefreshCw,
  Wrench,
} from "lucide-react";

import {
  Button,
  CollapsiblePanel,
  CollapsiblePanelGroup,
} from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { PreviewFileContext } from "./AppShell";

const RECENT_ITEMS = [
  { kind: "skill" as const, name: "blender-modeling" },
  { kind: "tool" as const, name: "create_cube" },
  { kind: "tool" as const, name: "set_material" },
  { kind: "skill" as const, name: "ue-blueprint" },
];

const SKILLS = [
  { name: "blender-modeling", version: "v1.2", enabled: true },
  { name: "ue-blueprint", version: "v0.9", enabled: true },
  { name: "image-gen", version: "v2.0", enabled: false },
];

const TOOL_GROUPS = [
  {
    skill: "blender-modeling",
    tools: ["create_cube", "set_material", "delete_object"],
  },
  { skill: "ue-blueprint", tools: ["create_actor", "compile_blueprint"] },
];

export function RightPanel() {
  const { previewFile } = React.useContext(PreviewFileContext);
  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel text-panel-foreground">
      <CollapsiblePanelGroup autoSaveId="artifex.shell.dpanel">
        {/* D1 最近使用 */}
        <CollapsiblePanel
          id="recent"
          order={1}
          title="最近使用"
          icon={<Clock className="h-3 w-3" />}
          badge={RECENT_ITEMS.length}
          defaultSize={20}
          minSize={10}
          actions={
            <Button size="icon" variant="ghost" className="h-5 w-5" aria-label="刷新">
              <RefreshCw className="h-3 w-3" />
            </Button>
          }
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            <ul className="space-y-px py-1 text-xs">
              {RECENT_ITEMS.map((it, i) => (
                <li
                  key={i}
                  className="flex h-6 cursor-pointer items-center gap-2 rounded px-2 hover:bg-accent/40"
                >
                  {it.kind === "skill" ? (
                    <Puzzle className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Wrench className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="truncate">{it.name}</span>
                </li>
              ))}
            </ul>
          </ScrollFade>
        </CollapsiblePanel>

        {/* D2 Skill 列表 */}
        <CollapsiblePanel
          id="skills"
          order={2}
          title="Skill 列表"
          icon={<Puzzle className="h-3 w-3" />}
          badge={SKILLS.length}
          defaultSize={25}
          minSize={10}
          defaultOpen={false}
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            <ul className="space-y-px py-1 text-xs">
              {SKILLS.map((s) => (
                <li
                  key={s.name}
                  className="flex h-6 items-center gap-2 rounded px-2 hover:bg-accent/40"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {s.version}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollFade>
        </CollapsiblePanel>

        {/* D3 Tool 列表 */}
        <CollapsiblePanel
          id="tools"
          order={3}
          title="Tool 列表"
          icon={<Wrench className="h-3 w-3" />}
          badge={TOOL_GROUPS.reduce((s, g) => s + g.tools.length, 0)}
          defaultSize={25}
          minSize={10}
          defaultOpen={false}
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            <div className="py-1 text-xs">
              {TOOL_GROUPS.map((g) => (
                <div key={g.skill} className="mb-1">
                  <div className="px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {g.skill}
                  </div>
                  <ul className="space-y-px">
                    {g.tools.map((t) => (
                      <li
                        key={t}
                        className="flex h-6 cursor-pointer items-center gap-2 rounded px-3 font-mono hover:bg-accent/40"
                      >
                        <Wrench className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate">{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
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

        {/* D5 文件预览 */}
        <CollapsiblePanel
          id="preview"
          order={5}
          title={previewFile ? `预览: ${previewFile.name}` : "文件预览"}
          icon={<FileText className="h-3 w-3" />}
          defaultSize={previewFile ? 30 : 10}
          minSize={8}
          defaultOpen={!!previewFile}
        >
          <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
            {previewFile ? (
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
                <p>在资源管理器或会话文件中选择文件以预览</p>
              </div>
            )}
          </ScrollFade>
        </CollapsiblePanel>
      </CollapsiblePanelGroup>
    </div>
  );
}
