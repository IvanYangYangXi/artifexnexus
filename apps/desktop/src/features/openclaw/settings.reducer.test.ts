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
          protocol: "openai",
          baseUrl: "https://api.openai.com/v1",
          models: [{ id: "gpt-4o-mini", isDefault: true }],
        },
      },
      authProfiles: {
        "openai-default": {
          provider: "openai",
          mode: "api-key",
          token: "********",
        },
      },
      authOrder: { openai: ["openai-default"] },
      agentDefaults: { model: "openai/gpt-4o-mini" },
      extras: {
        providerExtras: { openai: { displayName: "我的 GPT" } },
      },
    };
    const r = dumpToState(dump);
    expect(r.providers).toHaveLength(1);
    expect(r.providers[0]!.id).toBe("openai");
    expect(r.providers[0]!.displayName).toBe("我的 GPT");
    expect(r.providers[0]!.authProfileId).toBe("openai-default");
    expect(r.providers[0]!.models[0]!.isDefault).toBe(true);
    expect(r.authProfiles[0]!.apiKey).toBe("********");
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
    expect(s.providers[0]!.models[0]!.id).toBe("deepseek-chat");
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

  it("preserves apiKey field in patch (sidecar will strip mask)", () => {
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
    const profiles = (patch as { auth: { profiles: Record<string, { token?: string }> } })
      .auth.profiles;
    expect(profiles[authId]!.token).toBe("sk-real");
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
