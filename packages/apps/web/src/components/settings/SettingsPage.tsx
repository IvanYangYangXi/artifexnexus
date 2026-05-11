"use client";

/**
 * SettingsPage — 设置模块（模型+认证 / Agent）
 *
 * 完全复刻 apps/desktop SettingsPanel + settings.reducer
 * IPC 通过 src/lib/ipc.ts 动态加载
 */

import * as React from "react";
import { Cpu, Bot, Plus, Trash2, Eye, EyeOff, Loader2, CheckCircle, XCircle, Save } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";
import { getIpc } from "../../lib/ipc";
import { PROVIDER_TEMPLATES, type ProviderTemplate } from "../../features/settings/settings.types";

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

// ─── 模型+认证 Tab ─────────────────────────────────────────────────────────

function ProvidersTab() {
  const [config, setConfig] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showKeys, setShowKeys] = React.useState<Set<string>>(new Set());
  const [showAddTemplate, setShowAddTemplate] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const loadConfig = async () => {
    try {
      const ipc = await getIpc();
      const dump = await ipc.dumpOpenClawConfig();
      setConfig(dump);
      setError(null);
    } catch (e: any) { setError(e.message || String(e)); }
    setLoading(false);
  };

  React.useEffect(() => { loadConfig(); }, []);

  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ipc = await getIpc();
      await ipc.patchOpenClawConfig({ patch: config });
      await loadConfig();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载配置...</div>;
  if (error && !config) return <div className="text-sm text-red-400">加载失败: {error} <Button variant="outline" size="sm" className="ml-2 h-6 text-xs rounded-full" onClick={loadConfig}>重试</Button></div>;

  const providers = config?.providers || {};
  const providerKeys = Object.keys(providers);
  const authProfiles = config?.authProfiles || {};
  const authKeys = Object.keys(authProfiles);

  return (
    <div className="max-w-2xl space-y-8">
      {/* Provider 列表 */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold">模型提供商</h3>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={() => setShowAddTemplate(!showAddTemplate)}>
            <Plus className="h-3 w-3" />添加
          </Button>
        </div>

        {/* 添加模板选择器 */}
        {showAddTemplate && (
          <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2">
            {PROVIDER_TEMPLATES.map((tpl: ProviderTemplate) => (
              <button key={tpl.key} className="rounded px-2 py-1.5 text-left text-xs hover:bg-white/[0.06]"
                onClick={() => {
                  // 通过 IPC 添加 provider
                  const ipc = getIpc().then(async (ipc) => {
                    // 直接 patch config 添加新 provider
                    const newProviders = { ...providers, [tpl.defaultId]: { protocol: tpl.protocol, baseUrl: tpl.baseUrl, models: (tpl.defaultModels || []).map((m: string, i: number) => ({ id: m, isDefault: i === 0 })) } };
                    await ipc.patchOpenClawConfig({ patch: { providers: newProviders } });
                    await loadConfig();
                    setShowAddTemplate(false);
                  });
                }}>
                <div className="font-medium">{tpl.label}</div>
                {tpl.note && <div className="text-[10px] text-muted-foreground">{tpl.note}</div>}
              </button>
            ))}
          </div>
        )}

        {providerKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无配置的 Provider，点击"添加"选择模板</p>
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
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        const newProviders = { ...providers };
                        delete newProviders[key];
                        const ipc = await getIpc();
                        await ipc.patchOpenClawConfig({ patch: { providers: newProviders } });
                        await loadConfig();
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {p.baseUrl && <div className="mt-1 text-[10px] text-muted-foreground">{p.baseUrl}</div>}
                  {p.models && p.models.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.models.map((m: any) => (
                        <span key={m.id} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px]">{m.id}{m.isDefault ? " (默认)" : ""}</span>
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
                  <span className="rounded bg-white/[0.06] px-1.5 py-0 text-[10px] text-muted-foreground">{a.mode || a.type || "api_key"}</span>
                  <Input className="h-8 flex-1 text-xs font-mono" type={show ? "text" : "password"}
                    defaultValue={a.token || "••••••••"}
                    onChange={async (e) => {
                      const newAuth = { ...authProfiles, [key]: { ...a, token: e.target.value } };
                      // 不自动保存，等用户点保存按钮
                    }} />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleShowKey(key)}>
                    {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={saving}>
          <Save className="h-3 w-3" />{saving ? "保存中..." : "保存"}
        </Button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}

// ─── Agent Tab ─────────────────────────────────────────────────────────────

function AgentTab() {
  const [config, setConfig] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [systemPrompt, setSystemPrompt] = React.useState("");

  const loadConfig = async () => {
    try {
      const ipc = await getIpc();
      const dump = await ipc.dumpOpenClawConfig();
      setConfig(dump);
      // 读取 agents.defaults
      const defaults = dump.agentDefaults || {};
      setSystemPrompt((defaults as any).systemPrompt || "");
    } catch {}
    setLoading(false);
  };

  React.useEffect(() => { loadConfig(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const ipc = await getIpc();
      await ipc.patchOpenClawConfig({ patch: { agentDefaults: { ...config?.agentDefaults, systemPrompt } } });
      await loadConfig();
    } catch {} finally { setSaving(false); }
  };

  const handleReset = async () => {
    try {
      const ipc = await getIpc();
      await ipc.resetOpenClawAgentPreset();
      await loadConfig();
    } catch {}
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载...</div>;

  const defaults = config?.agentDefaults || {};
  const defaultModel = (defaults as any).defaultModel || (defaults as any).model || "未设置";
  const presetStatus = config?.extras?.agentPresetInstalled;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">当前设置</h3>
        <div className="space-y-2 rounded-lg border border-white/[0.06] p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">默认模型:</span>
            <span className="font-medium">{defaultModel}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Agent 预设:</span>
            {presetStatus ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
            <span>{presetStatus ? "已安装" : "未安装"}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">系统提示词</h3>
        <textarea className="h-32 w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
          value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="输入系统提示词..." />
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={saving}>
          <Save className="h-3 w-3" />{saving ? "保存中..." : "保存"}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleReset}>重置为默认</Button>
      </div>
    </div>
  );
}
