"use client";

/**
 * PublishConfirmDialog — 发布确认弹窗
 *
 * 支持两种模式：
 * - "tool": Nexus-Tool 发布（选择目标、版本、描述）
 * - "skill": Skill 发布（选择目标层级、摘要展示）
 *
 * 通用模式：open/onClose/onConfirm props，footer 含取消/确认按钮。
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Textarea,
  Label,
  cn,
} from "@artifex-nexus/ui";

// ─── Tool Publish ────────────────────────────────────────────────────────────

export interface ToolPublishData {
  name: string;
  currentVersion: string;
  currentDescription?: string;
}

export interface ToolPublishResult {
  target: string;
  version: string;
  description: string;
}

// ─── Skill Publish ───────────────────────────────────────────────────────────

export interface SkillPublishData {
  name: string;
  version: string;
}

export interface SkillPublishResult {
  targetLayer: string;
}

// ─── Union Props ─────────────────────────────────────────────────────────────

export interface PublishConfirmDialogProps {
  open: boolean;
  onClose: () => void;

  /** "tool" 或 "skill" */
  kind: "tool" | "skill";

  // ── Tool 专用 ──
  toolData?: ToolPublishData;
  onConfirmTool?: (result: ToolPublishResult) => void;

  // ── Skill 专用 ──
  skillData?: SkillPublishData;
  onConfirmSkill?: (result: SkillPublishResult) => void;

  /** 是否正在执行（禁用按钮 + 显示 spinner） */
  busy?: boolean;
}

// ─── Target 选项 ─────────────────────────────────────────────────────────────

const TOOL_TARGETS: Record<string, string> = {
  official: "官方 (official)",
  marketplace: "市场 (marketplace)",
};

const SKILL_TARGET_LAYERS: Record<string, string> = {
  "01_team": "团队 (team)",
  "00_official": "官方 (official)",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function PublishConfirmDialog({
  open,
  onClose,
  kind,
  toolData,
  onConfirmTool,
  skillData,
  onConfirmSkill,
  busy = false,
}: PublishConfirmDialogProps) {
  const isTool = kind === "tool";

  // ── Tool state ──
  const [toolTarget, setToolTarget] = React.useState("marketplace");
  const [toolVersion, setToolVersion] = React.useState("");
  const [toolDesc, setToolDesc] = React.useState("");
  const [toolErrors, setToolErrors] = React.useState<Record<string, string>>({});

  // ── Skill state ──
  const [skillTargetLayer, setSkillTargetLayer] = React.useState("01_team");
  const [skillErrors, setSkillErrors] = React.useState<Record<string, string>>({});

  // ── 重置状态 ──
  React.useEffect(() => {
    if (open) {
      if (isTool && toolData) {
        setToolTarget("marketplace");
        setToolVersion(toolData.currentVersion || "");
        setToolDesc(toolData.currentDescription || "");
        setToolErrors({});
      }
      if (!isTool && skillData) {
        setSkillTargetLayer("01_team");
        setSkillErrors({});
      }
    }
  }, [open, isTool, toolData, skillData]);

  // ── 校验 ──
  const validateTool = (): boolean => {
    const errs: Record<string, string> = {};
    if (!toolTarget) errs.target = "请选择发布目标";
    if (!toolVersion.trim()) errs.version = "版本号不能为空";
    if (toolVersion.trim() && !/^\d+\.\d+\.\d+/.test(toolVersion.trim())) {
      errs.version = "版本号格式应为 x.y.z（如 1.0.0）";
    }
    setToolErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateSkill = (): boolean => {
    const errs: Record<string, string> = {};
    if (!skillTargetLayer) errs.targetLayer = "请选择发布目标层级";
    setSkillErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── 确认 ──
  const handleConfirm = () => {
    if (isTool) {
      if (!validateTool()) return;
      onConfirmTool?.({
        target: toolTarget,
        version: toolVersion.trim(),
        description: toolDesc.trim(),
      });
    } else {
      if (!validateSkill()) return;
      onConfirmSkill?.({ targetLayer: skillTargetLayer });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isTool ? "发布 Nexus-Tool" : "发布 Skill"}</DialogTitle>
          <DialogDescription>
            {isTool
              ? "发布后该工具将出现在目标分类中，其他用户可见。"
              : "发布后该 Skill 将出现在目标层级，其他用户可见。"}
          </DialogDescription>
        </DialogHeader>

        {/* ── 内容区 ── */}
        <div className="space-y-4 py-2">
          {isTool && toolData ? (
            <>
              {/* Tool Name (read-only) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">工具名称</Label>
                <div className="text-sm font-medium">{toolData.name}</div>
              </div>

              {/* Target */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  发布目标 <span className="text-red-400">*</span>
                </Label>
                <Select value={toolTarget} onValueChange={setToolTarget}>
                  <SelectTrigger className={cn(toolErrors.target && "border-red-500")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TOOL_TARGETS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {toolErrors.target && (
                  <p className="text-xs text-red-400">{toolErrors.target}</p>
                )}
              </div>

              {/* Version */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  版本号 <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={toolVersion}
                  onChange={(e) => setToolVersion(e.target.value)}
                  placeholder="例如 1.0.0"
                  className={cn("h-8 text-sm", toolErrors.version && "border-red-500")}
                />
                {toolErrors.version ? (
                  <p className="text-xs text-red-400">{toolErrors.version}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">格式：主版本.次版本.修订号</p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">发布说明（可选）</Label>
                <Textarea
                  value={toolDesc}
                  onChange={(e) => setToolDesc(e.target.value)}
                  placeholder="描述此次发布的变更内容..."
                  rows={3}
                  className="text-sm resize-none"
                />
              </div>
            </>
          ) : !isTool && skillData ? (
            <>
              {/* Skill Name (read-only) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Skill 名称</Label>
                <div className="text-sm font-medium">{skillData.name}</div>
              </div>

              {/* Version (read-only) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">版本</Label>
                <div className="text-sm text-muted-foreground">{skillData.version || "unknown"}</div>
              </div>

              {/* Target Layer */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  发布到层级 <span className="text-red-400">*</span>
                </Label>
                <Select value={skillTargetLayer} onValueChange={setSkillTargetLayer}>
                  <SelectTrigger className={cn(skillErrors.targetLayer && "border-red-500")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SKILL_TARGET_LAYERS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {skillErrors.targetLayer && (
                  <p className="text-xs text-red-400">{skillErrors.targetLayer}</p>
                )}
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={busy}>
            {busy ? "发布中..." : "确认发布"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
