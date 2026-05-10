"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * Agent 下拉 / Model 下拉 / 对话下拉
 */

import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
} from "@artifex-nexus/ui";
import { MOCK_AGENTS, MOCK_MODELS, MOCK_CONVERSATIONS } from "../../lib/chatMock";

export function ChatControlBar() {
  const [agent, setAgent] = React.useState(MOCK_AGENTS[0].id);
  const [model, setModel] = React.useState(MOCK_MODELS[0].id);
  const [conversation, setConversation] = React.useState(MOCK_CONVERSATIONS[0].id);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* C1a Agent 选择 */}
      <Select value={agent} onValueChange={setAgent}>
        <SelectTrigger className="h-7 w-[140px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOCK_AGENTS.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="h-4 w-px bg-border/60" />

      {/* C1b Model 选择 */}
      <Select value={model} onValueChange={setModel}>
        <SelectTrigger className="h-7 w-[150px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOCK_MODELS.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* C1c 对话选择 */}
      <Select value={conversation} onValueChange={setConversation}>
        <SelectTrigger className="h-7 w-[180px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOCK_CONVERSATIONS.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
