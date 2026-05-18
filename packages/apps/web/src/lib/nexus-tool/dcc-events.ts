/**
 * DCC 事件常量 —— 从 ArtClaw Tool Manager 移植，适配 Nexus DCC 命名。
 *
 * 用法：
 *   import { DCC_EVENTS, getEventLabel } from "../nexus-tool/dcc-events";
 *   const events = DCC_EVENTS["blender"]; // [{ event, label }, ...]
 *   getEventLabel("unreal_engine", "asset.save.post"); // "资源保存 (post)"
 */

// ── 类型 ──────────────────────────────────────────────────────────────────

export interface DCCEventDef {
  /** 事件完整值（含 timing 后缀），如 "asset.save.pre"、"file.save.post" */
  event: string;
  /** 中文标签 */
  label: string;
}

// ── 按 DCC 的事件列表 ────────────────────────────────────────────────────
//
// DCC 名称映射（ArtClaw → Nexus）：
//   ue5       → unreal_engine
//   maya2024  → maya
//   max2024   → 3ds_max
//   blender   → blender
//   comfyui   → comfyui
//   sp        → substance_painter
//   sd        → substance_designer

export const DCC_EVENTS: Record<string, DCCEventDef[]> = {
  /** 通用类型 — 适用于所有 DCC，系统资源管理监测 */
  general: [
    { event: "file.created",      label: "文件创建" },
    { event: "file.modified",     label: "文件修改" },
    { event: "file.deleted",      label: "文件删除" },
    { event: "file.renamed",      label: "文件重命名" },
    { event: "dir.created",       label: "目录创建" },
    { event: "dir.deleted",       label: "目录删除" },
    { event: "project.opened",    label: "项目打开" },
    { event: "project.closed",    label: "项目关闭" },
  ],

  unreal_engine: [
    { event: "asset.save.pre",    label: "保存拦截 (pre)" },
    { event: "asset.save.post",   label: "资源保存 (post)" },
    { event: "asset.import.post", label: "资源导入 (post)" },
    { event: "asset.delete.pre",  label: "删除前检查 (pre)" },
    { event: "asset.delete.post", label: "资源删除 (post)" },
    { event: "asset.place.post",  label: "资源放置到场景 (post)" },
    { event: "level.load.post",   label: "关卡加载 (post)" },
    { event: "editor.startup",    label: "编辑器启动" },
  ],

  maya: [
    { event: "file.save.pre",    label: "文件保存前" },
    { event: "file.save.post",   label: "文件保存后" },
    { event: "file.export.pre",  label: "文件导出前" },
    { event: "file.export.post", label: "文件导出后" },
    { event: "file.import.pre",  label: "文件导入前" },
    { event: "file.import.post", label: "文件导入后" },
    { event: "file.open.post",   label: "文件打开后" },
    { event: "scene.new.post",   label: "新建场景后" },
  ],

  "3ds_max": [
    { event: "file.save.pre",    label: "文件保存前" },
    { event: "file.save.post",   label: "文件保存后" },
    { event: "file.open.post",   label: "文件打开后" },
    { event: "scene.new.post",   label: "新建场景后" },
  ],

  blender: [
    { event: "file.save.post",   label: "文件保存后" },
    { event: "file.open.post",   label: "文件打开后" },
    { event: "render.pre",       label: "渲染开始前" },
    { event: "render.post",      label: "渲染完成后" },
  ],

  houdini: [
    { event: "file.save.pre",    label: "文件保存前" },
    { event: "file.save.post",   label: "文件保存后" },
    { event: "file.open.post",   label: "文件打开后" },
    { event: "scene.new.post",   label: "新建场景后" },
    { event: "render.pre",       label: "渲染开始前" },
    { event: "render.post",      label: "渲染完成后" },
  ],

  comfyui: [
    { event: "workflow.queue.pre",   label: "提交工作流前" },
    { event: "workflow.queue.post",  label: "提交工作流后" },
    { event: "workflow.complete",    label: "工作流完成" },
  ],

  substance_painter: [
    { event: "project.save.pre",     label: "项目保存前" },
    { event: "project.save.post",    label: "项目保存后" },
    { event: "export.textures.pre",  label: "导出贴图前" },
    { event: "export.textures.post", label: "导出贴图后" },
  ],

  substance_designer: [
    { event: "graph.compute.pre",  label: "图表计算前" },
    { event: "graph.compute.post", label: "图表计算后" },
    { event: "package.save.pre",   label: "包保存前" },
    { event: "package.save.post",  label: "包保存后" },
  ],
};

// ── 工具函数 ──────────────────────────────────────────────────────────────

/** 获取事件的本地化标签（当前只有中文） */
export function getEventLabel(dcc: string, event: string): string {
  const events = DCC_EVENTS[dcc];
  if (!events) return event;
  const found = events.find((e) => e.event === event);
  return found ? found.label : event;
}

/** 判断某个 DCC 是否支持事件（有 DCC_EVENTS 定义） */
export function hasDCCEvents(dcc: string): boolean {
  return dcc in DCC_EVENTS;
}
