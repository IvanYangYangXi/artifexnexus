"use client";

import * as React from "react";
import { Cpu, Bot, Plus, Trash2, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";
import { getIpc } from "../../lib/ipc";
import {
  settingsReducer, createInitialState, buildPatchFromState, validateState,
  type SettingsState, type SettingsAction,
} from "../../features/settings/settings.reducer";
import { PROVIDER_TEMPLATES } from "../../features/settings/settings.types";

const GLASS = "rounded-[16px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]";
const SEL = "mt-1 h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-foreground backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30 [&_option]:bg-card [&_option]:text-foreground";

export function SettingsPage() {
  const [state, dispatch] = React.useReducer(settingsReducer, undefined, createInitialState);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  const loadConfig = async () => {
    dispatch({ type: "LOAD_START" });
    try { const ipc = await getIpc(); const dump = await ipc.dumpOpenClawConfig(); dispatch({ type: "LOAD_SUCCESS", dump }); }
    catch (e: any) { dispatch({ type: "LOAD_ERROR", message: e.message || String(e) }); }
  };
  React.useEffect(() => { loadConfig(); }, []);

  const handleSave = async () => {
    const issues = validateState(state);
    if (issues.length > 0) { setSaveMsg(`校验: ${issues.slice(0,3).map((i:any)=>`${i.field} ${i.message}`).join("; ")}`); return; }
    setSaving(true);
    try {
      const { patch, extrasPatch } = buildPatchFromState(state);
      const ipc = await getIpc();
      const r = await ipc.patchOpenClawConfig(patch, extrasPatch);
      if (!r.success) { setSaveMsg(r.validateError || "保存失败"); return; }
      // 如果用户输入了新 API Key，通过 setOpenClawAuthToken 写入
      const pk = (window as any).__pendingApiKey;
      if (pk?.token && pk.provider) {
        await ipc.setOpenClawAuthToken({ token: pk.token, provider: pk.provider });
        delete (window as any).__pendingApiKey;
      }
      setSaveMsg("已保存");
      dispatch({ type: "RESET_DIRTY" } as any);
      // 重新加载以获取最新状态
      await loadConfig();
    } catch (e: any) { setSaveMsg(e.message); }
    setSaving(false);
  };

  const tab = state.tab || "providers";
  if (state.load.kind === "loading") return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载配置...</div>;
  if (state.load.kind === "error") return <div className="p-6 text-sm text-red-400">加载失败: {state.load.message} <Button variant="outline" size="sm" className="ml-2 h-6 text-xs rounded-full" onClick={loadConfig}>重试</Button></div>;

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
        {saveMsg && <span className={`text-[10px] ${saveMsg==="已保存"?"text-emerald-400":"text-red-400"}`}>{saveMsg}</span>}
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={!state.dirty || saving}><Save className="h-3 w-3" />{saving?"保存中…":"保存"}</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "providers" && <ProvidersTab state={state} dispatch={dispatch} />}
        {tab === "defaultAgent" && <DefaultAgentTab state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}

function ModelRow({ model, index, selected, dispatch }: { model: any; index: number; selected: any; dispatch: React.Dispatch<SettingsAction> }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs ${model.isDefault ? "bg-primary/[0.08]" : ""}`}>
      <input className="h-6 flex-1 rounded border border-white/[0.08] bg-white/[0.03] px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30"
        value={model.id}
        onChange={(e) => dispatch({ type: "UPDATE_MODEL", providerId: selected.id, index, patch: { id: e.target.value } })} />
      <label className="flex items-center gap-1 text-[10px] cursor-pointer shrink-0">
        <input type="checkbox" className="rounded" checked={!!model.isDefault}
          onChange={(e) => {
            const c = e.target.checked;
            const models = selected.models.map((_: any, idx: number) => ({ ...selected.models[idx], isDefault: idx === index && c }));
            dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { models } as any });
          }} />默认
      </label>
      <button className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
        onClick={() => dispatch({ type: "DELETE_MODEL", providerId: selected.id, index })}>×</button>
    </div>
  );
}

function ProvidersTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const [showAdd, setShowAdd] = React.useState(false);
  const [newModelId, setNewModelId] = React.useState("");
  const [fetchingModels, setFetchingModels] = React.useState(false);
  const [remoteModels, setRemoteModels] = React.useState<any[] | null>(null);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [newApiKey, setNewApiKey] = React.useState("");

  const selected = state.providers.find((p) => p.id === state.selectedProviderId);
  const authProfile = selected?.authProfileId ? state.authProfiles.find((a) => a.id === selected.authProfileId) : undefined;
  // API Key 被 mask_secrets 脱敏，dump 返回 *** 串。如果 authProfile 存在且 token 非空（含***脱敏），显示脱敏提示
  const hasAuthProfile = !!authProfile;
  const isTokenMasked = authProfile?.apiKey && /^\*+$/.test(authProfile.apiKey || "");
  const hasRealToken = authProfile?.apiKey && !/^\*+$/.test(authProfile.apiKey || "") && authProfile.apiKey.length >= 8;

  const handleAddModel = () => { const id = newModelId.trim(); if (!id || !selected) return; dispatch({ type: "ADD_MODEL", providerId: selected.id, modelId: id }); setNewModelId(""); };
  const handleFetchModels = async () => { if (!selected) return; if (!selected.baseUrl) { setFetchError("请先填写 baseUrl"); return; } if (!hasRealToken) { setFetchError("请先保存 API Key（凭据脱敏或未找到）"); return; } setFetchingModels(true); setFetchError(null); setRemoteModels(null); try { const ipc = await getIpc(); const r = await ipc.fetchRemoteModels({ baseUrl: selected.baseUrl, token: authProfile!.apiKey }); if (r.success && r.models?.length) setRemoteModels(r.models); else setFetchError(r.error || "未获取到模型"); } catch (e: any) { setFetchError(e.message); } setFetchingModels(false); };
  const handleImportModels = (ids: string[]) => { if (!selected || !ids.length) return; dispatch({ type: "IMPORT_REMOTE_MODELS", providerId: selected.id, modelIds: ids }); setRemoteModels(null); };

  return (
    <div className="flex gap-4" style={{ minHeight: 300 }}>
      <div className={`w-48 shrink-0 ${GLASS} p-2 space-y-0.5`}>
        <div className="mb-1 flex items-center gap-1 px-1"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Provider</span><div className="flex-1" /><Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAdd(!showAdd)}><Plus className="h-3 w-3" /></Button></div>
        {showAdd && <div className="mb-1 rounded-lg border border-white/[0.10] bg-white/[0.06] p-1.5"><div className="text-[10px] text-muted-foreground mb-1">选择模板</div><div className="max-h-[200px] space-y-0.5 overflow-y-auto">{PROVIDER_TEMPLATES.map(tpl=>(<button key={tpl.key} className="block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-white/[0.08]" onClick={()=>{dispatch({type:"ADD_PROVIDER_FROM_TEMPLATE",templateKey:tpl.key,alsoAuth:true});setShowAdd(false);}}>{tpl.label}{tpl.note&&<span className="text-muted-foreground/60"> · {tpl.note}</span>}</button>))}</div></div>}
        {state.providers.map(p=>(<button key={p.id} className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${state.selectedProviderId===p.id?"bg-white/[0.10] font-medium":"hover:bg-white/[0.04] text-muted-foreground"}`} onClick={()=>dispatch({type:"SELECT_PROVIDER",id:p.id})}>{p.displayName||p.id}</button>))}
      </div>
      <div className={`flex-1 ${GLASS} p-4`}>
        {!selected ? <p className="text-xs text-muted-foreground">选择一个 Provider</p> : <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">ID</label><Input className="mt-1 h-8 text-xs" value={selected.id} disabled /></div>
            <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">显示名</label><Input className="mt-1 h-8 text-xs" value={selected.displayName} onChange={e=>dispatch({type:"UPDATE_PROVIDER",id:selected.id,patch:{displayName:e.target.value}})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">协议</label><select className={SEL} value={selected.protocol} onChange={e=>dispatch({type:"UPDATE_PROVIDER",id:selected.id,patch:{protocol:e.target.value as any}})}>{["openai","openai-compatible","anthropic","google","azure-openai"].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
            <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Base URL</label><Input className="mt-1 h-8 text-xs" value={selected.baseUrl} onChange={e=>dispatch({type:"UPDATE_PROVIDER",id:selected.id,patch:{baseUrl:e.target.value}})} /></div>
          </div>
          {/* API Key */}
          <div><label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">API Key</label>
            <div className="mt-1 flex items-center gap-2">
              {isTokenMasked ? (
                <Input className="h-8 flex-1 text-xs font-mono text-muted-foreground" value="已保存（脱敏，不可查看）" readOnly />
              ) : hasRealToken ? (<>
                <Input className="h-8 flex-1 text-xs font-mono" type={showApiKey?"text":"password"} value={authProfile?.apiKey||""} readOnly={!showApiKey} />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={()=>setShowApiKey(!showApiKey)}>{showApiKey?<EyeOff className="h-3 w-3"/>:<Eye className="h-3 w-3"/>}</Button>
              </>) : (
                <Input className="h-8 flex-1 text-xs font-mono" type="password" placeholder="输入新 API Key（保存时写入）" value={newApiKey} onChange={e=>{setNewApiKey(e.target.value);(window as any).__pendingApiKey={token:e.target.value,provider:selected.id};}} />
              )}
            </div>
          </div>
          {/* 模型列表 */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">模型 ({selected.models.length})</label>
            <div className="mt-1 space-y-px rounded-lg border border-white/[0.06]">
              {!selected.models.length && <div className="px-3 py-2 text-[10px] text-muted-foreground">暂无模型</div>}
              {selected.models.map((m, i) => (
                <ModelRow key={i} model={m} index={i} selected={selected} dispatch={dispatch} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input className="h-7 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30" placeholder="model-id" value={newModelId} onChange={e=>setNewModelId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddModel()} />
              <Button size="sm" className="h-7 text-[10px] rounded-full shrink-0" onClick={handleAddModel}>添加</Button>
              <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-full shrink-0" onClick={handleFetchModels} disabled={fetchingModels}>{fetchingModels?"获取中…":"获取模型列表"}</Button>
            </div>
            {fetchError&&<div className="mt-1 text-[10px] text-red-400">{fetchError}</div>}
            {remoteModels&&remoteModels.length>0&&<div className="mt-2 rounded-lg border border-white/[0.10] bg-white/[0.04] p-2 max-h-[200px] overflow-y-auto"><div className="mb-1 flex items-center gap-2"><span className="text-[10px] text-muted-foreground">远端模型（{remoteModels.length}个）</span><div className="flex-1"/><button className="text-[9px] rounded-full bg-primary px-2 py-0.5 text-primary-foreground" onClick={()=>handleImportModels(remoteModels.map((m:any)=>m.id))}>全部导入</button><button className="text-[9px] text-muted-foreground hover:text-foreground ml-1" onClick={()=>setRemoteModels(null)}>关闭</button></div>{remoteModels.map((m:any)=>(<div key={m.id} className="flex items-center justify-between border-b border-white/[0.04] py-0.5 text-xs"><span>{m.name||m.id}{m.ownedBy&&<span className="text-muted-foreground ml-1">({m.ownedBy})</span>}</span><button className="text-[10px] text-primary hover:underline" onClick={()=>handleImportModels([m.id])}>导入</button></div>))}</div>}
          </div>
          <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full text-destructive" onClick={()=>dispatch({type:"DELETE_PROVIDER",id:selected.id})}><Trash2 className="mr-1 h-3 w-3"/>删除</Button>
        </div>}
      </div>
    </div>
  );
}

function DefaultAgentTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const agent = state.defaultAgent;
  const [resetMsg, setResetMsg] = React.useState<string|null>(null);
  const handleReset = async () => { try { const ipc = await getIpc(); const r = await ipc.resetOpenClawAgentPreset(true); setResetMsg(r.success?"已重置":r.error||"失败"); const dump = await ipc.dumpOpenClawConfig(); dispatch({type:"LOAD_SUCCESS",dump}); } catch(e:any) { setResetMsg(e.message); } };

  return (
    <div className={`max-w-lg ${GLASS} p-4 space-y-4`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agent 默认设置（agents.defaults）</div>
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs text-muted-foreground">
        配置来源: openclaw.json → agents.defaults。安装时自动写入 Artifex Nexus 预设。
      </div>
      {/* 人格信息 */}
      {agent.systemPromptOverride && (
        <div>
          <label className="text-[10px] text-muted-foreground">系统提示词 (systemPromptOverride)</label>
          <textarea className="mt-1 h-24 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
            value={agent.systemPromptOverride}
            onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { systemPromptOverride: e.target.value } })} />
        </div>
      )}
      {!agent.systemPromptOverride && (
        <div className="rounded-lg border border-dashed border-white/[0.08] p-3 text-xs text-muted-foreground">
          未检测到 systemPromptOverride（人格信息）。请通过安装向导安装 Artifex Nexus Agent 预设。
        </div>
      )}
      <div><label className="text-[10px] text-muted-foreground">默认模型 (model)</label><Input className="mt-1 h-8 text-xs" value={agent.defaultModel} placeholder="如: openai/gpt-4o" onChange={e=>dispatch({type:"UPDATE_DEFAULT_AGENT",patch:{defaultModel:e.target.value}})} /></div>
      <div><label className="text-[10px] text-muted-foreground">图像模型 (imageModel)</label><Input className="mt-1 h-8 text-xs" value={agent.imageModel} placeholder="如: openai/dall-e-3" onChange={e=>dispatch({type:"UPDATE_DEFAULT_AGENT",patch:{imageModel:e.target.value}})} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="text-[10px] text-muted-foreground">Thinking (thinkingDefault)</label><select className={SEL} value={agent.thinkingDefault||"adaptive"} onChange={e=>dispatch({type:"UPDATE_DEFAULT_AGENT",patch:{thinkingDefault:e.target.value}})}><option value="adaptive">adaptive（自适应）</option><option value="on">on（开启）</option><option value="off">off（关闭）</option></select></div>
        <div><label className="text-[10px] text-muted-foreground">Reasoning (reasoningDefault)</label><select className={SEL} value={agent.reasoningDefault||"on"} onChange={e=>dispatch({type:"UPDATE_DEFAULT_AGENT",patch:{reasoningDefault:e.target.value}})}><option value="on">on（开启）</option><option value="off">off（关闭）</option></select></div>
      </div>
      <div className="flex gap-2"><Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleReset}>重置为默认</Button>{resetMsg&&<span className="text-[10px] text-muted-foreground self-center">{resetMsg}</span>}</div>
    </div>
  );
}
