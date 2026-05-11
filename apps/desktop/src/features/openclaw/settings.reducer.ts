// OpenClaw 设置面板 reducer：state 机 + dump↔form 转换 + patch 构建。
// EPIC-0001 第二批 STORY-0015。
// 全部纯函数 / 不接 IPC，便于单测。

import type {
  AuthMode,
  AuthProfileForm,
  AgentPresetForm,
  DefaultAgentForm,
  ModelEntry,
  Protocol,
  ProviderForm,
  ProviderTemplate,
} from "./settings.types";
import { PROVIDER_TEMPLATES } from "./settings.types";
import type { OpenClawConfigDump } from "../../ipc/openclaw";

// ---------------------------------------------------------------------------
// State / Action 类型
// ---------------------------------------------------------------------------

export type Tab = "providers" | "auth" | "defaultAgent";

/** 加载状态 */
export type LoadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export interface SettingsState {
  load: LoadStatus;
  tab: Tab;

  /** Provider 表单集合（按 id 索引；顺序保持插入顺序） */
  providers: ProviderForm[];
  /** Auth profile 表单集合 */
  authProfiles: AuthProfileForm[];
  /** Default agent 单一表单 */
  defaultAgent: DefaultAgentForm;
  /** Agent 预设列表（来自 agents.list，如 artifex-nexus） */
  agentPresets: AgentPresetForm[];

  /** 当前选中的 provider id（providers tab 用） */
  selectedProviderId: string | null;
  /** 当前选中的 auth profile id（auth tab 用） */
  selectedAuthId: string | null;

  /** 是否有未保存修改 */
  dirty: boolean;

  /** 保存中 / 测试中 标志位 */
  saving: boolean;
  testing: boolean;
  /** 最近一次测试结果（前端 toast 展示用） */
  lastTest: {
    providerId: string;
    success: boolean;
    latencyMs: number | null;
    error: string | null;
  } | null;
  /** 最近一次保存错误 */
  lastSaveError: string | null;
}

export type SettingsAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; dump: OpenClawConfigDump }
  | { type: "LOAD_ERROR"; message: string }
  | { type: "SET_TAB"; tab: Tab }
  | { type: "SELECT_PROVIDER"; id: string | null }
  | { type: "SELECT_AUTH"; id: string | null }
  | { type: "ADD_PROVIDER_FROM_TEMPLATE"; templateKey: string; alsoAuth: boolean }
  | { type: "ADD_PROVIDER_BLANK" }
  | { type: "UPDATE_PROVIDER"; id: string; patch: Partial<ProviderForm> }
  | { type: "DELETE_PROVIDER"; id: string }
  | { type: "ADD_MODEL"; providerId: string; modelId: string }
  | { type: "UPDATE_MODEL"; providerId: string; index: number; patch: Partial<ModelEntry> }
  | { type: "DELETE_MODEL"; providerId: string; index: number }
  | { type: "ADD_AUTH_PROFILE"; provider: string; mode?: AuthMode }
  | { type: "UPDATE_AUTH_PROFILE"; id: string; patch: Partial<AuthProfileForm> }
  | { type: "DELETE_AUTH_PROFILE"; id: string }
  | { type: "UPDATE_DEFAULT_AGENT"; patch: Partial<DefaultAgentForm> }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; message: string }
  | { type: "TEST_START"; providerId: string }
  | {
      type: "TEST_DONE";
      providerId: string;
      success: boolean;
      latencyMs: number | null;
      error: string | null;
    }
  | { type: "RESET_DIRTY" }
  | { type: "IMPORT_REMOTE_MODELS"; providerId: string; modelIds: string[] };

// ---------------------------------------------------------------------------
// 初始 state
// ---------------------------------------------------------------------------

export const INITIAL_DEFAULT_AGENT: DefaultAgentForm = {
  defaultModel: "",
  imageModel: "",
  imageGenerationModel: "",
  thinkingDefault: "adaptive",
  reasoningDefault: "on",
};

export function createInitialState(): SettingsState {
  return {
    load: { kind: "idle" },
    tab: "providers",
    providers: [],
    authProfiles: [],
    defaultAgent: { ...INITIAL_DEFAULT_AGENT },
    agentPresets: [],
    selectedProviderId: null,
    selectedAuthId: null,
    dirty: false,
    saving: false,
    testing: false,
    lastTest: null,
    lastSaveError: null,
  };
}

