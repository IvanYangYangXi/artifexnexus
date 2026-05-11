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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@artifex-nexus/ui";

export interface PreviewFile {
  name: string;
  content: string;
  language?: string;
}

// 预览文件 context
export const PreviewFileContext = React.createContext<{
  previewFile: PreviewFile | null;
  setPreviewFile: (f: PreviewFile | null) => void;
}>({
  previewFile: null,
  setPreviewFile: () => {},
});

// 钉选 Skill context（C3-钉选区 ↔ 技能模块联动）
export const PinnedSkillsContext = React.createContext<{
  pinnedSkills: string[];
  togglePin: (name: string) => void;
}>({
  pinnedSkills: [],
  togglePin: () => {},
});

// Tool 运行 → Chat 预输入 context
export const RunToolContext = React.createContext<{
  runTool: (toolName: string) => void;
  pendingToolName: string | null;
  clearPendingTool: () => void;
}>({
  runTool: () => {},
  pendingToolName: null,
  clearPendingTool: () => {},
});

// Gateway 连接信息 context（Chat 模块用于建立 WebSocket）
export const GatewayContext = React.createContext<{
  port: number;
  token: string;
  running: boolean;
}>({
  port: 19789,
  token: "",
  running: false,
});

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

  // 监听全局 nav 事件（子组件通过 dispatchEvent 触发模块切换）
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "string") {
        setCurrentModule(detail as any);
      }
    };
    window.addEventListener("nav", handler);
    return () => window.removeEventListener("nav", handler);
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

  // 预览文件状态（C3-文件区 ↔ D5 联动）
  const [previewFile, setPreviewFile] = React.useState<PreviewFile | null>(null);

  // 钉选 Skill 状态
  const [pinnedSkills, setPinnedSkills] = React.useState<string[]>([]);
  const [gatewayRunning, setGatewayRunning] = React.useState(false);
  const [gatewayPort, setGatewayPort] = React.useState(19789);
  const [dccStatus, setDccStatus] = React.useState<{ name: string; connected: boolean }[]>([]);
  const [openclawInstalled, setOpenclawInstalled] = React.useState(true);
  const [showInstallDialog, setShowInstallDialog] = React.useState(false);

  // 启动时自动检测：已安装 → 自动启动 Gateway；未安装 → 跳转系统面板 + 弹窗
  const startupCheckDone = React.useRef(false);
  React.useEffect(() => {
    if (startupCheckDone.current) return;
    startupCheckDone.current = true;
    const doCheck = async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const s = await ipc.getOpenClawStatus();
        if (s.cli_installed) {
          // 已安装 → 自动启动 Gateway
          setOpenclawInstalled(true);
          if (!s.gateway_running) {
            try {
              await ipc.startGateway();
              setGatewayRunning(true);
            } catch {
              // 启动失败，后续轮询会处理
            }
          } else {
            setGatewayRunning(true);
          }
        } else {
          // 未安装 → 跳转系统面板 + 弹窗
          setOpenclawInstalled(false);
          setCurrentModule("system");
          setTimeout(() => setShowInstallDialog(true), 500);
        }
      } catch {
        // IPC 不可用（浏览器 dev 模式），静默跳过
      }
    };
    // 延迟 300ms，等 AppShell 渲染完毕再检测
    const timer = setTimeout(doCheck, 300);
    return () => clearTimeout(timer);
  }, []);

  // 轮询 Gateway 状态（10s）
  React.useEffect(() => {
    const poll = async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const s = await ipc.getOpenClawStatus();
        setGatewayRunning(s.gateway_running);
        if (s.port) setGatewayPort(s.port);
        const statuses: { name: string; connected: boolean }[] = [];
        try {
          await ipc.getDCCPort("blender");
          // 只有配置了端口的 DCC 才显示
          let connected = false;
          if (s.gateway_running) {
            try {
              const bs = await ipc.getMCPBridgeStatus();
              connected = bs?.blenderConnected ?? false;
            } catch {}
          }
          statuses.push({ name: "Blender", connected });
        } catch {}
        setDccStatus(statuses);
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }, []);
  const togglePin = React.useCallback((name: string) => {
    setPinnedSkills((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  // Tool 运行 → 切换到 Chat 并预输入
  const [pendingToolName, setPendingToolName] = React.useState<string | null>(null);
  const runTool = React.useCallback((toolName: string) => {
    setPendingToolName(toolName);
    setCurrentModule("chat");
  }, []);
  const clearPendingTool = React.useCallback(() => {
    setPendingToolName(null);
  }, []);

  const sidebarWidth = sidebarCollapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;
  const showSidebar = !bp.isMobile;

  return (
    <PreviewFileContext.Provider value={{ previewFile, setPreviewFile }}>
    <PinnedSkillsContext.Provider value={{ pinnedSkills, togglePin }}>
    <RunToolContext.Provider value={{ runTool, pendingToolName, clearPendingTool }}>
    <GatewayContext.Provider value={{ port: gatewayPort, token: "", running: gatewayRunning }}>
    <div className="grid h-screen w-screen grid-rows-[40px_1fr] overflow-hidden bg-background text-foreground">
      {/* A 顶栏 */}
      <Topbar
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onTogglePanel={() => { setPanelOpen((v) => !v); }}
        sidebarHidden={!showSidebar}
        panelOpen={panelOpen}
        gatewayRunning={gatewayRunning}
        dccStatus={dccStatus}
        onStartGateway={async () => {
          try {
            const { getIpc } = await import("../../lib/ipc");
            const ipc = await getIpc();
            await ipc.startGateway();
            setGatewayRunning(true);
          } catch {}
        }}
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
        <div className="h-full min-w-0 flex-1" suppressHydrationWarning>
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

      {/* 启动时 OpenClaw 未安装提示弹窗 */}
      <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>未检测到 OpenClaw</DialogTitle>
            <DialogDescription>
              Artifex Nexus 需要 OpenClaw Gateway 才能提供 AI 对话功能。
              请先在"系统"面板中完成 OpenClaw 的安装。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInstallDialog(false)}
            >
              稍后再说
            </Button>
            <Button onClick={() => {
              setShowInstallDialog(false);
              setCurrentModule("system");
            }}>
              前往安装
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </GatewayContext.Provider>
    </RunToolContext.Provider>
    </PinnedSkillsContext.Provider>
    </PreviewFileContext.Provider>
  );
}