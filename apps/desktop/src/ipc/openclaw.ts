// OpenClaw IPC 封装：调用 Tauri Rust 命令，桥接 sidecar JSON-RPC。
// OpenClaw IPC wrapper: invokes Tauri Rust commands that bridge to sidecar JSON-RPC.

import { invoke } from "@tauri-apps/api/core";

/** openclaw.status 返回的聚合状态 */
export interface OpenClawStatus {
  cli_installed: boolean;
  bootstrap_done: boolean;
  gateway_running: boolean;
  version: string;
  supported_version: string;
  version_mismatch: boolean;
  port: number;
  pid: number | null;
  /** EPIC-0001 第二批 #2：当前版本是否提供 Web UI（轻量探测） */
  web_ui_available: boolean;
}

/** openclaw.web.get_url 返回
 *
 * @deprecated STORY-0018 T2：改用 {@link openOpenClawWebUi}。本类型与
 *   {@link getOpenClawWebUrl} 实现保留一个 release 周期供老前端兼容，
 *   2026-Q3 移除。
 */
export interface OpenClawWebUrl {
  available: boolean;
  url: string | null;
  reason: string | null;
}

/** openclaw.agent_preset.status 返回 */
export interface OpenClawAgentPresetStatus {
  installed: boolean;
  version: string | null;
  modifiedByUser: boolean;
  lockPath: string;
}

/** openclaw.agent_preset.reset_default 返回 */
export interface OpenClawAgentPresetResetResult {
  success: boolean;
  action: string;
  version: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// EPIC-0001 第二批 #1 / STORY-0015：设置面板
// ---------------------------------------------------------------------------

/** openclaw.config.dump 聚合返回（apiKey 已脱敏） */
export interface OpenClawConfigDump {
  /** models.providers 节点 */
  providers: Record<string, unknown>;
  /** auth.profiles 节点（token 字段已替成等长 * 串） */
  authProfiles: Record<string, unknown>;
  /** auth.order：provider_id → [profile_id, ...] */
  authOrder: Record<string, string[]>;
  /** agents.defaults 节点（含 model / imageModel / thinkingDefault 等） */
  agentDefaults: Record<string, unknown>;
  /** wrapper extras：providerExtras / authExtras / modelExtras */
  extras: Record<string, unknown>;
}

/** openclaw.config.patch 返回 */
export interface OpenClawConfigPatchResult {
  success: boolean;
  validateError: string | null;
}

/** openclaw.config.test_provider 返回 */
export interface OpenClawConfigTestResult {
  success: boolean;
  latencyMs: number | null;
  modelEcho: string | null;
  error: string | null;
}

/** openclaw.auth.set_token 返回
 *
 * STORY-0018 hot-fix：v2026.5.4 后凭证不再走 `auth.profiles.<id>.token`
 * （schema additionalProperties: false 拒收），改走 `models auth paste-token`
 * 写 `state/agents/<agentId>/agent/auth-profiles.json`。
 */
export interface OpenClawAuthSetTokenResult {
  success: boolean;
  profileId: string | null;
  error: string | null;
}

/** 安装进度事件 */
export interface InstallEvent {
  phase: string;
  name: string;
  percent: number;
  message: string;
}

/** openclaw.install 返回的安装结果 */
export interface OpenClawInstallResult {
  success: boolean;
  version: string;
  prefix: string;
  bin_path: string | null;
  events: InstallEvent[];
  error_code?: string;
  error_message?: string;
}

/** openclaw.bootstrap 返回的结果 */
export interface OpenClawBootstrapResult {
  success: boolean;
  created_dirs: string[];
  config_path: string;
  port: number;
}

/** openclaw.start 返回的结果 */
export interface OpenClawStartResult {
  success: boolean;
  pid: number;
  port: number;
  message: string;
}

/** 查询 OpenClaw 聚合状态 */
export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  return invoke<OpenClawStatus>("openclaw_status");
}

/** 安装 OpenClaw CLI */
export async function installOpenClaw(
  version?: string,
): Promise<OpenClawInstallResult> {
  return invoke<OpenClawInstallResult>("openclaw_install", { version });
}

