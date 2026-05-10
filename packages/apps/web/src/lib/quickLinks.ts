/**
 * QuickLink — 自定义连接数据模型
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §3 B1-自定义
 * 四种类型：网页链接 / 文件目录 / 文件 / 脚本
 */

export type QuickLinkType = "url" | "folder" | "file" | "script";

export interface QuickLink {
  id: string;
  type: QuickLinkType;
  name: string;
  /** URL 或文件系统路径 */
  target: string;
  /** 排序权重（越小越靠前） */
  order: number;
}

export const QUICK_LINK_TYPE_META: Record<
  QuickLinkType,
  { label: string; icon: string; placeholder: string }
> = {
  url: { label: "网页链接", icon: "🔗", placeholder: "https://..." },
  folder: { label: "文件目录", icon: "📁", placeholder: "C:\\Users\\..." },
  file: { label: "文件", icon: "📄", placeholder: "C:\\path\\to\\file.ext" },
  script: { label: "脚本", icon: "▶", placeholder: "python script.py" },
};

const STORAGE_KEY = "artifex.shell.quickLinks";

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `ql_${Date.now()}_${_idCounter}`;
}

export function loadQuickLinks(): QuickLink[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as QuickLink[];
  } catch {
    return [];
  }
}

export function saveQuickLinks(links: QuickLink[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

export function createQuickLink(
  type: QuickLinkType,
  name: string,
  target: string,
  existing: QuickLink[],
): QuickLink {
  const maxOrder = existing.reduce((m, l) => Math.max(m, l.order), 0);
  return { id: nextId(), type, name, target, order: maxOrder + 1 };
}
