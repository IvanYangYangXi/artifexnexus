/**
 * Gateway HTTP API 客户端 — 调用 OpenClaw Gateway REST 接口
 *
 * OpenClaw Gateway 在 localhost:{port} 上暴露 OpenAI 兼容的 REST API。
 * 常用端点：
 *   GET  /v1/models     → 模型列表
 *   POST /v1/chat/completions → 聊天（WebSocket 全双工已替代此用法）
 *
 * 注意：Gateway 默认可从 localhost 免鉴权访问；
 * 若需要 token，从 openclaw.json → gateway.auth.token 读取。
 */

import type { ModelOption, AgentOption } from "./types";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 10_000;

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** OpenAI /v1/models 响应格式 */
interface OpenAIModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

// ─── 模型 ──────────────────────────────────────────────────────────────────

/**
 * 从 Gateway 获取可用模型列表
 *
 * 调用 Gateway 的 GET /v1/models（OpenAI 兼容端点），
 * 返回所有已配置 provider 的模型。
 *
 * @param port Gateway 监听端口
 * @param token Gateway auth token；`gateway.auth.mode === "token"` 时必传，
 *   否则 Gateway 会返回 401。由 AppShell 从 sidecar auth_info RPC 获取。
 */
export async function fetchGatewayModels(port: number, token = ""): Promise<ModelOption[]> {
  const url = `http://127.0.0.1:${port}/v1/models`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[gateway-api] GET /v1/models returned ${response.status}`);
      return [];
    }

    const data: OpenAIModelsResponse = await response.json();
    if (!data?.data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((m) => ({
      id: m.id,
      name: m.id,
      providerId: m.owned_by ?? undefined,
    }));
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn(`[gateway-api] GET /v1/models timed out`);
    } else {
      console.warn(`[gateway-api] GET /v1/models failed: ${(err as Error).message}`);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Agent ─────────────────────────────────────────────────────────────────

/**
 * 获取可用 Agent 列表
 *
 * 当前 OpenClaw Gateway 未暴露标准 agent 列表端点；
 * 代理预设存储在 openclaw.json → agents.list[] 中，
 * 需通过 Tauri IPC 的 dumpOpenClawConfig() 获取（STORY-0040 实现）。
 *
 * 目前返回 Gateway 探测结果，无可用的返回空数组。
 *
 * @param port Gateway 监听端口
 * @param token Gateway auth token（可选）
 */
export async function fetchGatewayAgents(port: number, token = ""): Promise<AgentOption[]> {
  // 尝试探测 Gateway 的 agent 相关端点
  const endpoints = ["/v1/agents", "/api/agents"];
  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const headers: Record<string, string> = { "Accept": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`http://127.0.0.1:${port}${ep}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (list.length > 0) {
          return list
            .filter((a: { id?: string; name?: string }) => a.id)
            .map((a: { id?: string; name?: string }) => ({
              id: a.id!,
              name: a.name ?? a.id!,
            }));
        }
      }
    } catch {
      // 端点不可用，继续尝试下一个
    }
  }
  return [];
}

// ─── 健康检查 ──────────────────────────────────────────────────────────────

/** 检查 Gateway REST API 是否可用 */
export async function checkGatewayHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
