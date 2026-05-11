"use client";

/**
 * SettingsPage — 设置模块（模型+认证 / Agent）
 *
 * 完全复刻 apps/desktop SettingsPanel，使用 settingsReducer 状态机
 */

import * as React from "react";
import { Cpu, Bot, Plus, Trash2, Eye, EyeOff, Loader2, CheckCircle, XCircle, Save, AlertTriangle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";
import { getIpc } from "../../lib/ipc";
import {
  settingsReducer, createInitialState, buildPatchFromState, validateState,
  type SettingsState, type SettingsAction,
} from "../../features/settings/settings.reducer";
import { PROVIDER_TEMPLATES, type ProviderTemplate } from "../../features/settings/settings.types";

export function SettingsPage() {
  const [state, dispatch] = React.useReducer(settingsReducer, undefined, createInitialState);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  // 加载配置
  React.useEffect(() => {
    dispatch({ type: "LOAD_START" });
    void (async () => {
      try {
        const ipc = await getIpc();
        const dump = await ipc.dumpOpenClawConfig();
        dispatch({ type: "LOAD_SUCCESS", dump });
      } catch (e: any) {
        dispatch({ type: "LOAD_ERROR", message: e.message || String(e) });
      }
    })();
  }, []);

  // 保存
  const handleSave = async () => {
    const issues = validateState(state);
    if (issues.length > 0) {
      setSaveMsg(`校验未通过: ${issues.slice(0, 3).map((i: any) => `${i.field} ${i.message}`).join("; ")}`);
      return;
    }
    setSaving(true);
    try {
      const { patch, extrasPatch } = buildPatchFromState(state);
      const ipc = await getIpc();
      const result = await ipc.patchOpenClawConfig(patch, extrasPatch);
      if (!result.success) { setSaveMsg(result.validateError || "保存失败"); return; }
      // 写入 API Key（通过 setOpenClawAuthToken）
      const pendingKey = (window as any).__pendingApiKey;
      if (pendingKey?.token) {
        await ipc.setOpenClawAuthToken({
          profileId: `${pendingKey.provider}-default`,
          token: pendingKey.token,
          provider: pendingKey.provider,
        });
        delete (window as any).__pendingApiKey;
      }
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
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleSave} disabled={!state.dirty || saving}>
          <Save className="h-3 w-3" />{saving ? "保存中..." : "保存"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "providers" && <ProvidersTab state={state} dispatch={dispatch} />}
        {tab === "defaultAgent" && <DefaultAgentTab state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}

// ─── Provider Tab ───────────────────────────────────────────────────────────

function ProvidersTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const [showAdd, setShowAdd] = React.useState(false);
  const [fetchingModels, setFetchingModels] = React.useState(false);
  const [remoteModelList, setRemoteModelList] = React.useState<string[] | null>(null);

  const selected = state.providers.find((p) => p.id === state.selectedProviderId);

  const handleFetchModels = async () => {
    if (!selected) return;
    setFetchingModels(true);
    try {
      const ipc = await getIpc();
      const models = await ipc.fetchRemoteModels({ providerId: selected.id });
      if (models?.models && Array.isArray(models.models)) {
        const ids = models.models.map((m: any) => typeof m === "string" ? m : m.id).filter(Boolean);
        setRemoteModelList(ids);
      }
    } catch {} finally { setFetchingModels(false); }
  };

  const handleAddModel = (modelId: string) => {
    if (!selected) return;
    dispatch({ type: "ADD_MODEL", providerId: selected.id, modelId });
    setRemoteModelList(null);
  };

  return (
    <div className="flex gap-4" style={{ minHeight: 300 }}>
      {/* 左侧 Provider 列表 */}
      <div className="w-48 shrink-0 space-y-1">
        <div className="mb-2 flex items-center gap-1">
          <span className="text-xs font-medium text-muted-foreground">Provider</span>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowAdd(!showAdd)}><Plus className="h-3 w-3" /></Button>
        </div>
        {showAdd && (
          <div className="mb-2 rounded border border-white/[0.08] bg-white/[0.03] p-1.5">
            <div className="mb-1 text-[10px] text-muted-foreground">选择模板</div>
            <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
              {PROVIDER_TEMPLATES.map((tpl: ProviderTemplate) => (
                <button key={tpl.key} className="block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-white/[0.06]"
                  onClick={() => { dispatch({ type: "ADD_PROVIDER_FROM_TEMPLATE", templateKey: tpl.key, alsoAuth: true }); setShowAdd(false); }}>
                  {tpl.label} {tpl.note && <span className="text-muted-foreground">· {tpl.note}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.providers.map((p) => (
          <button key={p.id}
            className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${state.selectedProviderId === p.id ? "bg-white/[0.08] font-medium" : "hover:bg-white/[0.04] text-muted-foreground"}`}
            onClick={() => dispatch({ type: "SELECT_PROVIDER", id: p.id })}>
            {p.displayName || p.id}
          </button>
        ))}
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 space-y-3">
        {!selected ? (
          <p className="text-xs text-muted-foreground">选择一个 Provider 查看详情</p>
        ) : (
          <>
            <div>
              <label className="text-[10px] text-muted-foreground">名称</label>
              <Input className="mt-0.5 h-8 text-xs" value={selected.displayName} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { displayName: e.target.value } })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground">协议</label>
                <select className="mt-0.5 h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-foreground backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
                  value={selected.protocol} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { protocol: e.target.value as any } })}>
                  {["openai", "openai-compatible", "anthropic", "google", "azure-openai"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Base URL</label>
                <Input className="mt-0.5 h-8 text-xs" value={selected.baseUrl} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { baseUrl: e.target.value } })} />
              </div>
            </div>
            {/* API Key — 通过 auth profile 管理 */}
            <div>
              <label className="text-[10px] text-muted-foreground">API Key（通过认证 Profile 管理）</label>
              <div className="mt-0.5 flex items-center gap-2">
                <Input className="h-8 flex-1 text-xs font-mono"
                  type="password"
                  placeholder="输入新 API Key"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.length >= 8) {
                      // 存储到临时变量，保存时通过 setOpenClawAuthToken 写入
                      (window as any).__pendingApiKey = { provider: selected.id, token: val };
                    }
                  }} />
                <span className="text-[10px] text-muted-foreground">保存时写入</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">关联认证 Profile</label>
              <Input className="mt-0.5 h-8 text-xs" value={selected.authProfileId || ""} onChange={(e) => dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { authProfileId: e.target.value || undefined } })} placeholder="可选" />
            </div>
            {/* 模型列表 — 列表形式 */}
            <div>
              <div className="mb-1 flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground">模型列表 ({selected.models.length})</label>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleFetchModels} disabled={fetchingModels}>
                  {fetchingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </Button>
                <span className="text-[9px] text-muted-foreground">添加</span>
              </div>
              {/* 远程模型选择器 */}
              {remoteModelList && (
                <div className="mb-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 max-h-[200px] overflow-y-auto">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">可用模型</span>
                    <span className="flex-1" />
                    <button className="text-[9px] text-muted-foreground hover:text-foreground" onClick={() => setRemoteModelList(null)}>关闭</button>
                  </div>
                  <div className="space-y-0.5">
                    {remoteModelList.map((id) => {
                      const exists = selected.models.some((m) => m.id === id);
                      return (
                        <button key={id} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] transition-colors ${exists ? "text-muted-foreground/40" : "hover:bg-white/[0.06]"}`}
                          disabled={exists} onClick={() => handleAddModel(id)}>
                          <span className="flex-1 font-mono">{id}</span>
                          {exists ? <span className="text-[9px] text-muted-foreground">已添加</span> : <span className="text-[9px] text-primary">+ 添加</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* 模型列表 */}
              <div className="space-y-px rounded-lg border border-white/[0.06]">
                {selected.models.length === 0 && <div className="px-3 py-2 text-[10px] text-muted-foreground">暂无模型，点击 + 获取</div>}
                {selected.models.map((m, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${m.isDefault ? "bg-primary/[0.08]" : "hover:bg-white/[0.02]"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${m.isDefault ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    <span className="flex-1 font-mono">{m.id}</span>
                    <button
                      className={`text-[10px] transition-colors ${m.isDefault ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                      onClick={() => {
                        const newModels = selected.models.map((model, idx) => ({ ...model, isDefault: idx === i }));
                        dispatch({ type: "UPDATE_PROVIDER", id: selected.id, patch: { models: newModels } as any });
                      }}>
                      {m.isDefault ? "默认" : "设为默认"}
                    </button>
                    <button className="text-muted-foreground hover:text-destructive text-[10px]" onClick={() => dispatch({ type: "DELETE_MODEL", providerId: selected.id, index: i })}>删除</button>
                  </div>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full text-destructive" onClick={() => { dispatch({ type: "DELETE_PROVIDER", id: selected.id }); }}>
              <Trash2 className="mr-1 h-3 w-3" />删除此 Provider
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Agent Tab ─────────────────────────────────────────────────────────────

function DefaultAgentTab({ state, dispatch }: { state: SettingsState; dispatch: React.Dispatch<SettingsAction> }) {
  const agent = state.defaultAgent || { defaultModel: "", imageModel: "", thinkingDefault: "adaptive" };
  const [resetMsg, setResetMsg] = React.useState<string | null>(null);

  const handleReset = async () => {
    try {
      const ipc = await getIpc();
      const r = await ipc.resetOpenClawAgentPreset(true);
      if (!r.success) setResetMsg(r.error || "重置失败");
      else setResetMsg("已重置");
      const dump = await ipc.dumpOpenClawConfig();
      dispatch({ type: "LOAD_SUCCESS", dump });
    } catch (e: any) { setResetMsg(e.message); }
  };

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <label className="text-[10px] text-muted-foreground">默认模型（provider/model）</label>
        <Input className="mt-0.5 h-8 text-xs" value={agent.defaultModel}
          placeholder="如: openai/gpt-4o"
          onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { defaultModel: e.target.value } })} />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">图像模型</label>
        <Input className="mt-0.5 h-8 text-xs" value={agent.imageModel}
          placeholder="如: openai/dall-e-3"
          onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { imageModel: e.target.value } })} />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Thinking 模式</label>
        <select className="mt-0.5 h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-foreground backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
          value={agent.thinkingDefault || "adaptive"}
          onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { thinkingDefault: e.target.value } })}>
          <option value="adaptive">自适应</option>
          <option value="on">开启</option>
          <option value="off">关闭</option>
          <option value="auto">自动</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Reasoning 模式</label>
        <select className="mt-0.5 h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-xs text-foreground backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
          value={agent.reasoningDefault || "on"}
          onChange={(e) => dispatch({ type: "UPDATE_DEFAULT_AGENT", patch: { reasoningDefault: e.target.value } })}>
          <option value="on">开启</option>
          <option value="off">关闭</option>
        </select>
      </div>
      <Button variant="outline" size="sm" className="h-7 text-xs rounded-full" onClick={handleReset}>重置为默认</Button>
      {resetMsg && <span className="ml-2 text-[10px] text-muted-foreground">{resetMsg}</span>}
    </div>
  );
}
