"use client";

/**
 * FiltersTab — 筛选条件编辑区
 *
 * 包含：
 *   1. DCC 选择器 — 确定查询哪个 DCC 的对象类型
 *   2. ObjectTypePicker — 多选对象类型（支持搜索和自定义输入）
 *   3. 路径规则列表 — glob 模式匹配文件路径，支持分页
 */

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, cn } from "@artifex-nexus/ui";
import { ObjectTypePicker } from "../common/ObjectTypePicker";
import { Pagination } from "../common/Pagination";
import type { DCCEntry, FilterConfig } from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS } from "../../lib/skillsMock";

interface FiltersTabProps {
  filters: FilterConfig;
  onChange: (filters: FilterConfig) => void;
  software: DCCEntry[];
  compact?: boolean;
}

const PAGE_SIZE = 5;

export function FiltersTab({
  filters,
  onChange,
  software,
  compact,
}: FiltersTabProps) {
  const [page, setPage] = React.useState(1);

  const dccNames = software.map((e) => e.dcc);
  const dccOptions = ["", "general", ...dccNames];
  const selectedDcc = filters.dcc || dccNames[0] || "";
  const pathRules = filters.path || [];
  const selectedTypes = filters.types || [];

  const totalPages = Math.max(1, Math.ceil(pathRules.length / PAGE_SIZE));
  const pagedRules = pathRules.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const notify = (
    newPaths: typeof pathRules,
    newTypes: string[],
    dcc: string,
  ) => {
    onChange({
      ...filters,
      path: newPaths,
      types: newTypes.length ? newTypes : undefined,
      dcc: dcc || undefined,
    });
  };

  const handleDccChange = (dcc: string) => {
    notify(pathRules, selectedTypes, dcc);
  };

  const handleTypesChange = (types: string[]) => {
    notify(pathRules, types, selectedDcc);
  };

  const updatePath = (index: number, value: string) => {
    const next = [...pathRules];
    next[index] = { pattern: value };
    notify(next, selectedTypes, selectedDcc);
  };

  const removePath = (index: number) => {
    const globalIndex = (page - 1) * PAGE_SIZE + index;
    const next = pathRules.filter((_, i) => i !== globalIndex);
    // 如果删除后当前页为空，回退页码
    if (pagedRules.length <= 1 && page > 1) {
      setPage(page - 1);
    }
    notify(next, selectedTypes, selectedDcc);
  };

  const addPath = () => {
    const next = [...pathRules, { pattern: "" }];
    // 跳转到最后一页
    const newTotal = Math.ceil(next.length / PAGE_SIZE);
    setPage(newTotal);
    notify(next, selectedTypes, selectedDcc);
  };

  const inputCls =
    "h-7 text-xs rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2 focus:outline-none focus:border-primary/40 transition-colors font-mono";

  return (
    <div className="space-y-4">
      {/* ── DCC 选择器 ── */}
      <div>
        <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          DCC 软件
        </label>
        <select
          value={selectedDcc}
          onChange={(e) => handleDccChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-input px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full max-w-[200px] [color-scheme:dark] [&_option]:bg-card [&_option]:text-foreground"
        >
          <option value="">选择 DCC</option>
          {dccOptions.slice(1).map((dcc) => (
            <option key={dcc} value={dcc}>
              {(DCC_LABELS as Record<string, string>)[dcc] || dcc}
            </option>
          ))}
        </select>
      </div>

      {/* ── 对象类型 ── */}
      <div>
        <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
          对象类型
        </label>
        {selectedDcc ? (
          <ObjectTypePicker
            value={selectedTypes}
            onChange={handleTypesChange}
            dcc={selectedDcc}
          />
        ) : (
          <div className="text-[11px] text-muted-foreground py-2 px-3 rounded bg-muted/10 border border-border/40">
            请先选择 DCC 软件以加载可用对象类型
          </div>
        )}
      </div>

      {/* ── 路径规则 ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            路径规则
          </label>
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>

        <div className="space-y-1.5 mb-2">
          {pagedRules.map((rule, i) => (
            <div key={`${(page - 1) * PAGE_SIZE + i}`} className="flex items-center gap-1.5">
              <Input
                type="text"
                value={rule.pattern}
                onChange={(e) => updatePath((page - 1) * PAGE_SIZE + i, e.target.value)}
                placeholder="/Game/Content/**/*"
                className={cn(inputCls, "flex-1")}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => removePath(i)}
                title="删除路径规则"
              >
                <Trash2 className="h-3 w-3 text-red-400" />
              </Button>
            </div>
          ))}
        </div>

        {pathRules.length === 0 && (
          <div className="text-[11px] text-muted-foreground py-1 mb-2">
            暂无路径规则（匹配全部路径）
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addPath}
        >
          <Plus className="mr-1 h-3 w-3" />
          添加路径规则
        </Button>

        {/* 路径规则示例（gitignore 风格） */}
        <div className="mt-3 rounded bg-muted/10 border border-border/30 px-3 py-2">
          <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
            匹配规则（gitignore 风格）
          </div>
          <div className="space-y-0.5 text-[10px] font-mono text-muted-foreground/70">
            <div><span className="text-primary/70">*.blend</span>          — 匹配所有 .blend 文件</div>
            <div><span className="text-primary/70">**/Textures/*</span>    — 匹配任意子目录下的 Textures</div>
            <div><span className="text-primary/70">!important.blend</span> — 排除此文件（取反）</div>
            <div><span className="text-primary/70">Scenes/*.blend</span>   — 匹配 Scenes/ 下 .blend</div>
            <div><span className="text-primary/70">**/*_LOD*</span>       — 匹配所有含 _LOD 的文件</div>
          </div>
        </div>

        {/* 路径变量帮助 */}
        <div className="mt-3 rounded bg-muted/10 border border-border/30 px-3 py-2">
          <div className="text-[10px] font-medium text-muted-foreground mb-1">
            支持变量
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono text-muted-foreground/70">
            <div>$project — 项目根目录</div>
            <div>$content — Content 目录</div>
            <div>$game — Game 目录</div>
            <div>$scene — 当前场景路径</div>
            <div>$asset — 当前资源路径</div>
            <div>$selection — 选中对象路径</div>
          </div>
        </div>
      </div>
    </div>
  );
}
