"use client";

/**
 * ImportDropzone — 数据导入区（C1 区域内的入口按钮 + 弹出面板）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §2.1：
 *   三入口：拖拽文件 / 选择文件 / 粘贴 JSON
 *   支持 CSV (.csv) 和 JSON 数组 (.json)
 *
 * 拖拽优化（2026-06-05）：
 *   1. 通过 Tauri v2 `onDragDropEvent` 监听原生 file drop（Tauri 默认拦截 HTML5 DnD）
 *   2. window 级 dragover/drop 兜底（dev 模式 / 普通浏览器）
 *   3. 整页接收拖入，无需用户必须把文件丢进弹窗
 */

import * as React from "react";
import { Upload, Clipboard, X } from "lucide-react";

import { parseCSV } from "../../features/data/parser/csv-parser";
import { parseJSONArray } from "../../features/data/parser/json-parser";
import { DataPageContext } from "./DataPage";
import { uiLog } from "../../lib/ui-log";

/** 最大文件大小（50 MB） */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 全局拖拽状态（供 window 监听+面板提示共用） */
function useGlobalDragHover() {
  const [hover, setHover] = React.useState(false);
  React.useEffect(() => {
    let counter = 0;
    const onEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        counter++;
        setHover(true);
      }
    };
    const onLeave = () => {
      counter = Math.max(0, counter - 1);
      if (counter === 0) setHover(false);
    };
    const onDrop = () => {
      counter = 0;
      setHover(false);
    };
    // dragover 必须 preventDefault，否则 drop 不触发（也避免 WebView 默认行为）
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
  return hover;
}

