// Echo IPC 封装：调用 Rust Tauri Command。
// 骨架阶段：直接 invoke echo 命令。

import { invoke } from "@tauri-apps/api/core";

/**
 * Echo 命令：发送消息到 Rust 后端并获取回显。
 * 骨架阶段不经过 sidecar，直接 Rust 回显。
 */
export async function echo(message: string): Promise<string> {
  return invoke<string>("echo", { message });
}
