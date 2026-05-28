"use client";

/**
 * SkillDetailPanel — Skill 详情面板（右侧 D5 面板内渲染）
 *
 * 标签页：
 *   1. 基本信息（Info）— 只读展示 SKILL.md 的 name/description + manifest.json 的属性
 *   2. SKILL.md — 完整文档内容（Markdown 渲染）
 *   3. 格式问题 — validation_error 详情（仅在有错误时显示）
 *
 * 数据源规则（与 artclaw 格式标准对齐）：
 *   - name / description → SKILL.md frontmatter（唯一源）
 *   - 其他字段 → manifest.json（缺失则留空）
 */

import * as React from "react";
import {
  Info,
  FileText,
  AlertCircle,
  Loader2,
  ExternalLink,
  Wand2,
  Puzzle,
  CheckCircle2,
  Save,
  Upload,
  RefreshCw,
} from "lucide-react";
import { Button, cn, Input } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { type SkillDetail, skillDetail, skillFixManifest, skillReadSkillMd, skillUpdateManifest, skillPublish } from "../../lib/skill/skill-api";
import type { DCCEntry } from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS, SOURCE_LABELS } from "../../lib/skillsMock";
import { invoke } from "@tauri-apps/api/core";
import { TagEditor } from "./TagEditor";
import { useGlobalTagSuggestions } from "../../lib/useTagSuggestions";
import { MarkdownPreview } from "../markdown/MarkdownPreview";

// ─── 类型 ──────────────────────────────────────────────────────────────────

type TabId = "info" | "readme" | "errors";

function layerToSource(layer: string): string {
  if (layer.startsWith("00_")) return "official";
  if (layer.startsWith("01_")) return "marketplace";
  return "user";
}

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400 bg-blue-500/10",
  marketplace: "text-purple-400 bg-purple-500/10",
  user: "text-green-400 bg-green-500/10",
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

interface SkillDetailPanelProps {
  skillName: string;
  compact?: boolean;
  /** 外部变动通知（列表卡片操作后由 PreviewContext 传入） */
  refreshKey?: number;
}

