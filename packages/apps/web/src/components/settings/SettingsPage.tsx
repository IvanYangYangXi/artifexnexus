"use client";

/**
 * SettingsPage — 设置模块（模型 / 认证 / Agent / 通用）
 *
 * STORY-0037: mock 占位，STORY-0038 Desktop 内嵌时接入真实逻辑
 */

import * as React from "react";
import { Settings, Cpu, Key, Bot, Globe } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Input, Button } from "@artifex-nexus/ui";

export function SettingsPage() {
  const [tab, setTab] = React.useState("models");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7">
            <TabsTrigger value="models" className="h-6 gap-1 text-xs">
              <Cpu className="h-3 w-3" />模型
            </TabsTrigger>
            <TabsTrigger value="auth" className="h-6 gap-1 text-xs">
              <Key className="h-3 w-3" />认证
            </TabsTrigger>
            <TabsTrigger value="agent" className="h-6 gap-1 text-xs">
              <Bot className="h-3 w-3" />Agent
            </TabsTrigger>
            <TabsTrigger value="general" className="h-6 gap-1 text-xs">
              <Globe className="h-3 w-3" />通用
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "models" && <ModelsTab />}
        {tab === "auth" && <AuthTab />}
        {tab === "agent" && <AgentTab />}
        {tab === "general" && <GeneralTab />}
      </div>
    </div>
  );
}

function ModelsTab() {
  return (
    <div className="max-w-lg space-y-4">
      <h3 className="text-sm font-semibold">模型设置</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Provider</label>
          <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md">
            <option>OpenAI</option>
            <option>DeepSeek</option>
            <option>Anthropic</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">API Key</label>
          <Input className="h-9 text-sm" type="password" placeholder="sk-..." />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">默认模型</label>
          <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md">
            <option>gpt-4o</option>
            <option>deepseek-chat</option>
            <option>claude-3.5-sonnet</option>
          </select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        STORY-0038 接入 openclaw.json 真实配置读写
      </p>
    </div>
  );
}

function AuthTab() {
  return (
    <div className="max-w-lg space-y-4">
      <h3 className="text-sm font-semibold">认证设置</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Token</label>
          <Input className="h-9 text-sm" type="password" placeholder="输入认证 Token" />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        STORY-0038 接入真实 Token 管理
      </p>
    </div>
  );
}

function AgentTab() {
  return (
    <div className="max-w-lg space-y-4">
      <h3 className="text-sm font-semibold">Agent 设置</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">预设</label>
          <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md">
            <option>Artifex Nexus</option>
            <option>自定义 Agent</option>
          </select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        STORY-0038 接入 Agent preset 管理
      </p>
    </div>
  );
}

function GeneralTab() {
  return (
    <div className="max-w-lg space-y-4">
      <h3 className="text-sm font-semibold">通用设置</h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">语言</label>
          <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md">
            <option>中文</option>
            <option>English</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">主题</label>
          <select className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm backdrop-blur-md">
            <option>深色</option>
            <option>浅色</option>
          </select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        STORY-0038 接入真实配置持久化
      </p>
    </div>
  );
}
