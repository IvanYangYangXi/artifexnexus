// settings.reducer 单测：dump→state、reducer 切换、buildPatchFromState、validateState。
// EPIC-0001 第二批 STORY-0015。

import { describe, it, expect } from "vitest";
import {
  buildPatchFromState,
  createInitialState,
  dumpToState,
  parseCustomHeaders,
  settingsReducer,
  validateState,
} from "./settings.reducer";
import type { OpenClawConfigDump } from "../../ipc/openclaw";

const emptyDump: OpenClawConfigDump = {
  providers: {},
  authProfiles: {},
  authOrder: {},
  agentDefaults: {},
  extras: {},
};

describe("dumpToState", () => {
  it("returns empty arrays when dump is empty", () => {
    const r = dumpToState(emptyDump);
    expect(r.providers).toEqual([]);
    expect(r.authProfiles).toEqual([]);
    expect(r.defaultAgent.thinkingDefault).toBe("adaptive");
  });

  it("parses providers + authOrder + extras", () => {
    const dump: OpenClawConfigDump = {
      providers: {
        openai: {
          // STORY-0018 hot-fix：上游 v2026.5.4 不再认 protocol（前端虚构字段，进 extras）
          baseUrl: "https://api.openai.com/v1",
          models: [{ id: "gpt-4o-mini", name: "GPT-4o Mini" }],
        },
      },
      authProfiles: {
        "openai-default": {
          provider: "openai",
          mode: "api_key",
          // 上游 v2026.5.4 profile 不再有 token 字段（凭证在 auth-profiles.json）；
          // dumpToState 仅消费元数据，apiKey 由 sidecar 单独脱敏返回
        },
      },
      authOrder: { openai: ["openai-default"] },
      agentDefaults: { model: "openai/gpt-4o-mini" },
      extras: {
        providerExtras: { openai: { displayName: "我的 GPT", protocol: "openai" } },
        // model 级 isDefault 走 extras.modelExtras
        modelExtras: { openai: { "gpt-4o-mini": { isDefault: true } } },
      },
    };
    const r = dumpToState(dump);
    expect(r.providers).toHaveLength(1);
    expect(r.providers[0]!.id).toBe("openai");
    expect(r.providers[0]!.displayName).toBe("我的 GPT");
    expect(r.providers[0]!.protocol).toBe("openai");
    expect(r.providers[0]!.authProfileId).toBe("openai-default");
    expect(r.providers[0]!.models[0]!.isDefault).toBe(true);
    expect(r.defaultAgent.defaultModel).toBe("openai/gpt-4o-mini");
  });

  it("falls back unknown protocol to openai-compatible", () => {
    const r = dumpToState({
      ...emptyDump,
      providers: { x: { protocol: "weird-thing", baseUrl: "u", models: [] } },
    });
    expect(r.providers[0]!.protocol).toBe("openai-compatible");
  });
});