/** Bootstrap 初始化 */
/** 重装时的保留选项（STORY-0020） */
export interface PreserveOptions {
  preserveProviders?: boolean;
  preserveAuth?: boolean;
  preserveAgents?: boolean;
  preservePlugins?: boolean;
}

export async function bootstrapOpenClaw(
  version?: string,
  preserveOptions?: PreserveOptions,
): Promise<OpenClawBootstrapResult> {
  return invoke<OpenClawBootstrapResult>("openclaw_bootstrap", {
    version,
    preserveOptions: preserveOptions ?? null,
  });
}

/** 启动 OpenClaw gateway */
export async function startOpenClaw(
  port?: number,
): Promise<OpenClawStartResult> {
  return invoke<OpenClawStartResult>("openclaw_start", { port });
}

/** 停止 OpenClaw gateway */
export async function stopOpenClaw(): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>("openclaw_stop");
}

/** 健康检查 */
export async function doctorOpenClaw(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("openclaw_doctor");
}

/** 获取 OpenClaw Control UI 的 URL（带 token）
 *
 * @deprecated STORY-0018 T2：改用 {@link openOpenClawWebUi}。新前端不应再用本函数；
 *   实现保留一个 release 周期供回滚兼容，2026-Q3 移除。
 */
export async function getOpenClawWebUrl(): Promise<OpenClawWebUrl> {
  return invoke<OpenClawWebUrl>("openclaw_web_get_url");
}

/** 查询 Artifex Nexus 默认 agent 预设状态 */
export async function getOpenClawAgentPresetStatus(): Promise<OpenClawAgentPresetStatus> {
  return invoke<OpenClawAgentPresetStatus>("openclaw_agent_preset_status");
}

/** 强制重置 Artifex Nexus 默认 agent 预设（force=true 跳过用户改动检测） */
export async function resetOpenClawAgentPreset(
  force: boolean = true,
): Promise<OpenClawAgentPresetResetResult> {
  return invoke<OpenClawAgentPresetResetResult>(
    "openclaw_agent_preset_reset_default",
    { force },
  );
}

/** 拉取 OpenClaw 全量设置（apiKey 已脱敏，可安全展示） */
export async function dumpOpenClawConfig(): Promise<OpenClawConfigDump> {
  return invoke<OpenClawConfigDump>("openclaw_config_dump");
}

/** 写入 OpenClaw 设置（patch 透传到 `openclaw config patch --stdin`） */
export async function patchOpenClawConfig(
  patch: Record<string, unknown>,
  extrasPatch?: Record<string, unknown>,
): Promise<OpenClawConfigPatchResult> {
  return invoke<OpenClawConfigPatchResult>("openclaw_config_patch", {
    patch,
    extrasPatch: extrasPatch ?? null,
  });
}

/** 测试 provider 连通性 */
export async function testOpenClawProvider(args: {
  providerId: string;
  modelId: string;
  authProfileId?: string;
}): Promise<OpenClawConfigTestResult> {
  return invoke<OpenClawConfigTestResult>("openclaw_config_test_provider", {
    providerId: args.providerId,
    modelId: args.modelId,
    authProfileId: args.authProfileId ?? null,
  });
}

/** 设置 provider API token（写入上游 auth-profiles.json + openclaw.json 元数据）。
 *
 * STORY-0018 hot-fix：上游 v2026.5.4 把 `auth.profiles.<id>` schema 收敛为纯
 * 元数据（`additionalProperties: false`），凭证不能再走 `config patch`。
 * 本函数透传到 sidecar 的 `openclaw.auth.set_token`，spawn
 * `openclaw models auth paste-token --provider <p> --profile-id <id>`，
 * token 经 stdin 传入（不入 argv，避免泄漏到进程列表）。
 *
 * 调用约束：
 * - `token` 必须是用户新输入的明文；脱敏占位（全 `*` 串）会被 sidecar 拒绝
 * - 调用前应先用 {@link patchOpenClawConfig} 写入 profile 元数据（provider + mode）
 */
