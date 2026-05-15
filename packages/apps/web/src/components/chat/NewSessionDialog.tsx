"use client";

/**
 * NewSessionDialog — 新建对话配置面板
 *
 * 模态面板，含 Agent / Model / 思考模式 三个选择器，
 * 数据从 Gateway 配置拉取，默认值从 localStorage 恢复。
 * 对齐 ArtClawToolManager 的 SettingsDialog Agent/Model 选择逻辑。
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from "@artifex-nexus/ui";

// ─── 思考强度选项（与 ChatControlBar 保持一致）───────────────────────────

const THINKING_OPTIONS = [
  { id: "off", label: "思考: 关" },
  { id: "minimal", label: "思考: 最低" },
  { id: "low", label: "思考: 低" },
  { id: "medium", label: "思考: 中" },
  { id: "high", label: "思考: 高" },
  { id: "xhigh", label: "思考: 很高" },
  { id: "adaptive", label: "思考: 自适应" },
  { id: "max", label: "思考: 最高" },
];

const AGENT_KEY = "artifex.chat.agent";
const MODEL_KEY = "artifex.chat.model";
const EFFORT_KEY = "artifex.chat.effort";

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (config: { agentId: string; model: string; thinking: string }) => void;
  /** Gateway HTTP 端口 */
  gatewayPort: number;
  /** Gateway 是否运行 */
  gatewayRunning: boolean;
}

// ─── 组件 ─────────────────────────────────────────────────────────────────

export function NewSessionDialog({
  open,
  onClose,
  onConfirm,
  gatewayPort: _gatewayPort,
  gatewayRunning,
}: NewSessionDialogProps) {
  const [agent, setAgent] = React.useState(() => lsGet(AGENT_KEY, ""));
  const [model, setModel] = React.useState(() => lsGet(MODEL_KEY, ""));
  const [thinking, setThinking] = React.useState(() => lsGet(EFFORT_KEY, "adaptive"));
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string }>>([]);
  const [models, setModels] = React.useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = React.useState(false);
  const confirmBtnRef = React.useRef<HTMLButtonElement>(null);


  // 面板打开时拉取 Agent/Model 列表
  React.useEffect(() => {
    if (!open || !gatewayRunning) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const config = await ipc.dumpOpenClawConfig();
        if (cancelled) return;

        // 提取 agents
        const agentsList = (config as any)?.agentList ?? [];
        if (Array.isArray(agentsList) && agentsList.length > 0) {
          const list = agentsList
            .filter((a: any) => a?.id)
            .map((a: any) => ({ id: a.id, name: a.name ?? a.id }));
          setAgents(list);
          setAgent((prev) => {
            if (list.find((a) => a.id === prev)) return prev;
            const found = list.find((a) => a.id === "artifex-nexus")?.id ?? list[0].id;
            return found;
          });
        }

        // 提取 models —— 统一用 ``provider/modelId`` 格式，避免同名模型
        // 在不同供应商下混淆（如 custom/gpt-4 vs openai/gpt-4）。
        const providers = (config as any)?.providers ?? {};
        const modelList: Array<{ id: string; name: string }> = [];
        for (const [providerId, provider] of Object.entries(providers)) {
          const p = provider as any;
          if (Array.isArray(p?.models)) {
            for (const m of p.models) {
              if (m?.id) {
                const fqId = `${providerId}/${m.id}`;
                const baseName = m.name ?? m.id;
                modelList.push({ id: fqId, name: `${providerId}/${baseName}` });
              }
            }
          }
        }
        if (modelList.length > 0) {
          setModels(modelList);
          setModel((prev) => {
            // 兼容旧 localStorage 的裸 id
            const exactMatch = modelList.find((m) => m.id === prev);
            if (exactMatch) return prev;
            const suffixMatch = modelList.find((m) => m.id.split("/").pop() === prev);
            if (suffixMatch) return suffixMatch.id;
            return modelList[0].id;
          });
        }
      } catch (err) { console.warn("[NewSessionDialog] fetch models failed:", err);
        // 加载失败，使用 localStorage 默认值
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [open, gatewayRunning]);

  const handleConfirm = () => {
    if (!agent || !model) return;
    // 持久化到 localStorage
    try { localStorage.setItem(AGENT_KEY, agent); } catch { /* ignore */ }
    try { localStorage.setItem(MODEL_KEY, model); } catch { /* ignore */ }
    try { localStorage.setItem(EFFORT_KEY, thinking); } catch { /* ignore */ }
    onConfirm({ agentId: agent, model, thinking });
  };

  const agentName = agents.find((a) => a.id === agent)?.name ?? agent;
  const modelName = models.find((m) => m.id === model)?.name ?? model;
  const thinkingLabel = THINKING_OPTIONS.find((e) => e.id === thinking)?.label ?? "";

  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="w-[400px]"
        onOpenAutoFocus={(e) => {
          // 拦截 Radix 默认聚焦（会聚焦到 Agent Select），改为聚焦确认按钮
          e.preventDefault();
          setTimeout(() => confirmBtnRef.current?.focus(), 0);
        }}
      >
        <DialogHeader>
          <DialogTitle>新建对话</DialogTitle>
          <DialogDescription>
            选择 Agent、模型和思考模式，创建新的对话会话
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Agent */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Agent</label>
            {loading ? (
              <Skeleton className="h-9 w-full rounded-md" />
            ) : agents.length > 0 ? (
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue>{agentName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/20 text-xs text-muted-foreground">
                {gatewayRunning ? "无可用 Agent" : "Gateway 未启动"}
              </div>
            )}
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">模型</label>
            {loading ? (
              <Skeleton className="h-9 w-full rounded-md" />
            ) : models.length > 0 ? (
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue>{modelName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted/20 text-xs text-muted-foreground">
                {gatewayRunning ? "无可用模型" : "Gateway 未启动"}
              </div>
            )}
          </div>

          {/* Thinking */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">思考模式</label>
            <Select value={thinking} onValueChange={setThinking}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue>{thinkingLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {THINKING_OPTIONS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button ref={confirmBtnRef} onClick={handleConfirm} disabled={!agent || !model || loading}>
            创建对话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
