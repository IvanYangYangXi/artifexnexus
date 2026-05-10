"use client";

/**
 * ContentArea — C 区主内容（根据 B 选中模块渲染）
 *
 * STORY-0032 范围：4 个模块的占位页面
 * STORY-0034 接入：Chat 真实对话流
 * STORY-0035+ 接入：技能管理页 / 系统页 / 设置页
 */

import * as React from "react";
import { MessageSquare, Puzzle, Settings, Terminal } from "lucide-react";

import type { ModuleId } from "./Sidebar";
import { ChatView } from "../chat/ChatView";
import { SkillsPage } from "../skills/SkillsPage";

const MODULE_META: Record<
  ModuleId,
  { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }> }
> = {
  chat: {
    title: "Chat",
    subtitle: "AI 对话界面",
    icon: MessageSquare,
  },
  skills: {
    title: "技能管理",
    subtitle: "Skill / Tool / Workflow · 后续 STORY 接入",
    icon: Puzzle,
  },
  system: {
    title: "系统管理",
    subtitle: "Gateway / 安装向导 / 运行状态 · 后续 STORY 接入",
    icon: Terminal,
  },
  settings: {
    title: "设置",
    subtitle: "全局偏好 / 快捷键 / 主题 · 后续 STORY 接入",
    icon: Settings,
  },
};

interface ContentAreaProps {
  module: ModuleId;
}

export function ContentArea({ module }: ContentAreaProps) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className={module === "chat" ? "contents" : "hidden"}>
        <ChatView />
      </div>
      <div className={module === "skills" ? "contents" : "hidden"}>
        <SkillsPage />
      </div>
      <div className={module !== "chat" && module !== "skills" ? "contents" : "hidden"}>
        <PlaceholderPage module={module} />
      </div>
    </div>
  );
}

function PlaceholderPage({ module }: { module: ModuleId }) {
  const meta = MODULE_META[module];
  const Icon = meta.icon;
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 text-xs">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{meta.title}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">后续 STORY 接入</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{meta.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{meta.subtitle}</p>
        </div>
      </div>
    </>
  );
}
