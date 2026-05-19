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
} from "lucide-react";
import { Button, cn } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { type SkillDetail, skillDetail, skillFixManifest, skillReadSkillMd } from "../../lib/skill/skill-api";
import { DCC_LABELS, SOURCE_LABELS } from "../../lib/skillsMock";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── 类型 ──────────────────────────────────────────────────────────────────

type TabId = "info" | "readme" | "errors";

const RISK_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: "低风险", color: "text-emerald-400 bg-emerald-500/10" },
  medium: { label: "中风险", color: "text-amber-400 bg-amber-500/10" },
  high: { label: "高风险", color: "text-orange-400 bg-orange-500/10" },
  critical: { label: "严重", color: "text-red-400 bg-red-500/10" },
};

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
}

export function SkillDetailPanel({ skillName, compact }: SkillDetailPanelProps) {
  const [detail, setDetail] = React.useState<SkillDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<TabId>("info");

  const loadDetail = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const d = await skillDetail(skillName);
      setDetail(d);
      // 如果有格式问题，默认切到 errors 标签
      if (d.entry.validation_error) {
        setActiveTab("errors");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [skillName]);

  React.useEffect(() => { loadDetail(); }, [loadDetail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...
      </div>
    );
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
          {activeTab === "info" && <InfoTab entry={entry} labelCls={labelCls} compact={compact} />}
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

function InfoTab({ entry, labelCls, compact }: {
  entry: SkillDetail["entry"];
  labelCls: string;
  compact?: boolean;
}) {
  const source = layerToSource(entry.layer);

  return (
    <div className="space-y-4">
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

      {/* 标题 */}
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
          </div>
        </div>
      </div>

      {/* 描述（来自 SKILL.md） */}
      {entry.description && (
        <div>
          <div className={labelCls}>描述</div>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{entry.description}</p>
        </div>
      )}

      {/* manifest.json 属性网格 */}
      <div className="grid grid-cols-2 gap-2">
        <InfoField label="版本" value={entry.version || "—"} />
        <InfoField label="软件" value={(DCC_LABELS as Record<string, string>)[entry.software?.toLowerCase()] || entry.software || "—"} />
        <InfoField label="分类" value={entry.category || "—"} />
        <InfoField
          label="风险等级"
          value={
            entry.risk_level ? (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", RISK_LABELS[entry.risk_level]?.color || "text-muted-foreground bg-muted")}>
                {RISK_LABELS[entry.risk_level]?.label || entry.risk_level}
              </span>
            ) : "—"
          }
        />
        <InfoField label="作者" value={entry.author || "—"} />
        <InfoField label="许可证" value={entry.license || "—"} />
        <InfoField label="入口文件" value={entry.entry_point || "—"} />
        <InfoField label="层级" value={entry.layer || "—"} />
      </div>

      {/* 标签 */}
      {entry.tags && entry.tags.length > 0 && (
        <div>
          <div className={labelCls}>标签</div>
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((tag, i) => (
              <span key={i} className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 依赖 */}
      {entry.dependencies && entry.dependencies.length > 0 && (
        <div>
          <div className={labelCls}>依赖</div>
          <div className="flex flex-wrap gap-1">
            {entry.dependencies.map((dep, i) => (
              <span key={i} className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                {dep}
              </span>
            ))}
          </div>
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
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate text-[11px]">{value || "—"}</div>
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

  return (
    <div className="prose prose-invert prose-xs max-w-none
      prose-headings:text-foreground prose-headings:font-semibold
      prose-h1:text-base prose-h2:text-sm prose-h3:text-xs
      prose-p:text-xs prose-p:leading-relaxed prose-p:text-muted-foreground
      prose-code:text-[10px] prose-code:bg-muted/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
      prose-pre:bg-muted/20 prose-pre:border prose-pre:border-border/40
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
      prose-li:text-xs prose-li:text-muted-foreground
      prose-strong:text-foreground prose-strong:font-semibold
      prose-table:text-xs prose-th:text-muted-foreground prose-td:text-muted-foreground
      [&_table]:border-collapse [&_th]:border [&_th]:border-border/40 [&_th]:px-2 [&_th]:py-1
      [&_td]:border [&_td]:border-border/40 [&_td]:px-2 [&_td]:py-1
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
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
      detail: "Skill 目录下没有 manifest.json 文件。请按照 ArtClaw 格式规范创建包含以下建议字段的 manifest.json：manifest_version, name, version, software, software_version, category, risk_level, entry_point。",
    });
  } else if (errMsg.includes("manifest.json 校验失败")) {
    issues.push({
      severity: "error",
      message: "manifest.json 校验失败",
      detail: "manifest.json 存在但格式不符合规范。请参考 ArtClaw manifest.schema.json 检查字段类型和必需字段。",
    });
  } else if (errMsg) {
    issues.push({
      severity: "error",
      message: errMsg,
    });
  }

  // 检查常见缺失字段
  if (entry.has_manifest) {
    if (!entry.category) {
      issues.push({ severity: "warning", message: "缺少 category 字段" });
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

      {/* ArtClaw 格式规范参考 */}
      <div className="mt-4 rounded border border-border/40 bg-muted/10 px-3 py-2">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">ArtClaw 格式规范</div>
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <p>manifest.json 建议字段：</p>
          <ul className="list-disc list-inside ml-1 space-y-0.5 text-[10px]">
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">manifest_version</code>: "1.0"</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">name</code>: snake_case，全局唯一</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">version</code>: semver 格式</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">software</code>: DCC 软件标识</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">software_version</code>: <code className="text-[9px] bg-muted/30 px-1 rounded">{"{min, max}"}</code>，DCC 版本号约束</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">category</code>: 功能分类</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">risk_level</code>: low / medium / high</li>
            <li><code className="text-[9px] bg-muted/30 px-1 rounded">entry_point</code>: 入口文件名</li>
          </ul>
          <p className="mt-1">SKILL.md frontmatter 提供 name 和 description，manifest.json 提供其他所有字段。</p>
        </div>
      </div>
    </div>
  );
}
