/**
 * 前端启动追踪：把关键节点同时打到 console + Rust 日志文件。
 *
 * Why（2026-05-14）：
 *   release EXE 的前端 console 只在 DevTools 里看得到，用户报"卡在正在
 *   检测环境"时没法回看。本工具通过 Tauri command frontend_log 把每条
 *   事件 mirror 到 ~/.artifexnexus/logs/exe-stderr-<pid>.log。
 */

let _invoke: ((cmd: string, args?: any) => Promise<any>) | null = null;

async function getInvoke() {
  if (_invoke) return _invoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    _invoke = mod.invoke;
    return _invoke;
  } catch {
    return null;
  }
}

/**
 * 写一条启动追踪日志。
 * tag 形如 "ui.AppShell"、"ui.ChatView"，message 自由文本。
 */
export function trace(tag: string, message: string, ...extra: any[]) {
  // 1. 永远 console（dev 模式 DevTools 能看到）
  // 拼 extra（如对象）便于排查
  if (extra.length > 0) {
    console.info(`[${tag}]`, message, ...extra);
  } else {
    console.info(`[${tag}]`, message);
  }

  // 2. 异步写到 Rust 日志（best-effort，不 await 不阻塞）
  getInvoke().then((invoke) => {
    if (!invoke) return;
    const extraStr = extra.length > 0 ? " " + extra.map((e) => {
      try { return JSON.stringify(e); } catch { return String(e); }
    }).join(" ") : "";
    invoke("frontend_log", { tag, message: message + extraStr }).catch(() => { /* swallow */ });
  });
}
