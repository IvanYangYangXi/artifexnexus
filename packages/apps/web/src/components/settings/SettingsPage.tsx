"use client";

/**
 * SettingsPage — 设置模块（模型 / 认证 / Agent）
 *
 * 复刻 apps/desktop SettingsPanel 的三 Tab 结构
 * STORY-0037: UI 结构 + mock 数据，STORY-0040 接入真实 API
 */

import * as React from "react";
import { Cpu, Key, Bot, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input } from "@artifex-nexus/ui";

export function SettingsPage() {
  const [tab, setTab] = React.useState("providers");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7">
            <TabsTrigger value="providers" className="h-6 gap-1 text-xs"><Cpu className="h-3 w-3" />模型</TabsTrigger>
            <TabsTrigger value="auth" className="h-6 gap-1 text-xs"><Key className="h-3 w-3" />认证</TabsTrigger>
            <TabsTrigger value="agent" className="h-6 gap-1 text-xs"><Bot className="h-3 w-3" />Agent</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "providers" && <ProvidersTab />}
        {tab === "auth" && <AuthTab />}
        {tab === "agent" && <AgentTab />}
      </div>
    </div>
  );
}

// ─── 模型 Tab ───────────────────────────────────────────────────────────────

function ProvidersTab() {
  const [showKey, setShowKey] = React.useState(false);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">Provider</h3>
        <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30">
          <option>OpenAI</option>
          <option>DeepSeek</option>
          <option>Anthropic</option>
          <option>OpenRouter</option>
        </select>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">API Key</h3>
        <div className="relative">
          <Input
            className="h-9 pr-16 text-sm"
            type={showKey ? "text" : "password"}
            placeholder="sk-..."
            defaultValue="sk-mock-xxxxxxxxxxxx"
          />
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">模型列表</h3>
        <div className="space-y-2">
          {["gpt-4o", "gpt-4o-mini", "deepseek-chat", "claude-3.5-sonnet"].map((m) => (
            <div key={m} className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2">
              <span className="flex-1 text-sm">{m}</span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" className="peer sr-only" defaultChecked={m !== "claude-3.5-sonnet"} />
                <div className="h-5 w-9 rounded-full bg-white/[0.08] peer-checked:bg-primary/30 peer-checked:after:translate-x-4 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition" />
              </label>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">STORY-0040 接入 openclaw.json 真实配置读写</p>
    </div>
  );
}

// ─── 认证 Tab ───────────────────────────────────────────────────────────────

function AuthTab() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">认证配置</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          为不同 Provider 配置独立的 API Key 或 Token
        </p>
        <div className="space-y-3">
          {[
            { provider: "OpenAI", key: "sk-***" },
            { provider: "DeepSeek", key: "sk-***" },
            { provider: "Anthropic", key: "sk-ant-***" },
          ].map((p) => (
            <div key={p.provider} className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2">
              <span className="w-20 text-sm">{p.provider}</span>
              <Input className="h-8 flex-1 text-xs" type="password" defaultValue={p.key} />
              <Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3 h-7 gap-1 text-xs rounded-full">
          <Plus className="h-3 w-3" />添加
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">STORY-0040 接入真实 Token 管理</p>
    </div>
  );
}

// ─── Agent Tab ──────────────────────────────────────────────────────────────

function AgentTab() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">Agent 预设</h3>
        <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30">
          <option>Artifex Nexus（默认）</option>
          <option>自定义 Agent</option>
        </select>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">系统提示词</h3>
        <textarea
          className="h-32 w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-primary/30"
          defaultValue="你是 Artifex Nexus，一个 AI Agent ↔ DCC 的桥接助手。你可以通过 MCP 工具控制 Blender、Unreal Engine 等 DCC 软件。"
        />
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs rounded-full">保存</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full">重置为默认</Button>
      </div>

      <p className="text-[11px] text-muted-foreground">STORY-0040 接入 Agent preset 管理</p>
    </div>
  );
}