// ---------------------------------------------------------------------------
// dump → state 转换（容错：上游字段缺失就给默认值）
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asProtocol(v: unknown): Protocol {
  const allowed: Protocol[] = [
    "openai",
    "openai-compatible",
    "anthropic",
    "google",
    "azure-openai",
  ];
  return allowed.includes(v as Protocol) ? (v as Protocol) : "openai-compatible";
}

function asAuthMode(v: unknown): AuthMode {
  // 上游 schema 合法值（v2026.5.4）：api_key / oauth / token
  const allowed: AuthMode[] = ["api_key", "oauth", "token"];
  // 老值迁移：api-key → api_key, paste → api_key
  if (v === "api-key" || v === "paste") return "api_key";
  return allowed.includes(v as AuthMode) ? (v as AuthMode) : "api_key";
}

export function dumpToState(dump: OpenClawConfigDump): {
  providers: ProviderForm[];
  authProfiles: AuthProfileForm[];
  defaultAgent: DefaultAgentForm;
  agentPresets: AgentPresetForm[];
} {
  const providerExtras = asObject(asObject(dump.extras).providerExtras);
  const authExtras = asObject(asObject(dump.extras).authExtras);
  // STORY-0018 hot-fix：model 级 isDefault/timeoutMs 上游不收，存 extras.modelExtras
  const modelExtrasRoot = asObject(asObject(dump.extras).modelExtras);
  const authOrder = dump.authOrder ?? {};

  const providers: ProviderForm[] = Object.entries(asObject(dump.providers)).map(
    ([id, raw]) => {
      const obj = asObject(raw);
      const extra = asObject(providerExtras[id]);
      const modelExtrasForProvider = asObject(modelExtrasRoot[id]);
      const modelsRaw = asArray(obj.models);
      const models: ModelEntry[] = modelsRaw.map((m) => {
        const mObj = asObject(m);
        const mExtra = asObject(modelExtrasForProvider[asString(mObj.id)]);
        // 上游 reasoning + input → 前端 capabilities
        const inputArr = asArray(mObj.input).map((x) => asString(x));
        // 上游 params.temperature → 前端 temperature
        const paramsObj = asObject(mObj.params);
        return {
          id: asString(mObj.id),
          // isDefault 从 extras 读（上游不存这个字段）
          isDefault: mExtra.isDefault === true,
          maxTokens:
            typeof mObj.maxTokens === "number" ? mObj.maxTokens : undefined,
          temperature:
            typeof paramsObj.temperature === "number"
              ? paramsObj.temperature
              : undefined,
          timeoutMs:
            typeof mExtra.timeoutMs === "number" ? mExtra.timeoutMs : undefined,
          capabilities: {
            vision: inputArr.includes("image"),
            reasoning: mObj.reasoning === true,
          },
        };
      });
      const headersObj = asObject(obj.headers);
      const profileList = authOrder[id];
      return {
        id,
        displayName: asString(extra.displayName, id),
        // protocol 从 extras 读（v2026.5.4 上游 provider 节点不存 protocol，
        // 也不再依赖它来路由 —— 改用 model[*].api，但前端 UX 仍按 provider 维度展示）
        protocol: asProtocol(extra.protocol ?? obj.protocol),
        baseUrl: asString(obj.baseUrl),
        models,
        authProfileId:
          Array.isArray(profileList) && profileList.length > 0
            ? profileList[0]
            : undefined,
        customHeadersJson:
          Object.keys(headersObj).length > 0
            ? JSON.stringify(headersObj, null, 2)
            : "",
      };
    },
  );

  const authProfiles: AuthProfileForm[] = Object.entries(
    asObject(dump.authProfiles),
  ).map(([id, raw]) => {
    const obj = asObject(raw);
    const extra = asObject(authExtras[id]);
    return {
      id,
      provider: asString(obj.provider),
      mode: asAuthMode(obj.mode),
      apiKey: asString(obj.token ?? obj.apiKey),
      email: typeof obj.email === "string" ? obj.email : undefined,
      notes: typeof extra.notes === "string" ? extra.notes : undefined,
    };
  });

  const ad = asObject(dump.agentDefaults);
  const defaultAgent: DefaultAgentForm = {
    defaultModel: asString(ad.model),
    imageModel: asString(ad.imageModel),
    imageGenerationModel: asString(ad.imageGenerationModel),
    thinkingDefault: asString(ad.thinkingDefault, "adaptive"),
    reasoningDefault: asString(ad.reasoningDefault, "on"),
  };

  // Bug #5：解析 agents.list 中的预设 agent
  const agentPresets: AgentPresetForm[] = asArray(dump.agentList ?? []).map((raw) => {
    const obj = asObject(raw);
    return {
      id: asString(obj.id),
      name: asString(obj.name),
      isDefault: obj.default === true,
      reasoningDefault: asString(obj.reasoningDefault),
      thinkingDefault: asString(obj.thinkingDefault),
      verboseDefault: asString(obj.verboseDefault),
      toolProgressDetail: asString(obj.toolProgressDetail),
      workspace: asString(obj.workspace),
      skills: asArray(obj.skills).map((s) => asString(s)),
    };
  });

  return { providers, authProfiles, defaultAgent, agentPresets };
}