describe("settingsReducer", () => {
  it("LOAD_SUCCESS populates state and selects first items", () => {
    const dump: OpenClawConfigDump = {
      providers: { openai: { protocol: "openai", baseUrl: "x", models: [] } },
      authProfiles: { "k": { provider: "openai", mode: "api-key", token: "t" } },
      authOrder: {},
      agentDefaults: {},
      extras: {},
    };
    const next = settingsReducer(createInitialState(), {
      type: "LOAD_SUCCESS",
      dump,
    });
    expect(next.load.kind).toBe("ready");
    expect(next.selectedProviderId).toBe("openai");
    expect(next.selectedAuthId).toBe("k");
    expect(next.dirty).toBe(false);
  });

  it("ADD_PROVIDER_FROM_TEMPLATE creates provider + auth when alsoAuth=true", () => {
    const next = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "deepseek",
      alsoAuth: true,
    });
    expect(next.providers).toHaveLength(1);
    expect(next.providers[0]!.id).toBe("deepseek");
    expect(next.providers[0]!.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(next.authProfiles).toHaveLength(1);
    expect(next.authProfiles[0]!.provider).toBe("deepseek");
    expect(next.providers[0]!.authProfileId).toBe(next.authProfiles[0]!.id);
    expect(next.dirty).toBe(true);
  });

  it("ADD_PROVIDER_FROM_TEMPLATE auto-renames on id conflict", () => {
    let s = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "openai",
      alsoAuth: false,
    });
    s = settingsReducer(s, {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "openai",
      alsoAuth: false,
    });
    expect(s.providers.map((p) => p.id)).toEqual(["openai", "openai-2"]);
  });

  // v3 / UX-B：模板带的 defaultModels 应自动插入；首行 isDefault=true。
  it("ADD_PROVIDER_FROM_TEMPLATE seeds default model rows (UX-B)", () => {
    const s = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "deepseek",
      alsoAuth: false,
    });
    expect(s.providers[0]!.models).toHaveLength(1);
    expect(s.providers[0]!.models[0]!.id).toBe("deepseek-v4-flash");
    expect(s.providers[0]!.models[0]!.isDefault).toBe(true);
  });

  // v3 / UX-B：azure / lmstudio / custom 留空 defaultModels，故 models[] 仍为空，让用户填。
  it("ADD_PROVIDER_FROM_TEMPLATE skips seed when defaultModels is empty (azure/lmstudio/custom)", () => {
    for (const key of ["azure-openai", "lmstudio", "custom"]) {
      const s = settingsReducer(createInitialState(), {
        type: "ADD_PROVIDER_FROM_TEMPLATE",
        templateKey: key,
        alsoAuth: false,
      });
      expect(s.providers[0]!.models).toEqual([]);
    }
  });

  it("UPDATE_PROVIDER patches and marks dirty", () => {
    let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
    s = settingsReducer(s, { type: "RESET_DIRTY" });
    const id = s.providers[0]!.id;
    s = settingsReducer(s, {
      type: "UPDATE_PROVIDER",
      id,
      patch: { baseUrl: "https://x" },
    });
    expect(s.providers[0]!.baseUrl).toBe("https://x");
    expect(s.dirty).toBe(true);
  });

  it("DELETE_PROVIDER updates selection to next item", () => {
    let s = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "openai",
      alsoAuth: false,
    });
    s = settingsReducer(s, {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "deepseek",
      alsoAuth: false,
    });
    s = { ...s, selectedProviderId: "openai" };
    s = settingsReducer(s, { type: "DELETE_PROVIDER", id: "openai" });
    expect(s.providers.map((p) => p.id)).toEqual(["deepseek"]);
    expect(s.selectedProviderId).toBe("deepseek");
  });

  it("ADD_MODEL / DELETE_MODEL roundtrip", () => {
    let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
    const id = s.providers[0]!.id;
    s = settingsReducer(s, {
      type: "ADD_MODEL",
      providerId: id,
      modelId: "gpt-4o-mini",
    });
    s = settingsReducer(s, {
      type: "ADD_MODEL",
      providerId: id,
      modelId: "gpt-4o",
    });
    expect(s.providers[0]!.models).toHaveLength(2);
    s = settingsReducer(s, {
      type: "DELETE_MODEL",
      providerId: id,
      index: 0,
    });
    expect(s.providers[0]!.models[0]!.id).toBe("gpt-4o");
  });

  it("SAVE_SUCCESS clears dirty", () => {
    let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
    expect(s.dirty).toBe(true);
    s = settingsReducer(s, { type: "SAVE_SUCCESS" });
    expect(s.dirty).toBe(false);
  });
});

