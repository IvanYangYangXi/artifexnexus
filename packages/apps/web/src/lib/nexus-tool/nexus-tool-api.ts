/**
 * Nexus-Tool API — 封装 Tauri invoke → sidecar RPC 调用。
 *
 * 通信链路：Browser → Tauri IPC → Rust #[tauri::command] → sidecar JSON-RPC
 * 依赖 @tauri-apps/api，仅在 Tauri WebView 中可用。
 */

import { invoke } from "@tauri-apps/api/core";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 目标 DCC 条目（支持版本约束） */
export interface DCCEntry {
  dcc: string;
  minVersion?: string;
  maxVersion?: string;
}

export interface NexusToolParam {
  id: string;
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** 实例专属：是否继承源工具当前默认值 */
  useSourceDefault?: boolean;
}

export interface NexusToolOutput {
  id: string;
  name: string;
  type: string;
}

/** 触发器类型 */
export type TriggerType = "event" | "schedule" | "watch";

/** 执行模式 */
export type ExecutionMode = "silent" | "notify";

/** 定时调度配置 */
export interface ScheduleConfig {
  type: "interval" | "cron" | "once";
  interval?: string;
  cron?: string;
  runAt?: string;
}

/** Nexus 触发器（扁平格式，对齐 ArtClaw） */
export interface NexusToolTrigger {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: TriggerType;
  dcc: string;
  eventType: string;
  executionMode: ExecutionMode;
  useDefaultFilters: boolean;
  /** 触发器级自定义筛选条件（仅 useDefaultFilters=false 时生效） */
  conditions?: FilterConfig;
  /** 定时调度配置（仅 triggerType=schedule 时生效） */
  scheduleConfig?: ScheduleConfig;
  /** 文件监听轮询周期（秒），范围 1~300。仅 triggerType=watch 时生效。
   *  缺省时 fallback 到 app.settings.nexusToolWatcherPollIntervalSec。 */
  pollIntervalSec?: number;
  /** 监听事件类型列表，仅 triggerType=watch 时生效，默认 ["created","modified"] */
  watchEvents?: string[];
  /** 触发器命中后的防抖间隔（毫秒），仅 triggerType=watch 时生效 */
  debounceMs?: number;
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
  software: DCCEntry[];
  status: string;
  nexus_tool_path: string;
  is_enabled: boolean;
  is_pinned: boolean;
  is_favorited: boolean;
  use_count: number;
  author: string;
  created_at: string;
  updated_at: string;
  /** 标签列表 */
  tags: string[];
  /** manifest 详情 — ToolDetailPanel 的 Info/Params/Presets/Triggers 数据源 */
  inputs?: NexusToolParam[];
  outputs?: NexusToolOutput[];
  triggers?: NexusToolTrigger[];
  default_filters?: FilterConfig;
  implementation?: NexusToolImplementation;
  /** 工具实例元数据（仅另存为实例时存在） */
  instance_of?: string;
  parent_name?: string;
  parent_path?: string;
  /** Python 依赖列表（PEP 508 格式） */
  dependencies?: string[];
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

/** nexus-tool.run 异步启动返回 */
export interface NexusToolRunStartResult {
  task_id: string;
  status: "started" | "dependency_missing";
  missing_deps?: string[];
  /** 多 DCC 标记时的提示信息 */
  warning?: string;
}

/** nexus-tool.result 轮询返回 */
export interface NexusToolPollResult {
  task_id: string;
  status: "running" | "done" | "error" | "cancelled" | "dependency_missing" | "installing_deps";
  result?: NexusToolRunResult;
  error?: string;
  missing_deps?: string[];
  message?: string;
  failed_deps?: string[];
}

/** nexus-tool.ack 确认返回 */
export interface NexusToolAckResult {
  task_id: string;
  acked: boolean;
}

/** nexus-tool.cancel 取消返回 */
export interface NexusToolCancelResult {
  task_id: string;
  status: string;
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
  software?: DCCEntry[];
  manifest?: Record<string, unknown>;
}

export interface NexusToolUpdateOptions {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  /** source 由文件系统决定，仅 user→user 可修改 */
  source?: string;
  software?: DCCEntry[];
  manifest?: Record<string, unknown>;
  /** 快捷字段：触发器列表（会合并到 manifest.triggers） */
  triggers?: NexusToolTrigger[];
}

/** nexus-tool.check-deps 返回 */
export interface NexusToolCheckDepsResult {
  all_ok: boolean;
  missing: string[];
  message?: string;
}

/** nexus-tool.install-deps 返回 */
export interface NexusToolInstallDepsResult {
  success: boolean;
  installed: string[];
  failed: string[];
  errors?: string[];
}

// ── 筛选条件 ──────────────────────────────────────────────────────────────────

export interface FilterRule {
  pattern: string;
}

export interface SceneRule {
  pattern: string;
  isRegex?: boolean;
}

export interface TypeFilter {
  types: string[];
  dcc?: string;
}

export interface FilterConfig {
  /** 路径规则（工具默认筛选 + 触发器 watch 路径共用） */
  path?: FilterRule[];
  /** ⬇ 以下为触发器内联筛选用，兼容旧工具默认筛选格式 ⬇ */
  /** 筛选 DCC */
  dcc?: string;
  /** 对象类型列表 */
  types?: string[];
  /** 文件筛选规则（事件触发器内联使用） */
  fileRules?: FilterRule[];
  /** 场景对象名称规则（正则） */
  sceneRules?: SceneRule[];
  /** 对象类型筛选（含 DCC） */
  typeFilter?: TypeFilter;
}

// ── 实例参数 ──────────────────────────────────────────────────────────────────

export interface InstanceParam extends NexusToolParam {
  /** 是否继承源工具的当前默认值（实例专属） */
  useSourceDefault?: boolean;
}

/** 另存为实例参数 */
export interface SaveAsInstanceOptions {
  name: string;
  description?: string;
  inputs: NexusToolParam[];
  outputs?: NexusToolOutput[];
  filters: FilterConfig;
  triggers: NexusToolTrigger[];
  implementation?: NexusToolImplementation;
  parentId: string;
  parentName: string;
  parentPath: string;
  software?: DCCEntry[];
  version?: string;
}

export interface NexusToolPublishOptions {
  target?: string;
  version?: string;
  description?: string;
}

// ── 模块级缓存（减少 Tauri IPC 往返次数）─────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 列表/详情缓存 60s（用户切换页面后短时间回来看不需要重新请求）

interface CacheEntry<T> { data: T; ts: number; }

const _listCache = new Map<string, CacheEntry<NexusToolListResult>>();
const _detailCache = new Map<string, CacheEntry<NexusToolDetail>>();

function _cacheKey(filters?: NexusToolListFilters): string { return JSON.stringify(filters ?? {}); }

// ── API 方法 ──────────────────────────────────────────────────────────────────

/** 分页列表 */
export async function nexusToolList(filters?: NexusToolListFilters): Promise<NexusToolListResult> {
  const key = _cacheKey(filters);
  const cached = _listCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const result = await invoke<NexusToolListResult>("nexus_tool_list", { params: filters ?? {} });
  _listCache.set(key, { data: result, ts: Date.now() });
  // 列表更新后使详情缓存失效（数据可能已变）
  _detailCache.clear();
  return result;
}

/** 详情（含完整 manifest：inputs / outputs / presets / triggers） */
export async function nexusToolDetail(id: string): Promise<NexusToolDetail> {
  const cached = _detailCache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const result = await invoke<NexusToolDetail>("nexus_tool_detail", { params: { id } });
  _detailCache.set(id, { data: result, ts: Date.now() });
  return result;
}

/** 创建 */
export async function nexusToolCreate(opts: NexusToolCreateOptions): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_create", { params: opts });
}