export function SkillDetailPanel({ skillName, compact, refreshKey }: SkillDetailPanelProps) {
  const [detail, setDetail] = React.useState<SkillDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<TabId>("info");
  // 全局标签推荐（module-level 缓存，全 App 只请求一次）
  const globalTagSuggestions = useGlobalTagSuggestions("skill");

  const loadDetail = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const d = await skillDetail(skillName);
      setDetail(d);
      // 默认显示基本信息；有格式问题时自动切到 errors 标签
      setActiveTab("info");
      if (d.entry.validation_error) {
        setActiveTab("errors");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [skillName, refreshKey]);

  React.useEffect(() => { loadDetail(); }, [loadDetail]);

  if (loading) {
    return <DetailSkeleton tabs={2} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-red-400">
        <AlertCircle className="h-5 w-5" />
        <span className="text-xs">加载失败: {error}</span>
        <Button variant="outline" size="sm" onClick={loadDetail}>重试</Button>
      </div>
    );
  }

  if (!detail) {
    return <div className="p-4 text-xs text-muted-foreground">Skill 不存在</div>;
  }

  const entry = detail.entry;
  const hasErrors = !!entry.validation_error;

  const TABS: { id: TabId; label: string; icon: React.ReactNode; show?: boolean }[] = [
    { id: "info", label: "基本信息", icon: <Info className="h-3.5 w-3.5" /> },
    { id: "readme", label: "SKILL.md", icon: <FileText className="h-3.5 w-3.5" /> },
    { id: "errors", label: "格式问题", icon: <AlertCircle className="h-3.5 w-3.5" />, show: hasErrors },
  ];

  const labelCls = "text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab 栏 */}
      <div className="flex shrink-0 border-b border-border/60 bg-muted/20 overflow-x-auto">
        {TABS.filter(t => t.show !== false).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground/80",
              compact && "px-2 py-1.5 text-[11px]",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "errors" && hasErrors && (
              <span className="ml-0.5 rounded bg-red-500/20 px-1 text-[10px] text-red-400">!</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <ScrollFade className="flex-1">
        <div className="p-3">
          {activeTab === "info" && <InfoTab entry={entry} detail={detail} labelCls={labelCls} compact={compact} onDetailRefresh={loadDetail} globalTagSuggestions={globalTagSuggestions} />}
          {activeTab === "readme" && <ReadmeTab skillName={skillName} />}
          {activeTab === "errors" && <ErrorsTab entry={entry} detail={detail} onFixed={loadDetail} />}
        </div>
      </ScrollFade>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 1: 基本信息
// ═══════════════════════════════════════════════════════════════════════════

function InfoTab({ entry, detail, labelCls, compact, onDetailRefresh, globalTagSuggestions }: {
  entry: SkillDetail["entry"];
  detail: SkillDetail;
  labelCls: string;
  compact?: boolean;
  onDetailRefresh: () => void;
  globalTagSuggestions?: string[];
}) {
  const source = layerToSource(entry.layer);
  const isInstalled = !!detail.install_path;

  // ── 表单状态（初始值来自 entry） ─────────────────────────────────────
  const [software, setSoftware] = React.useState<DCCEntry[]>(entry.software || []);
  const [version, setVersion] = React.useState(entry.version || "");
  const [author, setAuthor] = React.useState(entry.author || "");
  const [license, setLicense] = React.useState(entry.license || "");
  const [entryPoint, setEntryPoint] = React.useState(entry.entry_point || "");
  const [tags, setTags] = React.useState(entry.tags?.join(", ") || "");
  const [deps, setDeps] = React.useState(entry.dependencies?.join(", ") || "");

  const [saving, setSaving] = React.useState(false);
  const [saveResult, setSaveResult] = React.useState<{ ok: boolean; warnings: string[]; errors: string[] } | null>(null);
  const [publishing, setPublishing] = React.useState(false);

  // semver 校验
  const semverPattern = /^\d+\.\d+\.\d+(?:[-+].+)?$/;
  const versionValid = !version || version === "0.0.0" || semverPattern.test(version);

  // ── 变更检测：有修改时才能保存 ──────────────────────────────────────
  const hasChanges = React.useMemo(() => {
    const orig = entry;
    // Compare software arrays
    const origSoftware = orig.software || [];
    if (software.length !== origSoftware.length) return true;
    for (let i = 0; i < software.length; i++) {
      if (software[i].dcc !== origSoftware[i].dcc) return true;
      if ((software[i].minVersion || "") !== (origSoftware[i].minVersion || "")) return true;
      if ((software[i].maxVersion || "") !== (origSoftware[i].maxVersion || "")) return true;
    }
    if (version !== (orig.version || "")) return true;
    if (author !== (orig.author || "")) return true;
    if (license !== (orig.license || "")) return true;
    if (entryPoint !== (orig.entry_point || "")) return true;
    if (tags !== (orig.tags?.join(", ") || "")) return true;
    if (deps !== (orig.dependencies?.join(", ") || "")) return true;
    return false;
  }, [software, version, author, license, entryPoint, tags, deps, entry]);

  // ── 软件 toggle ────────────────────────────────────────────────────
  const toggleDCC = React.useCallback((dcc: string) => {
    setSoftware((prev) => {
      const exists = prev.some((e) => e.dcc === dcc);
      if (exists) {
        return prev.filter((e) => e.dcc !== dcc);
      }
      return [...prev, { dcc }];
    });
  }, []);

  const updateDCCVersion = React.useCallback((dcc: string, field: "minVersion" | "maxVersion", value: string) => {
    setSoftware((prev) =>
      prev.map((e) => (e.dcc === dcc ? { ...e, [field]: value } : e))
    );
  }, []);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const fields: Record<string, unknown> = {
        software,
        version,
        author,
        entry_point: entryPoint,
        license,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        dependencies: deps.split(",").map(d => d.trim()).filter(Boolean),
      };
      const result = await skillUpdateManifest(entry.name, fields);
      setSaveResult(result);
      if (result.ok) {
        onDetailRefresh();
      }
    } catch (e) {
      setSaveResult({ ok: false, warnings: [], errors: [String(e)] });
    } finally {
      setSaving(false);
    }
  }, [software, version, author, entryPoint, license, tags, deps, entry.name, onDetailRefresh]);

  const handlePublish = React.useCallback(async () => {
    setPublishing(true);
    try {
      await skillPublish(entry.name);
      setSaveResult({ ok: true, warnings: ["已发布"], errors: [] });
      onDetailRefresh();
    } catch (e) {
      setSaveResult({ ok: false, warnings: [], errors: [String(e)] });
    } finally {
      setPublishing(false);
    }
  }, [entry.name, onDetailRefresh]);

  // 同步检测状态
  const syncState = detail.sync_state;
  const needsUpdate = syncState?.needs_update;
  const needsPublish = syncState?.needs_publish;

  // ── 表单字段样式 ─────────────────────────────────────────────────────
  const inputCls = "w-full h-7 px-2 text-[11px] rounded-[8px] border border-white/[0.08] bg-white/[0.04] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors";
  const inputClsErr = "w-full h-7 px-2 text-[11px] rounded-[8px] border border-red-500/40 bg-red-500/[0.04] text-foreground focus:outline-none focus:border-red-500/60 transition-colors";

  // 标签推荐：全局列表 + 当前 entry 自身的标签合并去重
  const allTagSuggestions = React.useMemo(() => {
    const set = new Set<string>(globalTagSuggestions || []);
    (entry.tags || []).forEach(t => { if (t.trim()) set.add(t.trim()); });
    return Array.from(set).sort();
  }, [globalTagSuggestions, entry.tags]);

  return (
    <div className="space-y-4">
      {/* ── 同步状态横幅 ─────────────────────────────────────────────── */}
      {isInstalled && needsUpdate && (
        <div className="flex items-start gap-2 rounded border border-cyan-500/20 bg-cyan-500/[0.04] px-3 py-2">
          <RefreshCw className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-cyan-300/80">源码有更新</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{syncState?.message}</p>
          </div>
        </div>
      )}
      {isInstalled && needsPublish && !needsUpdate && (
        <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
          <Upload className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-amber-300/80">建议发布</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{syncState?.message}</p>
          </div>
        </div>
      )}

      {/* 格式问题警告横幅 */}
      {entry.validation_error && (
        <div className="flex items-start gap-2 rounded border border-red-500/20 bg-red-500/[0.04] px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium text-red-300/80">格式问题</p>
            <p className="text-[11px] text-red-400/70 mt-0.5">{entry.validation_error}</p>
          </div>
        </div>
      )}

      {/* ── 标题 ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
          <Puzzle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{entry.display_name || entry.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">v{entry.version}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", SOURCE_COLORS[source] || "text-muted-foreground bg-muted")}>
              {(SOURCE_LABELS as Record<string, string>)[source] || source}
            </span>
            {!entry.has_manifest && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-400 bg-amber-500/10">
                缺 manifest.json
              </span>
            )}
            {isInstalled && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10">
                可编辑
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 1. 描述（来自 SKILL.md — 只读） ────────────────────────── */}
      {entry.description && (
        <div>
          <div className={labelCls}>描述</div>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{entry.description}</p>
        </div>
      )}

      {/* ── 2. 目标软件 + 版本约束 ──────────────────────────────────── */}
      <div>
        <div className={labelCls}>目标软件</div>
        {isInstalled ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(DCC_LABELS).map(([dcc, label]) => {
                const active = software.some((e) => e.dcc === dcc);
                return (
                  <button
                    key={dcc}
                    onClick={() => toggleDCC(dcc)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[11px] border transition-colors",
                      active
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-muted/20 text-muted-foreground border-border/40 hover:border-border/60",
                    )}
                  >
                    {label as string}
                  </button>
                );
              })}
            </div>
            {software.map((entry) => (
              <div key={entry.dcc} className="flex items-center gap-2 pl-1">
                <span className="text-[10px] text-muted-foreground w-20 shrink-0 truncate">
                  {(DCC_LABELS as Record<string, string>)[entry.dcc] || entry.dcc}
                </span>
                <input
                  className={inputCls}
                  placeholder="最低版本"
                  value={entry.minVersion || ""}
                  onChange={(e) => updateDCCVersion(entry.dcc, "minVersion", e.target.value)}
                />
                <span className="text-[10px] text-muted-foreground shrink-0">~</span>
                <input
                  className={inputCls}
                  placeholder="最高版本"
                  value={entry.maxVersion || ""}
                  onChange={(e) => updateDCCVersion(entry.dcc, "maxVersion", e.target.value)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {software.map((entry) => {
              const label = (DCC_LABELS as Record<string, string>)[entry.dcc] || entry.dcc;
              const hasVer = entry.minVersion || entry.maxVersion;
              return (
                <div key={entry.dcc} className="flex items-center gap-2 text-xs">
                  <span className="text-foreground">{label}</span>
                  {hasVer && (
                    <span className="text-[10px] text-muted-foreground">
                      {entry.minVersion || "?"} ~ {entry.maxVersion || "?"}
                    </span>
                  )}
                </div>
              );
            })}
            {software.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
          </div>
        )}
      </div>

      {/* ── 3. 版本 + 作者（双列） ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {/* 版本 */}
        <div>
          <div className={labelCls}>版本</div>
          <p className="text-xs text-foreground">{entry.version || "—"}</p>
        </div>

        {/* 作者 */}
        <div>
          <div className={labelCls}>作者</div>
          {isInstalled ? (
            <input className={inputCls} placeholder="作者" value={author} onChange={e => setAuthor(e.target.value)} />
          ) : (
            <p className="text-xs text-foreground">{entry.author || "—"}</p>
          )}
        </div>
      </div>

      {/* ── 4. 标签（全宽） ─────────────────────────────────────────── */}
      <div>
        <div className={labelCls}>标签</div>
        {isInstalled ? (
          <TagEditor tags={tags} onChange={setTags} suggestions={allTagSuggestions} />
        ) : entry.tags && entry.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((tag, i) => (
              <span key={i} className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </div>

      {/* ── 其他字段（追加，靠后显示） ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {/* 入口文件 */}
        <div>
          <div className={labelCls}>入口文件</div>
          {isInstalled ? (
            <input className={inputCls} placeholder="__init__.py" value={entryPoint} onChange={e => setEntryPoint(e.target.value)} />
          ) : (
            <p className="text-xs text-foreground">{entry.entry_point || "—"}</p>
          )}
        </div>

        {/* 许可证（靠后） */}
        <div>
          <div className={labelCls}>许可证</div>
          {isInstalled ? (
            <input className={inputCls} placeholder="如 MIT" value={license} onChange={e => setLicense(e.target.value)} />
          ) : (
            <p className="text-xs text-foreground">{entry.license || "—"}</p>
          )}
        </div>
      </div>

      {/* ── 依赖（全宽，追加） ───────────────────────────────────────── */}
      <div>
        <div className={labelCls}>依赖</div>
        {isInstalled ? (
          <input className={inputCls} placeholder="skill_a, skill_b" value={deps} onChange={e => setDeps(e.target.value)} />
        ) : entry.dependencies && entry.dependencies.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {entry.dependencies.map((dep, i) => (
              <span key={i} className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                {dep}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </div>

      {/* 层级（只读，追加） */}
      <div>
        <div className={labelCls}>层级</div>
        <p className="text-xs text-foreground">{entry.layer || "—"}</p>
      </div>

      {/* ── 保存 / 发布 按钮 ─────────────────────────────────────────── */}
      {isInstalled && (
        <div className="space-y-2 pt-1">
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            onClick={handleSave}
            disabled={saving || !versionValid || !hasChanges}
            title={!hasChanges ? "无修改" : undefined}
          >
            {saving ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />保存中</> : <><Save className="mr-1 h-3 w-3" />保存到安装目录</>}
          </Button>

          {saveResult && (
            <div className={cn(
              "rounded px-3 py-2 text-xs",
              saveResult.ok
                ? "border border-emerald-500/20 bg-emerald-500/[0.06]"
                : "border border-red-500/20 bg-red-500/[0.04]",
            )}>
              {saveResult.ok ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1 text-emerald-300/80">
                    <CheckCircle2 className="h-3 w-3" />{saveResult.warnings.join("; ") || "保存成功"}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handlePublish}
                    disabled={publishing}
                  >
                    {publishing ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />发布中</> : <><Upload className="mr-1 h-3 w-3" />发布到源目录</>}
                  </Button>
                </div>
              ) : (
                <div>
                  <p className="flex items-center gap-1 text-red-300/80">
                    <AlertCircle className="h-3 w-3" />保存失败
                  </p>
                  {saveResult.errors.map((err, i) => (
                    <p key={i} className="text-[10px] text-red-400/70 mt-1">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 路径 */}
      {entry.path && (
        <div>
          <div className={labelCls}>源路径</div>
          <button
            onClick={async () => {
              try {
                await invoke("shell_open_path", { path: entry.path });
              } catch (e) {
                console.error("打开路径失败:", e);
              }
            }}
            className="flex w-full items-center gap-1.5 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2 py-1.5 font-mono text-[10px] text-muted-foreground break-all hover:border-primary/40 hover:text-foreground transition-colors text-left"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {entry.path}
          </button>
        </div>
      )}

      {/* 安装路径（仅已安装 Skill 且与源路径不同时显示） */}
      {detail.install_path && detail.install_path !== entry.path && (
        <div>
          <div className={labelCls}>安装路径</div>
          <button
            onClick={async () => {
              try {
                await invoke("shell_open_path", { path: detail.install_path! });
              } catch (e) {
                console.error("打开路径失败:", e);
              }
            }}
            className="flex w-full items-center gap-1.5 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2 py-1.5 font-mono text-[10px] text-muted-foreground break-all hover:border-primary/40 hover:text-foreground transition-colors text-left"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {detail.install_path}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 2: SKILL.md 文档（Markdown 渲染）
// ═══════════════════════════════════════════════════════════════════════════

function ReadmeTab({ skillName }: { skillName: string }) {
  const [content, setContent] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const result = await skillReadSkillMd(skillName);
        if (!cancelled) {
          if (result.ok) {
            setContent(result.content);
          } else {
            setError(result.warnings.join("; "));
          }
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [skillName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">加载 SKILL.md...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <FileText className="h-6 w-6 text-muted-foreground opacity-40" />
        <p className="text-xs text-muted-foreground">无法加载 SKILL.md</p>
        <p className="text-[10px] text-red-400/70">{error}</p>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <FileText className="h-6 w-6 text-muted-foreground opacity-40" />
        <p className="text-xs text-muted-foreground">SKILL.md 为空</p>
      </div>
    );
  }

  return <MarkdownPreview content={content} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 3: 格式问题
// ═══════════════════════════════════════════════════════════════════════════

function ErrorsTab({ entry, detail, onFixed }: { entry: SkillDetail["entry"]; detail: SkillDetail; onFixed: () => void }) {
  const [fixing, setFixing] = React.useState(false);
  const [fixResult, setFixResult] = React.useState<{ ok: boolean; warnings: string[] } | null>(null);

  const handleFix = React.useCallback(async () => {
    setFixing(true);
    setFixResult(null);
    try {
      const result = await skillFixManifest(entry.name);
      setFixResult({ ok: result.ok, warnings: result.warnings });
      if (result.ok) {
        onFixed(); // 修复成功后刷新父组件
      }
    } catch (e) {
      setFixResult({ ok: false, warnings: [String(e)] });
    } finally {
      setFixing(false);
    }
  }, [entry.name, onFixed]);
  if (!entry.validation_error) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        <AlertCircle className="mx-auto mb-2 h-5 w-5 opacity-40" />
        此 Skill 格式完整，没有问题
      </div>
    );
  }

  const issues: Array<{ severity: "error" | "warning"; message: string; detail?: string }> = [];

  // 解析 validation_error
  const errMsg = entry.validation_error;

  if (errMsg.includes("缺少 manifest.json")) {
    issues.push({
      severity: "error",
      message: "缺少 manifest.json",
      detail: "Skill 目录下没有 manifest.json 文件。请按照 artifex nexus skill 格式规范创建包含以下建议字段的 manifest.json：manifest_version, name, version, software, tags, entry_point。",
    });
  } else if (errMsg.includes("manifest.json 校验失败")) {
    issues.push({
      severity: "error",
      message: "manifest.json 校验失败",
      detail: "manifest.json 存在但格式不符合规范。请参考 artifex nexus manifest.schema.json 检查字段类型和必需字段。",
    });
  } else if (errMsg) {
    issues.push({
      severity: "error",
      message: errMsg,
    });
  }

  // 检查常见缺失字段
  if (entry.has_manifest) {
    if (!entry.tags || entry.tags.length === 0) {
      issues.push({ severity: "warning", message: "缺少 tags 字段（建议至少有一个分类标签）" });
    }
    if (entry.version === "0.0.0") {
      issues.push({ severity: "warning", message: "version 为默认值 0.0.0，建议设置正式版本号" });
    }
    if (!entry.author) {
      issues.push({ severity: "warning", message: "缺少 author 字段" });
    }
  }

  // 检查加载错误
  if (detail.load_error) {
    issues.push({
      severity: "error",
      message: `加载失败: ${detail.load_error}`,
    });
  }

  return (
    <div className="space-y-2">
      {issues.map((issue, idx) => (
        <div
          key={idx}
          className={cn(
            "rounded border px-3 py-2",
            issue.severity === "error"
              ? "border-red-500/20 bg-red-500/[0.04]"
              : "border-amber-500/20 bg-amber-500/[0.04]",
          )}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className={cn(
              "h-3.5 w-3.5 shrink-0",
              issue.severity === "error" ? "text-red-400" : "text-amber-400",
            )} />
            <span className={cn(
              "text-xs font-medium",
              issue.severity === "error" ? "text-red-300/80" : "text-amber-300/80",
            )}>
              {issue.message}
            </span>
          </div>
          {issue.detail && (
            <p className="text-[11px] text-muted-foreground mt-1 ml-5.5">{issue.detail}</p>
          )}
        </div>
      ))}

      {/* 一键修复按钮 */}
      {errMsg.includes("缺少 manifest.json") && (
        <div className="rounded border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-300/80">一键修复</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                从 SKILL.md frontmatter 自动提取字段，生成符合规范的 manifest.json
              </p>
            </div>
            <Button
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={handleFix}
              disabled={fixing}
            >
              {fixing ? (
                <><Loader2 className="mr-1 h-3 w-3 animate-spin" />修复中</>
              ) : (
                <><Wand2 className="mr-1 h-3 w-3" />一键修复</>
              )}
            </Button>
          </div>
          {fixResult && (
            <div className={cn(
              "mt-2 rounded px-2 py-1.5 text-[10px]",
              fixResult.ok
                ? "border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300/80"
                : "border border-red-500/20 bg-red-500/[0.04] text-red-300/80",
            )}>
              {fixResult.ok ? (
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />manifest.json 已生成</span>
              ) : (
                <span>修复失败: {fixResult.warnings.join("; ")}</span>
              )}
              {fixResult.warnings.length > 0 && (
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-[9px] opacity-70">
                  {fixResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* artifex nexus skill 格式规范参考 */}
      <div className="mt-4 rounded border border-border/40 bg-muted/10 px-3 py-2">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">artifex nexus skill 格式规范</div>
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <p>manifest.json 建议字段：</p>
          <ul className="list-disc list-inside ml-1 space-y-0.5 text-[10px]">
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">manifest_version</code>: "1.0"</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">name</code>: snake_case，全局唯一</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">version</code>: semver 格式</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">software</code>: DCC 软件标识</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">software</code>: <code className="text-[9px] bg-muted/30 px-1 rounded">[{"{dcc, minVersion?, maxVersion?}"}]</code>，目标 DCC 及版本约束</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">tags</code>: 标签列表（至少一个分类标签）</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">entry_point</code>: 入口文件名</li>
          </ul>
          <p className="mt-1">SKILL.md frontmatter 提供 name 和 description，manifest.json 提供其他所有字段。</p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 骨架屏（详情加载时显示）
// ═══════════════════════════════════════════════════════════════════════════

function DetailSkeleton({ tabs }: { tabs: number }) {
  const shimmer = "animate-pulse rounded bg-white/10";
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 加载提示 */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>加载技能详情...</span>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-border/60 px-3 py-2">
        {Array.from({ length: tabs }).map((_, i) => (
          <div key={i} className={`h-5 w-16 ${shimmer}`} />
        ))}
      </div>
      <div className="flex-1 space-y-3 p-3">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl ${shimmer}`} />
          <div className="space-y-1.5">
            <div className={`h-4 w-32 ${shimmer}`} />
            <div className={`h-3 w-20 ${shimmer}`} />
          </div>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className={`h-3 w-12 ${shimmer}`} />
            <div className={`h-7 w-full ${shimmer}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