describe("buildPatchFromState", () => {
  it("packs providers + auth + extras", () => {
    let s = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "deepseek",
      alsoAuth: true,
    });
    const id = s.providers[0]!.id;
    s = settingsReducer(s, {
      type: "ADD_MODEL",
      providerId: id,
      modelId: "deepseek-chat",
    });
    const { patch, extrasPatch } = buildPatchFromState(s);
    expect(
      (patch as { models: { providers: Record<string, unknown> } }).models.providers[id],
    ).toBeDefined();
    expect(
      (extrasPatch as { providerExtras: Record<string, unknown> }).providerExtras[id],
    ).toBeDefined();
  });

  it("excludes apiKey/token from patch (v2026.5.4: profile is metadata-only)", () => {
    // STORY-0018 hot-fix：上游 schema 不再接受 auth.profiles.<id>.token
    // 凭证另由 setOpenClawAuthToken (paste-token) 写入
    let s = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "openai",
      alsoAuth: true,
    });
    const authId = s.authProfiles[0]!.id;
    s = settingsReducer(s, {
      type: "UPDATE_AUTH_PROFILE",
      id: authId,
      patch: { apiKey: "sk-real" },
    });
    const { patch } = buildPatchFromState(s);
    const profiles = (
      patch as {
        auth: { profiles: Record<string, Record<string, unknown>> };
      }
    ).auth.profiles;
    // patch 只携带元数据
    expect(profiles[authId]!.provider).toBeDefined();
    expect(profiles[authId]!.mode).toBeDefined();
    // patch 绝不携带凭证字段（schema 会拒收 → "Unrecognized key: token"）
    expect(profiles[authId]!.token).toBeUndefined();
    expect(profiles[authId]!.apiKey).toBeUndefined();
    // state.authProfiles 里仍保留 apiKey，供保存按钮 handler 取用调 setAuthToken
    expect(s.authProfiles.find((a) => a.id === authId)!.apiKey).toBe("sk-real");
  });

  // STORY-0018 hot-fix（2026/5/8）：上游 v2026.5.4 schema 真值表
  // 详见 d:\probe2.py 实测：provider 不收 protocol/timeoutMs，
  // model 不收 isDefault/timeoutMs/temperature(顶层)/capabilities，
  // model.name 必填。
  describe("v2026.5.4 schema mapping", () => {
    it("provider 节点不再含 protocol（进 extras）", () => {
      const s = settingsReducer(createInitialState(), {
        type: "ADD_PROVIDER_FROM_TEMPLATE",
        templateKey: "deepseek",
        alsoAuth: false,
      });
      const id = s.providers[0]!.id;
      const { patch, extrasPatch } = buildPatchFromState(s);
      const prov = (
        patch as { models: { providers: Record<string, Record<string, unknown>> } }
      ).models.providers[id];
      // 上游 v2026.5.4 不接受 protocol（前端虚构字段）：剥离
      expect(prov!.protocol).toBeUndefined();
      // extras 保留前端语义
      const pExtras = (
        extrasPatch as { providerExtras: Record<string, Record<string, unknown>> }
      ).providerExtras[id];
      expect(pExtras!.protocol).toBeDefined();
    });

    it("model.name 缺省时用 id 兜底（schema required string minLength 1）", () => {
      let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
      const pid = s.providers[0]!.id;
      s = settingsReducer(s, {
        type: "ADD_MODEL",
        providerId: pid,
        modelId: "kimi-k2.5",
      });
      const { patch } = buildPatchFromState(s);
      const m = (
        patch as {
          models: {
            providers: Record<
              string,
              { models: Array<Record<string, unknown>> }
            >;
          };
        }
      ).models.providers[pid]!.models[0];
      expect(m!.id).toBe("kimi-k2.5");
      expect(m!.name).toBe("kimi-k2.5"); // fallback
    });

    it("model.temperature 顶层 → 包进 params.temperature", () => {
      let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
      const pid = s.providers[0]!.id;
      s = settingsReducer(s, {
        type: "ADD_MODEL",
        providerId: pid,
        modelId: "m1",
      });
      s = settingsReducer(s, {
        type: "UPDATE_MODEL",
        providerId: pid,
        index: 0,
        patch: { temperature: 0.7 },
      });
      const { patch } = buildPatchFromState(s);
      const m = (
        patch as {
          models: {
            providers: Record<
              string,
              { models: Array<{ temperature?: unknown; params?: Record<string, unknown> }> }
            >;
          };
        }
      ).models.providers[pid]!.models[0];
      expect(m!.temperature).toBeUndefined(); // 顶层不能有
      expect(m!.params).toEqual({ temperature: 0.7 });
    });

    it("model.capabilities → reasoning + input 数组", () => {
      let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
      const pid = s.providers[0]!.id;
      s = settingsReducer(s, {
        type: "ADD_MODEL",
        providerId: pid,
        modelId: "m1",
      });
      s = settingsReducer(s, {
        type: "UPDATE_MODEL",
        providerId: pid,
        index: 0,
        patch: { capabilities: { vision: true, reasoning: true } },
      });
      const { patch } = buildPatchFromState(s);
      const m = (
        patch as {
          models: {
            providers: Record<
              string,
              {
                models: Array<{
                  reasoning?: unknown;
                  input?: unknown;
                  capabilities?: unknown;
                }>;
              }
            >;
          };
        }
      ).models.providers[pid]!.models[0];
      // capabilities 字段被剥离
      expect(m!.capabilities).toBeUndefined();
      // 拆映射
      expect(m!.reasoning).toBe(true);
      expect(m!.input).toEqual(["text", "image"]);
    });

    it("model.isDefault / timeoutMs → 进 extras.modelExtras", () => {
      let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
      const pid = s.providers[0]!.id;
      s = settingsReducer(s, {
        type: "ADD_MODEL",
        providerId: pid,
        modelId: "m1",
      });
      s = settingsReducer(s, {
        type: "UPDATE_MODEL",
        providerId: pid,
        index: 0,
        patch: { isDefault: true, timeoutMs: 60000 },
      });
      const { patch, extrasPatch } = buildPatchFromState(s);
      const m = (
        patch as {
          models: {
            providers: Record<
              string,
              { models: Array<Record<string, unknown>> }
            >;
          };
        }
      ).models.providers[pid]!.models[0];
      expect(m!.isDefault).toBeUndefined();
      expect(m!.timeoutMs).toBeUndefined();
      const ext = (
        extrasPatch as {
          modelExtras?: Record<string, Record<string, Record<string, unknown>>>;
        }
      ).modelExtras;
      expect(ext?.[pid]?.["m1"]).toEqual({ isDefault: true, timeoutMs: 60000 });
    });

    it("provider.protocol → model.api 字段（每个 model 都打）", () => {
      let s = settingsReducer(createInitialState(), {
        type: "ADD_PROVIDER_FROM_TEMPLATE",
        templateKey: "deepseek",
        alsoAuth: false,
      });
      // deepseek 模板默认 protocol 是 "openai-compatible" → 映射成上游
      // schema 接受的 "openai-completions"
      const pid = s.providers[0]!.id;
      const { patch } = buildPatchFromState(s);
      const ms = (
        patch as {
          models: {
            providers: Record<
              string,
              { models: Array<{ api?: unknown }> }
            >;
          };
        }
      ).models.providers[pid]!.models;
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) {
        expect(m.api).toBe("openai-completions");
      }
    });
  });

  it("custom headers are parsed into headers object", () => {
    let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
    const id = s.providers[0]!.id;
    s = settingsReducer(s, {
      type: "UPDATE_PROVIDER",
      id,
      patch: { customHeadersJson: '{"X-Org":"a"}' },
    });
    const { patch } = buildPatchFromState(s);
    const provider = (
      patch as { models: { providers: Record<string, { headers?: unknown }> } }
    ).models.providers[id];
    expect(provider!.headers).toEqual({ "X-Org": "a" });
  });
});

