/**
 * ResourceExplorer — D4 资源管理器
 *
 * 参考 docs/specs/ui/resource-explorer-structure.md
 * VSCode 风格单列文件树 + 面包屑导航 + 搜索 + 收藏夹 + 右键菜单
 */

"use client";

import * as React from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  File,
  ChevronRight,
  Search,
  Star,
  StarOff,
  Copy,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Button,
  Input,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  cn,
} from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { PreviewContext } from "./AppShell";
import {
  useResourceExplorer,
  type FileEntry,
} from "../../lib/useResourceExplorer";

// ── Props ──────────────────────────────────────────────────────────────────

interface ResourceExplorerProps {
  /** 直接导航到指定目录（初始加载 / 外部触发） */
  initialDir?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ResourceExplorer({ initialDir }: ResourceExplorerProps) {
  const {
    currentDir,
    filteredEntries,
    loading,
    searchLoading,
    error,
    search,
    setSearch,
    favorites,
    breadcrumbs,
    navigateTo,
    navigateUp,
    setPath,
    toggleFavorite,
    isFavorited,
    readFileContent,
  } = useResourceExplorer();

  const { setPreview } = React.useContext(PreviewContext);

  // 初始加载
  const doneInit = React.useRef(false);
  React.useEffect(() => {
    if (doneInit.current) return;
    if (initialDir) {
      doneInit.current = true;
      setPath(initialDir);
    }
  }, [initialDir, setPath]);

  // 处理文件点击 → D5 预览
  const handleFileClick = React.useCallback(async (entry: FileEntry) => {
    if (entry.is_dir) {
      navigateTo(entry.path);
    } else {
      const content = await readFileContent(entry.path);
      if (content !== null) {
        setPreview({
          kind: "file-preview",
          title: entry.name,
          data: { content, filePath: entry.path },
        });
      }
    }
  }, [navigateTo, readFileContent, setPreview]);

  // 右键菜单 → 在资源管理器中打开
  const handleOpenInExplorer = React.useCallback(async (entry: FileEntry) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_open_path", { paths: [entry.is_dir ? entry.path : entry.path.replace(/[/\\][^/\\]+$/, "")] });
    } catch (e) {
      console.error("[ResourceExplorer] 打开资源管理器失败:", e);
    }
  }, []);

  // 右键菜单 → 复制路径
  const handleCopyPath = React.useCallback(async (entry: FileEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
    } catch { /* ignore */ }
  }, []);

  // 收藏夹折叠状态
  const [favExpanded, setFavExpanded] = React.useState(true);

  // 手动输入路径 ref
  const pathInputRef = React.useRef<HTMLInputElement>(null);

  // 判断文件图标
  const getFileIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "py": return "py";
      case "ts": case "tsx": return "ts";
      case "js": case "jsx": return "js";
      case "json": return "json";
      case "md": return "md";
      case "rs": return "rs";
      case "toml": case "yaml": case "yml": return "cfg";
      default: return "file";
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── 1. 面包屑导航 ── */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-border/40">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          title="选择目录"
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({
              directory: true,
              multiple: false,
              title: "选择浏览目录",
              defaultPath: currentDir || undefined,
            });
            if (selected && typeof selected === "string") {
              setPath(selected);
            }
          }}
        >
          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        {currentDir ? (
          <div className="flex items-center gap-0.5 overflow-x-auto text-[11px] min-w-0">
            {breadcrumbs.map((seg, i) => (
              <React.Fragment key={seg.path}>
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <button
                  className={cn(
                    "shrink-0 rounded px-1 py-0.5 hover:bg-accent/40 truncate max-w-[120px]",
                    i === breadcrumbs.length - 1 ? "text-foreground font-medium" : "text-muted-foreground",
                  )}
                  onClick={() => setPath(seg.path)}
                  title={seg.path}
                >
                  {seg.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground px-1">尚未选择目录</span>
        )}
      </div>

      {/* ── 2. 搜索框 ── */}
      <div className="relative shrink-0 px-2 py-0.5">
        <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-6 pl-6 text-[11px] rounded-[8px] border-white/[0.08]"
          placeholder="搜索文件..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ── 3. 收藏夹（可折叠） ── */}
      {favorites.length > 0 && (
        <div className="shrink-0 border-t border-border/40">
          <button
            className="flex w-full items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/20 transition-colors"
            onClick={() => setFavExpanded(!favExpanded)}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", favExpanded && "rotate-90")} />
            <Star className="h-3 w-3 text-amber-400" />
            <span>收藏夹</span>
            <span className="ml-auto text-[10px] opacity-60">{favorites.length}</span>
          </button>
          {favExpanded && (
            <div className="max-h-[120px] overflow-y-auto">
              {favorites.map((fav) => (
                <ContextMenu key={fav.path}>
                  <ContextMenuTrigger asChild>
                    <div
                      className="flex h-[22px] cursor-pointer items-center gap-1.5 rounded px-2 pl-5 text-[11px] hover:bg-accent/40 transition-colors"
                      onClick={() => setPath(fav.is_dir ? fav.path : fav.path.replace(/[/\\][^/\\]+$/, ""))}
                    >
                      {fav.is_dir ? (
                        <Folder className="h-3 w-3 text-blue-400 shrink-0" />
                      ) : (
                        <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate">{fav.name}</span>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(fav);
                        }}
                      >
                        <StarOff className="h-2.5 w-2.5 text-amber-400" />
                      </Button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    <ContextMenuItem onClick={() => setPath(fav.is_dir ? fav.path : fav.path.replace(/[/\\][^/\\]+$/, ""))}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      定位
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => toggleFavorite(fav)}>
                      <StarOff className="mr-2 h-3.5 w-3.5" />
                      移除收藏
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 4. 文件列表 ── */}
      <div className="flex-1 overflow-hidden border-t border-border/40">
        <ScrollFade className="h-full" fadeFrom="from-panel" fadeHeight="h-3">
          {loading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <p className="text-[10px] px-2 text-center">{error}</p>
            </div>
          ) : !currentDir ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-[11px] text-muted-foreground">
              <Folder className="h-5 w-5 opacity-40" />
              <p>点击 📂 图标选择要浏览的目录</p>
              <p className="text-[10px] opacity-60">或输入路径：</p>
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const val = pathInputRef.current?.value?.trim();
                  if (val) setPath(val);
                }}
              >
                <Input
                  ref={pathInputRef}
                  className="h-6 w-40 text-[11px]"
                  placeholder="如 D:/projects/..."
                />
                <Button type="submit" variant="outline" size="sm" className="h-6 text-[10px]">
                  确认
                </Button>
              </form>
            </div>
          ) : searchLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
              <span className="text-[11px]">搜索中...</span>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-[11px] text-muted-foreground">
              <File className="h-4 w-4 opacity-40 mb-1" />
              {search.trim() ? "无匹配文件" : "目录为空"}
            </div>
          ) : (
            <div className="py-0.5">
              {/* 搜索模式：显示扁平列表 + 相对路径 */}
              {search.trim() ? (
                <>
                  <div className="px-2 py-0.5 text-[10px] text-muted-foreground border-b border-border/20 mb-0.5">
                    搜索结果（{filteredEntries.length} 项）
                  </div>
                  {filteredEntries.map((entry) => (
                    <FileRow
                      key={entry.path}
                      entry={entry}
                      onClick={() => handleFileClick(entry)}
                      isFavorited={isFavorited(entry.path)}
                      onToggleFavorite={() => toggleFavorite(entry)}
                      onOpenInExplorer={() => handleOpenInExplorer(entry)}
                      onCopyPath={() => handleCopyPath(entry)}
                      getFileIcon={getFileIcon}
                      showSubPath
                    />
                  ))}
                </>
              ) : (
                <>
                  {/* 正常模式：返回上级 + 树形列表 */}
                  <div
                    className="flex h-[22px] cursor-pointer items-center gap-1.5 rounded px-2 text-[11px] hover:bg-accent/40 transition-colors"
                    onClick={navigateUp}
                  >
                    <ChevronRight className="h-3 w-3 rotate-180 text-muted-foreground" />
                    <span className="text-muted-foreground">..</span>
                  </div>
                  {filteredEntries.map((entry) => (
                    <FileRow
                      key={entry.path}
                      entry={entry}
                      onClick={() => handleFileClick(entry)}
                      isFavorited={isFavorited(entry.path)}
                      onToggleFavorite={() => toggleFavorite(entry)}
                      onOpenInExplorer={() => handleOpenInExplorer(entry)}
                      onCopyPath={() => handleCopyPath(entry)}
                      getFileIcon={getFileIcon}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </ScrollFade>
      </div>
    </div>
  );
}

// ── 文件行组件（含右键菜单） ──────────────────────────────────────────────

function FileRow({
  entry,
  onClick,
  isFavorited,
  onToggleFavorite,
  onOpenInExplorer,
  onCopyPath,
  getFileIcon,
  showSubPath,
}: {
  entry: FileEntry;
  onClick: () => void;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onOpenInExplorer: () => void;
  onCopyPath: () => void;
  getFileIcon: (name: string) => string;
  /** 搜索模式：显示相对路径 */
  showSubPath?: boolean;
}) {
  const [contextOpen, setContextOpen] = React.useState(false);

  const isDir = entry.is_dir;
  const iconType = isDir ? "folder" : getFileIcon(entry.name);

  return (
    <ContextMenu onOpenChange={setContextOpen}>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "flex h-[22px] cursor-pointer items-center gap-1.5 rounded px-2 text-[11px] transition-colors duration-150",
            contextOpen ? "bg-accent/60" : "hover:bg-accent/40",
          )}
          onClick={onClick}
        >
          <FileIcon type={iconType} isDir={isDir} />
          <span className={cn("truncate", isDir && "font-medium")}>{entry.name}</span>
          {showSubPath && (
            <span className="truncate text-[10px] text-muted-foreground/60 ml-1">
              {entry.path}
            </span>
          )}
          <div className="flex-1" />
          {isFavorited && (
            <Star className="h-2.5 w-2.5 text-amber-400 shrink-0" />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {!isDir && (
          <ContextMenuItem onClick={onClick}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            打开
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={onOpenInExplorer}>
          <FolderOpen className="mr-2 h-3.5 w-3.5" />
          在资源管理器中打开
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyPath}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          复制路径
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onToggleFavorite}>
          {isFavorited ? (
            <StarOff className="mr-2 h-3.5 w-3.5" />
          ) : (
            <Star className="mr-2 h-3.5 w-3.5" />
          )}
          {isFavorited ? "移除收藏" : "添加到收藏"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── 文件图标 ───────────────────────────────────────────────────────────────

function FileIcon({ type, isDir }: { type: string; isDir: boolean }) {
  if (isDir) {
    return <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  }

  switch (type) {
    case "py":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#306998" />
          <path d="M7 2L4 5h2v2h2V5h2L7 2z" fill="#FFD43B" />
          <path d="M7 12l-3-3h2V7h2v2h2L7 12z" fill="#FFD43B" />
        </svg>
      );
    case "ts": case "tsx":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#3178C6" />
          <text x="2" y="10.5" fontSize="8" fontWeight="bold" fill="white">TS</text>
        </svg>
      );
    case "js": case "jsx":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#F7DF1E" />
          <text x="2" y="10.5" fontSize="8" fontWeight="bold" fill="black">JS</text>
        </svg>
      );
    case "json":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#F0DB4F" />
          <text x="1" y="10.5" fontSize="7" fontWeight="bold" fill="black">{}</text>
        </svg>
      );
    case "md":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#37474F" />
          <text x="2" y="10.5" fontSize="8" fontWeight="bold" fill="white">M</text>
        </svg>
      );
    case "rs":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#DEA584" />
          <text x="1.5" y="10.5" fontSize="7" fontWeight="bold" fill="black">Rs</text>
        </svg>
      );
    case "cfg":
      return (
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 14 14" fill="none">
          <rect width="14" height="14" rx="2" fill="#607D8B" />
          <text x="1" y="10.5" fontSize="7" fontWeight="bold" fill="white">cfg</text>
        </svg>
      );
    default:
      return <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}
