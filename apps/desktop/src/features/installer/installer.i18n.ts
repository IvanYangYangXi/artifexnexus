// 安装向导文案常量（中文）。
// Installer wizard i18n constants (zh-CN only for now; react-i18next deferred).

export const t = {
  zhCN: {
    // 页面标题
    pageTitle: "Artifex Nexus · 安装向导",

    // 全局工具条
    globalDetect: "全局检测",
    globalSettings: "默认设置",
    globalFinish: "完成",

    // 按钮文案
    btnDetect: "检测",
    btnSettings: "设置",
    btnInstall: "安装",
    btnInstalling: "安装中…",
    btnReinstall: "重装",
    btnRetry: "重试",

    // 状态徽章
    statusUnavailable: "不可用",
    statusPending: "等待依赖",
    statusNotInstalled: "待安装",
    statusInstalling: "安装中",
    statusInstalled: "已安装",
    statusUpdateAvailable: "有更新",
    statusFailed: "失败",

    // 条目名称
    itemOpenClaw: "OpenClaw",
    itemWebUI: "Web UI",
    itemBlender: "Blender",
    itemUnreal: "Unreal Engine",
    itemMax: "3ds Max",
    itemMaya: "Maya",
    itemComfyUI: "ComfyUI",

    // 占位文案
    comingSoon: "占位 · M8 启用",
    iconPlaceholder: "图标",

    // 依赖门禁 tooltip
    tooltipOpenClawRequired: "需先安装 OpenClaw",
    tooltipInstalling: "安装中，请稍候…",

    // 子项相关
    childSummary: "已装 {N} · 可用 {M} · 已配置 {K}",
    childBtnDelete: "删除",
    childDeleteConfirm: "确认删除子项「{label}」？此操作不可撤销。",
    childFieldVersion: "版本",
    childFieldInstallPath: "安装路径",
    childFieldProjectPath: "工程路径",
    childFieldScriptPath: "脚本路径",
  },
} as const;
