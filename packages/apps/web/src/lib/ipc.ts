/**
 * IPC 动态加载器 — 避免 Next.js SSR 时 @tauri-apps/api 报错
 *
 * 使用方式：
 *   import { getIpc } from "@/lib/ipc";
 *   const { getOpenClawStatus } = await getIpc();
 *   const status = await getOpenClawStatus();
 */

let _ipc: any = null;

export async function getIpc() {
  if (_ipc) return _ipc;
  _ipc = await import("../ipc/openclaw");
  return _ipc;
}
