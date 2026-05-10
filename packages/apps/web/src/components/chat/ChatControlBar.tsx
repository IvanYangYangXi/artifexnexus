"use client";

/**
 * ChatControlBar — C1 对话控制栏
 *
 * 布局：对话列表（最左）| 空白 | Agent / Model / Effort（靠右）
 */

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
} from "@artifex-nexus/ui";
import { MOCK_AGENTS, MOCK_MODELS, MOCK_CONVERSATIONS } from "../../lib/chatMock";

const MOCK_EFFORTS = [
  { id: "low", name: "低" },
  { id: "medium", name: "中" },
  { id: "high", name: "高" },
];

export function ChatControlBar() {
  const [agent, setAgent] = React.useState(MOCK_AGENTS[0].id);
  const [model, setModel] = React.useState(MOCK_MODELS[0].id);
  const [effort, setEffort] = React.useState(MOCK_EFFORTS[1].id);
  const [conversation, setConversation] = React.useState(MOCK_CONVERSATIONS[0].id);
  const [convs, setConvs] = React.useState(MOCK_CONVERSATIONS);

  const handleDeleteConv = (id: string) => {
    setConvs((prev) => prev.filter((c) => c.id !== id));
    if (conversation === id && convs.length > 1) {
      const remaining = convs.filter((c) => c.id !== id);
      setConversation(remaining[0].id);
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
      {/* C1c 对话列表 — 最左边 */}
      <Select value={conversation} onValueChange={setConversation}>
        <SelectTrigger className="h-7 w-[180px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {convs.map((c) => (
            <SelectItem key={c.id} value={c.id} className="group">
              <span className="flex-1">{c.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-5 w-5 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConv(c.id);
                }}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1" />

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

      {/* Effort 下拉 */}
      <Select value={effort} onValueChange={setEffort}>
        <SelectTrigger className="h-7 w-[80px] gap-1 border-0 bg-transparent text-xs shadow-none hover:bg-accent/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MOCK_EFFORTS.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              思考: {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
