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
  /** 凭据是否已从 sidecar 拉取到（port/token 就位前前端不应建 WS） */
  authReady: boolean;
}>({
  port: 19789,
  token: "",
  running: false,
  authReady: false,
});

const STORAGE_KEYS = {
  sidebarCollapsed: "artifex.shell.sidebarCollapsed",
  panelOpen: "artifex.shell.panelOpen",
} as const;

const SIDEBAR_WIDTH = { expanded: 200, collapsed: 48 } as const;

/**
 * 解析 sidecar -32020 port_busy 错误。
 *
 * STORY-0039：Rust 端把 sidecar 带 data 的 JSON-RPC error 序列化进 `Err(String)`
 * 的字符串末尾，格式为 `... __rpcdata__:{"kind":"port_busy","port":...,"occupants":[...]}`。
 * 本函数把 data 切出来解析，非 port_busy 返回 null（调用方继续走通用错误处理）。
 *
 * 不用 JSON 传递整条 error 是为了保持 Tauri invoke 的 `Err(String)` 单通道契约，
 * 避免把所有现有命令改成结构化 Err。
 */
function parsePortBusyError(err: unknown): {
  port: number;
  occupants: Array<{ pid: number; name: string; cmdline: string }>;
} | null {
  if (typeof err !== "string") return null;
  const marker = "__rpcdata__:";
  const idx = err.indexOf(marker);
  if (idx < 0) return null;
  try {
    const data = JSON.parse(err.slice(idx + marker.length));
    if (data?.kind !== "port_busy") return null;
    return {
      port: Number(data.port) || 0,
      occupants: Array.isArray(data.occupants) ? data.occupants : [],
    };
  } catch {
    return null;
  }
}

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
  const [gatewayToken, setGatewayToken] = React.useState<string>("");
  const [gatewayAuthReady, setGatewayAuthReady] = React.useState(false);
  const [dccStatus, setDccStatus] = React.useState<{ name: string; connected: boolean }[]>([]);
  const [openclawInstalled, setOpenclawInstalled] = React.useState(true);
  const [showInstallDialog, setShowInstallDialog] = React.useState(false);
  /** Gateway 启动中（sidecar spawn → gateway ready 期间） */
  const [gatewayStarting, setGatewayStarting] = React.useState(true);
  /** 启动阶段提示文字 */
  const [startupPhase, setStartupPhase] = React.useState("正在检测环境…");
  /** 启动 Gateway 时遇到"端口被外部进程占用"时的报错信息 */
  const [portBusyError, setPortBusyError] = React.useState<{
    port: number;
    occupants: Array<{ pid: number; name: string; cmdline: string }>;
  } | null>(null);

  // 启动时自动检测
  const startupCheckDone = React.useRef(false);
  React.useEffect(() => {
    if (startupCheckDone.current) return;
    startupCheckDone.current = true;

    let attempt = 0;
    let done = false;

    // ---------------------------------------------------------------
    // 全局硬超时（2026-05-12 修复，2026-05-12 调整为 60s）
    // 不管走哪条 doCheck/waitReady 路径，启动后 60s 必须强制把
    // gatewayStarting 置 false，确保覆盖遮罩绝不会永久卡住——这是
    // 兜底网，配合下面"已运行"分支的真实探测，双保险。
    // ---------------------------------------------------------------
    const hardTimeout = setTimeout(() => {
      if (!done) {
        console.error("[AppShell] startup hard timeout (60s) — forcing overlay close");
        done = true;
        setStartupPhase("启动超时（60s 强制跳出，请进入「系统」面板查看 Gateway 状态）");
        setGatewayStarting(false);
        setCurrentModule("system");
      } else {
        // doCheck 已经走完，但遮罩仍可能因为某条路径漏关而留着——再 set 一次保险
        setGatewayStarting(false);
      }
    }, 60_000);

    const fetchGatewayAuth = async (ipc: any) => {
      try {
        const info = await ipc.getGatewayAuthInfo();
        if (info.port > 0) setGatewayPort(info.port);
        setGatewayToken(info.token || "");
        setGatewayAuthReady(true);
      } catch { }
    };

    /**
     * 真实探测 Gateway 是否真的在跑（不只信 PID 锁文件）。
     *
     * Why（2026-05-12 调试发现）：
     *   sidecar 的 is_running() 只看 PID 锁文件 + tasklist 验进程是否存在，
     *   但 OpenClaw Gateway 进程是 node.exe；当用户没用优雅 stop 关 exe 时，
     *   node.exe 变孤儿继续 listen 19789，但**实际可能已经无法响应**（句柄
     *   错乱、token 失效等）。此时 is_running() 返 true，前端走"已运行"分
     *   支不调 startGateway，但 ChatView WS 握手会失败 → 用户看遮罩消失但
     *   功能全废。
     *
     *   getGatewayAuthInfo 会真正读 openclaw.json 的 token + 当前注册端口；
     *   能成功且 port>0 就当作真活；失败/port=0 当作"PID 锁是谎言"，强制
     *   force_restart 再 spawn 一次 gateway。
     */
    const verifyGatewayActuallyAlive = async (ipc: any): Promise<boolean> => {
      try {
        const info = await ipc.getGatewayAuthInfo();
        return !!(info && info.port > 0);
      } catch {
        return false;
      }
    };

    const doCheck = async () => {
      if (done) return;
      attempt++;
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const s = await ipc.getOpenClawStatus();
        done = true; // sidecar 就绪，停止重试
        if (s.cli_installed) {
          setOpenclawInstalled(true);

          // -----------------------------------------------------------
          // 统一 Gateway 启动逻辑（2026-05-12 重构）
          //
          // 之前的代码把 "未运行" 和 "已运行" 分成两个分支，"未运行"
          // 分支内用 waitReady 轮询，但 waitReady 里 `if (done) return`
          // 引用了外层 done（已经是 true），导致第一轮就退出、遮罩永远
          // 不会关。重构后：
          //   1. 先无条件调 startGateway（RPC 本身是幂等的）
          //   2. 成功后进入 waitReady 轮询（独立 cancelled flag）
          //   3. "已运行" 走 verifyGatewayActuallyAlive 快速路径
          //   4. 每条路径都保证 setGatewayStarting(false) 被调用
          // -----------------------------------------------------------

          if (!s.gateway_running) {
            // === "未运行"分支 ===
            setStartupPhase("正在启动 OpenClaw Gateway…");
            try {
              await ipc.startGateway();
            } catch (e: any) {
              console.error("[AppShell] startGateway failed:", e);
              const parsed = parsePortBusyError(e);
              if (parsed) {
                setPortBusyError(parsed);
              }
              setStartupPhase(`启动 Gateway 失败: ${e?.message || String(e)}`);
              await new Promise(r => setTimeout(r, 3000));
              setGatewayStarting(false);
              setCurrentModule("system");
              return;
            }

            // startGateway RPC 成功，开始轮询等待 gateway 真正就绪。
            // 用独立 cancelled flag，不依赖外层 done。
            let cancelled = false;
            const cleanup = () => { cancelled = true; };
            // 把 cleanup 挂到 effect 的 teardown（组件卸载时取消轮询）
            // 通过 hardTimeout 兜底；这里只用 cancelled 防止组件已卸载后
            // 继续 setState。

            setStartupPhase("等待 Gateway 就绪…");
            for (let i = 0; i < 30; i++) {
              if (cancelled) return;
              await new Promise(r => setTimeout(r, 1000));
              try {
                const st = await ipc.getOpenClawStatus();
                if (st.gateway_running) {
                  console.info(`[AppShell] gateway ready after ${i + 1}s`);
                  setStartupPhase("Gateway 就绪");
                  setGatewayRunning(true);
                  setGatewayStarting(false);
                  fetchGatewayAuth(ipc);
                  return;
                }
                setStartupPhase(`等待 Gateway 就绪…（${i + 1}/30）`);
              } catch {
                // status 查询失败（sidecar 可能在重启），继续等
              }
            }

            // 30 次轮询都没看到 running — 兜底：再试一次 startGateway
            // 因为第一次 startGateway 成功后 sidecar 可能被 Rust 端重启，
            // 旧 sidecar 的 atexit hook 把 gateway 杀了。
            console.warn("[AppShell] waitReady exhausted 30 rounds, retrying startGateway");
            setStartupPhase("Gateway 未就绪，正在重试启动…");
            try {
              await ipc.startGateway({ forceRestart: true });
              // 等 3s 让 gateway 有时间初始化
              await new Promise(r => setTimeout(r, 3000));
              const st2 = await ipc.getOpenClawStatus();
              if (st2.gateway_running) {
                console.info("[AppShell] gateway ready after retry");
                setGatewayRunning(true);
                setGatewayStarting(false);
                fetchGatewayAuth(ipc);
                return;
              }
            } catch (e2: any) {
              console.error("[AppShell] retry startGateway failed:", e2);
            }

            // 重试也失败了 — 关遮罩，跳系统面板
            setStartupPhase("Gateway 启动超时，跳转系统面板");
            await new Promise(r => setTimeout(r, 1500));
            setGatewayStarting(false);
            setCurrentModule("system");

          } else {
            // === "已运行"分支 ===
            // sidecar 报告 gateway_running=true，但 PID 锁可能是孤儿/谎言。
            console.info("[AppShell] sidecar reports gateway_running=true, verifying...");
            const actuallyAlive = await verifyGatewayActuallyAlive(ipc);
            if (actuallyAlive) {
              setGatewayRunning(true);
              setGatewayStarting(false);
              console.info("[AppShell] gateway verified alive (auth_info OK)");
            } else {
              console.warn("[AppShell] PID lock claims running but auth_info failed — force restart");
              setStartupPhase("检测到孤儿 Gateway，正在重启…");
              try {
                await ipc.startGateway({ forceRestart: true });
                // 等 3s 让 gateway 初始化
                await new Promise(r => setTimeout(r, 3000));
                const st = await ipc.getOpenClawStatus();
                if (st.gateway_running) {
                  setGatewayRunning(true);
                  setStartupPhase("Gateway 已重启");
                  setGatewayStarting(false);
                } else {
                  setStartupPhase("Gateway 重启后仍未就绪，请检查系统面板");
                  await new Promise(r => setTimeout(r, 1500));
                  setGatewayStarting(false);
                  setCurrentModule("system");
                }
              } catch (e: any) {
                console.error("[AppShell] force restart failed:", e);
                setStartupPhase(`重启 Gateway 失败: ${e?.message || String(e)}`);
                await new Promise(r => setTimeout(r, 3000));
                setGatewayStarting(false);
                setCurrentModule("system");
              }
            }
          }
          // Gateway 就绪后拉一次连接凭据（port + token），供 Chat WS 握手用
          // 启动有个短暂窗口期（pid 锁 + 端口探测），延迟 400ms 再拉
          setTimeout(async () => {
            try {
              const info = await ipc.getGatewayAuthInfo();
              if (info.port > 0) setGatewayPort(info.port);
              setGatewayToken(info.token || "");
              setGatewayAuthReady(true);
            } catch {
              // auth_info 拉取失败，ChatView 会显示未连接
            }
          }, 400);
        } else {
          // 未安装 → 跳转系统面板 + 弹窗
          setOpenclawInstalled(false);
          setGatewayStarting(false);
          setCurrentModule("system");
          setTimeout(() => setShowInstallDialog(true), 500);
        }
      } catch {
        // sidecar 未就绪 → 1s 后重试
        setStartupPhase(`等待 sidecar 就绪…（${attempt}/30）`);
        if (attempt >= 30) {
          done = true;
          setStartupPhase("sidecar 启动超时，跳转系统面板");
          await new Promise(r => setTimeout(r, 1500));
          setGatewayStarting(false);
          setCurrentModule("system");
        }
      }
    };

    // 首次立即执行，失败再轮询
    doCheck().catch(() => {});
    const interval = setInterval(doCheck, 1000);
    return () => { done = true; clearInterval(interval); clearTimeout(hardTimeout); };
  }, []);

  // 轮询 Gateway 状态（10s）
  React.useEffect(() => {
    const poll = async () => {
      try {
        const { getIpc } = await import("../../lib/ipc");
        const ipc = await getIpc();
        const s = await ipc.getOpenClawStatus();
        setGatewayRunning(s.gateway_running);
        if (s.gateway_running) {
          setGatewayStarting(false);
        }
        if (s.port) setGatewayPort(s.port);
        // Gateway 运行中 → 持续刷新连接凭据（端口探测迁移、token 轮换都能同步）
        if (s.gateway_running) {
          try {
            const info = await ipc.getGatewayAuthInfo();
            if (info.port > 0) setGatewayPort(info.port);
            setGatewayToken(info.token || "");
            setGatewayAuthReady(true);
          } catch {
            // 单次失败不重置 authReady，避免 ChatView 抖动
          }
        }
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
    <GatewayContext.Provider value={{ port: gatewayPort, token: gatewayToken, running: gatewayRunning, authReady: gatewayAuthReady }}>
    <div className="grid h-screen w-screen grid-rows-[40px_1fr] overflow-hidden bg-background text-foreground">
      {/* Gateway 启动全屏遮罩 */}
      {gatewayStarting && !openclawInstalled === false && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            {/* 旋转加载动画 */}
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-7 w-7 rounded-full bg-primary/10" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-base font-medium text-foreground">Artifex Nexus 正在启动</p>
              <p className="mt-1.5 text-xs text-muted-foreground">{startupPhase}</p>
              <div className="mt-4 flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]" />
                <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]" />
                <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* STORY-0039：Gateway 目标端口被非 OpenClaw 进程占用时的报错弹窗 */}
      <Dialog open={portBusyError !== null} onOpenChange={(open) => !open && setPortBusyError(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>端口被其它程序占用，Gateway 无法启动</DialogTitle>
            <DialogDescription>
              Artifex Nexus 需要绑定端口 <span className="font-mono">{portBusyError?.port}</span>，
              但它当前被以下非 OpenClaw 进程占用。为避免误杀你的其它程序，
              Artifex Nexus 不会自动清理它，请手动停止后重试。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            {portBusyError?.occupants.length ? (
              <ul className="space-y-1 font-mono text-xs">
                {portBusyError.occupants.map((o) => (
                  <li key={o.pid}>
                    PID=<span className="font-semibold">{o.pid}</span> · {o.name || "unknown"}
                    {o.cmdline ? <div className="opacity-70 break-all">{o.cmdline}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">未能获取占用进程详情（可能需要管理员权限）。</span>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPortBusyError(null)}>
              知道了
            </Button>
            <Button
              onClick={async () => {
                // 用户手动停了占用进程后点"重试"
                setPortBusyError(null);
                try {
                  const { getIpc } = await import("../../lib/ipc");
                  const ipc = await getIpc();
                  await ipc.startGateway();
                  setGatewayRunning(true);
                } catch (err) {
                  const parsed = parsePortBusyError(err);
                  if (parsed) setPortBusyError(parsed);
                }
              }}
            >
              重试启动
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