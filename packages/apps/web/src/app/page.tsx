"use client";

import dynamic from "next/dynamic";

// 强制 client-side only render，禁用 Next.js 预渲染。
//
// Why（2026-05-12 修复）：
//   Tauri 桌面应用根本不需要 SSR；但 Next.js `output: "export"` 仍会在 build
//   时 prerender HTML。AppShell / ChatMessageList 大量使用 localStorage、
//   navigator、运行时 IPC 数据，prerender 出来的 HTML 与 hydrate 时 client
//   侧的真实 DOM 必然不一致 → React #418（Hydration failed）→ 整棵 tree
//   unmount 重建 → 用户看到"切对话历史消失"。
//
//   `dynamic(..., { ssr: false })` 让 Next.js 完全跳过该组件的 prerender，
//   client 首次渲染才挂载，避免 hydration mismatch。
const AppShell = dynamic(
  () => import("../components/shell/AppShell").then((m) => ({ default: m.AppShell })),
  { ssr: false },
);

export default function HomePage() {
  return <AppShell />;
}
