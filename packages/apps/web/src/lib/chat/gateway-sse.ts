/**
 * Gateway SSE 流式聊天客户端
 *
 * 使用 Gateway 的 OpenAI 兼容 HTTP API：
 *   POST http://127.0.0.1:{port}/v1/chat/completions
 *
 * 优势：无需 WebSocket 握手，无 client 白名单，无 origin 检查，无 device identity。
 * 直接用 fetch + ReadableStream 解析 SSE 流。
 *
 * OpenClaw Gateway v2026.5.4 完全兼容此端点。
 */

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** SSE chunk 回调 */
export interface StreamCallbacks {
  /** 收到增量文本 */
  onDelta: (text: string) => void;
  /** 流结束 */
  onDone: () => void;
  /** 出错 */
  onError: (error: string) => void;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

const CHAT_TIMEOUT = 300_000; // 5 分钟

// ─── 客户端 ────────────────────────────────────────────────────────────────

/** 当前的 AbortController（用于取消） */
let currentController: AbortController | null = null;

/**
 * 发送流式聊天请求
 *
 * @returns `true` 表示成功发送，`false` 表示失败
 */
export async function streamChat(
  port: number,
  messages: Array<{ role: string; content: string }>,
  callbacks: StreamCallbacks,
  options?: {
    model?: string;
    token?: string;
  },
): Promise<boolean> {
  // 取消上一个请求
  abortStream();

  const controller = new AbortController();
  currentController = controller;
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    if (options?.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }

    const response = await fetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: options?.model ?? "gpt-4o",
          messages,
          stream: true,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      callbacks.onError(`Gateway 返回 ${response.status}: ${errorText}`);
      return false;
    }

    // 读取 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError("无法读取响应流");
      return false;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          callbacks.onDone();
          return true;
        }

        try {
          const chunk = JSON.parse(data);
          const delta = chunk?.choices?.[0]?.delta;
          if (delta?.content) {
            callbacks.onDelta(delta.content);
          }
          // 检查工具调用
          if (delta?.tool_calls) {
            // 工具调用在 delta 中累积，后续 STORY-0040 详细处理
          }
          // 流结束标记
          if (chunk?.choices?.[0]?.finish_reason === "stop") {
            callbacks.onDone();
            return true;
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }

    callbacks.onDone();
    return true;
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") {
      // 用户主动取消，不报错
      callbacks.onDone();
      return true;
    }
    callbacks.onError(`网络错误: ${(err as Error).message}`);
    return false;
  } finally {
    clearTimeout(timeout);
    if (currentController === controller) {
      currentController = null;
    }
  }
}

/** 取消当前流式请求 */
export function abortStream(): void {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
}
