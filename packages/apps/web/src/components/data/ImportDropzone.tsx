"use client";

/**
 * ImportDropzone — 数据导入区（C1 区域内的入口按钮 + 弹出面板）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §2.1：
 *   三入口：拖拽文件 / 选择文件 / 粘贴 JSON
 *   支持 CSV (.csv) 和 JSON 数组 (.json)
 */

import * as React from "react";
import { Upload, Clipboard, X } from "lucide-react";

import { parseCSV } from "../../features/data/parser/csv-parser";
import { parseJSONArray } from "../../features/data/parser/json-parser";
import { DataPageContext } from "./DataPage";
import { uiLog } from "../../lib/ui-log";

/** 最大文件大小（5 MB） */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export function ImportDropzone() {
  const { dispatch } = React.useContext(DataPageContext);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [jsonText, setJsonText] = React.useState("");
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 关闭面板时重置
  const closePanel = React.useCallback(() => {
    setPanelOpen(false);
    setDragOver(false);
    setJsonText("");
    setPasteOpen(false);
  }, []);

  // 处理文件内容
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
        const ext = file.name.split(".").pop()?.toLowerCase();
        const result = ext === "json" ? parseJSONArray(text) : parseCSV(text);

        if (result.ok && result.data) {
          dispatch({ type: "IMPORT_OK", andf: result.data });
        } else {
          dispatch({
            type: "IMPORT_ERROR",
            message: result.error?.message ?? "未知解析错误",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "文件读取失败";
        uiLog.error("ImportDropzone", "fileReadError", { error: msg });
        dispatch({ type: "IMPORT_ERROR", message: msg });
      } finally {
        setImporting(false);
      }
    },
    [dispatch, closePanel],
  );

  // 拖拽事件
  const handleDragOver = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    [],
  );

  const handleDragLeave = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
    },
    [],
  );

  const handleDrop = React.useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
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
                dragOver
                  ? "border-primary bg-primary/[0.04]"
                  : "border-white/[0.08] bg-white/[0.01]"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                拖拽 CSV 或 JSON 文件到此处
              </p>
              <p className="text-xs text-muted-foreground/60">或</p>
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
              <span className="text-[10px] text-muted-foreground/60">或</span>
              <div className="flex-1 border-t border-white/[0.06]" />
            </div>

            {/* 粘贴 JSON */}
            {pasteOpen ? (
              <div className="flex flex-col gap-3">
                <textarea
                  className="h-[120px] w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.02] p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/30 focus:outline-none"
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
                className="flex w-full items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] py-2.5 text-xs text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
                onClick={() => setPasteOpen(true)}
                disabled={importing}
              >
                <Clipboard className="h-3.5 w-3.5" />
                粘贴 JSON 数据
              </button>
            )}

            {/* 底部说明 */}
            <p className="mt-3 text-center text-[10px] text-muted-foreground/50">
              支持 CSV (.csv) 和 JSON 数组 (.json) 格式
            </p>
          </div>
        </>
      )}
    </>
  );
}
