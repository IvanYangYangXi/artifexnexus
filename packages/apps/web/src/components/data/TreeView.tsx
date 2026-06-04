"use client";

/**
 * TreeView — 树形直展视图（STORY-0070）
 *
 * parentId 模式构建树结构：
 *   - label 槽位：节点名
 *   - parentId 槽位：父节点字段（null = 根节点）
 *   - expanded 槽位：初始展开状态
 *   拖拽改变节点父子关系，产出 move Diff。
 */

import * as React from "react";
import { ChevronRight, ChevronDown, GripVertical } from "lucide-react";

import { DataPageContext, type DiffChange } from "./DataPage";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { InlineFieldEditor } from "./shared/InlineFieldEditor";
import { uiLog } from "../../lib/ui-log";
import type { Column } from "@artifex-nexus/contracts";

// ─── 树节点结构 ────────────────────────────────────────────────────────────

interface TreeNode {
  rowIndex: number;
  label: string;
  children: TreeNode[];
  expanded: boolean;
}

// ─── 拖拽状态 ──────────────────────────────────────────────────────────────

interface DragState {
  rowIndex: number;
  nodeLabel: string;
}

export function TreeView() {
  const { andf, dispatch } = React.useContext(DataPageContext);
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());
  const [editingNode, setEditingNode] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  if (!andf) return null;

  const slots = mapColumnsToSlots("tree", andf.columns as Column[]);
  const labelField = slots.find((s) => s.name === "label")?.field;
  const parentIdField = slots.find((s) => s.name === "parentId")?.field;

  if (!labelField) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
        缺少 label 槽位，请指定节点名称字段
      </div>
    );
  }

  // 构建树
  const tree = buildTree(andf.rows, labelField, parentIdField ?? null, expanded);

  // ─── 操作 ────────────────────────────────────────────────────────────────

  const toggleExpand = (rowIdx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  };

  const startEdit = (rowIdx: number) => {
    dispatch({ type: "START_EDIT" });
    setEditingNode(rowIdx);
  };

  const commitEdit = (rowIdx: number, value: unknown) => {
    dispatch({ type: "APPLY_UPDATE", rowIndex: rowIdx, column: labelField, value });
    const change: DiffChange = { op: "update", row: rowIdx, column: labelField, value };
    dispatch({ type: "ADD_DIFF", change });
    dispatch({ type: "CANCEL_EDIT" });
    setEditingNode(null);
    uiLog.custom("TreeView", "rename", { row: rowIdx, newLabel: value });
  };

  const cancelEdit = () => {
    dispatch({ type: "CANCEL_EDIT" });
    setEditingNode(null);
  };

  // 拖拽
  const handleDragStart = (rowIdx: number) => {
    const label = andf.rows[rowIdx]?.[labelField];
    setDrag({ rowIndex: rowIdx, nodeLabel: String(label ?? "") });
  };

  const handleDragOver = (e: React.DragEvent, rowIdx: number) => {
    e.preventDefault();
    setDragOver(rowIdx);
  };

  const handleDragLeave = () => setDragOver(null);

  const handleDrop = (targetRowIdx: number) => {
    setDragOver(null);
    if (!drag || drag.rowIndex === targetRowIdx) {
      setDrag(null);
      return;
    }
    // 检查不能拖到自己的子孙节点
    if (isDescendant(andf.rows, labelField, parentIdField ?? null, drag.rowIndex, targetRowIdx)) {
      uiLog.custom("TreeView", "dropBlocked", { reason: "descendant", from: drag.rowIndex, to: targetRowIdx });
      setDrag(null);
      return;
    }

    const targetId = andf.rows[targetRowIdx]?.[labelField] ?? String(targetRowIdx);
    const change: DiffChange = {
      op: "move",
      row: drag.rowIndex,
      rowId: String(andf.rows[drag.rowIndex]?.[labelField] ?? drag.rowIndex),
      toParent: String(targetId),
      toIndex: 0,
    };
    dispatch({ type: "ADD_DIFF", change });
    // in-place 更新 parentId
    dispatch({ type: "APPLY_UPDATE", rowIndex: drag.rowIndex, column: parentIdField ?? "parentId", value: targetId });
    uiLog.custom("TreeView", "drop", { from: drag.rowIndex, to: targetRowIdx });
    setDrag(null);
  };

  const handleDragEnd = () => setDrag(null);

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  return (
    <div className="p-2">
      {tree.length === 0 && (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          无数据
        </div>
      )}
      {tree.map((node) => (
        <TreeNodeRow
          key={node.rowIndex}
          node={node}
          depth={0}
          labelField={labelField}
          editingNode={editingNode}
          drag={drag}
          dragOver={dragOver}
          onToggle={toggleExpand}
          onStartEdit={startEdit}
          onCommitEdit={commitEdit}
          onCancelEdit={cancelEdit}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}

// ─── 递归行组件 ────────────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  labelField,
  editingNode,
  drag,
  dragOver,
  onToggle,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  node: TreeNode;
  depth: number;
  labelField: string;
  editingNode: number | null;
  drag: DragState | null;
  dragOver: number | null;
  onToggle: (idx: number) => void;
  onStartEdit: (idx: number) => void;
  onCommitEdit: (idx: number, value: unknown) => void;
  onCancelEdit: () => void;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragLeave: () => void;
  onDrop: (idx: number) => void;
  onDragEnd: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const isEditing = editingNode === node.rowIndex;
  const isDragging = drag?.rowIndex === node.rowIndex;
  const isDragOver = dragOver === node.rowIndex && !isDragging;

  return (
    <>
      <div
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors ${
          isDragOver ? "bg-primary/[0.08] ring-1 ring-primary/30" : ""
        } ${isDragging ? "opacity-40" : ""}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        draggable
        onDragStart={() => onDragStart(node.rowIndex)}
        onDragOver={(e) => onDragOver(e, node.rowIndex)}
        onDragLeave={onDragLeave}
        onDrop={() => onDrop(node.rowIndex)}
        onDragEnd={onDragEnd}
      >
        {/* 拖拽手柄 */}
        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/30 hover:text-muted-foreground/60" />

        {/* 展开/折叠 */}
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onToggle(node.rowIndex)}
          >
            {node.expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* 标签 */}
        {isEditing ? (
          <InlineFieldEditor
            type="string"
            value={node.label}
            onChange={(v) => onCommitEdit(node.rowIndex, v)}
            onCancel={onCancelEdit}
          />
        ) : (
          <span
            className="cursor-pointer truncate text-foreground hover:text-primary"
            onClick={() => onStartEdit(node.rowIndex)}
            title="点击重命名"
          >
            {node.label}
          </span>
        )}
      </div>

      {/* 递归渲染子节点 */}
      {node.expanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.rowIndex}
            node={child}
            depth={depth + 1}
            labelField={labelField}
            editingNode={editingNode}
            drag={drag}
            dragOver={dragOver}
            onToggle={onToggle}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
          />
        ))}
    </>
  );
}

