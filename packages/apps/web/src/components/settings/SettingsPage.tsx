"use client";

import * as React from "react";
import { Cpu, Bot, Sliders, Plus, Trash2, Eye, EyeOff, Loader2, Save, RotateCcw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";
import { getIpc } from "../../lib/ipc";
import {
  getAppSettings, setAppSettings, resetAppSettings,
  type AppSettings,
} from "../../ipc/openclaw";
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
    try { const ipc = await getIpc(); const dump = await ipc.dumpOpenClawConfig(); dispatch({ type: "LOAD_SUCCESS", dump }); console.log(`[Settings] config loaded: ${dump?.providers?.length||0} providers`); }
    catch (e: any) { console.error("[Settings] config load failed:", e); dispatch({ type: "LOAD_ERROR", message: e.message || String(e) }); }
  };
  React.useEffect(() => { loadConfig(); }, []);

  const handleSave = async () => {
    const issues = validateState(state);
    if (issues.length > 0) { setSaveMsg(`校验: ${issues.slice(0,3).map((i:any)=>`${i.field} ${i.message}`).join("; ")}`); return; }
    setSaving(true);
    try {
      const { patch, extrasPatch, replacePaths } = buildPatchFromState(state);
      const ipc = await getIpc();
      const r = await ipc.patchOpenClawConfig(patch, extrasPatch, replacePaths);
      if (!r.success) { setSaveMsg(r.validateError || "保存失败"); return; }
      // 如果用户输入了新 API Key（多个 provider 都可能有），逐个写入
      // pendingApiKeys 结构：{ [providerId]: { token, provider, profileId? } }
      const pkMap = ((window as any).__pendingApiKeys ?? {}) as Record<string, { token: string; provider: string; profileId?: string }>;
      for (const pk of Object.values(pkMap)) {
        if (pk?.token && pk.provider) {
          const profileId = pk.profileId || `${pk.provider}-default`;
          await ipc.setOpenClawAuthToken({ token: pk.token, provider: pk.provider, profileId });
        }
      }
      delete (window as any).__pendingApiKeys;
      // 清理旧版兼容字段（避免遗留状态）
      delete (window as any).__pendingApiKey;
      setSaveMsg("已保存");
      dispatch({ type: "RESET_DIRTY" } as any);
      // 重新加载以获取最新状态
      await loadConfig();
    } catch (e: any) { console.error("[Settings] config save failed:", e); setSaveMsg(e.message); }
    setSaving(false);
  };

  const tab = state.tab || "general";
  if (state.load.kind === "loading") return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载配置...</div>;
  if (state.load.kind === "error") return <div className="p-6 text-sm text-red-400">加载失败: {state.load.message} <Button variant="outline" size="sm" className="ml-2 h-6 text-xs rounded-full" onClick={loadConfig}>重试</Button></div>;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={(v) => dispatch({ type: "SET_TAB", tab: v as any })}>
          <TabsList className="h-7">
            <TabsTrigger value="general" className="h-6 gap-1 text-xs"><Sliders className="h-3 w-3" />常规</TabsTrigger>
            <TabsTrigger value="providers" className="h-6 gap-1 text-xs"><Cpu className="h-3 w-3" />模型 ({state.providers.length})</TabsTrigger>
            <TabsTrigger value="defaultAgent" className="h-6 gap-1 text-xs"><Bot className="h-3 w-3" />Agent</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        {saveMsg && <span className={`text-[11px] ${saveMsg==="已保存"?"text-emerald-400":"text-red-400"}`}>{saveMsg}</span>}
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={!state.dirty || saving}><Save className="h-3 w-3" />{saving?"保存中…":"保存"}</Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "general" && <GeneralTab />}
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
      <label className="flex items-center gap-1 text-[11px] cursor-pointer shrink-0">
        <input type="checkbox" className="rounded" checked={!!model.isDefault}
          onChange={(e) => {
            const c = e.target.checked;
            const models = selected.models.map((_: any, idx: number) => ({ ...selected.models[idx], isDefault: idx === index && c }));
            dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { models } as any });
          }} />默认
      </label>
      <button className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive"
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
  // Bug #1: 添加"覆盖模式"状态——当用户想要更换已保存的 API Key 时
  const [overrideApiKey, setOverrideApiKey] = React.useState(false);
  // 测试连接状态
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);

  const selected = state.providers.find((p) => p.id === state.selectedProviderId);

  // 切换 provider 时，从 pending map 恢复该 provider 之前输入的 key（如果有），
  // 同时清掉"覆盖模式"，避免误以为旧 key 还在编辑。
  React.useEffect(() => {
    if (!selected) return;
    const w = window as any;
    const pending = w.__pendingApiKeys?.[selected.id];
    setNewApiKey(pending?.token ?? "");
    setOverrideApiKey(false);
    setTestResult(null);
  }, [selected?.id]);
  const authProfile = selected?.authProfileId ? state.authProfiles.find((a) => a.id === selected.authProfileId) : undefined;
  // API Key 被 mask_secrets 脱敏，dump 返回 *** 串。如果 authProfile 存在且 token 非空（含***脱敏），显示脱敏提示
  const hasAuthProfile = !!authProfile;
  const isTokenMasked = authProfile?.apiKey && /^\*+$/.test(authProfile.apiKey || "");
  const hasRealToken = authProfile?.apiKey && !/^\*+$/.test(authProfile.apiKey || "") && authProfile.apiKey.length >= 8;

  const handleAddModel = () => { const id = newModelId.trim(); if (!id || !selected) return; dispatch({ type: "ADD_MODEL", providerId: selected.id, modelId: id }); setNewModelId(""); };

  // 测试连接：通过 sidecar 发一次最小请求验证 provider + auth 连通性
  const handleTestConnection = async () => {
    if (!selected) return;
    const defaultModel = selected.models.find((m) => m.isDefault)?.id || selected.models[0]?.id;
    if (!defaultModel) { setTestResult({ success: false, error: "请先添加至少一个模型" }); return; }
    setTesting(true); setTestResult(null);
    try {
      const ipc = await getIpc();
      const r = await ipc.testOpenClawProvider({ providerId: selected.id, modelId: defaultModel, authProfileId: selected.authProfileId });
      setTestResult({ success: r.success, latencyMs: r.latencyMs, error: r.error });
    } catch (e: any) { console.warn("[Settings] test connection failed:", e); setTestResult({ success: false, error: e.message }); }
    setTesting(false);
  };

  // Bug #2 修复: 获取模型列表时传递 providerId，让 sidecar 自动读取已存储的 token
  const handleFetchModels = async () => {
    if (!selected) return;
    if (!selected.baseUrl) { setFetchError("请先填写 baseUrl"); return; }
    // 如果没有关联的 auth profile 且没有输入新 key，才报错
    if (!hasAuthProfile && !newApiKey) { setFetchError("请先关联凭据或输入 API Key"); return; }
    setFetchingModels(true); setFetchError(null); setRemoteModels(null);
    try {
      const ipc = await getIpc();
      // Bug #2: 传 providerId 让 sidecar 在 token 为空/脱敏时自动从 auth-profiles.json 读取
      const token = hasRealToken ? authProfile!.apiKey : (newApiKey || "");
      const r = await ipc.fetchRemoteModels({ baseUrl: selected.baseUrl, token, providerId: selected.id });
      if (r.success && r.models?.length) setRemoteModels(r.models);
      else setFetchError(r.error || "未获取到模型");
    } catch (e: any) { console.warn("[Settings] fetch models failed:", e); setFetchError(e.message); }
    setFetchingModels(false);
  };
  const handleImportModels = (ids: string[]) => { if (!selected || !ids.length) return; dispatch({ type: "IMPORT_REMOTE_MODELS", providerId: selected.id, modelIds: ids }); setRemoteModels(null); };

  return (
    <div className="flex gap-4" style={{ minHeight: 300 }}>
      <div className={`w-48 shrink-0 ${GLASS} p-2 space-y-0.5`}>
        <div className="mb-1 flex items-center gap-1 px-1"><span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Provider</span><div className="flex-1" /><Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAdd(!showAdd)}><Plus className="h-3 w-3" /></Button></div>
        {showAdd && <div className="mb-1 rounded-lg border border-white/[0.10] bg-white/[0.06] p-1.5"><div className="text-[11px] text-muted-foreground mb-1">选择模板</div><div className="max-h-[200px] space-y-0.5 overflow-y-auto">{PROVIDER_TEMPLATES.map(tpl=>(<button key={tpl.key} className="block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-white/[0.08]" onClick={()=>{dispatch({type:"ADD_PROVIDER_FROM_TEMPLATE",templateKey:tpl.key,alsoAuth:true});setShowAdd(false);}}>{tpl.label}{tpl.note&&<span className="text-muted-foreground/60"> · {tpl.note}</span>}</button>))}</div></div>}
        {state.providers.map(p=>(<button key={p.id} className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${state.selectedProviderId===p.id?"bg-white/[0.10] font-medium":"hover:bg-white/[0.04] text-muted-foreground"}`} onClick={()=>dispatch({type:"SELECT_PROVIDER",id:p.id})}>{p.displayName||p.id}</button>))}
      </div>
      <div className={`flex-1 ${GLASS} p-4`}>
        {!selected ? <p className="text-xs text-muted-foreground">选择一个 Provider</p> : <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">ID</label><Input className="mt-1 h-8 text-xs" value={selected.id} disabled /></div>
            <div><label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">显示名</label><Input className="mt-1 h-8 text-xs" value={selected.displayName} onChange={e=>dispatch({type:"UPDATE_PROVIDER",id:selected.id,patch:{displayName:e.target.value}})} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">协议</label><select className={SEL} value={selected.protocol} onChange={e=>dispatch({type:"UPDATE_PROVIDER",id:selected.id,patch:{protocol:e.target.value as any}})}>{["openai","openai-compatible","anthropic","google","azure-openai"].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
            <div><label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Base URL</label><Input className="mt-1 h-8 text-xs" value={selected.baseUrl} onChange={e=>dispatch({type:"UPDATE_PROVIDER",id:selected.id,patch:{baseUrl:e.target.value}})} /></div>
          </div>
          {/* Bug #1 修复：API Key 显示/隐藏/覆盖 */}
          <div><label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">API Key</label>
            <div className="mt-1 flex items-center gap-2">
              {isTokenMasked && !overrideApiKey ? (
                <>
                  <Input className="h-8 flex-1 text-xs font-mono text-muted-foreground" value="••••••••（已保存）" readOnly />
                  <Button variant="outline" size="sm" className="h-7 text-[11px] rounded-full shrink-0" onClick={()=>setOverrideApiKey(true)}>修改</Button>
                </>
              ) : (isTokenMasked && overrideApiKey) || (!isTokenMasked && !hasRealToken) ? (
                <>
                  <Input className="h-8 flex-1 text-xs font-mono" type={showApiKey?"text":"password"} placeholder="输入新 API Key（保存时写入）" value={newApiKey} onChange={e=>{
                    setNewApiKey(e.target.value);
                    const w = window as any;
                    w.__pendingApiKeys = w.__pendingApiKeys || {};
                    w.__pendingApiKeys[selected.id] = {token:e.target.value, provider:selected.id, profileId:authProfile?.id};
                    dispatch({ type: "MARK_DIRTY" });
                  }} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={()=>setShowApiKey(!showApiKey)}>{showApiKey?<EyeOff className="h-3 w-3"/>:<Eye className="h-3 w-3"/>}</Button>
                  {overrideApiKey && <Button variant="ghost" size="sm" className="h-7 text-[11px] shrink-0" onClick={()=>{setOverrideApiKey(false);setNewApiKey("");}}>取消</Button>}
                </>
              ) : hasRealToken ? (<>
                <Input className="h-8 flex-1 text-xs font-mono" type={showApiKey?"text":"password"} value={authProfile?.apiKey||""} readOnly />
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={()=>setShowApiKey(!showApiKey)}>{showApiKey?<EyeOff className="h-3 w-3"/>:<Eye className="h-3 w-3"/>}</Button>
              </>) : (
                <Input className="h-8 flex-1 text-xs font-mono" type="password" placeholder="输入新 API Key（保存时写入）" value={newApiKey} onChange={e=>{
                  setNewApiKey(e.target.value);
                  const w = window as any;
                  w.__pendingApiKeys = w.__pendingApiKeys || {};
                  w.__pendingApiKeys[selected.id] = {token:e.target.value, provider:selected.id, profileId:authProfile?.id};
                  dispatch({ type: "MARK_DIRTY" });
                }} />
              )}
            </div>
            {!hasAuthProfile && <div className="mt-1 text-[11px] text-amber-400">此 Provider 尚未关联凭据，请先通过模板创建或手动添加</div>}
          </div>
          {/* 模型列表 */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">模型 ({selected.models.length})</label>
            <div className="mt-1 space-y-px rounded-lg border border-white/[0.06]">
              {!selected.models.length && <div className="px-3 py-2 text-[11px] text-muted-foreground">暂无模型</div>}
              {selected.models.map((m, i) => (
                <ModelRow key={i} model={m} index={i} selected={selected} dispatch={dispatch} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input className="h-7 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30" placeholder="model-id" value={newModelId} onChange={e=>setNewModelId(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddModel()} />
              <Button size="sm" className="h-7 text-[11px] rounded-full shrink-0" onClick={handleAddModel}>添加</Button>
              <Button variant="outline" size="sm" className="h-7 text-[11px] rounded-full shrink-0" onClick={handleFetchModels} disabled={fetchingModels}>{fetchingModels?"获取中…":"获取模型列表"}</Button>
            </div>
            {fetchError&&<div className="mt-1 text-[11px] text-red-400">{fetchError}</div>}
            {remoteModels&&remoteModels.length>0&&<div className="mt-2 rounded-lg border border-white/[0.10] bg-white/[0.04] p-2 max-h-[200px] overflow-y-auto"><div className="mb-1 flex items-center gap-2"><span className="text-[11px] text-muted-foreground">远端模型（{remoteModels.length}个）</span><div className="flex-1"/><button className="text-[11px] rounded-full bg-primary px-2 py-0.5 text-primary-foreground" onClick={()=>handleImportModels(remoteModels.map((m:any)=>m.id))}>全部导入</button><button className="text-[11px] text-muted-foreground hover:text-foreground ml-1" onClick={()=>setRemoteModels(null)}>关闭</button></div>{remoteModels.map((m:any)=>(<div key={m.id} className="flex items-center justify-between border-b border-white/[0.04] py-0.5 text-xs"><span>{m.name||m.id}{m.ownedBy&&<span className="text-muted-foreground ml-1">({m.ownedBy})</span>}</span><button className="text-[11px] text-primary hover:underline" onClick={()=>handleImportModels([m.id])}>导入</button></div>))}</div>}
          </div>
          {/* 测试连接 */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleTestConnection} disabled={testing || !selected.models.length}>
              {testing ? "测试中…" : "测试连接"}
            </Button>
            {testResult && (
              <span className={`text-[11px] ${testResult.success ? "text-emerald-400" : "text-red-400"}`}>
                {testResult.success ? `✓ 连接成功${testResult.latencyMs ? ` (${testResult.latencyMs}ms)` : ""}` : `✗ ${testResult.error || "连接失败"}`}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full text-destructive" onClick={()=>dispatch({type:"DELETE_PROVIDER",id:selected.id})}><Trash2 className="mr-1 h-3 w-3"/>删除</Button>
        </div>}
      </div>
    </div>
  );
}

function DefaultAgentTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const [resetMsg, setResetMsg] = React.useState<string|null>(null);
  const handleReset = async () => { try { const ipc = await getIpc(); const r = await ipc.resetOpenClawAgentPreset(true); setResetMsg(r.success?"已重置":r.error||"失败"); const dump = await ipc.dumpOpenClawConfig(); dispatch({type:"LOAD_SUCCESS",dump}); } catch(e:any) { setResetMsg(e.message); } };

  // 模型下拉选项，从 providers 中的 models 生成
  const modelOptions = React.useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const p of state.providers) {
      for (const m of p.models) {
        if (m.id) { const value = `${p.id}/${m.id}`; out.push({ value, label: value }); }
      }
    }
    return out;
  }, [state.providers]);

  // 与 openClaw 完全一致的枚举值
  const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max"];
  const REASONING_OPTIONS = ["off", "on", "stream"];
  const VERBOSE_OPTIONS = ["off", "on", "full"];
  const TOOL_DETAIL_OPTIONS = ["explain", "raw"];

  // agent 预设列表
  const agentPresets = (state as any).agentPresets as any[] || [];

  return (
    <div className="max-w-2xl space-y-4">
      {/* Agent 预设列表 — 可编辑 */}
      {agentPresets.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">已注册 Agent（{agentPresets.length}）</span>
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={handleReset}>重置为默认</Button>
            {resetMsg&&<span className="text-[11px] text-muted-foreground">{resetMsg}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground/70 leading-relaxed">
            数据来源: openclaw.json → agents.list。Skills 是 OpenClaw 的 Skill 系统（非 MCP tool），"run_python" 是 Artifex Nexus 通过 MCP Bridge 暴露的 DCC 执行能力。
          </div>
          {agentPresets.map((preset: any) => (
            <div key={preset.id} className={`${GLASS} p-4 space-y-3`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{preset.name || preset.id}</span>
                {preset.isDefault && <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-400">默认</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">名称</label>
                  <Input className="mt-1 h-8 text-xs" value={preset.name||""} onChange={e=>dispatch({type:"UPDATE_AGENT_PRESET",agentId:preset.id,patch:{name:e.target.value}})} />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">ID（只读）</label>
                  <Input className="mt-1 h-8 text-xs text-muted-foreground" value={preset.id} disabled />
                </div>
              </div>
              {/* 模型选择（从 agents.list 暂不支持 per-agent model，但预留位置） */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">Thinking</label>
                  <select className={SEL} value={preset.thinkingDefault||""} onChange={e=>dispatch({type:"UPDATE_AGENT_PRESET",agentId:preset.id,patch:{thinkingDefault:e.target.value}})}>
                    <option value="">未设置（继承 defaults）</option>
                    {THINKING_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Reasoning</label>
                  <select className={SEL} value={preset.reasoningDefault||""} onChange={e=>dispatch({type:"UPDATE_AGENT_PRESET",agentId:preset.id,patch:{reasoningDefault:e.target.value}})}>
                    <option value="">未设置（继承 defaults）</option>
                    {REASONING_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Verbose</label>
                  <select className={SEL} value={preset.verboseDefault||""} onChange={e=>dispatch({type:"UPDATE_AGENT_PRESET",agentId:preset.id,patch:{verboseDefault:e.target.value}})}>
                    <option value="">未设置（继承 defaults）</option>
                    {VERBOSE_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Tool Progress Detail</label>
                  <select className={SEL} value={preset.toolProgressDetail||""} onChange={e=>dispatch({type:"UPDATE_AGENT_PRESET",agentId:preset.id,patch:{toolProgressDetail:e.target.value}})}>
                    <option value="">未设置</option>
                    {TOOL_DETAIL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                {preset.skills?.length > 0 && <span>Skills: <code className="text-foreground/80">{preset.skills.join(", ")}</code></span>}
                {preset.workspace && <span>Workspace: <code className="text-foreground/60 text-[11px]">{preset.workspace}</code></span>}
              </div>
              {/* 人格信息（systemPromptOverride）— 可编辑 */}
              <div>
                <label className="text-[11px] text-muted-foreground">系统提示词（人格信息） · {(preset.systemPromptOverride||"").length} 字符</label>
                <textarea
                  className="mt-1 h-40 w-full resize-y rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-foreground backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono"
                  value={preset.systemPromptOverride||""}
                  placeholder="输入 agent 的系统提示词..."
                  onChange={e=>dispatch({type:"UPDATE_AGENT_PRESET",agentId:preset.id,patch:{systemPromptOverride:e.target.value}})}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`${GLASS} p-6 text-center`}>
          <p className="text-xs text-muted-foreground mb-3">暂无已注册的 Agent 预设</p>
          <Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleReset}>安装默认预设</Button>
          {resetMsg&&<p className="mt-2 text-[11px] text-muted-foreground">{resetMsg}</p>}
        </div>
      )}
    </div>
  );
}

// ── 常规设置 Tab ─────────────────────────────────────────────────────────

function GeneralTab() {
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [resetMsg, setResetMsg] = React.useState<string | null>(null);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [defaults, setDefaults] = React.useState<AppSettings | null>(null);
  const [dirty, setDirty] = React.useState(false);

  const loadSettings = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await getAppSettings();
      setSettings(r.settings);
      setDefaults(r.defaults);
      setDirty(false);
    } catch (e: any) {
      console.error("[GeneralTab] load failed:", e);
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadSettings(); }, [loadSettings]);

  const patch = (p: Partial<AppSettings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...p });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await setAppSettings(settings);
      setSettings(r.settings);
      setDefaults(r.defaults);
      setDirty(false);
      setSaveMsg("已保存");
    } catch (e: any) {
      setSaveMsg(e.message || String(e));
    }
    setSaving(false);
  };

  const handleReset = async () => {
    setResetMsg(null);
    try {
      const r = await resetAppSettings();
      setSettings(r.settings);
      setDefaults(r.defaults);
      setDirty(false);
      setResetMsg("已恢复默认");
    } catch (e: any) {
      setResetMsg(e.message || String(e));
    }
  };

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载常规设置...</div>;
  if (!settings) return (
    <div className="p-6 space-y-3">
      <div className="text-sm text-red-400">加载设置失败</div>
      {loadError && (
        <p className="text-xs text-muted-foreground break-all font-mono">{loadError}</p>
      )}
      <Button variant="outline" size="sm" className="text-xs" onClick={loadSettings}>
        <Loader2 className="mr-1 h-3 w-3" /> 重试
      </Button>
    </div>
  );

  return (
    <div className="max-w-xl space-y-4">
      {/* 工具超时 */}
      <div className={`${GLASS} p-4 space-y-2`}>
        <label className="text-sm font-medium text-foreground">默认工具超时（秒）</label>
        <p className="text-xs text-muted-foreground/70">通用 nexus-tool 执行超时上限（manifest 可单工具覆盖），范围 1~86400</p>
        <div className="flex items-center gap-2 mt-1">
          <input
            className="h-8 w-32 rounded border border-white/[0.08] bg-white/[0.03] px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
            type="number" min={1} max={86400}
            value={settings.nexusToolDefaultTimeoutSec}
            onChange={e => { const v = parseInt(e.target.value) || 120; patch({ nexusToolDefaultTimeoutSec: Math.max(1, Math.min(86400, v)) }); }}
          />
          {defaults && <span className="text-[11px] text-muted-foreground/50">默认: {defaults.nexusToolDefaultTimeoutSec}s</span>}
        </div>
      </div>

      {/* 最大并发 */}
      <div className={`${GLASS} p-4 space-y-2`}>
        <label className="text-sm font-medium text-foreground">最大并发工具数</label>
        <p className="text-xs text-muted-foreground/70">同时允许运行的 nexus-tool 数，超出会拒绝，范围 1~64</p>
        <div className="flex items-center gap-2 mt-1">
          <input
            className="h-8 w-32 rounded border border-white/[0.08] bg-white/[0.03] px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
            type="number" min={1} max={64}
            value={settings.nexusToolMaxConcurrent}
            onChange={e => { const v = parseInt(e.target.value) || 3; patch({ nexusToolMaxConcurrent: Math.max(1, Math.min(64, v)) }); }}
          />
          {defaults && <span className="text-[11px] text-muted-foreground/50">默认: {defaults.nexusToolMaxConcurrent}</span>}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={!dirty || saving}>
          <Save className="h-3 w-3" />{saving ? "保存中…" : "保存"}
        </Button>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleReset}>
          <RotateCcw className="h-3 w-3" />恢复默认
        </Button>
        {saveMsg && <span className={`text-[11px] ${saveMsg === "已保存" ? "text-emerald-400" : "text-red-400"}`}>{saveMsg}</span>}
        {resetMsg && <span className={`text-[11px] ${resetMsg === "已恢复默认" ? "text-emerald-400" : "text-red-400"}`}>{resetMsg}</span>}
      </div>

      {/* 文件路径（排错用） */}
      <div className="text-[11px] text-muted-foreground/40 mt-2">
        配置路径: <code className="font-mono">~/.artifexnexus/.openclaw/state/artifex/app-settings.json</code>
      </div>
    </div>
  );
}
