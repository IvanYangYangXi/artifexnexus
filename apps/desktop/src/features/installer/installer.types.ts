// 安装向导类型定义（仅前端，contracts schema 待后续 STORY 补）。
// Installer wizard type definitions (frontend only; contracts schema deferred).

/** 安装项状态枚举 / Install item state enum */
export type InstallItemState =
  | "unavailable"
  | "pending"
  | "not-installed"
  | "installing"
  | "installed"
  | "update-available"
  | "failed";

/** DCC 子项 / DCC child instance */
export interface InstallChildItem {
  /** 唯一标识（用户可改），如 "Blender 4.2 主机" */
  label: string;
  /** DCC 版本号 */
  version: string;
  /** DCC 安装路径 */
  installPath: string;
  /** 工程路径（仅 UE 等需要，可为空） */
  projectPath: string;
  /** 注入脚本路径 */
  scriptPath: string;
  /** 子项独立状态 */
  state: InstallItemState;
}

/** 安装清单顶级条目 / Top-level install list item */
export interface InstallItem {
  /** 唯一标识，如 "openclaw" / "web-ui" / "blender" */
  id: string;
  /** 显示名，来自 i18n */
  name: string;
  /** 图标资源键，本期不绑实际图 */
  iconKey: string;
  /** 当前状态（DCC 类取子项汇总，见 spec §5.3） */
  state: InstallItemState;
  /** 是否可展开子项（DCC 系为 true） */
  expandable: boolean;
  /** 占位标记（ComfyUI 等未启用的条目） */
  comingSoon?: boolean;
  /** 子项列表（仅 expandable 条目有） */
  children?: InstallChildItem[];
  /** 失败时的错误信息（state=failed 时展示） */
  errorMessage?: string;
}
