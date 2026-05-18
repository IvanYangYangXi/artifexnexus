"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "@artifex-nexus/ui";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        title="上一页"
      >
        <ChevronLeft className="h-3 w-3" />
      </Button>
      <span className="text-muted-foreground min-w-[40px] text-center tabular-nums">
        {page}/{totalPages}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        title="下一页"
      >
        <ChevronRight className="h-3 w-3" />
      </Button>
    </div>
  );
}
