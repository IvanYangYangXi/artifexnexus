"use client";

/**
 * ChatView — Chat 模块主组件（C1 控制栏 + C2 消息流 + C3 输入区）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §4
 * STORY-0039：接入 OpenClaw Gateway WebSocket 实现真实流式对话
 *
 * 对话管理流程（混合方案）：
 * - 切换对话时先从 IndexedDB 缓存瞬间显示历史消息
 * - 后台静默从 Gateway 拉最新 history，拉到就更新 + 刷新缓存
 * - 新消息（发送/接收/流式）走现有 WebSocket 通道
 * - 消息变化时自动回写 IndexedDB 缓存供下次切换
 */

import * as React from "react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";
import { saveMessages, loadMessages } from "../../lib/chat/persistence";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning, authReady } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // 当前活跃的 sessionKey（格式 agent:<agentId>:<sessionName>）
  const [activeSessionKey, setActiveSessionKey] = React.useState("");

  // 切换对话时的 loading 中间态（仅在 IndexedDB 也无缓存时才显示）
  const [switchingSession, setSwitchingSession] = React.useState(false);

  // Chat 状态机
  const chat = useChatService({
    gatewayPort: port,
    gatewayToken: token,
    gatewayRunning,
    authReady,
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // 防止 Gateway history 后台拉取与用户新消息冲突的标记
  const lastSwitchKeyRef = React.useRef("");

  // ─── 切换对话（核心：先缓存后 Gateway）─────────────────────────────────
  async function handleSwitchSession(sessionKey: string) {
    if (!sessionKey || sessionKey === "__empty__" || sessionKey === "__new__") {
      return;
    }
    if (!sessionKey.startsWith("agent:")) {
      console.warn("[ChatView] 拒绝非法 sessionKey:", sessionKey);
      return;
    }

    // 如果当前正在流式生成，先中止
    if (chat.isStreaming) {
      await chat.stop();
    }

    // 在切走前，把当前对话的消息存入缓存
    const currentKey = lastSwitchKeyRef.current;
    const currentMessages = chat.messages;
    if (currentKey && currentMessages.length > 0) {
      saveMessages(currentKey, currentMessages).catch(() => {});
    }

    // 更新标记
    setActiveSessionKey(sessionKey);
    lastSwitchKeyRef.current = sessionKey;
    chat.switchSession(sessionKey);

    // 第一步：从 IndexedDB 缓存瞬间加载
    let cacheHit = false;
    try {
      const cached = await loadMessages(sessionKey);
      if (cached.length > 0) {
        chat.loadHistoryMessages(cached);
        cacheHit = true;
      }
    } catch {
      // IndexedDB 不可用，继续走 Gateway
    }

    // 没命中缓存才显示 loading
    if (!cacheHit) {
      setSwitchingSession(true);
    }

    // 第二步：后台静默从 Gateway 拉最新历史
    try {
      const { getIpc } = await import("../../lib/ipc");
      const ipc = await getIpc();
      const result = await ipc.getSessionsHistory({ sessionKey, limit: 50 });
      const messages = result?.messages ?? [];
      // 只有在用户没有再次切换对话时才更新
      if (lastSwitchKeyRef.current === sessionKey && messages.length > 0) {
        chat.loadHistoryMessages(messages);
        // 更新缓存
        saveMessages(sessionKey, messages).catch(() => {});
      }
    } catch (err) {
      console.warn("[ChatView] Gateway history failed (非致命):", err);
      // Gateway 失败不影响——用户已经看到了缓存内容（或空对话）
    } finally {
      if (lastSwitchKeyRef.current === sessionKey) {
        setSwitchingSession(false);
      }
    }
  }

  // ─── 新建对话 ──────────────────────────────────────────────────────────
  function handleNewSession() {
    // 切走前保存当前对话
    const currentKey = lastSwitchKeyRef.current;
    const currentMessages = chat.messages;
    if (currentKey && currentMessages.length > 0) {
      saveMessages(currentKey, currentMessages).catch(() => {});
    }

    const timestamp = Date.now();
    const newSessionKey = `agent:artifex-nexus:session-${timestamp}`;
    setActiveSessionKey(newSessionKey);
    lastSwitchKeyRef.current = newSessionKey;
    chat.createNewSession();
  }

  // ─── 消息变化时自动回写 IndexedDB 缓存 ─────────────────────────────────
  // 仅在非流式状态（idle）且有消息时写入，避免流式 delta 频繁写 DB
  const prevChatStateRef = React.useRef(chat.chatState);
  React.useEffect(() => {
    const wasStreaming = prevChatStateRef.current === "streaming" || prevChatStateRef.current === "tool_executing";
    const isNowIdle = chat.chatState === "idle";
    prevChatStateRef.current = chat.chatState;

    // 流式结束 → idle：写缓存（一次完整回复结束后）
    if (wasStreaming && isNowIdle && lastSwitchKeyRef.current && chat.messages.length > 0) {
      saveMessages(lastSwitchKeyRef.current, chat.messages).catch(() => {});
    }
  }, [chat.chatState, chat.messages]);

  // 用户发送消息后也写缓存（ADD_USER_MESSAGE 后 chatState 仍是 idle → sending）
  React.useEffect(() => {
    if (chat.chatState === "sending" && lastSwitchKeyRef.current && chat.messages.length > 0) {
      saveMessages(lastSwitchKeyRef.current, chat.messages).catch(() => {});
    }
  }, [chat.chatState]);

  // 处理 pending tool 预输入
  React.useEffect(() => {
    if (pendingToolName && !pendingHandledRef.current) {
      pendingHandledRef.current = true;
      window.dispatchEvent(new CustomEvent("artifex:prefillInput", {
        detail: { text: `请帮我运行工具 "${pendingToolName}"` },
      }));
      clearPendingTool();
    }
  }, [pendingToolName, clearPendingTool]);

  // 模块切换回来时重置标记
  React.useEffect(() => {
    pendingHandledRef.current = false;
  });

  // WS 连通后自动加载当前对话历史（解决初始选中对话时 WS 还没连上的问题）
  React.useEffect(() => {
    if (!activeSessionKey || activeSessionKey === "__empty__" || activeSessionKey === "__new__") return;
    if (!activeSessionKey.startsWith("agent:")) return;
    if (chat.messages.length > 0) return;
    // 走混合加载
    lastSwitchKeyRef.current = activeSessionKey;
    chat.switchSession(activeSessionKey);

    (async () => {
      // 先读缓存
      let cacheHit = false;
      try {
        const cached = await loadMessages(activeSessionKey);
        if (cached.length > 0 && lastSwitchKeyRef.current === activeSessionKey) {
          chat.loadHistoryMessages(cached);
          cacheHit = true;
        }
      } catch { /* ignore */ }

      if (!cacheHit) {
        setSwitchingSession(true);
      }

      // 后台拉 Gateway
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const result = await ipc.getSessionsHistory({ sessionKey: activeSessionKey, limit: 50 });
        if (result?.messages && result.messages.length > 0 && lastSwitchKeyRef.current === activeSessionKey) {
          chat.loadHistoryMessages(result.messages);
          saveMessages(activeSessionKey, result.messages).catch(() => {});
        }
      } catch (err) {
        console.warn("[ChatView] auto-load history failed:", err);
      } finally {
        setSwitchingSession(false);
      }
    })();
  }, [activeSessionKey]);

  // 自动滚动到底部
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* C1 控制栏 */}
      <ChatControlBar
        activeSessionKey={activeSessionKey}
        onSwitchSession={handleSwitchSession}
        onNewSession={handleNewSession}
        gatewayPort={port}
        gatewayRunning={gatewayRunning}
        onConfigChange={(cfg) => chat.setSelectedConfig(cfg)}
      />

      {/* C2 消息流 */}
      <ChatMessageList
        messages={chat.messages}
        messagesEndRef={messagesEndRef}
        loading={switchingSession}
      />

      {/* C3 输入区 */}
      <ChatInputArea
        onSend={chat.sendMessage}
        onStop={chat.stop}
        onResume={chat.resume}
        isStreaming={chat.isStreaming}
        canResume={chat.cancelledMessageId !== null && !chat.isStreaming}
        pendingCount={chat.pendingQueue.length}
        pendingMessages={chat.pendingQueue}
        sessionFiles={[]}
      />
    </div>
  );
}
