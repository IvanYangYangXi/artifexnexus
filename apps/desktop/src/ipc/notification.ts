// 通知推送 IPC 封装：调用 Tauri push_notification 命令。
// 外部脚本 / OpenClaw cron 任务可通过此 API 触发前端 toast 提示 + 通知历史记录。

import { invoke } from "@tauri-apps/api/core";

/** 通知类型 */
export type NotificationType = "info" | "success" | "warning" | "error";

/** 推送通知参数 */
export interface PushNotificationParams {
  title: string;
  message: string;
  type: NotificationType;
  source?: string;
}

/**
 * 推送一条通知到 Artifex Nexus 桌面应用。
 *
 * 调用 Tauri Rust 命令 `push_notification`，Rust 层通过
 * Tauri 事件 emit("notification-received") 推送到前端 WebView，
 * 前端 NotificationProvider 接收并写入通知历史 + 触发 toast 泡泡。
 *
 * 使用示例：
 * ```ts
 * import { pushNotification } from "./ipc/notification";
 *
 * await pushNotification({
 *   title: "备份完成",
 *   message: "数据库备份成功，大小 2.3GB",
 *   type: "success",
 *   source: "cron:daily-backup",
 * });
 * ```
 */
export async function pushNotification(params: PushNotificationParams): Promise<void> {
  // Tauri invoke 要求参数字段名为 snake_case（req 是嵌套对象）
  await invoke("push_notification", {
    req: {
      title: params.title,
      message: params.message,
      type: params.type,       // serde rename("type") → 序列化为 "type"
      source: params.source ?? null,
    },
  });
}
