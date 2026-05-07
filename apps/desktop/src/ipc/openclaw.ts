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

/** openclaw.web.get_url 返回 */
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
export async function bootstrapOpenClaw(
  version?: string,
): Promise<OpenClawBootstrapResult> {
  return invoke<OpenClawBootstrapResult>("openclaw_bootstrap", { version });
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

/** 获取 OpenClaw Control UI 的 URL（带 token） */
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