/** 更新 */
export async function nexusToolUpdate(id: string, opts: NexusToolUpdateOptions): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_update", { params: { id, ...opts } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 删除 */
export async function nexusToolDelete(id: string): Promise<NexusToolOpResult> {
  const result = await invoke<NexusToolOpResult>("nexus_tool_delete", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 启用 */
export async function nexusToolEnable(id: string): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_enable", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 禁用 */
export async function nexusToolDisable(id: string): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_disable", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 钉选 */
export async function nexusToolPin(id: string): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_pin", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 取消钉选 */
export async function nexusToolUnpin(id: string): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_unpin", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 收藏 */
export async function nexusToolFavorite(id: string): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_favorite", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 取消收藏 */
export async function nexusToolUnfavorite(id: string): Promise<NexusToolItem> {
  const result = await invoke<NexusToolItem>("nexus_tool_unfavorite", { params: { id } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 发布 */
export async function nexusToolPublish(id: string, opts?: NexusToolPublishOptions): Promise<NexusToolPublishResult> {
  const result = await invoke<NexusToolPublishResult>("nexus_tool_publish", { params: { id, ...opts } });
  _listCache.clear(); _detailCache.delete(id);
  return result;
}

/** 运行（异步启动，立即返回 task_id，后端线程执行） */
export async function nexusToolRun(id: string, args?: Record<string, unknown>): Promise<NexusToolRunStartResult> {
  return invoke<NexusToolRunStartResult>("nexus_tool_run", { params: { id, args: args ?? {} } });
}

/** 轮询任务结果 */
export async function nexusToolResult(taskId: string): Promise<NexusToolPollResult> {
  return invoke<NexusToolPollResult>("nexus_tool_result", { params: { task_id: taskId } });
}

/** 取消运行中任务 */
export async function nexusToolCancel(taskId: string): Promise<NexusToolCancelResult> {
  return invoke<NexusToolCancelResult>("nexus_tool_cancel", { params: { task_id: taskId } });
}

/** 确认已收到结果，清理服务端存储 */
export async function nexusToolAck(taskId: string): Promise<NexusToolAckResult> {
  return invoke<NexusToolAckResult>("nexus_tool_ack", { params: { task_id: taskId } });
}

/** 批量操作 */
export async function nexusToolBatch(operation: string, ids: string[]): Promise<NexusToolBatchResult> {
  return invoke<NexusToolBatchResult>("nexus_tool_batch", { params: { operation, ids } });
}

/** 实时查询 DCC 对象类型（通过 MCP Bridge run_python） */
export async function fetchDccObjectTypes(dcc: string): Promise<string[]> {
  const result = await invoke<{ success: boolean; data?: { stdout?: string }; error?: string }>(
    "nexus_tool_fetch_types",
    { params: { dcc } },
  );
  if (!result.success || !result.data?.stdout) return [];
  // 解析 Python print 输出的类型列表（每行一个类型名）
  return result.data.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** 保存触发器列表到 manifest */
export async function nexusToolSaveTriggers(id: string, triggers: NexusToolTrigger[]): Promise<NexusToolItem> {
  return invoke<NexusToolItem>("nexus_tool_update", { params: { id, triggers } });
}

/** 另存为工具实例 — 创建新的 user nexus-tool，复制完整参数+筛选+触发器 */
export async function nexusToolSaveAsInstance(opts: SaveAsInstanceOptions): Promise<NexusToolItem> {
  const manifest: Record<string, unknown> = {
    inputs: opts.inputs,
    outputs: opts.outputs || [],
    defaultFilters: opts.filters,
    triggers: opts.triggers,
    implementation: {
      ...(opts.implementation || {}),
      sourceTool: opts.parentId,
    },
    instanceOf: opts.parentId,
    parentName: opts.parentName,
    parentPath: opts.parentPath,
  };
  return invoke<NexusToolItem>("nexus_tool_create", {
    params: {
      name: opts.name,
      description: opts.description || "",
      version: opts.version || "1.0.0",
      source: "user",
      software: opts.software || [],
      manifest,
    },
  });
}

/** 检查 Nexus Tool 的 Python 依赖 */
export async function nexusToolCheckDeps(id: string): Promise<NexusToolCheckDepsResult> {
  return invoke<NexusToolCheckDepsResult>("nexus_tool_check_deps", { params: { id } });
}

/** 安装 Nexus Tool 的 Python 依赖 */
export async function nexusToolInstallDeps(id: string): Promise<NexusToolInstallDepsResult> {
  return invoke<NexusToolInstallDepsResult>("nexus_tool_install_deps", { params: { id } });
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
  saveTriggers: nexusToolSaveTriggers,
  saveAsInstance: nexusToolSaveAsInstance,
  checkDeps: nexusToolCheckDeps,
  installDeps: nexusToolInstallDeps,
};

export type NexusToolAPIType = typeof NexusToolAPI;
