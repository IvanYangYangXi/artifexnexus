"use client";

/**
 * ObjectTypePicker — DCC 对象类型多选搜索组件
 *
 * 从 ArtClaw ObjectTypePicker 移植并适配 Artifex Nexus 主题。
 * DCC 连接时可通过 MCP 实时查询对象类型；未连接时使用静态预设列表。
 * 支持搜索过滤、手动输入自定义类型（Enter 添加）、标签展示。
 */

import * as React from "react";
import {
  X,
  ChevronDown,
  Loader2,
  Wifi,
  WifiOff,
  Check,
  RefreshCw,
} from "lucide-react";
import { cn } from "@artifex-nexus/ui";
import { DCCStatusContext } from "../shell/AppShell";
import { fetchDccObjectTypes } from "../../lib/nexus-tool/nexus-tool-api";

// ── DCC 预设对象类型 ────────────────────────────────────────────────────

const DCC_TYPE_PRESETS: Record<string, string[]> = {
  blender: [
    "Mesh", "Camera", "Light", "Armature", "Material",
    "Collection", "Empty", "Curve", "Text", "MetaBall",
    "Lattice", "Speaker", "ForceField", "LightProbe", "GPencil",
  ],
  unreal_engine: [
    "StaticMesh", "SkeletalMesh", "Material", "Texture",
    "Blueprint", "Level", "ParticleSystem", "SoundCue",
    "AnimationSequence", "MaterialInstance", "NiagaraSystem",
    "World", "Actor", "Pawn", "Character",
  ],
  maya: [
    "mesh", "camera", "light", "joint", "nurbsCurve",
    "locator", "material", "transform", "group", "ikHandle",
  ],
  "3ds_max": [
    "Editable_Mesh", "Camera", "Light", "Bone", "Helper",
    "Shape", "SplineShape", "Editable_Poly", "Editable_Spline", "Dummy",
  ],
  houdini: [
    "geo", "camera", "light", "bone", "null",
    "material", "ropnet", "obj", "sop", "dop",
  ],
  comfyui: [
    "Checkpoint", "LoRA", "VAE", "CLIP", "ControlNet",
    "UpscaleModel", "KSampler", "CLIPTextEncode", "VAEDecode", "SaveImage",
  ],
  general: [
    "file", "directory", "project",
  ],
};

interface ObjectTypePickerProps {
  value: string[];
  onChange: (types: string[]) => void;
  dcc: string;
  placeholder?: string;
  className?: string;
}

interface TypeItem {
  type: string;
  label: string;
}

export function ObjectTypePicker({
  value,
  onChange,
  dcc,
  placeholder = "搜索或输入对象类型...",
  className,
}: ObjectTypePickerProps) {
  const { dccStatus } = React.useContext(DCCStatusContext);
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [types, setTypes] = React.useState<TypeItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [source, setSource] = React.useState<"live" | "preset" | "">("");

  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // 判断 DCC 是否已连接
  const isConnected = React.useMemo(() => {
    if (!dcc) return false;
    const status = dccStatus.find(
      (s) => s.name.toLowerCase() === dcc.toLowerCase(),
    );
    return status?.connected ?? false;
  }, [dcc, dccStatus]);

  // 加载类型列表 — 优先通过 MCP 实时查询，失败则 fallback 到预设
  const loadTypes = React.useCallback(async () => {
    if (!dcc) return;
    setLoading(true);

    // 始终尝试 MCP 实时查询（不依赖 dccStatus 连接状态）
    try {
      const liveTypes = await fetchDccObjectTypes(dcc);
      if (liveTypes.length > 0) {
        setTypes(liveTypes.map((t) => ({ type: t, label: t })));
        setSource("live");
        setLoading(false);
        return;
      }
    } catch {
      // MCP 查询失败 → fallback 到预设
    }

    // Fallback: 使用静态预设列表
    const presetKey = Object.keys(DCC_TYPE_PRESETS).find(
      (k) => k.toLowerCase() === dcc.toLowerCase(),
    );
    const presetTypes = presetKey
      ? DCC_TYPE_PRESETS[presetKey].map((t) => ({ type: t, label: t }))
      : [];

    setTypes(presetTypes);
    setSource("preset");
    setLoading(false);
  }, [dcc]);

  React.useEffect(() => {
    setTypes([]);
    setSource("");
    if (dcc) loadTypes();
  }, [dcc]); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击外部关闭
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 搜索过滤
  const filtered = types.filter(
    (t) =>
      t.type.toLowerCase().includes(search.toLowerCase()) ||
      t.label.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedSet = new Set(value);

  const toggleType = (type: string) => {
    if (selectedSet.has(type)) {
      onChange(value.filter((v) => v !== type));
    } else {
      onChange([...value, type]);
    }
  };

  const removeType = (type: string) => {
    onChange(value.filter((v) => v !== type));
  };

  // Enter 添加自定义类型
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      e.preventDefault();
      const trimmed = search.trim();
      if (!selectedSet.has(trimmed)) {
        onChange([...value, trimmed]);
      }
      setSearch("");
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
    if (e.key === "Backspace" && !search && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const inputCls =
    "bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground flex-1 min-w-[80px]";

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* 输入区域 + 已选标签 */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 min-h-[32px] px-2 py-1 rounded border transition-colors cursor-text",
          "bg-muted/20 border-border/60",
          open && "border-primary/40 ring-1 ring-primary/20",
        )}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {/* 已选标签 */}
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[11px] font-mono"
          >
            {v}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeType(v);
              }}
              className="hover:text-red-400 transition-colors ml-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {/* 搜索输入 */}
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          className={inputCls}
        />

        {/* 状态指示器 */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {loading && (
            <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
          )}
          {!loading && source === "live" && (
            <span title="DCC 已连接">
              <Wifi className="w-3 h-3 text-emerald-400" />
            </span>
          )}
          {!loading && source === "preset" && (
            <span title="静态预设（DCC 未连接）">
              <WifiOff className="w-3 h-3 text-muted-foreground" />
            </span>
          )}
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-[220px] overflow-y-auto rounded border border-border/60 bg-card shadow-lg">
          {/* 来源指示 */}
          {source && (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/40 flex items-center gap-1.5">
              {source === "live" ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-400" /> DCC 已连接
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-muted-foreground" />{" "}
                  静态预设（DCC 未连接）
                </>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  loadTypes();
                }}
                className="ml-auto text-primary hover:text-primary/80 text-[10px] flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> 刷新
              </button>
            </div>
          )}

          {loading ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">
              {search ? (
                <>
                  未找到匹配类型，
                  <span
                    className="text-primary cursor-pointer"
                    onClick={() => {
                      if (search.trim()) {
                        toggleType(search.trim());
                        setSearch("");
                      }
                    }}
                  >
                    按 Enter 添加 "{search}"
                  </span>
                </>
              ) : (
                "暂无可用类型"
              )}
            </div>
          ) : (
            <div className="py-1">
              {filtered.map((t) => {
                const selected = selectedSet.has(t.type);
                return (
                  <button
                    key={t.type}
                    onClick={() => {
                      toggleType(t.type);
                      setSearch("");
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors flex items-center gap-2",
                      selected
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-[9px]",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60",
                      )}
                    >
                      {selected && <Check className="w-2.5 h-2.5" />}
                    </span>
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 提示 */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/40">
            输入自定义类型后按 Enter 添加
          </div>
        </div>
      )}
    </div>
  );
}
