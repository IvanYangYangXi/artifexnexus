"use client";

import { useEffect } from "react";

/**
 * 全局禁止浏览器默认右键菜单。
 *
 * 在桌面应用（Tauri）模式下，所有 UI 元素默认不响应右键。
 * 需要恢复右键的特定组件，在事件处理函数中调用
 *   e.stopPropagation()
 * 后手动弹出自定义菜单即可。
 *
 * 或者在目标元素上添加 data-attribute `data-ctx="auto"` 让其恢复默认行为。
 */
export default function DisableContextMenu() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // 如果目标或祖先标记了 data-ctx="auto"，允许默认右键菜单
      const target = e.target as HTMLElement;
      if (target?.closest("[data-ctx='auto']")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener("contextmenu", handler, true);
    return () => document.removeEventListener("contextmenu", handler, true);
  }, []);

  return null;
}
