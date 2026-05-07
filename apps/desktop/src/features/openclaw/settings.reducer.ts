// OpenClaw 设置面板 reducer：state 机 + dump↔form 转换 + patch 构建。
// EPIC-0001 第二批 STORY-0015。
// 全部纯函数 / 不接 IPC，便于单测。

import type {
  AuthMode,
  AuthProfileForm,
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
  | { type: "RESET_DIRTY" };

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
  const allowed: AuthMode[] = ["api-key", "oauth", "token", "paste"];
  return allowed.includes(v as AuthMode) ? (v as AuthMode) : "api-key";
}

export function dumpToState(dump: OpenClawConfigDump): {
  providers: ProviderForm[];
  authProfiles: AuthProfileForm[];
  defaultAgent: DefaultAgentForm;
} {
  const providerExtras = asObject(asObject(dump.extras).providerExtras);
  const authExtras = asObject(asObject(dump.extras).authExtras);
  const authOrder = dump.authOrder ?? {};

  const providers: ProviderForm[] = Object.entries(asObject(dump.providers)).map(
    ([id, raw]) => {
      const obj = asObject(raw);
      const extra = asObject(providerExtras[id]);
      const modelsRaw = asArray(obj.models);
      const models: ModelEntry[] = modelsRaw.map((m) => {
        const mObj = asObject(m);
        const cap = asObject(mObj.capabilities);
        return {
          id: asString(mObj.id),
          isDefault: mObj.isDefault === true,
          maxTokens: typeof mObj.maxTokens === "number" ? mObj.maxTokens : undefined,
          temperature:
            typeof mObj.temperature === "number" ? mObj.temperature : undefined,
          timeoutMs:
            typeof mObj.timeoutMs === "number" ? mObj.timeoutMs : undefined,
          capabilities: {
            vision: cap.vision === true,
            reasoning: cap.reasoning === true,
          },
        };
      });
      const headersObj = asObject(obj.headers);
      const profileList = authOrder[id];
      return {
        id,
        displayName: asString(extra.displayName, id),
        protocol: asProtocol(obj.protocol),
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

  return { providers, authProfiles, defaultAgent };
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
  const providersOut: Record<string, unknown> = {};
  const providerExtras: Record<string, unknown> = {};
  const authOrderOut: Record<string, string[]> = {};

  for (const p of state.providers) {
    const headers = parseCustomHeaders(p.customHeadersJson) ?? {};
    providersOut[p.id] = {
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      models: p.models.map((m) => ({
        id: m.id,
        ...(m.isDefault ? { isDefault: true } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        ...(m.temperature !== undefined ? { temperature: m.temperature } : {}),
        ...(m.timeoutMs !== undefined ? { timeoutMs: m.timeoutMs } : {}),
        ...(m.capabilities &&
        (m.capabilities.vision || m.capabilities.reasoning)
          ? {
              capabilities: {
                ...(m.capabilities.vision ? { vision: true } : {}),
                ...(m.capabilities.reasoning ? { reasoning: true } : {}),
              },
            }
          : {}),
      })),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
    providerExtras[p.id] = { displayName: p.displayName };

    if (p.authProfileId) {
      authOrderOut[p.id] = [p.authProfileId];
    }
  }

  // authProfiles → auth.profiles.<id>.*
  const authProfilesOut: Record<string, unknown> = {};
  const authExtras: Record<string, unknown> = {};
  for (const a of state.authProfiles) {
    authProfilesOut[a.id] = {
      provider: a.provider,
      mode: a.mode,
      // apiKey 字段如为脱敏占位，sidecar 会剔除；这里照传
      ...(a.apiKey ? { token: a.apiKey } : {}),
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
      const { providers, authProfiles, defaultAgent } = dumpToState(action.dump);
      return {
        ...createInitialState(),
        load: { kind: "ready" },
        providers,
        authProfiles,
        defaultAgent,
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
          mode: "api-key",
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
        mode: action.mode ?? "api-key",
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

    default:
      return state;
  }
}