export async function setOpenClawAuthToken(args: {
  provider: string;
  profileId: string;
  token: string;
  expiresIn?: string;
}): Promise<OpenClawAuthSetTokenResult> {
  return invoke<OpenClawAuthSetTokenResult>("openclaw_auth_set_token", {
    provider: args.provider,
    profileId: args.profileId,
    token: args.token,
    expiresIn: args.expiresIn ?? null,
  });
}

// ---------------------------------------------------------------------------
// STORY-0018 T3：Gateway 状态控制面板 5 个 RPC
// 契约见 docs/specs/openclaw-status-panel.md §2 与
// packages/platform/contracts/schemas/openclaw-gateway-*.schema.json
// ---------------------------------------------------------------------------

/** Gateway 三态枚举（与 sidecar `gateway_state.GatewayState` 对齐） */
export type GatewayState = "running" | "stopped" | "errored";

/** 单条 gateway 日志条目 */
export interface GatewayLogEntry {
  id: number;
  /** unix ts（秒，float） */
  ts: number;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  stream: "stdout" | "stderr";
  text: string;
}

/** openclaw.gateway.status 返回 */
export interface GatewayStatus {
  state: GatewayState;
  pid: number | null;
  port: number | null;
  /** unix ts（秒，float）；前端基于此自算 uptime */
  started_at: number | null;
  /** 当前 buffer 最大 id；前端首次拉日志时用作 since_id 初值 */
  last_log_id: number;
  last_error: string | null;
}

/** openclaw.gateway.start / restart 返回 */
export interface GatewayStartResult {
  success: boolean;
  /** 是否经历 stop+start 重启路径 */
  restarted: boolean;
  pid: number;
  port: number;
  message: string;
}

/** openclaw.gateway.tail_log 返回 */
export interface GatewayLogBatch {
  entries: GatewayLogEntry[];
  /** buffer 当前最大 id；下次轮询用作 since_id */
  max_id: number;
  /** buffer 当前条目数（≤ maxlen） */
  buffer_size: number;
  /** 因 buffer 满被丢弃的累计行数 */
  dropped: number;
}

/** openclaw.web.open 返回（fire-and-forget） */
export interface WebOpenResult {
  success: boolean;
  /** T3 阶段固定 "openclaw_dashboard"，T4 fallback 时可扩展 "tauri_shell" */
  method: string;
  pid: number | null;
  error: string | null;
}

/** 查询 gateway 进程状态（前端 1s 轮询入口） */
export async function getGatewayStatus(): Promise<GatewayStatus> {
  return invoke<GatewayStatus>("openclaw_gateway_status");
}

/** 启动 gateway（幂等：已运行不重启除非 force_restart=true） */
export async function startGateway(args?: {
  forceRestart?: boolean;
  port?: number;
}): Promise<GatewayStartResult> {
  return invoke<GatewayStartResult>("openclaw_gateway_start", {
    forceRestart: args?.forceRestart ?? false,
    port: args?.port ?? null,
  });
}

/** 重启 gateway（等价 startGateway({forceRestart: true})） */
export async function restartGateway(args?: {
  port?: number;
}): Promise<GatewayStartResult> {
  return invoke<GatewayStartResult>("openclaw_gateway_restart", {
    port: args?.port ?? null,
  });
}

/** 增量拉取 gateway 日志
 *
 * - `n` 与 `sinceId` **互斥**：同传时 sidecar 优先 sinceId（spec §2.4）
 * - 首次拉取传 `{ n: 200 }`；后续轮询传 `{ sinceId: lastBatch.max_id }`
 */
export async function tailGatewayLog(args?: {
  n?: number;
  sinceId?: number;
}): Promise<GatewayLogBatch> {
  return invoke<GatewayLogBatch>("openclaw_gateway_tail_log", {
    n: args?.n ?? null,
    sinceId: args?.sinceId ?? null,
  });
}

/** 让 OpenClaw CLI 自开浏览器到 dashboard
 *
 * fire-and-forget：success 仅代表 spawn 成功，不代表浏览器一定打开。
 * 失败时（CLI 未装 / spawn OSError）返回 `{success: false, error}`，
 * 前端可在此处 fallback 到 `tauri-shell.open(url)`（待 STORY-0018 T4 接入）。
 */
