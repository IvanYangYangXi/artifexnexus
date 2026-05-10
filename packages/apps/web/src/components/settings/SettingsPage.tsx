"use client";

/**
 * SettingsPage — 设置模块（模型 / 认证 / Agent）
 *
 * 完全复刻 apps/desktop SettingsPanel 的三 Tab 结构
 * 在 Tauri 环境中通过 window.__TAURI__.invoke 调用真实 IPC
 */

import * as React from "react";
import { Cpu, Key, Bot, Plus, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";

function getTauri() { return (window as any).__TAURI__; }
async function tauriInvoke(cmd: string, args?: any) {
  const t = getTauri();
  if (t?.invoke) return t.invoke(cmd, args ?? {});
  throw new Error("非 Tauri 环境");
}

export function SettingsPage() {
  const [tab, setTab] = React.useState("providers");
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7">
            <TabsTrigger value="providers" className="h-6 gap-1 text-xs"><Cpu className="h-3 w-3" />模型</TabsTrigger>
            <TabsTrigger value="auth" className="h-6 gap-1 text-xs"><Key className="h-3 w-3" />认证</TabsTrigger>
            <TabsTrigger value="agent" className="h-6 gap-1 text-xs"><Bot className="h-3 w-3" />Agent</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "providers" && <ProvidersTab />}
        {tab === "auth" && <AuthTab />}
        {tab === "agent" && <AgentTab />}
      </div>
    </div>
  );
}

// ─── 模型 Tab（复刻 ProvidersTab） ─────────────────────────────────────────

function ProvidersTab() {
  const [config, setConfig] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try { const dump = await tauriInvoke("openclaw_config_dump"); setConfig(dump); } catch {}
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try { await tauriInvoke("openclaw_config_patch", { patch: config }); } catch {}
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载配置...</div>;

  const providers = config?.providers ?? {};
  const providerKeys = Object.keys(providers);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">Provider 列表</h3>
        <div className="space-y-2">
          {providerKeys.map((key) => {
            const p = providers[key];
            return (
              <div key={key} className="rounded-lg border border-white/[0.06] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{key}</span>
                  <span className="text-[10px] text-muted-foreground">{p.protocol || "openai"}</span>
                  <div className="flex-1" />
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" className="peer sr-only" defaultChecked={p.enabled !== false} />
                    <div className="h-5 w-9 rounded-full bg-white/[0.08] peer-checked:bg-primary/30 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
                  </label>
                </div>
                {p.baseUrl && <div className="mt-1 text-[10px] text-muted-foreground">{p.baseUrl}</div>}
                {p.models && <div className="mt-1 flex flex-wrap gap-1">{p.models.map((m: any) => <span key={m.id} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px]">{m.id}</span>)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">API Key</h3>
        <div className="relative">
          <Input className="h-9 pr-16 text-sm" type={showKey ? "text" : "password"} placeholder="sk-..." defaultValue="sk-mock-xxxxxxxxxxxx" />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
        </div>
      </div>

      <Button size="sm" className="h-7 text-xs rounded-full" onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
      <p className="text-[11px] text-muted-foreground">配置来自 openclaw.json · STORY-0040 接入真实读写</p>
    </div>
  );
}

// ─── 认证 Tab（复刻 AuthProfilesTab） ──────────────────────────────────────

function AuthTab() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">认证配置</h3>
        <p className="mb-3 text-xs text-muted-foreground">为不同 Provider 配置独立的 API Key</p>
        <div className="space-y-3">
          {[{ provider: "OpenAI", key: "sk-***" }, { provider: "DeepSeek", key: "sk-***" }, { provider: "Anthropic", key: "sk-ant-***" }].map((p) => (
            <div key={p.provider} className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2">
              <span className="w-20 text-sm">{p.provider}</span>
              <Input className="h-8 flex-1 text-xs" type="password" defaultValue={p.key} />
              <Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3 h-7 gap-1 text-xs rounded-full"><Plus className="h-3 w-3" />添加</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">STORY-0040 接入真实 Token 管理</p>
    </div>
  );
}

// ─── Agent Tab（复刻 DefaultAgentTab） ─────────────────────────────────────

function AgentTab() {
  const [presetStatus, setPresetStatus] = React.useState<any>(null);
  React.useEffect(() => {
    void (async () => { try { const s = await tauriInvoke("openclaw_agent_preset_status"); setPresetStatus(s); } catch {} })();
  }, []);

  const handleReset = async () => {
    try { await tauriInvoke("openclaw_agent_preset_reset_default"); const s = await tauriInvoke("openclaw_agent_preset_status"); setPresetStatus(s); } catch {}
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">Agent 预设</h3>
        {presetStatus ? (
          <div className="rounded-lg border border-white/[0.06] px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className={presetStatus.installed ? "text-emerald-400" : "text-muted-foreground"}>
                {presetStatus.installed ? "✅ 已安装" : "未安装"}
              </span>
              {presetStatus.version && <span className="text-[10px] text-muted-foreground">{presetStatus.version}</span>}
              {presetStatus.modifiedByUser && <span className="text-[10px] text-amber-400">已修改</span>}
            </div>
          </div>
        ) : <div className="text-sm text-muted-foreground">加载中...</div>}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">系统提示词</h3>
        <textarea className="h-32 w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
          defaultValue="你是 Artifex Nexus，一个 AI Agent ↔ DCC 的桥接助手。" />
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs rounded-full">保存</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleReset}>重置为默认</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">STORY-0040 接入 Agent preset 管理</p>
    </div>
  );
}
