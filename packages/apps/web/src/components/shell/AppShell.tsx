"use client";

/**
 * AppShell — 全局四区域布局骨架（A 顶栏 / B 导航 / C 主区 / D 面板）
 *
 * 设计依据：docs/specs/ui/web-chat-structure.md §1, §2, §3, §8
 *
 * 实现策略（STORY-0032 决议）：
 *   - A 顶栏：sticky 顶部，固定 40px
 *   - B 导航：宽度 state 控制 200(展开) / 48(折叠)，CSS transition
 *   - C 主区：flex-1
 *   - D 面板：react-resizable-panels 横向拖拽（240-640px），顶栏按钮可整体隐藏
 *   - 整体 B-C-D 用 ResizablePanelGroup 包裹（仅 D 可拖拽，B 由按钮切换）
 *   - D 区内部用 @artifex-nexus/ui 的 CollapsiblePanelGroup 渲染 D1-D5
 *   - 持久化：B 折叠态、D 显示态、D 区内部 panel 尺寸 → localStorage
 *   - 响应式：≥1280 全展开 / 1024-1279 D 隐藏 / 768-1023 B 折叠+D 隐藏 / <768 B 隐藏
 */

import * as React from "react";
import { type ImperativePanelHandle } from "react-resizable-panels";

import { Topbar } from "./Topbar";
import { Sidebar, type ModuleId } from "./Sidebar";
import { ContentArea } from "./ContentArea";
import { RightPanel } from "./RightPanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@artifex-nexus/ui";

const STORAGE_KEYS = {
  sidebarCollapsed: "artifex.shell.sidebarCollapsed",
  panelOpen: "artifex.shell.panelOpen",
} as const;

const SIDEBAR_WIDTH = { expanded: 200, collapsed: 48 } as const;

/** 响应式断点（与 web-chat-structure.md §1.2 对齐） */
function useBreakpoint() {
  const [width, setWidth] = React.useState<number>(() => {
    if (typeof window === "undefined") return 1440; // SSR 默认大屏
    return window.innerWidth;
  });
  React.useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return {
    width,
    /** ≥1280 全展开 */ isWide: width >= 1280,
    /** 1024–1279 D 隐藏 */ isMedium: width >= 1024 && width < 1280,
    /** 768–1023 B 折叠 + D 隐藏 */ isNarrow: width >= 768 && width < 1024,
    /** <768 B 隐藏 + D 隐藏 */ isMobile: width < 768,
  };
}

export function AppShell() {
  const bp = useBreakpoint();

  // B 折叠态（用户主动 + 响应式被动）
  // 注意：useState 初始值不能读 localStorage，否则 SSR 渲染 false、CSR hydrate 时
  // 读到 true 会触发 hydration mismatch；改为 mount 后异步读取。
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState<boolean>(false);

  // D 显隐
  const [panelOpen, setPanelOpen] = React.useState<boolean>(true);

  // 当前模块（B 选中）
  const [currentModule, setCurrentModule] = React.useState<ModuleId>("chat");

  // mount 后从 localStorage 恢复偏好（避免 hydration mismatch）
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const sb = window.localStorage.getItem(STORAGE_KEYS.sidebarCollapsed);
    if (sb === "1") setSidebarCollapsed(true);
    const po = window.localStorage.getItem(STORAGE_KEYS.panelOpen);
    if (po === "0") setPanelOpen(false);
    setMounted(true);
  }, []);

  // 响应式：在窄屏强制折叠 / 隐藏（不覆盖用户偏好，仅在断点变更时一次性）
  const lastBp = React.useRef<string>("");
  React.useEffect(() => {
    const key = bp.isWide ? "wide" : bp.isMedium ? "medium" : bp.isNarrow ? "narrow" : "mobile";
    if (lastBp.current === key) return;
    lastBp.current = key;
    if (bp.isMedium || bp.isNarrow || bp.isMobile) {
      setPanelOpen(false);
    }
    if (bp.isNarrow || bp.isMobile) {
      setSidebarCollapsed(true);
    }
  }, [bp.isWide, bp.isMedium, bp.isNarrow, bp.isMobile]);

  // 持久化（仅 mount 后写，避免覆盖未恢复的初值）
  React.useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed, mounted]);
  React.useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(STORAGE_KEYS.panelOpen, panelOpen ? "1" : "0");
  }, [panelOpen, mounted]);

  // D 区 imperative ref（顶栏按钮调用 expand/collapse）
  const dPanelRef = React.useRef<ImperativePanelHandle>(null);

  const sidebarWidth = sidebarCollapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;
  const showSidebar = !bp.isMobile;

  return (
    <div className="grid h-screen w-screen grid-rows-[40px_1fr] overflow-hidden bg-background text-foreground">
      {/* A 顶栏 */}
      <Topbar
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onTogglePanel={() => {
          setPanelOpen((v) => !v);
        }}
        sidebarHidden={!showSidebar}
        panelOpen={panelOpen}
      />

      {/* B + C + D 区 */}
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        {/* B 导航 — 由 state 控制宽度，CSS transition */}
        {showSidebar && (
          <div
            className="h-full shrink-0 transition-[width] duration-200 ease-out"
            style={{ width: sidebarWidth }}
          >
            <Sidebar
              collapsed={sidebarCollapsed}
              currentModule={currentModule}
              onSelect={setCurrentModule}
              onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            />
          </div>
        )}

        {/* C + D 区 — 用 ResizablePanelGroup，D 隐藏时只剩 C */}
        <div className="h-full min-w-0 flex-1">
          {panelOpen ? (
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId="artifex.shell.cd"
              className="h-full w-full"
            >
              <ResizablePanel defaultSize={70} minSize={30}>
                <ContentArea module={currentModule} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                ref={dPanelRef}
                defaultSize={30}
                minSize={18}
                maxSize={50}
                collapsible
                collapsedSize={0}
                onCollapse={() => setPanelOpen(false)}
              >
                <RightPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <ContentArea module={currentModule} />
          )}
        </div>
      </div>
    </div>
  );
}
