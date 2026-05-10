/**
 * @artifex-nexus/ui — 组件库入口 / Public API
 *
 * 所有组件与工具的统一出口。消费者通过
 *   `import { Button, Card, cn } from "@artifex-nexus/ui";`
 * 引用。
 *
 * 设计令牌与 Tailwind 配置通过独立 export 入口暴露：
 *   - `@artifex-nexus/ui/globals.css`  — 全局 CSS（必须在应用入口 import）
 *   - `@artifex-nexus/ui/tailwind.preset` — 内容扫描路径与 token 元数据
 */

// ─── utils ───
export { cn } from "./lib/cn";

// ─── P0 components ───
export * from "./components/button";
export * from "./components/input";
export * from "./components/textarea";
export * from "./components/card";
export * from "./components/dialog";
export * from "./components/dropdown-menu";
export * from "./components/tabs";
export * from "./components/scroll-area";
export * from "./components/tooltip";

// ─── P1 components ───
export * from "./components/badge";
export * from "./components/separator";
export * from "./components/skeleton";
export * from "./components/toast";

// ─── P2 components (web-chat-structure 显式依赖，2026-05-10 加入) ───
export * from "./components/avatar";
export * from "./components/label";
export * from "./components/checkbox";
export * from "./components/switch";
export * from "./components/radio-group";
export * from "./components/progress";
export * from "./components/popover";
export * from "./components/collapsible";
export * from "./components/select";
export * from "./components/sheet";
export * from "./components/context-menu";
export * from "./components/command";
export * from "./components/resizable";

// ─── 业务组件（chat / agent log 专用） ───
export * from "./components/tool-call";
export * from "./components/collapsible-panel";