export function ImportDropzone() {
  const { dispatch } = React.useContext(DataPageContext);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [jsonText, setJsonText] = React.useState("");
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const globalHover = useGlobalDragHover();

  // 关闭面板时重置
  const closePanel = React.useCallback(() => {
    setPanelOpen(false);
    setDragOver(false);
    setJsonText("");
    setPasteOpen(false);
  }, []);

  /** 把文本内容当作 CSV 或 JSON 解析（路径或文件名决定扩展名） */
  const processText = React.useCallback(
    (name: string, text: string) => {
      const ext = name.split(".").pop()?.toLowerCase();
      if (ext !== "csv" && ext !== "json") {
        dispatch({
          type: "IMPORT_ERROR",
          message: `不支持的文件类型：.${ext ?? "?"}（仅支持 .csv / .json）`,
        });
        return;
      }
      const result = ext === "json" ? parseJSONArray(text) : parseCSV(text);
      if (result.ok && result.data) {
        dispatch({ type: "IMPORT_OK", andf: result.data });
      } else {
        dispatch({
          type: "IMPORT_ERROR",
          message: result.error?.message ?? "未知解析错误",
        });
      }
    },
    [dispatch],
  );

  // 处理 File 对象（HTML5 DnD 或 input[type=file]）
  const processFile = React.useCallback(
    async (file: File) => {
      uiLog.custom("ImportDropzone", "processFile", { name: file.name, size: file.size });

      if (file.size > MAX_FILE_SIZE) {
        dispatch({
          type: "IMPORT_ERROR",
          message: `文件过大：${(file.size / 1024 / 1024).toFixed(1)} MB（上限 5 MB）`,
        });
        return;
      }

      dispatch({ type: "START_IMPORT" });
      setImporting(true);
      closePanel();

      try {
        const text = await file.text();
        processText(file.name, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "文件读取失败";
        uiLog.error("ImportDropzone", "fileReadError", { error: msg });
        dispatch({ type: "IMPORT_ERROR", message: msg });
      } finally {
        setImporting(false);
      }
    },
    [dispatch, closePanel, processText],
  );

  // 处理 Tauri 原生拖入的文件路径
  const processPath = React.useCallback(
    async (path: string) => {
      uiLog.custom("ImportDropzone", "processPath", { path });
      dispatch({ type: "START_IMPORT" });
      setImporting(true);
      closePanel();
      try {
        // 通过 Tauri 命令读取文件文本（已扩到 5MB 上限）
        const { invoke } = await import("@tauri-apps/api/core");
        const res = await invoke<{ ok: boolean; content: string; error?: string }>(
          "read_file_text",
          { path },
        );
        if (!res.ok) {
          dispatch({ type: "IMPORT_ERROR", message: res.error ?? "读取文件失败" });
          return;
        }
        const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
        processText(name, res.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Tauri 读取文件失败";
        uiLog.error("ImportDropzone", "tauriReadError", { error: msg });
        dispatch({ type: "IMPORT_ERROR", message: msg });
      } finally {
        setImporting(false);
      }
    },
    [dispatch, closePanel, processText],
  );

  // ── Tauri 原生 file drop 监听（Tauri 默认拦截 HTML5 DnD，必须走这条通道）──
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const wv = getCurrentWebview();
        const off = await wv.onDragDropEvent((event) => {
          const p = event.payload as { type?: string; paths?: string[] };
          if (p?.type === "drop" && Array.isArray(p.paths) && p.paths.length > 0) {
            const path = p.paths[0];
            processPath(path);
          }
        });
        if (cancelled) {
          off();
        } else {
          unlisten = off;
        }
      } catch {
        // 非 Tauri 环境（浏览器 dev）静默跳过，由 HTML5 DnD 兜底
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [processPath]);

  // ── HTML5 DnD 兜底（浏览器环境 + 弹窗内）──
  // 注意：Tauri 默认会吞掉 HTML5 drop，但 dev 模式下浏览器仍可用
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = React.useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) await processFile(file);
    },
    [processFile],
  );

  // 选择文件
  const handleFileSelect = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await processFile(file);
      // 重置 input 以允许重复选同一文件
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [processFile],
  );

  // 粘贴 JSON
  const handlePasteSubmit = React.useCallback(() => {
    if (!jsonText.trim()) return;
    uiLog.custom("ImportDropzone", "pasteJSON", { length: jsonText.length });

    dispatch({ type: "START_IMPORT" });
    setImporting(true);

    try {
      const result = parseJSONArray(jsonText);
      if (result.ok && result.data) {
        dispatch({ type: "IMPORT_OK", andf: result.data });
        closePanel();
      } else {
        dispatch({
          type: "IMPORT_ERROR",
          message: result.error?.message ?? "JSON 解析失败",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知解析错误";
      dispatch({ type: "IMPORT_ERROR", message: msg });
    } finally {
      setImporting(false);
    }
  }, [jsonText, dispatch, closePanel]);

  // 全局拖入时自动弹面板 + 高亮提示
  React.useEffect(() => {
    if (globalHover && !panelOpen) setPanelOpen(true);
  }, [globalHover, panelOpen]);

  const showDragHighlight = dragOver || globalHover;

  return (
    <>
      {/* 入口按钮 */}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
        onClick={() => setPanelOpen(true)}
      >
        <Upload className="h-3.5 w-3.5" />
        导入
      </button>

      {/* 弹出面板 */}
      {panelOpen && (
        <>
          {/* 遮罩 */}
          <div className="fixed inset-0 z-40" onClick={closePanel} />

          {/* 面板 */}
          <div className="absolute left-1/2 top-20 z-50 w-[420px] -translate-x-1/2 rounded-lg border border-white/[0.08] bg-background/95 p-5 shadow-xl backdrop-blur-xl">
            {/* 标题栏 */}
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">导入数据</h3>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={closePanel}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 拖拽区 */}
            <div
              className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
                showDragHighlight
                  ? "border-primary bg-primary/[0.08]"
                  : "border-white/[0.08] bg-white/[0.01]"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload className={`h-8 w-8 ${showDragHighlight ? "text-primary" : "text-muted-foreground"}`} />
              <p className={`text-sm ${showDragHighlight ? "text-primary" : "text-foreground/70"}`}>
                {showDragHighlight ? "松开即可导入" : "拖拽 CSV 或 JSON 文件到此处"}
              </p>
              <p className="text-xs text-foreground/50">或</p>
              <label className="cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-foreground transition-colors hover:bg-white/[0.08]">
                选择文件
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={importing}
                />
              </label>
            </div>

            {/* 分隔 */}
            <div className="my-4 flex items-center gap-3">
              <div className="flex-1 border-t border-white/[0.06]" />
              <span className="text-[10px] text-foreground/50">或</span>
              <div className="flex-1 border-t border-white/[0.06]" />
            </div>

            {/* 粘贴 JSON */}
            {pasteOpen ? (
              <div className="flex flex-col gap-3">
                <textarea
                  className="h-[120px] w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.02] p-3 font-mono text-xs text-foreground placeholder:text-foreground/40 focus:border-primary/30 focus:outline-none"
                  placeholder='[{"x": 1, "y": "a"}, ...]'
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  disabled={importing}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => { setPasteOpen(false); setJsonText(""); }}
                    disabled={importing}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-primary/80 px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary disabled:opacity-50"
                    onClick={handlePasteSubmit}
                    disabled={importing || !jsonText.trim()}
                  >
                    {importing ? "解析中..." : "确认导入"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] py-2.5 text-xs text-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground"
                onClick={() => setPasteOpen(true)}
                disabled={importing}
              >
                <Clipboard className="h-3.5 w-3.5" />
                粘贴 JSON 数据
              </button>
            )}

            {/* 底部说明 */}
            <p className="mt-3 text-center text-[10px] text-foreground/50">
              支持 CSV (.csv) 和 JSON 数组 (.json) 格式
            </p>
          </div>
        </>
      )}
    </>
  );
}
