// 状态查询 IPC 封装：获取 sidecar 运行状态。

import { invoke } from "@tauri-apps/api/core";

export interface StatusResponse {
  sidecar_running: boolean;
  port: number;
  openclaw_home: string;
}

/**
 * 查询当前运行状态。
 */
export async function getStatus(): Promise<StatusResponse> {
  return invoke<StatusResponse>("get_status");
}
