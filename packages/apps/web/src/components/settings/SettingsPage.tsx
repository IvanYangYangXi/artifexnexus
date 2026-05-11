"use client";

import * as React from "react";
import { Cpu, Bot, Plus, Trash2, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";
import { getIpc } from "../../lib/ipc";
import {
  settingsReducer, createInitialState, buildPatchFromState, validateState,
  type SettingsState, type SettingsAction,
} from "../../features/settings/settings.reducer";
import { PROVIDER_TEMPLATES, type ProviderTemplate } from "../../features/settings/settings.types";

const GLASS = "rounded-[16px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]";
const GLASS_INPUT = "rounded-lg border-white/[0.08] bg-white/[0.03] backdrop-blur-md";

export function SettingsPage() {
  const [state, dispatch] = React.useReducer(settingsReducer, undefined, createInitialState);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    dispatch({ type: "LOAD_START" });
    void (async () => {
      try { const ipc = await getIpc(); const dump = await ipc.dumpOpenClawConfig(); dispatch({ type: "LOAD_SUCCESS", dump }); }
      catch (e: any) { dispatch({ type: "LOAD_ERROR", message: e.message || String(e) }); }
    })();
  }, []);

  const handleSave = async () => {
    const issues = validateState(state);
    if (issues.length > 0) { setSaveMsg(issues.slice(0, 3).map((i: any) => `${i.field} ${i.message}`).join("; ")); return; }
    setSaving(true);
    try {
      const { patch, extrasPatch } = buildPatchFromState(state);
      const ipc = await getIpc();
      const result = await ipc.patchOpenClawConfig(patch, extrasPatch);
      if (!result.success) { setSaveMsg(result.validateError || "保存失败"); return; }
      const pendingKey = (window as any).__pendingApiKey;
      if (pendingKey?.token && pendingKey?.profileId) { await ipc.setOpenClawAuthToken({ profileId: pendingKey.profileId, token: pendingKey.token, provider: pendingKey.provider }); delete (window as any).__pendingApiKey; }
      setSaveMsg("已保存");
      dispatch({ type: "RESET_DIRTY" } as any);
    } catch (e: any) { setSaveMsg(e.message); }
    setSaving(false);
  };

  const tab = state.tab || "providers";
  if (state.load.kind === "loading") return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载配置...</div>;
  if (state.load.kind === "error") return <div className="p-6 text-sm text-red-400">加载失败: {state.load.message} <Button variant="outline" size="sm" className="ml-2 h-6 text-xs rounded-full" onClick={() => dispatch({ type: "LOAD_START" })}>重试</Button></div>;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={(v) => dispatch({ type: "SET_TAB", tab: v as any })}>
          <TabsList className="h-7">
            <TabsTrigger value="providers" className="h-6 gap-1 text-xs"><Cpu className="h-3 w-3" />模型 ({state.providers.length})</TabsTrigger>
            <TabsTrigger value="defaultAgent" className="h-6 gap-1 text-xs"><Bot className="h-3 w-3" />Agent</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        {saveMsg && <span className={`text-[10px] ${saveMsg === "已保存" ? "text-emerald-400" : "text-red-400"}`}>{saveMsg}</span>}
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={!state.dirty || saving}><Save className="h-3 w-3" />{saving ? "保存中..." : "保存"}</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "providers" && <ProvidersTab state={state} dispatch={dispatch} />}
        {tab === "defaultAgent" && <DefaultAgentTab state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}

function ProvidersTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const [showAdd, setShowAdd] = React.useState(false);
  const [fetchingModels, setFetchingModels] = React.useState(false);
  const [remoteModelList, setRemoteModelList] = React.useState<string[] | null>(null);
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [newApiKey, setNewApiKey] = React.useState("");
  const selected = state.providers.find((p) => p.id === state.selectedProviderId);
  const authProfile = selected?.authProfileId ? state.authProfiles.find((a) => a.id === selected.authProfileId) : undefined;
  const maskedKey = authProfile?.apiKey ? "•".repeat(24) : "";

  const handleFetchModels = async () => { if (!selected) return; setFetchingModels(true); try { const ipc = await getIpc(); const models = await ipc.fetchRemoteModels({ providerId: selected.id }); if (models?.models && Array.isArray(models.models)) { setRemoteModelList(models.models.map((m: any) => typeof m === "string" ? m : m.id).filter(Boolean)); } } catch {} finally { setFetchingModels(false); } };

  return (
    <div className="flex gap-4" style={{ minHeight: 300 }}>
      {/* 左侧 — 玻璃卡片 */}
      <div className={`w-48 shrink-0 ${GLASS} p-2 space-y-0.5`}>
        <div className="mb-1 flex items-center gap-1 px-1"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Provider</span><div className="flex-1" /><Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAdd(!showAdd)}><Plus className="h-3 w-3" /></Button></div>
        {showAdd && (
          <div className="mb-1 rounded-lg border border-white/[0.10] bg-white/[0.06] p-1.5">
            <div className="mb-1 text-[10px] text-muted-foreground">选择模板</div>
            <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
              {PROVIDER_TEMPLATES.map((tpl) => (
                <button key={tpl.key} className="block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-white/[0.08] transition-colors" onClick={() => { dispatch({ type: "ADD_PROVIDER_FROM_TEMPLATE", templateKey: tpl.key, alsoAuth: true }); setShowAdd(false); }}>{tpl.label} {tpl.note && <span className="text-muted-foreground/60">· {tpl.note}</span>}</button>
              ))}
            </div>
          </div>
        )}
        {state.providers.map((p) => (
          <button key={p.id} className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${state.selectedProviderId === p.id ? "bg-white/[0.10] font-medium" : "hover:bg-white/[0.04] text-muted-foreground"}`} onClick={() => dispatch({ type: "SELECT_PROVIDER", id: p.id })}>{p.displayName || p.id}</button>
        ))}
      </div>

      {/* 右侧 — 玻璃卡片 */}
      <div className={`flex-1 ${GLASS} p-4`}>
        {!selected ? <p className="text-xs text-muted-foreground">选择一个 Provider 查看详情</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">名称</label><Input className="mt-1 h-8 text-xs" value={selected.displayName} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { displayName: e.target.value } })} /></div>
              <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">协议</label><select className={`mt-1 h-8 w-full ${GLASS_INPUT} px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30`} value={selected.protocol} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { protocol: e.target.value as any } })}>{["openai","openai-compatible","anthropic","google","azure-openai"].map((v)=><option key={v} value={v}>{v}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Base URL</label><Input className="mt-1 h-8 text-xs" value={selected.baseUrl} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { baseUrl: e.target.value } })} /></div>
              <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">关联 Profile</label><Input className="mt-1 h-8 text-xs" value={selected.authProfileId || ""} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { authProfileId: e.target.value || undefined } })} placeholder="可选" /></div>
            </div>
            {/* API Key */}
            <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">API Key</label>
              <div className="mt-1 flex items-center gap-2">
                {maskedKey ? <>
                  <Input className="h-8 flex-1 text-xs font-mono" type={showApiKey ? "text" : "password"} value={showApiKey ? (authProfile?.apiKey || "") : maskedKey} readOnly={!showApiKey} />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}</Button>
                </> : <>
                  <Input className="h-8 flex-1 text-xs font-mono" type="password" placeholder="输入 API Key" value={newApiKey} onChange={(e) => { setNewApiKey(e.target.value); (window as any).__pendingApiKey = { profileId: selected.authProfileId, token: e.target.value, provider: selected.id }; }} />
                  <span className="text-[10px] text-muted-foreground shrink-0">保存时写入</span>
                </>}
              </div>
            </div>
            {/* 模型列表 */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">模型 ({selected.models.length})</label>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleFetchModels} disabled={fetchingModels}>{fetchingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}</Button>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] rounded-full" onClick={() => { const id = prompt("模型 ID:"); if (id?.trim()) dispatch({ type: "ADD_MODEL", providerId: selected.id, modelId: id.trim() }); }}>手动添加</Button>
              </div>
              {remoteModelList && (
                <div className="mb-2 rounded-lg border border-white/[0.10] bg-white/[0.06] p-2 max-h-[200px] overflow-y-auto">
                  <div className="mb-1 flex items-center gap-2"><span className="text-[10px] text-muted-foreground">可用模型</span><div className="flex-1" /><button className="text-[9px] text-muted-foreground hover:text-foreground" onClick={() => setRemoteModelList(null)}>关闭</button></div>
                  {remoteModelList.map((id) => { const exists = selected.models.some((m) => m.id === id); return <button key={id} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] ${exists ? "text-muted-foreground/40" : "hover:bg-white/[0.06]"}`} disabled={exists} onClick={() => { dispatch({ type: "ADD_MODEL", providerId: selected.id, modelId: id }); setRemoteModelList(null); }}><span className="flex-1 font-mono">{id}</span><span className="text-[9px]">{exists ? "已添加" : "+ 添加"}</span></button>; })}
                </div>
              )}
              <div className="space-y-px rounded-lg border border-white/[0.06]">
                {selected.models.length === 0 && <div className="px-3 py-2 text-[10px] text-muted-foreground">暂无模型</div>}
                {selected.models.map((m, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${m.isDefault ? "bg-primary/[0.08]" : "hover:bg-white/[0.02]"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${m.isDefault ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    <span className="flex-1 font-mono">{m.id}</span>
                    <button className={`text-[10px] ${m.isDefault ? "text-primary" : "text-muted-foreground hover:text-primary"}`} onClick={() => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { models: selected.models.map((model, idx) => ({ ...model, isDefault: idx === i })) } as any })}>{m.isDefault ? "默认" : "设为默认"}</button>
                    <button className="text-[10px] text-muted-foreground hover:text-destructive" onClick={() => dispatch({ type: "DELETE_MODEL", providerId: selected.id, index: i })}>删除</button>
                  </div>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full text-destructive" onClick={() => dispatch({ type: "DELETE_PROVIDER", id: selected.id })}><Trash2 className="mr-1 h-3 w-3" />删除此 Provider</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function DefaultAgentTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const agent = state.defaultAgent || { defaultModel: "", imageModel: "", thinkingDefault: "adaptive", reasoningDefault: "on" };
  const [resetMsg, setResetMsg] = React.useState<string | null>(null);

  const handleReset = async () => { try { const ipc = await getIpc(); const r = await ipc.resetOpenClawAgentPreset(true); if (!r.success) setResetMsg(r.error || "重置失败"); else setResetMsg("已重置"); const dump = await ipc.dumpOpenClawConfig(); dispatch({ type: "LOAD_SUCCESS", dump }); } catch (e: any) { setResetMsg(e.message); } };

  return (
    <div className={`max-w-lg ${GLASS} p-4 space-y-4`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Agent 默认设置</div>
      {/* 当前预设状态 */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs">
        <div className="flex items-center gap-2"><span className="text-muted-foreground">预设状态:</span><span className="text-emerald-400">Artifex Nexus Agent</span></div>
        <div className="mt-1 text-[10px] text-muted-foreground">安装时自动配置，可在此修改默认参数</div>
      </div>
      <div><label className="text-[10px] text-muted-foreground">默认模型</label><Input className="mt-1 h-8 text-xs" value={agent.defaultModel} placeholder="如: openai/gpt-4o" onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { defaultModel: e.target.value } })} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="text-[10px] text-muted-foreground">Thinking</label><select className={`mt-1 h-8 w-full ${GLASS_INPUT} px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30`} value={agent.thinkingDefault || "adaptive"} onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { thinkingDefault: e.target.value } })}><option value="adaptive">自适应</option><option value="on">开启</option><option value="off">关闭</option></select></div>
        <div><label className="text-[10px] text-muted-foreground">Reasoning</label><select className={`mt-1 h-8 w-full ${GLASS_INPUT} px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30`} value={agent.reasoningDefault || "on"} onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { reasoningDefault: e.target.value } })}><option value="on">开启</option><option value="off">关闭</option></select></div>
      </div>
      <div><label className="text-[10px] text-muted-foreground">图像模型</label><Input className="mt-1 h-8 text-xs" value={agent.imageModel} placeholder="如: openai/dall-e-3" onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { imageModel: e.target.value } })} /></div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleReset}>重置为默认</Button>
        {resetMsg && <span className="text-[10px] text-muted-foreground self-center">{resetMsg}</span>}
      </div>
    </div>
  );
}
