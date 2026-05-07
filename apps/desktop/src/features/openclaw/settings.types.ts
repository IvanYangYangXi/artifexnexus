// OpenClaw 设置面板：类型定义。
// EPIC-0001 第二批 STORY-0015。
// 与 spec docs/specs/openclaw-settings-panel.md §4 字段表对齐。

/** 协议枚举（spec §3 / §4.1）。具体合法值待 P1 深挖确认。 */
export type Protocol =
  | "openai"
  | "openai-compatible"
  | "anthropic"
  | "google"
  | "azure-openai";

/** 鉴权方式枚举（spec §4.2）。 */
export type AuthMode = "api-key" | "oauth" | "token" | "paste";

/** 单个模型条目（provider.models[]）。 */
export interface ModelEntry {
  /** 模型 ID（如 gpt-4o-mini） */
  id: string;
  /** 是否默认（仅一个 provider 内单选；不影响 agents.defaults） */
  isDefault?: boolean;
  /** 单模型高级配置 */
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  capabilities?: {
    vision?: boolean;
    reasoning?: boolean;
  };
}

/** Provider 表单（与 openclaw.json `models.providers.<id>` 对齐 + extras） */
export interface ProviderForm {
  /** providers 的 key，**不可重命名**（删旧建新） */
  id: string;
  /** 显示名（落 extras） */
  displayName: string;
  protocol: Protocol;
  baseUrl: string;
  models: ModelEntry[];
  /** 关联的 auth profile（落 auth.order.<id>[0]） */
  authProfileId?: string;
  /** 自定义 headers（JSON object，UI 用文本输入再 parse） */
  customHeadersJson: string;
}

/** Auth profile 表单（与 `auth.profiles.<id>` 对齐 + extras） */
export interface AuthProfileForm {
  id: string;
  /** 关联到哪个 provider id */
  provider: string;
  mode: AuthMode;
  /** API Key（脱敏占位是等长 *；为 *** 表示"未改"） */
  apiKey: string;
  email?: string;
  /** 备注（落 extras） */
  notes?: string;
}

/** Default Agent 表单（与 `agents.defaults.*` 对齐） */
export interface DefaultAgentForm {
  /** "<provider>/<model>" 形式 */
  defaultModel: string;
  imageModel: string;
  imageGenerationModel: string;
  thinkingDefault: string;
  reasoningDefault: string;
}

/** Provider 模板（仅"新增"时一键填默认值；不创建固定 slot） */
export interface ProviderTemplate {
  /** 模板 key（i18n 用） */
  key: string;
  /** 显示名 */
  label: string;
  /** 默认 ID */
  defaultId: string;
  protocol: Protocol;
  baseUrl: string;
  /** 备注（在模板 picker 列表里显示一行说明） */
  note?: string;
  /**
   * 默认模型 ID 列表（v3 / UX-B / spec §3）。
   *
   * 选模板新建 provider 时自动插入这些 model 行，第一行 isDefault=true，
   * 解决 v2 用户反馈 "新建立刻保存就报至少 1 个 model" 的痛点。
   *
   * 留空数组 = 不自动插（如 azure-openai 需要 deployment 名、custom 全空白）。
   */
  defaultModels?: readonly string[];
}

/** 11 个 provider 模板矩阵（spec §3）。`defaultModels` 见 spec §3 v3 表"默认 model"列。 */
export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  {
    key: "openai",
    label: "OpenAI",
    defaultId: "openai",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    note: "官方",
    defaultModels: ["gpt-4o-mini"],
  },
  {
    key: "anthropic",
    label: "Anthropic",
    defaultId: "anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    note: "官方",
    defaultModels: ["claude-3-5-sonnet-20241022"],
  },
  {
    key: "google",
    label: "Google Gemini",
    defaultId: "google",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    note: "Gemini API",
    defaultModels: ["gemini-2.0-flash-exp"],
  },
  {
    key: "azure-openai",
    label: "Azure OpenAI",
    defaultId: "azure-openai",
    protocol: "azure-openai",
    baseUrl: "",
    note: "需 deployment + apiVersion",
    defaultModels: [],
  },
  {
    key: "ollama-local",
    label: "Ollama（本地）",
    defaultId: "ollama-local",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    note: "apiKey 可空",
    defaultModels: ["llama3.2:latest"],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    defaultId: "deepseek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModels: ["deepseek-chat"],
  },
  {
    key: "volcengine-doubao",
    label: "火山豆包",
    defaultId: "volcengine-doubao",
    protocol: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModels: ["doubao-pro-32k"],
  },
  {
    key: "aliyun-qwen",
    label: "阿里千问",
    defaultId: "aliyun-qwen",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModels: ["qwen-plus"],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    defaultId: "openrouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    note: "多模型聚合",
    defaultModels: ["anthropic/claude-3.5-sonnet"],
  },
  {
    key: "lmstudio",
    label: "LM Studio",
    defaultId: "lmstudio",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    note: "本地",
    defaultModels: [],
  },
  {
    key: "custom",
    label: "自定义",
    defaultId: "custom",
    protocol: "openai-compatible",
    baseUrl: "",
    note: "全空白",
    defaultModels: [],
  },
] as const;
