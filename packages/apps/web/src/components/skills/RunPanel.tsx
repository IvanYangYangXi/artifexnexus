/**
 * RunPanel — Nexus-Tool 运行面板
 *
 * 用途：手动运行工具，参数填入 + 筛选条件为临时变量，不写入 manifest。
 * 与 ToolDetailPanel 的区别：
 *   - 参数为值输入（非定义编辑）
 *   - 无触发器 Tab
 *   - 无基本信息编辑
 *   - 底部 [运行] [AI辅助运行] ... [取消]，空间不足时隐藏按钮文字
 */

"use client";

import * as React from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  Wrench,
  ChevronDown,
  ChevronRight,
  Filter,
  Sliders,
  GitBranch,
  Info,
  Sparkles,
  XCircle,
  ShieldAlert,
  ShieldCheck,
  PackageOpen,
} from "lucide-react";
import { Button, Input, cn, toast } from "@artifex-nexus/ui";
import { invoke } from "@tauri-apps/api/core";
import { ScrollFade } from "../chat/ScrollFade";
import { FiltersTab } from "./FiltersTab";
import { ToggleSwitch } from "./ToolDetailPanel";
import { ChatPromptContext, DCCStatusContext } from "../shell/AppShell";
import { useNotifications } from "../../lib/notification-store";
import {
  nexusToolDetail,
  nexusToolRun,
  nexusToolResult,
  nexusToolCancel,
  nexusToolAck,
  nexusToolInstallDeps,
  type NexusToolDetail,
  type NexusToolParam,
  type FilterConfig,
  type NexusToolRunResult,
  type NexusToolRunStartResult,
  type NexusToolPollResult,
  type NexusToolInstallDepsResult,
} from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS, SOURCE_LABELS } from "../../lib/skillsMock";
import { addRecentTool } from "../../lib/useRecentStore";

// ── Types ──────────────────────────────────────────────────────────────────

interface RunPanelProps {
  toolId: string;
  compact?: boolean;
}

type TabId = "params" | "filters" | "info";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "params",  label: "脚本参数", icon: <Sliders className="h-3.5 w-3.5" /> },
  { id: "filters", label: "筛选条件", icon: <Filter className="h-3.5 w-3.5" /> },
  { id: "info",    label: "工具信息", icon: <Info className="h-3.5 w-3.5" /> },
];

// ── Component ──────────────────────────────────────────────────────────────