// ─── 树构建 ────────────────────────────────────────────────────────────────

function buildTree(
  rows: Record<string, unknown>[],
  labelField: string,
  parentIdField: string | null,
  expandedSet: Set<number>,
): TreeNode[] {
  const nodes: TreeNode[] = rows.map((row, i) => ({
    rowIndex: i,
    label: String(row[labelField] ?? `Row ${i}`),
    children: [],
    expanded: expandedSet.has(i),
  }));

  // 为每个节点查找其子节点
  for (let i = 0; i < rows.length; i++) {
    const node = nodes[i];
    const nodeId = rows[i]?.[labelField];
    // 查找所有 parentId 指向此节点的行
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const parentId = parentIdField ? rows[j]?.[parentIdField] : null;
      if (parentId !== null && parentId !== undefined && String(parentId) === String(nodeId)) {
        nodes[i].children.push(nodes[j]);
      }
    }
  }

  // 只返回根节点（parentId 为空 或 不在任何 labelField 列表中的节点）
  const labelValues = new Set(rows.map((r) => String(r[labelField] ?? "")));
  const rootNodes = nodes.filter((node, i) => {
    const parentId = parentIdField ? rows[i]?.[parentIdField] : null;
    if (parentId === null || parentId === undefined || parentId === "") return true;
    return !labelValues.has(String(parentId));
  });

  return rootNodes;
}

/** 检查 targetRowIdx 是否是从 sourceRowIdx 出发的子孙节点 */
function isDescendant(
  rows: Record<string, unknown>[],
  labelField: string,
  parentIdField: string | null,
  sourceIdx: number,
  targetIdx: number,
): boolean {
  // 没有 parentIdField 时无父子关系，直接返回 false
  if (!parentIdField) return false;
  // 简化循环检测：找到 source 的所有子孙
  const children = new Set<number>();
  const queue = [sourceIdx];
  // 防御性循环上限：rows 长度 ×2，避免数据本身就有循环时死循环
  let iterations = 0;
  const maxIterations = rows.length * 2 + 1;
  while (queue.length > 0 && iterations++ < maxIterations) {
    const current = queue.shift()!;
    const currentLabel = String(rows[current]?.[labelField] ?? "");
    if (currentLabel === "") continue;
    for (let i = 0; i < rows.length; i++) {
      if (i === sourceIdx || children.has(i)) continue;
      const pid = rows[i]?.[parentIdField];
      if (pid !== null && pid !== undefined && String(pid) === currentLabel) {
        children.add(i);
        queue.push(i);
      }
    }
  }
  return children.has(targetIdx);
}
