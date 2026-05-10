"use client";

/**
 * QuickLinkDialog — 添加/编辑自定义连接对话框
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §3 B1-自定义
 */

import * as React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@artifex-nexus/ui";
import type { QuickLink, QuickLinkType } from "../../lib/quickLinks";
import { QUICK_LINK_TYPE_META } from "../../lib/quickLinks";

interface QuickLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (link: Omit<QuickLink, "id" | "order"> & { id?: string }) => void;
  /** 编辑模式：传入已有链接 */
  existing?: QuickLink;
}

export function QuickLinkDialog({
  open,
  onClose,
  onSave,
  existing,
}: QuickLinkDialogProps) {
  const [type, setType] = React.useState<QuickLinkType>(
    existing?.type ?? "url",
  );
  const [name, setName] = React.useState(existing?.name ?? "");
  const [target, setTarget] = React.useState(existing?.target ?? "");

  // 重置表单（仅在 open 从 false→true 时）
  const prevOpen = React.useRef(open);
  React.useEffect(() => {
    if (open && !prevOpen.current) {
      setType(existing?.type ?? "url");
      setName(existing?.name ?? "");
      setTarget(existing?.target ?? "");
    }
    prevOpen.current = open;
  }, [open, existing]);

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedTarget = target.trim();
    if (!trimmedName || !trimmedTarget) return;
    onSave({
      id: existing?.id,
      type,
      name: trimmedName,
      target: trimmedTarget,
    });
    onClose();
  };

  const isValid = name.trim().length > 0 && target.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{existing ? "编辑连接" : "添加连接"}</DialogTitle>
          <DialogDescription>
            添加网页链接、文件目录、文件或脚本快捷入口
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* 类型选择 */}
          <div className="grid gap-1.5">
            <Label htmlFor="ql-type">类型</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as QuickLinkType)}
            >
              <SelectTrigger id="ql-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(QUICK_LINK_TYPE_META) as [QuickLinkType, typeof QUICK_LINK_TYPE_META["url"]][]).map(
                  ([key, meta]) => (
                    <SelectItem
                      key={key}
                      value={key}
                      disabled={meta.disabled}
                    >
                      {meta.icon} {meta.label}
                      {meta.disabled && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ({meta.disabledReason})
                        </span>
                      )}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 名称 */}
          <div className="grid gap-1.5">
            <Label htmlFor="ql-name">名称</Label>
            <Input
              id="ql-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="显示名称"
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValid) handleSave();
              }}
            />
          </div>

          {/* 路径/URL */}
          <div className="grid gap-1.5">
            <Label htmlFor="ql-target">
              {type === "url" ? "URL" : "路径"}
            </Label>
            <Input
              id="ql-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={QUICK_LINK_TYPE_META[type].placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isValid) handleSave();
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {existing ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