export async function openOpenClawWebUi(): Promise<WebOpenResult> {
  return invoke<WebOpenResult>("openclaw_web_open");
}

// ---------------------------------------------------------------------------
// STORY-0019：远端模型列表获取
// ---------------------------------------------------------------------------

/** 远端模型信息 */
export interface RemoteModelInfo {
  id: string;
  name?: string;
  ownedBy?: string;
}

/** 远端模型列表获取结果 */
export interface FetchRemoteModelsResult {
  success: boolean;
  models?: RemoteModelInfo[];
  error?: string;
}

/** 从远端 provider 的 OpenAI 兼容 /models 端点获取模型列表。
 *
 * STORY-0019：前端"获取模型列表"按钮调用入口。
 * 对于不支持该端点的 provider（如网易 CodeMaker，返回 404），
 * 会 graceful 返回 `{success: false, error: "..."}` 而不是 throw。
 *
 * 调用前提：provider 的 baseUrl 和 token 已保存（需要先保存一次）。
 */
export async function fetchRemoteModels(args: {
  baseUrl: string;
  token: string;
}): Promise<FetchRemoteModelsResult> {
  return invoke<FetchRemoteModelsResult>("openclaw_models_fetch_remote", {
    baseUrl: args.baseUrl,
    token: args.token,
  });
}

// ---------------------------------------------------------------------------
// STORY-0027 M2：Blender DCC 安装器 IPC
// ---------------------------------------------------------------------------

/** 单个 Blender 版本检测结果 */
export interface BlenderVersionInfo {
  version: string;
  installed: boolean;
  compatible: boolean;
  compat_reason: string;
}

/** 插件元信息 */
export interface BlenderAddonInfo {
  name: string;
  version: string;
  blender_min: string;
  blender_max: string | null;
}

/** openclaw.dcc.blender.detect 返回 */
export interface BlenderDetectResult {
  versions: BlenderVersionInfo[];
  addon_info: BlenderAddonInfo;
}

/** openclaw.dcc.blender.install 返回 */
export interface BlenderInstallResult {
  success: boolean;
  method: "copy" | null;
  target: string;
  error: string | null;
}

/** openclaw.dcc.blender.uninstall 返回 */
export interface BlenderUninstallResult {
  success: boolean;
  target: string;
  error: string | null;
  message?: string;
}

/** 检测本机 Blender 版本及插件安装状态 */
export async function detectBlenderVersions(): Promise<BlenderDetectResult> {
  return invoke<BlenderDetectResult>("openclaw_dcc_blender_detect");
}

/** 安装 Artifex Nexus 插件到指定 Blender 版本 */
export async function installBlenderAddon(
  version: string,
  force?: boolean,
): Promise<BlenderInstallResult> {
  return invoke<BlenderInstallResult>("openclaw_dcc_blender_install", {
    version,
    force: force ?? false,
  });
}

/** 卸载 Artifex Nexus 插件 */
export async function uninstallBlenderAddon(
  version: string,
): Promise<BlenderUninstallResult> {
  return invoke<BlenderUninstallResult>("openclaw_dcc_blender_uninstall", {
    version,
  });
}

// ---------------------------------------------------------------------------
// STORY-0029 M2：DCC 端口管理 IPC
// ---------------------------------------------------------------------------

/** DCC 端口配置 */
export interface DCCPortConfig {
  port: number;
  url: string;
  server_name: string;
}

/** 端口设置结果 */
export interface DCCPortSetResult {
  success: boolean;
  port: number;
  url: string;
  error: string | null;
  updated_servers?: string[];
}

/** 获取 DCC MCP Server 端口配置 */
export async function getDCCPort(dcc: string): Promise<DCCPortConfig> {
  return invoke<DCCPortConfig>("openclaw_dcc_port_get", { dcc });
}

/** 设置 DCC MCP Server 端口 */
export async function setDCCPort(
  dcc: string,
  port: number,
): Promise<DCCPortSetResult> {
  return invoke<DCCPortSetResult>("openclaw_dcc_port_set", { dcc, port });
}
