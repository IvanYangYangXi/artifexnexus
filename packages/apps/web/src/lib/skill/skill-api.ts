/**
 * Skill API — 封装 Tauri invoke → sidecar RPC 调用。
 *
 * 通信链路：Browser → Tauri IPC → Rust #[tauri::command] → sidecar JSON-RPC
 * 依赖 @tauri-apps/api，仅在 Tauri WebView 中可用。
 */

import { invoke } from "@tauri-apps/api/core";
import type { DCCEntry } from "../nexus-tool/nexus-tool-api";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string;
  display_name: string;
  description: string;
  layer: string;
  software: DCCEntry[];
  version: string;
  priority: number;
  path: string;
  validation_error?: string | null;
  /** manifest.json 是否存在 */
  has_manifest: boolean;
  /** manifest.json 独有字段 */
  author: string;
  tags: string[];
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
  risk_level: string;
  input_schema: Record<string, unknown>;
}

export interface SyncStateInfo {
  ok: boolean;
  state: string | null;
  installed_version: string | null;
  source_version: string | null;
  changed_files: string[];
  needs_update: boolean;
  needs_publish: boolean;
  message: string;
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
  sync_state?: SyncStateInfo | null;
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
  tags?: string[];
  category?: string;  // 向后兼容（映射到 tags[0]）
  software?: string;
  layer?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: string;
}

// ── 模块级缓存（减少 Tauri IPC 往返次数）─────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 列表/详情缓存 60s

interface CacheEntry<T> { data: T; ts: number; }

const _listCache = new Map<string, CacheEntry<SkillListResult>>();
const _detailCache = new Map<string, CacheEntry<SkillDetail>>();

function _cacheKey(filters?: SkillListFilters): string { return JSON.stringify(filters ?? {}); }

// ── 全局事件总线（2026-06-25）────────────────────────────────────────────────
//
// 用途：RightPanel / SkillList / SkillDetailPanel 等多个组件各自维护了 skill 列表副本，
// 之前只能在自身操作后手动 `await loadSkills()`，导致跨组件的状态不一致
// （典型场景：用户在 SkillList 安装新 skill，右侧面板的列表不刷新，仍然显示空）。
//
// 现在 install / uninstall / enable / disable / pin / unpin / favorite /
// unfavorite / sync / publish / batch / fixManifest / updateManifest 成功后
// 会 emit `artifex:skill-changed` CustomEvent，detail 携带操作类型 + 涉及的 skill 名。
// 任何组件都可以 `window.addEventListener("artifex:skill-changed", handler)`
// 监听并刷新本地缓存。
//
// 仅在浏览器环境触发，SSR / 非 window 上下文静默跳过。

export interface SkillChangeDetail {
  /** 操作类型（对应 API 方法名去掉 "skill" 前缀） */
  operation: "install" | "uninstall" | "enable" | "disable" | "pin" | "unpin"
    | "favorite" | "unfavorite" | "sync" | "publish" | "batch"
    | "fixManifest" | "updateManifest";
  /** 受影响的 skill 名称（单） */
  skillName?: string;
  /** 受影响的 skill 名称（批量） */
  skillNames?: string[];
}

function _emitSkillChange(detail: SkillChangeDetail): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<SkillChangeDetail>("artifex:skill-changed", { detail }));
  } catch { /* ignore */ }
}

/** 监听 skill 列表变化（其他组件 install / uninstall / ... 后触发）。 */
export function onSkillChange(handler: (detail: SkillChangeDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<SkillChangeDetail>;
    handler(ce.detail);
  };
  window.addEventListener("artifex:skill-changed", listener);
  return () => window.removeEventListener("artifex:skill-changed", listener);
}

// ── API 方法 ──────────────────────────────────────────────────────────────────

/** 分页列表 */
export async function skillList(filters?: SkillListFilters): Promise<SkillListResult> {
  const key = _cacheKey(filters);
  const cached = _listCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const result = await invoke<SkillListResult>("skill_list", { params: filters ?? {} });
  _listCache.set(key, { data: result, ts: Date.now() });
  _detailCache.clear();
  return result;
}

/** 详情（含 Skill-Tool 列表 + 用户偏好） */
export async function skillDetail(id: string): Promise<SkillDetail> {
  const cached = _detailCache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const result = await invoke<SkillDetail>("skill_detail", { params: { id } });
  _detailCache.set(id, { data: result, ts: Date.now() });
  return result;
}