describe("validateState", () => {
  it("flags missing baseUrl and empty models", () => {
    const s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
    const issues = validateState(s);
    expect(issues.some((i) => i.field === "baseUrl")).toBe(true);
    expect(issues.some((i) => i.field === "models")).toBe(true);
  });

  it("flags invalid customHeadersJson", () => {
    let s = settingsReducer(createInitialState(), { type: "ADD_PROVIDER_BLANK" });
    const id = s.providers[0]!.id;
    s = settingsReducer(s, {
      type: "UPDATE_PROVIDER",
      id,
      patch: {
        baseUrl: "https://x",
        customHeadersJson: "{not valid",
      },
    });
    s = settingsReducer(s, {
      type: "ADD_MODEL",
      providerId: id,
      modelId: "m",
    });
    const issues = validateState(s);
    expect(issues.some((i) => i.field === "customHeadersJson")).toBe(true);
  });

  it("returns no issues for valid state", () => {
    let s = settingsReducer(createInitialState(), {
      type: "ADD_PROVIDER_FROM_TEMPLATE",
      templateKey: "openai",
      alsoAuth: true,
    });
    const id = s.providers[0]!.id;
    s = settingsReducer(s, {
      type: "ADD_MODEL",
      providerId: id,
      modelId: "gpt-4o-mini",
    });
    expect(validateState(s)).toEqual([]);
  });
});

describe("parseCustomHeaders", () => {
  it("returns empty object on blank", () => {
    expect(parseCustomHeaders("")).toEqual({});
    expect(parseCustomHeaders("   ")).toEqual({});
  });

  it("returns null on invalid JSON", () => {
    expect(parseCustomHeaders("{not}")).toBeNull();
  });

  it("returns null on non-object JSON", () => {
    expect(parseCustomHeaders("[]")).toBeNull();
    expect(parseCustomHeaders('"x"')).toBeNull();
  });

  it("returns object on valid JSON", () => {
    expect(parseCustomHeaders('{"a":1}')).toEqual({ a: 1 });
  });
});
