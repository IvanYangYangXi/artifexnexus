"use client";

/**
 * ContentArea — C 区主内容（根据 B 选中模块渲染）
 */

import * as React from "react";

import type { ModuleId } from "./Sidebar";
import { ChatView } from "../chat/ChatView";
import { SkillsPage } from "../skills/SkillsPage";
import { SystemPage } from "../system/SystemPage";
import { SettingsPage } from "../settings/SettingsPage";

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
      <div className={module === "system" ? "contents" : "hidden"}>
        <SystemPage />
      </div>
      <div className={module === "settings" ? "contents" : "hidden"}>
        <SettingsPage />
      </div>
    </div>
  );
}
