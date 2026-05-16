/**
 * Nexus-Tool API — 封装 Tauri invoke → sidecar RPC 调用。
 *
 * 通信链路：Browser → Tauri IPC → Rust #[tauri::command] → sidecar JSON-RPC
 * 依赖 @tauri-apps/api，仅在 Tauri WebView 中可用。
 */

import { invoke } from "@tauri-apps/api/core";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface NexusToolParam {
  id: string;
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  description?: string;
  options?: string[];
}

export interface NexusToolOutput {
  id: string;
  name: string;
  type: string;
}

export interface NexusToolPreset {
  id: string;
  name: string;
  values: Record<string, unknown>;
  created_at?: string;
}

export interface NexusToolTrigger {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: string;
    event: string;
    dcc: string;
  };
  execution: {
    mode: string;
  };
  useDefaultFilters: boolean;
}

export interface NexusToolImplementation {
  type: string;
  entry: string;
  function: string;
}

export interface NexusToolItem {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  target_dccs: string[];
  status: string;
  nexus_tool_path: string;
  implementation_type: string;
  is_enabled: boolean;
  is_pinned: boolean;
  is_favorited: boolean;
  use_count: number;
  author: string;
  created_at: string;
  updated_at: string;
  /** manifest 详情 — ToolDetailPanel 的 Info/Params/Presets/Triggers 数据源 */
  inputs?: NexusToolParam[];
  outputs?: NexusToolOutput[];
  presets?: NexusToolPreset[];
  triggers?: NexusToolTrigger[];
  default_filters?: Record<string, unknown>;
  implementation?: NexusToolImplementation;
}

/** nexus-tool.detail 返回的完整数据（同 NexusToolItem，保证必有 manifest 字段） */
export type NexusToolDetail = NexusToolItem;

export interface NexusToolListResult {
  items: NexusToolItem[];
  total: number;
}

export interface NexusToolOpResult {
  ok: boolean;
}

export interface NexusToolPublishResult {
  ok: boolean;
  version?: string;
}

export interface NexusToolRunResult {
  success: boolean;
  data?: unknown;
  error?: string;
  dcc?: string;
}

export interface NexusToolBatchResult {
  succeeded: string[];
  failed: string[];
  errors: Array<{ id: string; error: string }>;
  total: number;
}

export interface NexusToolListFilters {
  source?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: string;
}

export interface NexusToolCreateOptions {
  name: string;
  description?: string;
  version?: string;
  source?: string;
  target_dccs?: string[];
  implementation_type?: string;
  manifest?: Record<string, unknown>;
}

export interface NexusToolUpdateOptions {
  name?: string;
  description?: string;
  version?: string;
  target_dccs?: string[];
  implementation_type?: string;
  manifest?: Record<string, unknown>;
  /** 快捷字段：预设列表（会合并到 manifest.presets） */
  presets?: NexusToolPreset[];
  /** 快捷字段：触发器列表（会合并到 manifest.triggers） */
  triggers?: NexusToolTrigger[];
}

export interface NexusToolPublishOptions {
  target?: string;
  version?: string;
  description?: string;
}

// ── API 方法 ──────────────────────────────────────────────────────────────────

/** 分页列表 */
export async function nexusToolList(filters?: NexusToolListFilters): Promise<NexusToolListResult> {
  return invoke<NexusToolListResult>("nexus_tool_list", { params: filters ?? {} });
}

/** 详情（含完整 manifest：inputs / outputs / presets / triggers） */
export async function nexusToolDetail(id: string): Promise<NexusToolDetail> {
  return invoke<NexusToolDetail>("nexus_tool_detail", { params: { id } });
}

/** 创建 */
export async function nexusToolCreate(opts: NexusToolCreateOptions): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_create", { params: opts });
}

/** 更新 */
export async function nexusToolUpdate(id: string, opts: NexusToolUpdateOptions): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_update", { params: { id, ...opts } });
}

/** 删除 */
export async function nexusToolDelete(id: string): Promise<NexusToolOpResult> {
  return invoke<NexusToolOpResult>("nexus_tool_delete", { params: { id } });
}

/** 启用 */
export async function nexusToolEnable(id: string): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_enable", { params: { id } });
}

/** 禁用 */
export async function nexusToolDisable(id: string): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_disable", { params: { id } });
}

/** 钉选 */
export async function nexusToolPin(id: string): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_pin", { params: { id } });
}

/** 取消钉选 */
export async function nexusToolUnpin(id: string): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_unpin", { params: { id } });
}

/** 收藏 */
export async function nexusToolFavorite(id: string): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_favorite", { params: { id } });
}

/** 取消收藏 */
export async function nexusToolUnfavorite(id: string): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_unfavorite", { params: { id } });
}

/** 发布 */
export async function nexusToolPublish(id: string, opts?: NexusToolPublishOptions): Promise<NexusToolPublishResult> {
  return invoke<NexusToolPublishResult>("nexus_tool_publish", { params: { id, ...opts } });
}

/** 运行（DCC 工具走 MCP Bridge，通用工具走 subprocess） */
export async function nexusToolRun(id: string, args?: Record<string, unknown>): Promise<NexusToolRunResult> {
  return invoke<NexusToolRunResult>("nexus_tool_run", { params: { id, args: args ?? {} } });
}

/** 批量操作 */
export async function nexusToolBatch(operation: string, ids: string[]): Promise<NexusToolBatchResult> {
  return invoke<NexusToolBatchResult>("nexus_tool_batch", { params: { operation, ids } });
}

/** 保存预设列表到 manifest */
export async function nexusToolSavePresets(id: string, presets: NexusToolPreset[]): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_update", { params: { id, presets } });
}

/** 保存触发器列表到 manifest */
export async function nexusToolSaveTriggers(id: string, triggers: NexusToolTrigger[]): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_update", { params: { id, triggers } });
}

// ── 集合导出 ──────────────────────────────────────────────────────────────────

export const NexusToolAPI = {
  list: nexusToolList,
  detail: nexusToolDetail,
  create: nexusToolCreate,
  update: nexusToolUpdate,
  delete: nexusToolDelete,
  enable: nexusToolEnable,
  disable: nexusToolDisable,
  pin: nexusToolPin,
  unpin: nexusToolUnpin,
  favorite: nexusToolFavorite,
  unfavorite: nexusToolUnfavorite,
  publish: nexusToolPublish,
  run: nexusToolRun,
  batch: nexusToolBatch,
  savePresets: nexusToolSavePresets,
  saveTriggers: nexusToolSaveTriggers,
};

export type NexusToolAPIType = typeof NexusToolAPI;
