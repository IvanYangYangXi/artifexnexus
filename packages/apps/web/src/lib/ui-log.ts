/**
 * UI 操作日志埋点工具
 *
 * 统一格式：[ui:<module>] <action> | <key=value pairs>
 * 用于调试用户操作流程、定位 UI bug。
 *
 * 使用：
 *   uiLog.click("Topbar", "toggleSidebar", { sidebarHidden });
 *   uiLog.send("ChatInput", "send", { textLen: text.length });
 *   uiLog.toast("ChatView", "error", { message });
 *   uiLog.dialog("NewSession", "open");
 *   uiLog.nav("Sidebar", "switchModule", { from, to });
 *
 * 输出：
 *   [ui:Topbar] click toggleSidebar | sidebarHidden=false
 *   [ui:ChatInput] send | textLen=12
 *   [ui:ChatView] toast error | message=连接已断开
 */

type LogLevel = "log" | "warn" | "error";

function _emit(level: LogLevel, module: string, action: string, payload?: Record<string, unknown>) {
  const tag = `[ui:${module}]`;
  let detail = action;
  if (payload && Object.keys(payload).length > 0) {
    const parts = Object.entries(payload).map(([k, v]) => {
      if (v === undefined || v === null) return `${k}=${v}`;
      if (typeof v === "string") return `${k}="${v.length > 60 ? v.slice(0, 60) + "..." : v}"`;
      if (typeof v === "object") return `${k}=${JSON.stringify(v).slice(0, 80)}`;
      return `${k}=${v}`;
    });
    detail += " | " + parts.join(" ");
  }
  // eslint-disable-next-line no-console
  console[level](`${tag} ${detail}`);
}

/** 按钮点击 / toggle / 选中 */
function click(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("log", module, `click ${action}`, payload);
}

/** 发送/提交 */
function send(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("log", module, `send ${action}`, payload);
}

/** Toast 通知 */
function toast(module: string, level: "info" | "success" | "warning" | "error" | "loading", payload?: Record<string, unknown>) {
  _emit(level === "error" ? "warn" : "log", module, `toast ${level}`, payload);
}

/** 对话框 open/close */
function dialog(module: string, action: "open" | "close" | "confirm" | "cancel", payload?: Record<string, unknown>) {
  _emit("log", module, `dialog ${action}`, payload);
}

/** 导航 / 模块切换 */
function nav(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("log", module, `nav ${action}`, payload);
}

/** 输入变化（高频，仅显著变化时调用） */
function input(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("log", module, `input ${action}`, payload);
}

/** 状态变化（组件级状态） */
function state(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("log", module, `state ${action}`, payload);
}

/** 错误日志 */
function error(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("error", module, `error ${action}`, payload);
}

/** 警告日志 */
function warn(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("warn", module, `warn ${action}`, payload);
}

/** 自定义事件（兜底） */
function custom(module: string, action: string, payload?: Record<string, unknown>) {
  _emit("log", module, action, payload);
}

export const uiLog = {
  click,
  send,
  toast,
  dialog,
  nav,
  input,
  state,
  error,
  warn,
  custom,
};
