"use client";

/**
 * ChatView — Chat 模块主组件（C1 控制栏 + C2 消息流 + C3 输入区）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §4
 * STORY-0039：接入 OpenClaw Gateway WebSocket 实现真实流式对话
 *
 * 对话管理流程（同步缓存方案）：
 * - chat-service 内部用内存 Map 缓存每个 session 的消息
 * - 切换对话时 switchSession 同步从 Map 读取，零延迟
 * - 新消息（发送/接收/流式）走 WebSocket，完成后自动写回 Map
 * - Gateway history 仅在首次打开（Map 为空）时后台静默加载
 */

import * as React from "react";
import { ChatControlBar } from "./ChatControlBar";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInputArea } from "./ChatInputArea";
import { RunToolContext, GatewayContext } from "../shell/AppShell";
import { useChatService } from "../../lib/chat/chat-service";

export function ChatView() {
  const { pendingToolName, clearPendingTool } = React.useContext(RunToolContext);
  const { port, token, running: gatewayRunning, authReady } = React.useContext(GatewayContext);
  const pendingHandledRef = React.useRef(false);

  // 当前活跃的 sessionKey
  const [activeSessionKey, setActiveSessionKey] = React.useState("");

  // Chat 状态机
  const chat = useChatService({
    gatewayPort: port,
    gatewayToken: token,
    gatewayRunning,
    authReady,
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // ─── 切换对话（纯同步，消息从内存缓存瞬间加载）─────────────────────
  async function handleSwitchSession(sessionKey: string) {
    if (!sessionKey || sessionKey === "__empty__" || sessionKey === "__new__") {
      return;
    }
    if (!sessionKey.startsWith("agent:")) {
      console.warn("[ChatView] 拒绝非法 sessionKey:", sessionKey);
      return;
    }

    if (chat.isStreaming) {
      await chat.stop();
    }

    setActiveSessionKey(sessionKey);
    // switchSession 内部同步：存当前消息 → 从缓存读目标消息 → dispatch
    // 不需要 await，不需要 loading
    chat.switchSession(sessionKey);

    // 后台静默从 Gateway 刷新（缓存为空时特别有用，但不阻塞 UI）
    silentLoadHistory(sessionKey);
  }

  // ─── 新建对话 ──────────────────────────────────────────────────────────
  function handleNewSession() {
    const timestamp = Date.now();
    const newSessionKey = `agent:artifex-nexus:session-${timestamp}`;
    setActiveSessionKey(newSessionKey);
    chat.createNewSession();
  }

  // ─── 后台静默从 Gateway 拉历史（不阻塞 UI）───────────────────────────
  function silentLoadHistory(sessionKey: string) {
    (async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const result = await ipc.getSessionsHistory({ sessionKey, limit: 50 });
        const messages = result?.messages ?? [];
        // 只有当前对话没变且确实拿到了数据才更新
        if (messages.length > 0 && chat.getSessionKey() === sessionKey) {
          chat.loadHistoryMessages(messages);
        }
      } catch (err) {
        console.warn("[ChatView] Gateway history 后台刷新失败（非致命）:", err);
      }
    })();
  }

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

  // 初始加载：首次选中对话时从 Gateway 拉历史填充缓存
  React.useEffect(() => {
    if (!activeSessionKey || activeSessionKey === "__empty__" || activeSessionKey === "__new__") return;
    if (!activeSessionKey.startsWith("agent:")) return;
    if (chat.messages.length > 0) return;
    // switchSession 同步读缓存（首次可能为空）
    chat.switchSession(activeSessionKey);
    // 后台拉 Gateway 填充
    silentLoadHistory(activeSessionKey);
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
