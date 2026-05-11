"use client";

/**
 * SettingsPage — 设置模块（模型+认证 / Agent）
 *
 * 完全复刻 apps/desktop SettingsPanel
 * IPC 通过 src/lib/tauriIpc.ts 桥接
 */

import * as React from "react";
import { Cpu, Bot, Plus, Trash2, Eye, EyeOff, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";
import {
  dumpOpenClawConfig, getOpenClawAgentPresetStatus, resetOpenClawAgentPreset,
  type OpenClawConfigDump, type OpenClawAgentPresetStatus,
} from "../../ipc/openclaw";

export function SettingsPage() {
  const [tab, setTab] = React.useState("providers");
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7">
            <TabsTrigger value="providers" className="h-6 gap-1 text-xs"><Cpu className="h-3 w-3" />模型+认证</TabsTrigger>
            <TabsTrigger value="agent" className="h-6 gap-1 text-xs"><Bot className="h-3 w-3" />Agent</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "providers" && <ProvidersTab />}
        {tab === "agent" && <AgentTab />}
      </div>
    </div>
  );
}

// ─── 模型+认证 Tab（复刻 ProvidersTab + AuthProfilesTab） ──────────────────

function ProvidersTab() {
  const [config, setConfig] = React.useState<OpenClawConfigDump | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showKeys, setShowKeys] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    void (async () => {
      try {
        const dump = await dumpOpenClawConfig();
        setConfig(dump);
      } catch (e: any) {
        setError(e.message || String(e));
      }
      setLoading(false);
    })();
  }, []);

  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载配置...</div>;
  if (error) return <div className="text-sm text-red-400">加载失败: {error}</div>;
  if (!config) return <div className="text-sm text-muted-foreground">无配置数据</div>;

  const providers = config.providers || {};
  const providerKeys = Object.keys(providers);
  const authProfiles = config.authProfiles || {};
  const authKeys = Object.keys(authProfiles);

  return (
    <div className="max-w-2xl space-y-8">
      {/* Provider 列表 */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">模型提供商</h3>
        {providerKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无配置的 Provider</p>
        ) : (
          <div className="space-y-2">
            {providerKeys.map((key) => {
              const p = providers[key] as any;
              return (
                <div key={key} className="rounded-lg border border-white/[0.06] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{key}</span>
                    <span className="rounded bg-white/[0.06] px-1.5 py-0 text-[10px] text-muted-foreground">{p.protocol || "openai"}</span>
                    <div className="flex-1" />
                    <span className="text-[10px] text-muted-foreground">{p.baseUrl || ""}</span>
                  </div>
                  {p.models && p.models.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.models.map((m: any) => (
                        <span key={m.id} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px]">
                          {m.id}{m.isDefault ? " (默认)" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 认证配置 */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">认证配置</h3>
        {authKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无认证配置</p>
        ) : (
          <div className="space-y-2">
            {authKeys.map((key) => {
              const a = authProfiles[key] as any;
              const show = showKeys.has(key);
              return (
                <div key={key} className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2">
                  <span className="w-24 text-sm">{key}</span>
                  <span className="rounded bg-white/[0.06] px-1.5 py-0 text-[10px] text-muted-foreground">{a.type || "api_key"}</span>
                  <Input className="h-8 flex-1 text-xs font-mono" type={show ? "text" : "password"} defaultValue={a.token || "••••••••"} readOnly />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleShowKey(key)}>
                    {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">配置来自 openclaw.json · 修改请通过 Desktop 设置面板</p>
    </div>
  );
}

// ─── Agent Tab（复刻 DefaultAgentTab） ─────────────────────────────────────

function AgentTab() {
  const [status, setStatus] = React.useState<OpenClawAgentPresetStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [resetting, setResetting] = React.useState(false);

  const fetchStatus = async () => {
    try {
      const s = await getOpenClawAgentPresetStatus();
      setStatus(s);
    } catch {}
    setLoading(false);
  };

  React.useEffect(() => { fetchStatus(); }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetOpenClawAgentPreset();
      await fetchStatus();
    } catch {} finally { setResetting(false); }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载...</div>;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">Agent 预设状态</h3>
        {status ? (
          <div className="space-y-2 rounded-lg border border-white/[0.06] p-3">
            <div className="flex items-center gap-2 text-sm">
              {status.installed ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
              <span>{status.installed ? "已安装" : "未安装"}</span>
              {status.version && <span className="text-[10px] text-muted-foreground">{status.version}</span>}
            </div>
            {status.modifiedByUser && (
              <div className="text-xs text-amber-400">⚠ 用户已修改预设</div>
            )}
            {status.lockPath && (
              <div className="text-[10px] text-muted-foreground truncate">路径: {status.lockPath}</div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">无法获取状态</p>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs rounded-full" onClick={handleReset} disabled={resetting}>
          {resetting ? "重置中..." : "重置为默认"}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">Agent 预设管理 · STORY-0040 接入完整编辑功能</p>
    </div>
  );
}