// ---------------------------------------------------------------------------
// state → patch 构建（纯函数）
// ---------------------------------------------------------------------------

interface BuiltPatch {
  patch: Record<string, unknown>;
  extrasPatch: Record<string, unknown>;
}

/** 解析 customHeadersJson 字符串到 object；失败返回 null（让上层标错） */
export function parseCustomHeaders(json: string): Record<string, unknown> | null {
  const trimmed = json.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** 把 form 全量打包成 patch + extrasPatch（保存按钮调用） */
export function buildPatchFromState(state: SettingsState): BuiltPatch {
  // providers → models.providers.<id>.*
  //
  // STORY-0018 hot-fix（schema 真值表，2026/5/8 经 d:\probe2.py 实测）：
  //   provider 接受字段：baseUrl / apiKey / auth / headers / params / models
  //     - `auth` 是枚举字面值（"api-key" / "aws-sdk" / "oauth" / "token"），
  //       **不是** auth profile id；profile 绑定走 auth.order.<providerId> = [profileId]
  //     - `protocol` / `timeoutMs` 上游不认（前端虚构字段），转入 extras
  //   model[*] 接受字段：id / name / api / reasoning / input / maxTokens /
  //     contextWindow / params / headers / cost
  //     - `name` 必填且非空 → 缺省时 fallback 用 id
  //     - 顶层 `temperature` 不接受，要包到 params.temperature
  //     - `isDefault` / `timeoutMs` / `capabilities` 不接受 → 拆映射 + 转 extras
  //         capabilities.reasoning → reasoning: true
  //         capabilities.vision    → input: ["text", "image"]
  //   any unknown key → schema validate 直接拒整条 patch。
  const providersOut: Record<string, unknown> = {};
  const providerExtras: Record<string, unknown> = {};
  // model 级 extras：{ providerId: { modelId: { isDefault?, timeoutMs? } } }
  // 用于回填上游不认但前端有意义的字段
  const modelExtras: Record<string, Record<string, Record<string, unknown>>> = {};
  const authOrderOut: Record<string, string[]> = {};

  // 前端 Protocol 枚举 → 上游 model[*].api 枚举映射
  // 上游 api 合法值（实测自 d:\probe2.py）：
  //   openai-completions / openai-responses / openai-codex-responses /
  //   anthropic-messages / google-generative-ai / github-copilot /
  //   bedrock-converse-stream / ollama / azure-openai-responses
  // 前端 Protocol：openai / openai-compatible / anthropic / google / azure-openai
  // openai-compatible 走 openai-completions（最通用的 OpenAI Chat Completions 协议）
  const protocolToApi: Record<string, string> = {
    "openai": "openai-completions",
    "openai-compatible": "openai-completions",
    "anthropic": "anthropic-messages",
    "google": "google-generative-ai",
    "azure-openai": "azure-openai-responses",
  };

  for (const p of state.providers) {
    const headers = parseCustomHeaders(p.customHeadersJson) ?? {};
    const inferredApi: string | undefined = protocolToApi[p.protocol];

    const modelsExtraForProvider: Record<string, Record<string, unknown>> = {};

    const modelsOut = p.models.map((m) => {
      // 保留 isDefault / timeoutMs 到 extras（schema 不认）
      const mExtra: Record<string, unknown> = {};
      if (m.isDefault) mExtra.isDefault = true;
      if (m.timeoutMs !== undefined) mExtra.timeoutMs = m.timeoutMs;
      if (Object.keys(mExtra).length > 0) {
        modelsExtraForProvider[m.id] = mExtra;
      }

      // capabilities → schema 字段
      // vision  -> input 包含 "image"
      // reasoning -> reasoning: true
      const inputModalities: string[] = ["text"];
      if (m.capabilities?.vision) inputModalities.push("image");

      // params：把前端 temperature 包进去；预留扩展位
      const paramsObj: Record<string, unknown> = {};
      if (m.temperature !== undefined) paramsObj.temperature = m.temperature;

      return {
        id: m.id,
        // schema 必填且非空：缺省时用 id 兜底（避免保存崩）
        name: (m as { name?: string }).name?.trim() || m.id,
        ...(inferredApi ? { api: inferredApi } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        ...(m.capabilities?.reasoning ? { reasoning: true } : {}),
        ...(inputModalities.length > 1 ? { input: inputModalities } : {}),
        ...(Object.keys(paramsObj).length > 0 ? { params: paramsObj } : {}),
      };
    });

    // provider 顶层只放 schema 接受的键
    providersOut[p.id] = {
      baseUrl: p.baseUrl,
      models: modelsOut,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };

    // protocol 等前端字段进 extras（不发上游，保留 UX 状态）
    providerExtras[p.id] = {
      displayName: p.displayName,
      ...(p.protocol ? { protocol: p.protocol } : {}),
    };
    if (Object.keys(modelsExtraForProvider).length > 0) {
      modelExtras[p.id] = modelsExtraForProvider;
    }

    if (p.authProfileId) {
      // auth.order.<providerId> = [profileId, ...]
      authOrderOut[p.id] = [p.authProfileId];
    }
  }

  // authProfiles → auth.profiles.<id>.*
  //
  // STORY-0018 hot-fix：上游 v2026.5.4 schema 把 auth.profiles.<id> 收敛为纯元数据
  //   { provider, mode, email?, displayName? }（additionalProperties: false）
  // 凭证（apiKey/token）不能再塞到这里，否则 schema validate 报
  //   "Unrecognized key: token"。
  // → patch 只携带元数据；apiKey 由调用方在 patch 成功后用
  //   `setOpenClawAuthToken` 单独写入（走 `openclaw models auth paste-token`，
  //   写到 state/agents/<agentId>/agent/auth-profiles.json）。
  const authProfilesOut: Record<string, unknown> = {};
  const authExtras: Record<string, unknown> = {};
  for (const a of state.authProfiles) {
    authProfilesOut[a.id] = {
      provider: a.provider,
      mode: a.mode,
      ...(a.email ? { email: a.email } : {}),
    };
    if (a.notes) {
      authExtras[a.id] = { notes: a.notes };
    }
  }

  // agents.defaults.*
  const ad = state.defaultAgent;
  const agentsDefaults: Record<string, unknown> = {
    ...(ad.defaultModel ? { model: ad.defaultModel } : {}),
    ...(ad.imageModel ? { imageModel: ad.imageModel } : {}),
    ...(ad.imageGenerationModel
      ? { imageGenerationModel: ad.imageGenerationModel }
      : {}),
    ...(ad.thinkingDefault ? { thinkingDefault: ad.thinkingDefault } : {}),
    ...(ad.reasoningDefault ? { reasoningDefault: ad.reasoningDefault } : {}),
  };

  const patch: Record<string, unknown> = {
    models: { providers: providersOut },
    auth: {
      profiles: authProfilesOut,
      order: authOrderOut,
    },
    agents: { defaults: agentsDefaults },
  };

  const extrasPatch: Record<string, unknown> = {
    providerExtras,
    authExtras,
    ...(Object.keys(modelExtras).length > 0 ? { modelExtras } : {}),
  };

  return { patch, extrasPatch };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  /** 表单 ID（providerId / authId / "defaultAgent"） */
  scope: string;
  field: string;
  message: string;
}

export function validateState(state: SettingsState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // providers
  const providerIds = new Set<string>();
  for (const p of state.providers) {
    if (!p.id.trim()) {
      issues.push({ scope: p.id || "(unnamed)", field: "id", message: "必填" });
    }
    if (providerIds.has(p.id)) {
      issues.push({ scope: p.id, field: "id", message: "ID 已存在" });
    }
    providerIds.add(p.id);
    if (!p.baseUrl.trim()) {
      issues.push({ scope: p.id, field: "baseUrl", message: "接口地址必填" });
    }
    if (p.models.length === 0) {
      issues.push({ scope: p.id, field: "models", message: "至少需要一个模型" });
    }
    if (p.customHeadersJson.trim() && parseCustomHeaders(p.customHeadersJson) === null) {
      issues.push({
        scope: p.id,
        field: "customHeadersJson",
        message: "非合法 JSON",
      });
    }
  }

  // auth profiles
  const authIds = new Set<string>();
  for (const a of state.authProfiles) {
    if (!a.id.trim()) {
      issues.push({ scope: a.id || "(unnamed)", field: "id", message: "必填" });
    }
    if (authIds.has(a.id)) {
      issues.push({ scope: a.id, field: "id", message: "ID 已存在" });
    }
    authIds.add(a.id);
    if (!a.provider.trim()) {
      issues.push({ scope: a.id, field: "provider", message: "必填" });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// reducer 主体
// ---------------------------------------------------------------------------

const TEMPLATE_BY_KEY: Record<string, ProviderTemplate> = Object.fromEntries(
  PROVIDER_TEMPLATES.map((t) => [t.key, t]),
);

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function markDirty(state: SettingsState): SettingsState {
  return { ...state, dirty: true };
}

export function settingsReducer(
  state: SettingsState,
  action: SettingsAction,
): SettingsState {
  switch (action.type) {
    case "LOAD_START":
      return { ...createInitialState(), load: { kind: "loading" } };

    case "LOAD_SUCCESS": {
      const { providers, authProfiles, defaultAgent, agentPresets } = dumpToState(action.dump);
      return {
        ...createInitialState(),
        load: { kind: "ready" },
        providers,
        authProfiles,
        defaultAgent,
        agentPresets,
        selectedProviderId: providers[0]?.id ?? null,
        selectedAuthId: authProfiles[0]?.id ?? null,
      };
    }

    case "LOAD_ERROR":
      return {
        ...createInitialState(),
        load: { kind: "error", message: action.message },
      };

    case "SET_TAB":
      return { ...state, tab: action.tab };

    case "SELECT_PROVIDER":
      return { ...state, selectedProviderId: action.id };

    case "SELECT_AUTH":
      return { ...state, selectedAuthId: action.id };

    case "ADD_PROVIDER_FROM_TEMPLATE": {
      const tpl = TEMPLATE_BY_KEY[action.templateKey];
      if (!tpl) return state;
      const taken = new Set(state.providers.map((p) => p.id));
      const id = uniqueId(tpl.defaultId, taken);
      // v3 / UX-B：模板带的 defaultModels 自动插入；第 1 行 isDefault=true。
      // 留空数组（azure-openai / lmstudio / custom）= 不自动插，让用户自填。
      const seedModels: ModelEntry[] = (tpl.defaultModels ?? []).map(
        (modelId, idx) => ({
          id: modelId,
          isDefault: idx === 0,
        }),
      );
      const newProvider: ProviderForm = {
        id,
        displayName: tpl.label,
        protocol: tpl.protocol,
        baseUrl: tpl.baseUrl,
        models: seedModels,
        customHeadersJson: "",
      };
      const next: SettingsState = {
        ...state,
        providers: [...state.providers, newProvider],
        selectedProviderId: id,
      };
      if (action.alsoAuth) {
        const authTaken = new Set(state.authProfiles.map((a) => a.id));
        const authId = uniqueId(`${id}-default`, authTaken);
        const newAuth: AuthProfileForm = {
          id: authId,
          provider: id,
          mode: "api_key",
          apiKey: "",
        };
        next.authProfiles = [...state.authProfiles, newAuth];
        next.providers = next.providers.map((p) =>
          p.id === id ? { ...p, authProfileId: authId } : p,
        );
      }
      return markDirty(next);
    }

    case "ADD_PROVIDER_BLANK": {
      const taken = new Set(state.providers.map((p) => p.id));
      const id = uniqueId("custom", taken);
      const newProvider: ProviderForm = {
        id,
        displayName: id,
        protocol: "openai-compatible",
        baseUrl: "",
        models: [],
        customHeadersJson: "",
      };
      return markDirty({
        ...state,
        providers: [...state.providers, newProvider],
        selectedProviderId: id,
      });
    }

    case "UPDATE_PROVIDER":
      return markDirty({
        ...state,
        providers: state.providers.map((p) =>
          p.id === action.id ? { ...p, ...action.patch } : p,
        ),
      });

    case "DELETE_PROVIDER": {
      const next = state.providers.filter((p) => p.id !== action.id);
      return markDirty({
        ...state,
        providers: next,
        selectedProviderId:
          state.selectedProviderId === action.id
            ? next[0]?.id ?? null
            : state.selectedProviderId,
      });
    }

    case "ADD_MODEL":
      return markDirty({
        ...state,
        providers: state.providers.map((p) =>
          p.id === action.providerId
            ? { ...p, models: [...p.models, { id: action.modelId }] }
            : p,
        ),
      });

    case "UPDATE_MODEL":
      return markDirty({
        ...state,
        providers: state.providers.map((p) => {
          if (p.id !== action.providerId) return p;
          return {
            ...p,
            models: p.models.map((m, i) =>
              i === action.index ? { ...m, ...action.patch } : m,
            ),
          };
        }),
      });

    case "DELETE_MODEL":
      return markDirty({
        ...state,
        providers: state.providers.map((p) => {
          if (p.id !== action.providerId) return p;
          return {
            ...p,
            models: p.models.filter((_, i) => i !== action.index),
          };
        }),
      });

    case "ADD_AUTH_PROFILE": {
      const taken = new Set(state.authProfiles.map((a) => a.id));
      const id = uniqueId(`${action.provider}-default`, taken);
      const newAuth: AuthProfileForm = {
        id,
        provider: action.provider,
        mode: action.mode ?? "api_key",
        apiKey: "",
      };
      return markDirty({
        ...state,
        authProfiles: [...state.authProfiles, newAuth],
        selectedAuthId: id,
      });
    }

    case "UPDATE_AUTH_PROFILE":
      return markDirty({
        ...state,
        authProfiles: state.authProfiles.map((a) =>
          a.id === action.id ? { ...a, ...action.patch } : a,
        ),
      });

    case "DELETE_AUTH_PROFILE": {
      const next = state.authProfiles.filter((a) => a.id !== action.id);
      return markDirty({
        ...state,
        authProfiles: next,
        selectedAuthId:
          state.selectedAuthId === action.id
            ? next[0]?.id ?? null
            : state.selectedAuthId,
      });
    }

    case "UPDATE_DEFAULT_AGENT":
      return markDirty({
        ...state,
        defaultAgent: { ...state.defaultAgent, ...action.patch },
      });

    case "SAVE_START":
      return { ...state, saving: true, lastSaveError: null };

    case "SAVE_SUCCESS":
      return { ...state, saving: false, dirty: false, lastSaveError: null };

    case "SAVE_ERROR":
      return { ...state, saving: false, lastSaveError: action.message };

    case "TEST_START":
      return { ...state, testing: true };

    case "TEST_DONE":
      return {
        ...state,
        testing: false,
        lastTest: {
          providerId: action.providerId,
          success: action.success,
          latencyMs: action.latencyMs,
          error: action.error,
        },
      };

    case "RESET_DIRTY":
      return { ...state, dirty: false };

    case "IMPORT_REMOTE_MODELS": {
      // 把远端获取到的 modelIds 合并到指定 provider 的 models 列表中
      // 已存在的（按 id 去重）不重复添加；新增的第一条标记 isDefault（如果当前无 default）
      const target = state.providers.find((p) => p.id === action.providerId);
      if (!target) return state;
      const existing = new Set(target.models.map((m) => m.id));
      const newModels = action.modelIds.filter((id) => !existing.has(id));
      if (newModels.length === 0) return state;
      const hasDefault = target.models.some((m) => m.isDefault);
      const additions: ModelEntry[] = newModels.map((id, idx) => ({
        id,
        isDefault: !hasDefault && idx === 0,
      }));
      return markDirty({
        ...state,
        providers: state.providers.map((p) =>
          p.id === action.providerId
            ? { ...p, models: [...p.models, ...additions] }
            : p,
        ),
      });
    }

    default:
      return state;
  }
}
