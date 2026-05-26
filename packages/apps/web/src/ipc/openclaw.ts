// OpenClaw IPC 封装：调用 Tauri Rust 命令，桥接 sidecar JSON-RPC。
// OpenClaw IPC wrapper: invokes Tauri Rust commands that bridge to sidecar JSON-RPC.
//
// 从 apps/desktop/src/ipc/openclaw.ts 复制，完全一致。
// 注意：此文件依赖 @tauri-apps/api，仅在 Tauri webview 中可用。
// 浏览器开发环境请使用 mock 数据。

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

/** 写入 OpenClaw 设置（patch 透传到 `openclaw config patch --stdin`）。
 *
 * @param replacePaths 可选；让指定 dot/bracket 路径下的 object/array **整体替换**
 *   而非递归 merge。前端"删除 provider / 删除 model"应：
 *   - patch 里给被删父路径一个不含被删项的新值
 *   - 同时把该父路径加进 replacePaths（如 `["models.providers"]` 或
 *     `["models.providers.custom.models"]`）
 */
export async function patchOpenClawConfig(
  patch: Record<string, unknown>,
  extrasPatch?: Record<string, unknown>,
  replacePaths?: string[],
): Promise<OpenClawConfigPatchResult> {
  return invoke<OpenClawConfigPatchResult>("openclaw_config_patch", {
    patch,
    extrasPatch: extrasPatch ?? null,
    replacePaths: replacePaths && replacePaths.length > 0 ? replacePaths : null,
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
// STORY-0039 M3：Chat WS 连接凭据
// ---------------------------------------------------------------------------

/** openclaw.gateway.auth_info 返回 */
export interface GatewayAuthInfo {
  /** Gateway 实际监听端口（反映端口迁移后的真实值） */
  port: number;
  /** Gateway auth token；`auth_mode !== "token"` 或未配置时为空串 */
  token: string;
  /** "token" / "none" / "" 未配置 */
  auth_mode: string;
}

/** 获取 Gateway WS 握手所需凭据（port + token）。
 *
 * STORY-0039：前端 ChatView 直连 Gateway WS 需要 `auth.token`，token 存在
 * `~/.artifexnexus/.openclaw/openclaw.json` → `gateway.auth.token`。
 * 本命令经 Tauri sidecar 从 openclaw.json 读取，仅在本机进程间流转。
 */
export async function getGatewayAuthInfo(): Promise<GatewayAuthInfo> {
  return invoke<GatewayAuthInfo>("openclaw_gateway_auth_info");
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
 * Bug #2 修复：新增 providerId 参数。当 token 为空或脱敏占位时，
 * sidecar 会自动从 auth-profiles.json 中读取已保存的真实 token。
 *
 * 调用前提：provider 的 baseUrl 和 token 已保存（需要先保存一次）。
 */
export async function fetchRemoteModels(args: {
  baseUrl: string;
  token: string;
  providerId?: string;
}): Promise<FetchRemoteModelsResult> {
  return invoke<FetchRemoteModelsResult>("openclaw_models_fetch_remote", {
    baseUrl: args.baseUrl,
    token: args.token,
    providerId: args.providerId ?? null,
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
// STORY-0051 M5：UE 插件安装/卸载 IPC
// ---------------------------------------------------------------------------

/** UE 版本检测结果 */
export interface UEDetectResult {
  versions: Array<{
    version: string;
    source_dir: string;
    compatible: boolean;
    compat_reason: string;
  }>;
  plugin_info: {
    name: string;
    version: string;
    ue_min: string;
    ue_max: string;
  };
}

/** UE 插件安装结果 */
export interface UEInstallResult {
  success: boolean;
  source_dir: string;
  target: string;
  error: string | null;
}

/** UE 插件卸载结果 */
export interface UEUninstallResult {
  success: boolean;
  target: string;
  error: string | null;
  message?: string;
}

/** 检测可用 UE 插件版本 */
export async function detectUEVersions(): Promise<UEDetectResult> {
  return invoke<UEDetectResult>("openclaw_dcc_unreal_detect");
}

/** 安装 UE 插件到指定项目目录 */
export async function installUEPlugin(
  version: string,
  projectPath: string,
  force?: boolean,
): Promise<UEInstallResult> {
  return invoke<UEInstallResult>("openclaw_dcc_unreal_install", {
    version,
    projectPath,
    force: force ?? false,
  });
}

/** 卸载 UE 插件 */
export async function uninstallUEPlugin(
  version: string,
  projectPath: string,
  keepLib?: boolean,
): Promise<UEUninstallResult> {
  return invoke<UEUninstallResult>("openclaw_dcc_unreal_uninstall", {
    version,
    projectPath,
    keepLib: keepLib ?? false,
  });
}

// ── UE 插件安装状态检查 ────────────────────────────────────────────────

export interface UnrealPluginCheckResult {
  installed: boolean;
  target: string;
}

/** 检查 UE 插件是否已安装到指定项目（纯文件系统检查，不依赖 sidecar） */
export async function checkUnrealPluginInstalled(
  projectPath: string,
): Promise<UnrealPluginCheckResult> {
  return invoke<UnrealPluginCheckResult>("check_ue_plugin_installed", {
    projectPath,
  });
}

/** 验证 UE 工程路径是否有效（目录存在 + 含 .uproject） */
export async function validateUEProjectPath(
  projectPath: string,
): Promise<{ valid: boolean; error: string | null }> {
  return invoke<{ valid: boolean; error: string | null }>("validate_ue_project_path", {
    projectPath,
  });
}

// ---------------------------------------------------------------------------
// STORY-0063/0064 M7：Maya & 3ds Max IPC
// ---------------------------------------------------------------------------

/** 通用 DCC 检测/安装/卸载结果类型（Maya, 3ds Max） */
export interface DCCDetectResult {
  versions: Array<{
    version: string;
    installed: boolean;
    compatible: boolean;
    compat_reason: string;
  }>;
  addon_info: {
    name: string;
    version: string;
    dcc_min: string;
    dcc_max: string | null;
  };
}

export interface DCCInstallResult {
  success: boolean;
  method: "copy" | null;
  target: string;
  error: string | null;
  locale_synced?: string[];
  startup_scripts?: string[];
}

export interface DCCUninstallResult {
  success: boolean;
  target: string;
  error: string | null;
  message?: string;
}

// ── Maya ──

/** 检测本机 Maya 版本及插件安装状态 */
export async function detectMayaVersions(): Promise<DCCDetectResult> {
  return invoke<DCCDetectResult>("openclaw_dcc_maya_detect");
}

/** 安装 Artifex Nexus 插件到指定 Maya 版本 */
export async function installMayaAddon(
  version: string,
  force?: boolean,
): Promise<DCCInstallResult> {
  return invoke<DCCInstallResult>("openclaw_dcc_maya_install", {
    version,
    force: force ?? false,
  });
}

/** 卸载指定 Maya 版本的 Artifex Nexus 插件 */
export async function uninstallMayaAddon(
  version: string,
): Promise<DCCUninstallResult> {
  return invoke<DCCUninstallResult>("openclaw_dcc_maya_uninstall", {
    version,
  });
}

// ── 3ds Max ──

/** 检测本机 3ds Max 版本及插件安装状态 */
export async function detectMaxVersions(): Promise<DCCDetectResult> {
  return invoke<DCCDetectResult>("openclaw_dcc_max_detect");
}

/** 安装 Artifex Nexus 插件到指定 3ds Max 版本 */
export async function installMaxAddon(
  version: string,
  force?: boolean,
): Promise<DCCInstallResult> {
  return invoke<DCCInstallResult>("openclaw_dcc_max_install", {
    version,
    force: force ?? false,
  });
}

/** 卸载指定 3ds Max 版本的 Artifex Nexus 插件 */
export async function uninstallMaxAddon(
  version: string,
): Promise<DCCUninstallResult> {
  return invoke<DCCUninstallResult>("openclaw_dcc_max_uninstall", {
    version,
  });
}

// ── 插件版本查询 ──

/** 插件版本项 */
export interface PluginVersionInfo {
  version: string;
  dcc_min: string;
  dcc_max: string | null;
  path: string;
}

/** 获取指定 DCC 所有可用的插件版本及兼容范围 */
export async function getAvailablePluginVersions(
  dcc: string,
): Promise<{ versions: PluginVersionInfo[] }> {
  return invoke<{ versions: PluginVersionInfo[] }>(
    "openclaw_dcc_plugin_versions",
    { dcc },
  );
}

/** 精简版插件信息（用于列表展示） */
export interface PluginSummary {
  dcc: string;
  dcc_name: string;
  version: string;
  dcc_min: string;
  dcc_max: string | null;
  path: string;
  overridden: boolean;
  builtin_dcc_min: string;
  builtin_dcc_max: string | null;
}

/** 获取所有 DCC 所有版本的插件兼容信息 */
export async function getAllPluginsWithCompat(): Promise<{ plugins: PluginSummary[] }> {
  return invoke<{ plugins: PluginSummary[] }>("openclaw_dcc_plugin_all", {});
}

/** 更新指定插件的兼容范围 */
export async function updatePluginCompatibility(
  dcc: string,
  version: string,
  dcc_min: string,
  dcc_max: string | null,
): Promise<{ ok: boolean; message: string }> {
  return invoke<{ ok: boolean; message: string }>(
    "openclaw_dcc_plugin_compat_update",
    { dcc, version, dccMin: dcc_min, dccMax: dcc_max },
  );
}

/** 重置指定插件的兼容范围为默认值 */
export async function resetPluginCompatibility(
  dcc: string,
  version: string,
): Promise<{ ok: boolean; message: string }> {
  return invoke<{ ok: boolean; message: string }>(
    "openclaw_dcc_plugin_compat_reset",
    { dcc, version },
  );
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

// ── STORY-0030：部署文件校验 ─────────────────────────────────────────────

/** 单个部署项的校验结果 */
export interface DeployValidationItem {
  id: string;
  status: "ok" | "outdated" | "missing" | "corrupted";
  target: string;
  sourceVersion: string;
  currentVersion?: string;
  deployedAt: string;
  details: string;
  missing_files?: string[];
  corrupted_files?: string[];
}

/** 全局部署校验返回 */
export interface DeployValidationResult {
  deployments: DeployValidationItem[];
  summary: {
    total: number;
    ok: number;
    outdated: number;
    missing: number;
    corrupted: number;
  };
}

/** 全局部署文件校验：对比 deploy-manifest.json 与磁盘 sha256 */
export async function validateDeployments(): Promise<DeployValidationResult> {
  return invoke<DeployValidationResult>("openclaw_deploy_validate");
}

/** 修复（重新部署）指定部署项 */
export async function repairDeployment(depId: string): Promise<{ success: boolean; error?: string; message?: string }> {
  return invoke("openclaw_deploy_repair", { depId });
}

// ── Sidecar 状态 ───────────────────────────────────────────────────────────

/** sidecar 运行状态（对齐 apps/desktop/src/ipc/status.ts） */
export interface StatusResponse {
  sidecar_running: boolean;
  port: number;
  openclaw_home: string;
}

/** 查询 sidecar 运行状态 */
export async function getStatus(): Promise<StatusResponse> {
  return invoke<StatusResponse>("get_status");
}

// ── MCP Bridge 状态 ────────────────────────────────────────────────────────

/** MCP Bridge 状态（含 Blender / UE / Maya / Max 连通性） */
export interface MCPBridgeStatus {
  installed: boolean;
  blenderConnected: boolean;
  blenderServerRunning: boolean;
  blenderAddress: string;
  blenderError: string | null;
  unrealServerRunning: boolean;
  unrealConnected: boolean;
  unrealAddress: string;
  unrealError: string | null;
  mayaServerRunning: boolean;
  mayaConnected: boolean;
  mayaAddress: string;
  mayaError: string | null;
  maxServerRunning: boolean;
  maxConnected: boolean;
  maxAddress: string;
  maxError: string | null;
  upToDate: boolean;
  sourceHash: string | null;
  deployedHash: string | null;
}

/** 查询 MCP Bridge 插件部署及 DCC（Blender / UE）连通性状态 */
export async function getMCPBridgeStatus(): Promise<MCPBridgeStatus> {
  return invoke<MCPBridgeStatus>("openclaw_gateway_mcp_bridge_status");
}

/** 安装/重装 MCP Bridge 插件 */
export async function installGatewayMCPBridge(): Promise<{ success: boolean; target: string; error: string | null }> {
  return invoke("openclaw_gateway_mcp_bridge_install");
}

/** 卸载 MCP Bridge 插件 */
export async function uninstallGatewayMCPBridge(): Promise<{ success: boolean; target: string; error: string | null }> {
  return invoke("openclaw_gateway_mcp_bridge_uninstall");
}

// ---------------------------------------------------------------------------
// STORY-0039 M3：对话列表管理
// ---------------------------------------------------------------------------

/** 单个对话摘要 */
export interface SessionSummary {
  sessionKey: string;
  sessionId: string;
  title: string;
  /** unix ts（毫秒） */
  createdAt: number;
  /** unix ts（毫秒） */
  updatedAt: number;
  model: string;
  modelProvider: string;
  status: string;
  totalTokens: number;
  /** agent ID（从 sessions.json 所在目录提取，用于前端按 agent 筛选） */
  agentId?: string;
  /** sidecar 返回：transcript .jsonl 文件是否存在（布尔值） */
  hasTranscript?: boolean;
}

/** openclaw.sessions.list 返回 */
export interface SessionsListResult {
  sessions: SessionSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** 获取 Gateway 对话列表（从 sessions.json 读取，按最近活跃排序）。
 *
 * STORY-0039：ChatControlBar 对话切换器使用此命令获取可切换的对话列表。
 * 数据源是 Gateway 的 sessions.json（唯一真相），通过 sidecar RPC 读取。
 */
export async function getSessionsList(args?: {
  agentId?: string;
  offset?: number;
  limit?: number;
}): Promise<SessionsListResult> {
  return invoke<SessionsListResult>("openclaw_sessions_list", {
    agentId: args?.agentId ?? null,
    offset: args?.offset ?? null,
    limit: args?.limit ?? null,
  });
}

/** 获取指定对话的历史消息（从 session transcript .jsonl 文件读取）。
 *
 * STORY-0039：切换或加载对话时自动获取历史消息。
 * 数据源是 Gateway 的 session transcript 文件（.jsonl）。
 */
export async function getSessionsHistory(args: {
  sessionKey: string;
  agentId?: string;
  limit?: number;
}): Promise<{ messages: Array<{ id: string; role: string; content: string; timestamp: string }> }> {
  return invoke<{ messages: Array<{ id: string; role: string; content: string; timestamp: string }> }>(
    "openclaw_sessions_history",
    {
      sessionKey: args.sessionKey,
      agentId: args.agentId ?? null,
      limit: args.limit ?? null,
    }
  );
}

// ── STORY-0041：备份-安装-恢复 ─────────────────────────────────────────────

/** 备份时的保留选项（5 项，Provider+Auth 合并） */
export interface BackupPreserveOptions {
  preserveProvidersAndAuth?: boolean;
  preserveAgents?: boolean;
  preservePluginsAndMemory?: boolean;
  preserveMCPServers?: boolean;
  preserveSkills?: boolean;
}

/** openclaw.backup 返回 */
export interface BackupResult {
  success: boolean;
  backup_dir: string;
  timestamp: string;
  total_size_bytes: number;
  items: string[];
  /** 单文件失败数（被锁/无权限） */
  skipped_count?: number;
  skipped?: Array<{ path: string; error: string }>;
  /** 整个 .openclaw/ 的安全网快照（永久保留，最多 3 份） */
  full_snapshot?: {
    success: boolean;
    snapshot_dir?: string | null;
    timestamp?: string;
    file_count?: number;
    skipped_count?: number;
    total_size_bytes?: number;
    skipped_full_snapshot?: boolean;
  } | null;
  error?: string;
}

/** openclaw.restore 返回 */
export interface RestoreResult {
  success: boolean;
  message: string;
  errors?: Array<{ item: string; error: string }> | null;
  error?: string;
}

/** 备份列表项 */
export interface BackupInfo {
  timestamp: string;
  size_bytes: number;
  item_count: number;
  items: string[];
  created: number;
}

/** openclaw.backups.list 返回 */
export interface BackupsListResult {
  backups: BackupInfo[];
}

/** 删除备份返回 */
export interface BackupDeleteResult {
  success: boolean;
  message?: string;
  error?: string;
}

/** 备份 OpenClaw 用户数据（Phase 1） */
export async function backupOpenClaw(
  preserveOptions: BackupPreserveOptions,
): Promise<BackupResult> {
  return invoke<BackupResult>("openclaw_backup", {
    preserveOptions,
  });
}

/** 恢复 OpenClaw 用户数据（Phase 2-3：全新安装 + 恢复） */
export async function restoreOpenClaw(args: {
  backupTimestamp: string;
  preserveOptions: BackupPreserveOptions;
  version?: string;
}): Promise<RestoreResult> {
  return invoke<RestoreResult>("openclaw_restore", {
    backupTimestamp: args.backupTimestamp,
    preserveOptions: args.preserveOptions,
    version: args.version ?? null,
  });
}

/** 列出所有备份 */
export async function listOpenClawBackups(): Promise<BackupsListResult> {
  return invoke<BackupsListResult>("openclaw_backups_list");
}

/** 删除指定备份 */
export async function deleteOpenClawBackup(
  timestamp: string,
): Promise<BackupDeleteResult> {
  return invoke<BackupDeleteResult>("openclaw_backups_delete", { timestamp });
}

// ── 通用 invoke（仅新 UI 用于少数未封装的命令） ────────────────────────────

export { invoke };

// ── Shell 配置持久化（~/.artifexnexus/config/shell.json） ──────────────────

// ── 应用级设置（"设置 → 常规"页） ─────────────────────────────────────────

/** 应用设置字段（与 sidecar app_settings.py DEFAULT_SETTINGS 对齐） */
export interface AppSettings {
  /** 通用 nexus-tool 默认超时（秒），范围 1~86400 */
  nexusToolDefaultTimeoutSec: number;
  /** 最大并发 nexus-tool 数，范围 1~64 */
  nexusToolMaxConcurrent: number;
  /** cancel 时是否递归杀子进程 */
  nexusToolKillProcessTree: boolean;
  /** sidecar 日志等级 */
  logLevel: string;
  // ── UI 偏好（跨启动持久化） ────────────────────────────────────────
  skillViewMode?: "card" | "list";
  toolViewMode?: "card" | "list";
  skillFavoritesOnly?: boolean;
  toolFavoritesOnly?: boolean;
}

/** app.settings.get / set / reset 返回 */
export interface AppSettingsResponse {
  settings: AppSettings;
  defaults: AppSettings;
  path: string;
}

/** 读取应用设置 */
export async function getAppSettings(): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("app_settings_get");
}

/** 部分更新应用设置（patch 可只含部分字段） */
export async function setAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("app_settings_set", { patch });
}

/** 重置应用设置为默认值 */
export async function resetAppSettings(): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("app_settings_reset");
}

// ── Shell 配置持久化（~/.artifexnexus/config/shell.json） ──────────────────

export interface ShellConfig {
  panelOpen?: boolean;
  sidebarCollapsed?: boolean;
}

export async function readShellConfig(): Promise<ShellConfig> {
  const raw = await invoke<string>("read_shell_config");
  return JSON.parse(raw);
}

export async function writeShellConfig(config: ShellConfig): Promise<void> {
  await invoke("write_shell_config", { json: JSON.stringify(config) });
}
