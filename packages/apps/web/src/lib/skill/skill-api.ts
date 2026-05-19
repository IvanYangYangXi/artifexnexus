/**
 * Skill API — 封装 Tauri invoke → sidecar RPC 调用。
 *
 * 通信链路：Browser → Tauri IPC → Rust #[tauri::command] → sidecar JSON-RPC
 * 依赖 @tauri-apps/api，仅在 Tauri WebView 中可用。
 */

import { invoke } from "@tauri-apps/api/core";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string;
  display_name: string;
  description: string;
  layer: string;
  category: string | null;
  software: string;
  version: string;
  priority: number;
  path: string;
  validation_error?: string | null;
  /** manifest.json 是否存在 */
  has_manifest: boolean;
  /** manifest.json 独有字段 */
  author: string;
  tags: string[];
  risk_level: string;
  dependencies: string[];
  entry_point: string;
  license: string;
}

export interface SkillItem extends SkillEntry {
  enabled: boolean;
  pinned: boolean;
  favorited: boolean;
  installed: boolean;
}

export interface SkillToolItem {
  name: string;
  description: string;
  category: string;
  risk_level: string;
  input_schema: Record<string, unknown>;
}

export interface SkillDetail {
  entry: SkillEntry;
  tools: SkillToolItem[];
  config: { enabled: boolean; pinned: boolean; favorited: boolean };
  loaded: boolean;
  layer: string;
  source_path?: string;
  install_path?: string | null;
  load_error?: string | null;
  tool_count?: number;
}

export interface SkillListResult {
  items: SkillItem[];
  total: number;
}

export interface SkillOpResult {
  ok: boolean;
  skill_name: string;
  message: string;
  installed_path?: string | null;
}

export interface SkillSyncResult {
  ok: boolean;
  skill_name: string;
  synced_files: string[];
  state: string;
  message: string;
}

export interface SkillPublishResult {
  ok: boolean;
  skill_name: string;
  version: string;
  published_path?: string | null;
}

export interface SkillBatchResult {
  succeeded: string[];
  failed: string[];
  errors: Array<{ id: string; error: string }>;
  total: number;
}

export interface SkillListFilters {
  category?: string;
  software?: string;
  layer?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: string;
}

// ── API 方法 ──────────────────────────────────────────────────────────────────

/** 分页列表 */
export async function skillList(filters?: SkillListFilters): Promise<SkillListResult> {
  return invoke<SkillListResult>("skill_list", { params: filters ?? {} });
}

/** 详情（含 Skill-Tool 列表 + 用户偏好） */
export async function skillDetail(id: string): Promise<SkillDetail> {
  return invoke<SkillDetail>("skill_detail", { params: { id } });
}

/** 安装 */
export async function skillInstall(id: string, opts?: { sourceLayer?: string; targetLayer?: string }): Promise<SkillOpResult> {
  return invoke<SkillOpResult>("skill_install", { params: { id, ...opts } });
}

/** 卸载 */
export async function skillUninstall(id: string, opts?: { targetLayer?: string }): Promise<SkillOpResult> {
  return invoke<SkillOpResult>("skill_uninstall", { params: { id, ...opts } });
}

/** 启用 */
export async function skillEnable(id: string): Promise<SkillItem> {
  return invoke<SkillItem>("skill_enable", { params: { id } });
}

/** 禁用 */
export async function skillDisable(id: string): Promise<SkillItem> {
  return invoke<SkillItem>("skill_disable", { params: { id } });
}

/** 钉选 */
export async function skillPin(id: string): Promise<SkillItem> {
  return invoke<SkillItem>("skill_pin", { params: { id } });
}

/** 取消钉选 */
export async function skillUnpin(id: string): Promise<SkillItem> {
  return invoke<SkillItem>("skill_unpin", { params: { id } });
}

/** 收藏 */
export async function skillFavorite(id: string): Promise<SkillItem> {
  return invoke<SkillItem>("skill_favorite", { params: { id } });
}

/** 取消收藏 */
export async function skillUnfavorite(id: string): Promise<SkillItem> {
  return invoke<SkillItem>("skill_unfavorite", { params: { id } });
}

/** 同步 */
export async function skillSync(id: string, opts?: { sourceLayer?: string; targetLayer?: string }): Promise<SkillSyncResult> {
  return invoke<SkillSyncResult>("skill_sync", { params: { id, ...opts } });
}

/** 发布 */
export async function skillPublish(id: string, opts?: { sourceLayer?: string; targetLayer?: string }): Promise<SkillPublishResult> {
  return invoke<SkillPublishResult>("skill_publish", { params: { id, ...opts } });
}

/** 批量操作 */
export async function skillBatch(operation: string, ids: string[]): Promise<SkillBatchResult> {
  return invoke<SkillBatchResult>("skill_batch", { params: { operation, ids } });
}

/** 搜索 */
export async function skillSearch(query: string): Promise<SkillItem[]> {
  return invoke<SkillItem[]>("skill_search", { params: { query } });
}

/** 一键修复 manifest.json（从 SKILL.md 生成） */
export async function skillFixManifest(id: string): Promise<{ ok: boolean; path: string; warnings: string[] }> {
  return invoke("skill_fix_manifest", { params: { id } });
}

/** 读取 SKILL.md 原始内容 */
export async function skillReadSkillMd(id: string): Promise<{ ok: boolean; content: string; path: string; warnings: string[] }> {
  return invoke("skill_read_skill_md", { params: { id } });
}

// ── 集合导出 ──────────────────────────────────────────────────────────────────

export const SkillAPI = {
  list: skillList,
  detail: skillDetail,
  install: skillInstall,
  uninstall: skillUninstall,
  enable: skillEnable,
  disable: skillDisable,
  pin: skillPin,
  unpin: skillUnpin,
  favorite: skillFavorite,
  unfavorite: skillUnfavorite,
  sync: skillSync,
  publish: skillPublish,
  batch: skillBatch,
  search: skillSearch,
  fixManifest: skillFixManifest,
  readSkillMd: skillReadSkillMd,
};

export type SkillAPIType = typeof SkillAPI;