/** 安装 */
export async function skillInstall(id: string, opts?: { sourceLayer?: string; targetLayer?: string }): Promise<SkillOpResult> {
  const result = await invoke<SkillOpResult>("skill_install", { params: { id, ...opts } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "install", skillName: id });
  return result;
}

/** 卸载 */
export async function skillUninstall(id: string, opts?: { targetLayer?: string }): Promise<SkillOpResult> {
  const result = await invoke<SkillOpResult>("skill_uninstall", { params: { id, ...opts } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "uninstall", skillName: id });
  return result;
}

/** 启用 */
export async function skillEnable(id: string): Promise<SkillItem> {
  const result = await invoke<SkillItem>("skill_enable", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "enable", skillName: id });
  return result;
}

/** 禁用 */
export async function skillDisable(id: string): Promise<SkillItem> {
  const result = await invoke<SkillItem>("skill_disable", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "disable", skillName: id });
  return result;
}

/** 钉选 */
export async function skillPin(id: string): Promise<SkillItem> {
  const result = await invoke<SkillItem>("skill_pin", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "pin", skillName: id });
  return result;
}

/** 取消钉选 */
export async function skillUnpin(id: string): Promise<SkillItem> {
  const result = await invoke<SkillItem>("skill_unpin", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "unpin", skillName: id });
  return result;
}

/** 收藏 */
export async function skillFavorite(id: string): Promise<SkillItem> {
  const result = await invoke<SkillItem>("skill_favorite", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "favorite", skillName: id });
  return result;
}

/** 取消收藏 */
export async function skillUnfavorite(id: string): Promise<SkillItem> {
  const result = await invoke<SkillItem>("skill_unfavorite", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "unfavorite", skillName: id });
  return result;
}

/** 同步 */
export async function skillSync(id: string, opts?: { source_layer?: string; target_layer?: string }): Promise<SkillSyncResult> {
  const result = await invoke<SkillSyncResult>("skill_sync", { params: { id, ...opts } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "sync", skillName: id });
  return result;
}

/** 发布 */
export async function skillPublish(id: string, opts?: { source_layer?: string; target_layer?: string; version?: string }): Promise<SkillPublishResult> {
  const result = await invoke<SkillPublishResult>("skill_publish", { params: { id, ...opts } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "publish", skillName: id });
  return result;
}

/** 批量操作 */
export async function skillBatch(operation: string, ids: string[]): Promise<SkillBatchResult> {
  const result = await invoke<SkillBatchResult>("skill_batch", { params: { operation, ids } });
  _listCache.clear(); ids.forEach((id) => _detailCache.delete(id));
  if (operation === "install" || operation === "uninstall" || operation === "enable" || operation === "disable") {
    _emitSkillChange({ operation: "batch", skillNames: ids });
  }
  return result;
}

/** 搜索 */
export async function skillSearch(query: string): Promise<SkillItem[]> {
  return invoke<SkillItem[]>("skill_search", { params: { query } });
}

/** 一键修复 manifest.json（从 SKILL.md 生成） */
export async function skillFixManifest(id: string): Promise<{ ok: boolean; path: string; warnings: string[] }> {
  const result = await invoke<{ ok: boolean; path: string; warnings: string[] }>("skill_fix_manifest", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "fixManifest", skillName: id });
  return result;
}

/** 读取 SKILL.md 原始内容 */
export async function skillReadSkillMd(id: string): Promise<{ ok: boolean; content: string; path: string; warnings: string[] }> {
  return invoke("skill_read_skill_md", { params: { id } });
}

/** 检测同步状态 */
export async function skillCheckSync(id: string): Promise<SyncStateInfo> {
  return invoke("skill_check_sync", { params: { id } });
}

/** 更新已安装 Skill 的 manifest.json */
export async function skillUpdateManifest(id: string, fields: Record<string, unknown>): Promise<{ ok: boolean; path: string; warnings: string[]; errors: string[] }> {
  const result = await invoke<{ ok: boolean; path: string; warnings: string[]; errors: string[] }>("skill_update_manifest", { params: { id, fields } });
  _listCache.clear(); _detailCache.delete(id);
  _emitSkillChange({ operation: "updateManifest", skillName: id });
  return result;
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
  checkSync: skillCheckSync,
  updateManifest: skillUpdateManifest,
};

export type SkillAPIType = typeof SkillAPI;