export function RunPanel({ toolId, compact }: RunPanelProps) {
  const [detail, setDetail] = React.useState<NexusToolDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [runResult, setRunResult] = React.useState<NexusToolRunResult | null>(null);
  const [activeTab, setActiveTab] = React.useState<TabId>("params");

  // ── 异步执行状态 ──
  const taskIdRef = React.useRef<string | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 防重入：确保 maybeNotify 每次运行只触发一次（setInterval 竞态） */
  const notifiedRef = React.useRef(false);

  const { navigateWithPrompt } = React.useContext(ChatPromptContext);
  const { dccStatus } = React.useContext(DCCStatusContext);
  const { addNotification } = useNotifications();

  // ── DCC 连接状态检测 ──────────────────────────────────────────────
  const targetDccs = React.useMemo(() => {
    if (!detail) return [];
    return (detail.software || []).map((e) => typeof e === "string" ? e : e.dcc);
  }, [detail]);

  /** 检查是否有目标 DCC 的 MCP 已连接。filter out "general" — 通用工具无需 DCC 连接 */
  const hasConnectedDCC = React.useMemo(() => {
    const dccTargets = targetDccs.filter((d) => d !== "general");
    if (dccTargets.length === 0) return true;
    return dccTargets.some((dcc) => {
      const status = dccStatus.find((s) => s.name.toLowerCase() === dcc.toLowerCase());
      return status?.connected ?? false;
    });
  }, [targetDccs, dccStatus]);

  /** 获取已连接/未连接的 DCC 名称列表 */
  const dccConnectionInfo = React.useMemo(() => {
    const dccLabels = targetDccs.map((dcc) => ({
      dcc,
      label: (DCC_LABELS as Record<string, string>)[dcc] || dcc,
      connected: dccStatus.some((s) => s.name.toLowerCase() === dcc.toLowerCase() && s.connected),
    }));
    return {
      connected: dccLabels.filter((d) => d.connected).map((d) => d.label),
      disconnected: dccLabels.filter((d) => !d.connected).map((d) => d.label),
    };
  }, [targetDccs, dccStatus]);

  // ── 临时参数值（纯内存，不写 manifest）─────────────────────────────
  const [paramValues, setParamValues] = React.useState<Record<string, unknown>>({});
  const [paramExpanded, setParamExpanded] = React.useState<Record<string, boolean>>({});

  // ── 临时筛选条件 ──────────────────────────────────────────────────
  const [filters, setFilters] = React.useState<FilterConfig>({});

  // ── 依赖状态 ──────────────────────────────────────────────────────
  const [depsMissing, setDepsMissing] = React.useState<string[] | null>(null);
  const [depsInstalling, setDepsInstalling] = React.useState(false);
  const [depsInstallResult, setDepsInstallResult] = React.useState<NexusToolInstallDepsResult | null>(null);

  // 加载工具详情
  const loadDetail = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    // 切换工具时清空上一个工具的运行结果
    setRunResult(null);
    setRunning(false);
    setDepsMissing(null);
    setDepsInstallResult(null);
    try {
      const d = await nexusToolDetail(toolId);
      setDetail(d);
      // 初始化参数值为默认值
      const initialValues: Record<string, unknown> = {};
      d.inputs?.forEach((p) => {
        if (p.default !== undefined) initialValues[p.id] = p.default;
      });
      setParamValues(initialValues);
      // 初始化筛选条件
      setFilters(d.default_filters || {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [toolId]);

  React.useEffect(() => { loadDetail(); }, [loadDetail]);

  // ── 通知生成：工具执行完成时，由前端直接发通知（取代 sidecar 文件桥接）─
  const maybeNotify = React.useCallback(
    (result: NexusToolRunResult) => {
      try {
        // 兼容性兜底：当 sidecar 旧版不识别 MCP Bridge v4 的 `output` 字段时，
        // result.data 会是原始 MCP 响应 {success, output, exec_id, execution_time, result}。
        // 我们在这里再做一次 parse，把工具的真实返回值挖出来。这样即便 sidecar
        // 还没重启、还在跑老代码，前端依然能正确展示成功/失败状态和 CSV 路径。
        let data: any = (result as any).data;
        let success = result.success;
        let extraError: string | undefined;
        if (
          data &&
          typeof data === "object" &&
          typeof data.output === "string" &&
          ("exec_id" in data || "execution_time" in data)
        ) {
          // 这是 UE universal_proxy 的原始响应——尝试解析最后一行 output
          try {
            const lines = data.output.split("\n").map((l: string) => l.trim()).filter(Boolean);
            if (lines.length > 0) {
              const parsed = JSON.parse(lines[lines.length - 1]);
              if (parsed && typeof parsed === "object") {
                // 内层 success === false 时把外层也标记为失败
                if (parsed.success === false) {
                  success = false;
                  extraError = parsed.error || parsed.error_type || undefined;
                }
                data = parsed;
              }
            }
          } catch {
            // 解析失败：保留原始 data
          }
        }

        let type: "success" | "warning" | "error" = success ? "success" : "error";
        let message: string;
        let notifDetail: string | undefined;

        // 资产扫描类工具识别：data.csv_path 或 data.groups (含 total_scanned)
        const isScanResult = data && (
          data.csv_path !== undefined ||
          (Array.isArray(data.groups) && data.total_scanned !== undefined)
        );

        if (!success) {
          // ── 失败分支：把工具内层 error/traceback 放到 detail，便于排查 ──
          const errMsg = result.error || extraError || (data && (data as any).error) || "执行失败";
          const step = data && (data as any).step;
          const errorType = data && (data as any).error_type;
          const traceback = data && (data as any).traceback;
          message = step
            ? `执行失败 [${step}]: ${String(errMsg).slice(0, 80)}`
            : `执行失败: ${String(errMsg).slice(0, 80)}`;
          // detail 拼接：错误类型 + traceback（如果有）
          const parts: string[] = [];
          if (errorType) parts.push(`类型: ${errorType}`);
          parts.push(`错误: ${errMsg}`);
          if (traceback) parts.push(`---\n${traceback}`);
          notifDetail = parts.join("\n");
        } else if (data && (data.issues_found !== undefined || data.report)) {
          // 合规检查类工具
          const issuesFound: number = data.issues_found ?? 0;
          const total: number = data.total_checked ?? issuesFound;
          const report: string = data.report ?? "";
          if (issuesFound > 0) {
            type = "warning";
            const errors = (data.issues || []).filter((i: any) => i.severity === "error").length;
            const warnings = (data.issues || []).filter((i: any) => i.severity === "warning").length;
            const parts: string[] = [];
            if (errors) parts.push(`${errors} 个错误`);
            if (warnings) parts.push(`${warnings} 个警告`);
            message = `检查 ${total} 个 Tool，${parts.join("，")}`;
          } else {
            message = `检查 ${total} 个 Tool，全部通过`;
          }
          notifDetail = report;
        } else if (isScanResult) {
          // 资产扫描类工具（重复模型/贴图/相似贴图）→ 显示 CSV 路径
          const csvPath: string = data.csv_path ?? "";
          const groupCount: number = data.group_count ?? data.groups?.length ?? 0;
          const totalDupes: number = data.total_duplicate_assets ?? 0;
          const totalScanned: number = data.total_scanned ?? 0;

          const lines: string[] = [];
          if (groupCount > 0) {
            lines.push(`扫描 ${totalScanned} 个资产，发现 ${groupCount} 个重复组（${totalDupes} 个资产）`);
          } else {
            lines.push(`扫描 ${totalScanned} 个资产，未发现重复资产`);
          }
          if (csvPath) {
            lines.push(`CSV: ${csvPath}`);
          }
          message = lines.join("\n");
          // detail 始终带 CSV 路径，即使 message 已经包含——便于点击查看
          notifDetail = csvPath || undefined;
          type = "success";
        } else if (data?.stdout && typeof data.stdout === "string" && data.stdout.length > 3) {
          message = `执行成功（输出 ${data.stdout.length} 字符）`;
        } else {
          message = "执行成功";
        }

        addNotification({
          type,
          title: `工具: ${detail?.name ?? ""}`,
          message,
          source: "nexus-tool",
          detail: notifDetail,
        });
      } catch (_) {
        // 通知失败不影响主流程
      }
    },
    [addNotification, detail],
  );

  // ── 运行（异步：启动 → 轮询）──
  const handleRun = async () => {
    if (!detail) return;
    cleanup();
    notifiedRef.current = false;
    setRunning(true);
    setRunResult(null);
    setDepsMissing(null);
    setDepsInstallResult(null);

    try {
      // 1. 启动执行（5s 超时，立即返回 task_id）
      const startResult = await nexusToolRun(detail.id, paramValues);
      const taskId = startResult.task_id;
      taskIdRef.current = taskId;

      // 多 DCC 标记提示
      if (startResult.warning) {
        toast(startResult.warning, { duration: 4000 });
      }

      // 检查 dependency_missing 状态（后端在异步返回前就设了）
      if (startResult.status === "dependency_missing") {
        cleanup();
        setRunning(false);
        // 立即查询一次获取 missing 列表
        try {
          const poll = await nexusToolResult(taskId);
          if (poll.status === "dependency_missing" && (poll as any).missing_deps) {
            setDepsMissing((poll as any).missing_deps);
          }
          nexusToolAck(taskId).catch(() => {});
        } catch (_) {
          setDepsMissing(["无法获取缺失依赖列表"]);
        }
        return;
      }

      // 2. 轮询结果（setInterval 竞态防护：回调顶部检查 + notifiedRef 防重入）
      pollTimerRef.current = setInterval(async () => {
        // 回调入口检查：cleanup 已将 taskIdRef 置 null，直接跳过
        if (!taskIdRef.current) return;
        try {
          const poll: NexusToolPollResult = await nexusToolResult(taskId);
          // await 之后再次检查：上一个回调可能已在等待期间 cleanup
          if (!taskIdRef.current) return;

          if (poll.status === "done") {
            cleanup();
            const result = poll.result || { success: true };
            setRunResult(result);
            setRunning(false);
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              maybeNotify(result);
            }
            if (detail) addRecentTool(detail.id, detail.name);
            nexusToolAck(taskId).catch(() => {});
          } else if (poll.status === "error") {
            cleanup();
            const errorResult = { success: false, error: poll.error || "执行失败" };
            setRunResult(errorResult);
            setRunning(false);
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              maybeNotify(errorResult);
            }
            nexusToolAck(taskId).catch(() => {});
          } else if (poll.status === "cancelled") {
            cleanup();
            setRunResult({ success: false, error: "任务已取消" });
            setRunning(false);
            nexusToolAck(taskId).catch(() => {});
          }
          // status === "running" → 继续轮询
        } catch (_e) {
          // 轮询失败不中断，继续尝试
        }
      }, 1000);

      // 3. 超时保护：尊重 manifest.implementation.timeout（秒），默认 120s，clamp 到 [10s, 86400s]
      const manifestTimeoutSec = Number((detail as any)?.implementation?.timeout) || 120;
      const guardMs = Math.min(86400, Math.max(10, manifestTimeoutSec)) * 1000 + 5_000;
      const guardLabel = `${Math.round(guardMs / 1000)} 秒`;
      timeoutTimerRef.current = setTimeout(() => {
        cleanup();
        const timeoutResult = { success: false, error: `执行超时（超过 ${guardLabel}）` };
        setRunResult(timeoutResult);
        setRunning(false);
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          maybeNotify(timeoutResult);
        }
        if (taskId) nexusToolCancel(taskId).catch(() => {});
      }, guardMs);
    } catch (e) {
      cleanup();
      const catchResult = { success: false, error: String(e) };
      setRunResult(catchResult);
      setRunning(false);
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        maybeNotify(catchResult);
      }
    }
  };

  const handleCancel = async () => {
    const taskId = taskIdRef.current;
    if (!taskId) return;
    try {
      await nexusToolCancel(taskId);
    } catch (_e) {
      // ignore
    }
    cleanup();
    setRunning(false);
    setRunResult({ success: false, error: "已取消" });
  };

  // ── 一键修复依赖 ──
  const handleFixDeps = async () => {
    if (!detail) return;
    setDepsInstalling(true);
    setDepsMissing(null);
    setDepsInstallResult(null);
    try {
      const result = await nexusToolInstallDeps(detail.id);
      setDepsInstallResult(result);
    } catch (e) {
      setDepsInstallResult({ success: false, installed: [], failed: [], errors: [String(e)] });
    } finally {
      setDepsInstalling(false);
    }
  };

  // ── 忽略依赖并运行 ──
  const handleIgnoreRun = async () => {
    if (!detail) return;
    setDepsMissing(null);
    setDepsInstallResult(null);
    cleanup();
    notifiedRef.current = false;
    setRunning(true);

    try {
      const startResult = await invoke("nexus_tool_run", { params: { id: detail.id, args: paramValues, force: true } }) as NexusToolRunStartResult;
      const taskId = startResult.task_id;
      taskIdRef.current = taskId;

      // 多 DCC 标记提示
      if (startResult.warning) {
        toast(startResult.warning, { duration: 4000 });
      }

      pollTimerRef.current = setInterval(async () => {
        if (!taskIdRef.current) return;
        try {
          const poll: NexusToolPollResult = await nexusToolResult(taskId);
          if (!taskIdRef.current) return;
          if (poll.status === "done") {
            cleanup();
            const result = poll.result || { success: true };
            setRunResult(result);
            setRunning(false);
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              maybeNotify(result);
            }
            if (detail) addRecentTool(detail.id, detail.name);
            nexusToolAck(taskId).catch(() => {});
          } else if (poll.status === "error") {
            cleanup();
            const errorResult = { success: false, error: poll.error || "执行失败" };
            setRunResult(errorResult);
            setRunning(false);
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              maybeNotify(errorResult);
            }
            nexusToolAck(taskId).catch(() => {});
          } else if (poll.status === "cancelled") {
            cleanup();
            setRunResult({ success: false, error: "任务已取消" });
            setRunning(false);
            nexusToolAck(taskId).catch(() => {});
          }
        } catch (_e) { /* 轮询失败不中断 */ }
      }, 1000);

      const manifestTimeoutSec2 = Number((detail as any)?.implementation?.timeout) || 120;
      const guardMs2 = Math.min(86400, Math.max(10, manifestTimeoutSec2)) * 1000 + 5_000;
      const guardLabel2 = `${Math.round(guardMs2 / 1000)} 秒`;
      timeoutTimerRef.current = setTimeout(() => {
        cleanup();
        const timeoutResult = { success: false, error: `执行超时（超过 ${guardLabel2}）` };
        setRunResult(timeoutResult);
        setRunning(false);
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          maybeNotify(timeoutResult);
        }
        if (taskId) nexusToolCancel(taskId).catch(() => {});
      }, guardMs2);
    } catch (e) {
      cleanup();
      const catchResult = { success: false, error: String(e) };
      setRunResult(catchResult);
      setRunning(false);
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        maybeNotify(catchResult);
      }
    }
  };

  function cleanup() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    taskIdRef.current = null;
  }

  // ── AI 辅助运行 ──
  const handleAIAssist = () => {
    if (!detail) return;
    const dccs = (detail.software || []).map((e) => (typeof e === "string" ? e : e.dcc)).filter((d) => d !== "general");
    const dccLabel = dccs.length > 0 ? dccs.join(", ") : "当前 DCC";
    const inputs = detail.inputs || [];

    const paramsList = inputs.length > 0
      ? inputs.map((p) => {
          const typeLabel = p.type === "select" ? "下拉选择" : p.type;
          const req = p.required ? "(必填)" : "(可选)";
          const def = p.default !== undefined ? `默认值: ${p.default}` : "";
          const desc = p.description || "";
          const info = [def, desc].filter(Boolean).join(" / ");
          return `  - ${p.name} [${typeLabel}] ${req} ${info}`.trim();
        }).join("\n")
      : "  (无参数)";

    const prompt = [
      `请帮我运行工具「${detail.name}」：`,
      ``,
      `- 工具路径：${detail.nexus_tool_path}`,
      `- DCC：${dccLabel}`,
      inputs.length > 0 ? `- 参数：` : `- 参数：(无参数)`,
      paramsList,
      ``,
      `请帮我获取 ${dccLabel} 中的当前状态并自动填写运行参数。如果需要我判断的，请向我确认。`,
    ].join("\n");

    navigateWithPrompt(prompt);
  };

  // ── 参数值变更 ──
  const handleParamChange = (paramId: string, value: unknown) => {
    setParamValues((prev) => ({ ...prev, [paramId]: value }));
  };

  const toggleParamExpand = (paramId: string) => {
    setParamExpanded((prev) => ({ ...prev, [paramId]: !prev[paramId] }));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <AlertCircle className="h-5 w-5 text-red-400" />
        <p className="text-xs text-muted-foreground">{error || "工具不存在"}</p>
        <Button variant="outline" size="sm" className="text-xs" onClick={loadDetail}>重试</Button>
      </div>
    );
  }

  const isInstance = !!detail.instance_of;
  const inputs = detail.inputs || [];
  const dccList = detail.software || [];
  const inputCls =
    "h-7 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2 text-xs focus:outline-none focus:border-primary/40 transition-colors font-mono";

  return (
    <div className="flex flex-col h-full">
      {/* 可滚动内容区：头部 + Tab + 依赖/结果 */}
      <ScrollFade className="flex-1 min-h-0" fadeFrom="from-card" fadeHeight="h-3">
        <div className="flex flex-col min-w-0">
        {/* ── 头部 ── */}
        <div className="shrink-0 px-3 py-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-400 shrink-0" />
            <h2 className="text-sm font-semibold truncate">{detail.name}</h2>
            {isInstance && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                <GitBranch className="h-2.5 w-2.5" /> 工具实例
              </span>
            )}
          </div>
          {isInstance && detail.parent_name && (
            <div className="mt-0.5 text-[10px] text-muted-foreground ml-6">
              父工具: {detail.parent_name} ({detail.parent_path})
            </div>
          )}
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground ml-6 flex-wrap">
            <span>版本: {detail.version || "0.0.0"}</span>
            {(SOURCE_LABELS as Record<string, string>)[detail.source] && (
              <span>来源: {(SOURCE_LABELS as Record<string, string>)[detail.source]}</span>
            )}
            {dccList.length > 0 && (
              <span>DCC: {dccList.map((d) => (DCC_LABELS as Record<string, string>)[typeof d === "string" ? d : d.dcc] || (typeof d === "string" ? d : d.dcc)).join(", ")}</span>
            )}
          </div>
        </div>

        {/* ── MCP 连接状态警告 ── */}
        {/* 运行中（running）时隐藏此警告：工具调用占用 UE MCP Server 主线程时，
            状态轮询的 initialize 握手会超时被误判为"未连接"，警告会闪烁误导用户。 */}
        {!hasConnectedDCC && targetDccs.length > 0 && !running && (
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-300/80">
                <p className="font-medium">
                  {dccConnectionInfo.disconnected.length > 0
                    ? `MCP 未连接: ${dccConnectionInfo.disconnected.join("、")}`
                    : "目标 DCC 的 MCP 服务未连接"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  请先在目标 DCC 中启动 Artifex Nexus 插件，MCP 连接建立后才能运行工具。
                  {dccConnectionInfo.connected.length > 0 && (
                    <span className="text-emerald-400/80 ml-1">
                      （已连接: {dccConnectionInfo.connected.join("、")}）
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  工具仍可运行，但可能无法在目标 DCC 中生效
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 导航 ── */}
        <div className="shrink-0 flex border-b border-border/60 px-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-2 text-xs border-b-2 transition-colors whitespace-nowrap",
                activeTab === tab.id
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.id === "params" && (
                <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{inputs.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab 内容 ── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "params" && (
            <div className="p-3 space-y-2">
              {inputs.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  <Sliders className="mx-auto mb-2 h-5 w-5 opacity-40" />
                  该工具无可用参数
                </div>
              ) : (
                inputs.map((param, idx) => (
                  <ParamValueRow
                    key={param.id || param.name || `param-${idx}`}
                    param={param}
                    value={paramValues[param.id]}
                    onChange={(v) => handleParamChange(param.id, v)}
                    isInstance={isInstance}
                    expanded={paramExpanded[param.id] ?? false}
                    onToggleExpand={() => toggleParamExpand(param.id)}
                    inputCls={inputCls}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === "filters" && (
            <div className="p-3">
              <FiltersTab
                filters={filters}
                onChange={setFilters}
                software={dccList}
                compact
              />
            </div>
          )}

          {activeTab === "info" && (
            <div className="p-3 space-y-2 text-xs">
              <div className="rounded border border-border/40 bg-muted/5 p-3 space-y-1.5">
                <InfoRow label="名称" value={detail.name} />
                <InfoRow label="描述" value={detail.description || "无描述"} />
                <InfoRow label="版本" value={detail.version || "0.0.0"} />
                <InfoRow label="作者" value={detail.author || "未知"} />
                <InfoRow label="来源" value={(SOURCE_LABELS as Record<string, string>)[detail.source] || detail.source} />
                <InfoRow label="DCC" value={dccList.map((d) => (DCC_LABELS as Record<string, string>)[typeof d === "string" ? d : d.dcc] || (typeof d === "string" ? d : d.dcc)).join(", ") || "通用"} />
                <InfoRow label="ID" value={detail.id} mono />
                <InfoRow label="路径" value={detail.nexus_tool_path} mono />
                {detail.created_at && <InfoRow label="创建时间" value={detail.created_at.slice(0, 10)} />}
                {detail.updated_at && <InfoRow label="更新时间" value={detail.updated_at.slice(0, 10)} />}
              </div>
            </div>
          )}
        </div>

        {/* ── 依赖缺失 ── */}
        {depsMissing && !depsInstallResult && (
          <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/[0.03] px-3 py-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="text-xs font-medium text-amber-300">
                工具运行前发现 {depsMissing.length} 个 Python 依赖缺失
              </span>
            </div>
            <div className="space-y-1 mb-3">
              {depsMissing.map((dep) => (
                <div key={dep} className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/20 rounded px-2 py-1">
                  <PackageOpen className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="flex-1 font-mono">{dep}</span>
                  <span className="text-amber-400/70">未安装</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs"
                onClick={handleFixDeps}
                disabled={depsInstalling}
              >
                {depsInstalling ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Wrench className="mr-1.5 h-3 w-3" />
                )}
                一键修复
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleIgnoreRun}
                disabled={depsInstalling}
              >
                忽略并运行
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              💡 一键修复无法解决？试试 <button className="underline hover:text-foreground" onClick={handleAIAssist}>AI 辅助运行</button>
            </p>
          </div>
        )}

        {/* ── 依赖安装结果 ── */}
        {depsInstallResult && (
          <div className={cn(
            "shrink-0 border-t px-3 py-2 max-h-[120px] overflow-y-auto",
            depsInstallResult.success
              ? "border-emerald-500/20 bg-emerald-500/[0.03]"
              : "border-red-500/20 bg-red-500/[0.03]",
          )}>
            <div className="flex items-center gap-2 mb-1">
              {depsInstallResult.success ? (
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-red-400" />
              )}
              <span className="text-xs font-medium">
                {depsInstallResult.success
                  ? `依赖安装完成 (${depsInstallResult.installed.length} 个)`
                  : "依赖安装失败"}
              </span>
            </div>
            {depsInstallResult.installed.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1">
                已安装: {depsInstallResult.installed.join(", ")}
              </div>
            )}
            {depsInstallResult.failed.length > 0 && (
              <div className="text-[10px] text-red-300/80 mt-1">
                安装失败: {depsInstallResult.failed.join(", ")}
              </div>
            )}
            {depsInstallResult.errors?.map((e, i) => (
              <p key={i} className="text-[10px] text-red-300/80 mt-0.5">{e}</p>
            ))}
            {depsInstallResult.success && (
              <p className="mt-2 text-[10px] text-emerald-400/80">
                依赖已就绪，请重新运行工具
              </p>
            )}
          </div>
        )}

        {/* ── 运行结果 ── */}
        {runResult && (
          <div className={cn(
            "shrink-0 border-t px-3 py-2 max-h-[150px] overflow-y-auto",
            runResult.success
              ? "border-emerald-500/20 bg-emerald-500/[0.03]"
              : "border-red-500/20 bg-red-500/[0.03]",
          )}>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("inline-block h-2 w-2 rounded-full", runResult.success ? "bg-emerald-400" : "bg-red-400")} />
              <span className="text-xs font-medium">
                {runResult.success ? "运行成功" : "运行失败"}
                {runResult.dcc && ` · ${runResult.dcc}`}
              </span>
            </div>
            {runResult.error && (
              <p className="text-xs text-red-300/80 mb-1">{runResult.error}</p>
            )}
            {runResult.data !== undefined && (
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/20 p-2 font-mono text-[10px] leading-relaxed">
                {typeof runResult.data === "string" ? runResult.data : JSON.stringify(runResult.data, null, 2)}
              </pre>
            )}
          </div>
        )}
        </div>
      </ScrollFade>

      {/* ── 底部运行按钮（ScrollFade 外，不受 overflow-x-hidden 影响）── */}
      <div className="@container shrink-0 flex items-center gap-1.5 border-t border-border/60 px-2 py-2 min-w-0">
        {/* 运行 — 最左边 */}
        <Button
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={handleRun}
          disabled={running}
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          <span className={running ? "hidden @[300px]:inline ml-1" : "ml-1"}>
            {running ? "运行中..." : "运行"}
          </span>
        </Button>
        {/* AI 辅助运行 */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={handleAIAssist}
          title="切换到 Chat 界面，让 AI 帮你运行工具"
        >
          <Sparkles className="h-3 w-3" />
          <span className={running ? "hidden @[300px]:inline ml-1" : "ml-1"}>AI 辅助运行</span>
        </Button>
        <div className="flex-1 min-w-0" />
        {running && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0"
            onClick={handleCancel}
          >
            <XCircle className="h-3 w-3" />
            <span className="hidden @[300px]:inline ml-1">取消</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ── 参数值输入行 ───────────────────────────────────────────────────────────

function ParamValueRow({
  param, value, onChange, isInstance, expanded, onToggleExpand, inputCls,
}: {
  param: NexusToolParam;
  value: unknown;
  onChange: (v: unknown) => void;
  isInstance: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  inputCls: string;
}) {
  const type = param.type || "string";
  const useSource = isInstance && param.useSourceDefault;

  return (
    <div className="rounded border border-border/40 bg-muted/5 p-2 space-y-1.5">
      {/* 参数头 */}
      <div className="flex items-center gap-2">
        <button onClick={onToggleExpand} className="p-0.5 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <span className="text-xs font-medium font-mono">{param.name}</span>
        <span className="px-1 py-0.5 rounded bg-muted/30 text-[10px] text-muted-foreground">{type}</span>
        {param.required && <span className="text-[10px] text-red-400">*必填</span>}
        {useSource && (
          <span className="text-[10px] text-amber-400 ml-auto">使用源参数默认值</span>
        )}
      </div>

      {/* 展开详情 */}
      {expanded && param.description && (
        <div className="text-[10px] text-muted-foreground pl-5">{param.description}</div>
      )}

      {/* 值输入 */}
      {useSource ? (
        <div className="pl-5 text-[11px] text-muted-foreground font-mono">
          默认值: {String(param.default ?? "无")}
        </div>
      ) : (
        <div className="pl-5">
          {renderParamInput(param, value, onChange, inputCls)}
        </div>
      )}
    </div>
  );
}

// ── 参数类型 → 输入控件 ────────────────────────────────────────────────────

function renderParamInput(
  param: NexusToolParam,
  value: unknown,
  onChange: (v: unknown) => void,
  inputCls: string,
): React.ReactNode {
  const type = param.type || "string";

  switch (type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <ToggleSwitch
            checked={!!value}
            onChange={onChange}
          />
          <span className="text-xs">{value ? "是" : "否"}</span>
        </label>
      );

    case "number":
      return (
        <input
          type="number"
          value={value !== undefined ? String(value) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? undefined : Number(raw));
          }}
          min={param.min}
          max={param.max}
          step={param.step}
          placeholder={String(param.default ?? "输入数字")}
          className={inputCls}
        />
      );

    case "select":
    case "enum":
      return (
        <select
          value={String(value ?? param.options?.[0] ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, "appearance-none")}
        >
          {(param.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case "file":
    case "folder":
      return (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-7 text-xs flex-1"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={type === "file" ? "选择文件路径..." : "选择文件夹路径..."}
          />
          <Button variant="outline" size="sm" className="h-7 text-[10px] shrink-0">
            浏览
          </Button>
        </div>
      );

    default:
      return (
        <input
          type="text"
          value={value !== undefined ? String(value) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? undefined : raw);
          }}
          placeholder={String(param.default ?? "输入值")}
          className={inputCls}
        />
      );
  }
}

// ── 辅助 ──

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground shrink-0 w-16 text-right">{label}</span>
      <span className={cn("flex-1 min-w-0 break-all", mono && "font-mono text-[10px]")}>{value}</span>
    </div>
  );
}
