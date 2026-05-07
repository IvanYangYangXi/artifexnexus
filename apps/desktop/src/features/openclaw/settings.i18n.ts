// OpenClaw 设置面板文案常量（中文，spec §8）。
// EPIC-0001 第二批 STORY-0015。

export const t = {
  zhCN: {
    // 触发器（InstallItemRow 的"设置"按钮 tooltip）
    triggerSettings: "设置",
    triggerDisabledNotInstalled: "请先安装 OpenClaw",

    // Modal 标题与通用按钮
    modalTitle: "OpenClaw · 模型设置",
    btnClose: "关闭",
    btnCancel: "取消",
    btnSave: "保存",
    btnSaving: "保存中…",
    btnRetry: "重试",
    btnReload: "重新加载",
    btnTest: "测试连接",
    btnTesting: "测试中…",
    btnDelete: "删除",
    btnAdd: "新增",
    btnAddFromTemplate: "模板…",
    btnResetAgentPreset: "重置 Artifex Nexus 默认 agent 预设",

    // Tabs
    tabProviders: "提供商",
    tabAuth: "鉴权凭据",
    tabDefaultAgent: "默认 Agent 模型",

    // Provider 表单字段
    fieldProviderId: "Provider ID",
    fieldDisplayName: "显示名",
    fieldProtocol: "协议",
    fieldBaseUrl: "接口地址",
    fieldModels: "模型列表",
    fieldAuthProfile: "鉴权凭据",
    fieldAdvanced: "高级配置",
    fieldMaxTokens: "最大 token",
    fieldTemperature: "Temperature",
    fieldTimeoutMs: "请求超时 (ms)",
    fieldVision: "视觉输入",
    fieldReasoning: "推理模式",
    fieldCustomHeaders: "自定义 Headers (JSON)",

    // Auth profile 字段
    fieldAuthId: "Profile ID",
    fieldAuthMode: "鉴权方式",
    fieldApiKey: "API Key",
    fieldEmail: "邮箱",
    fieldNotes: "备注",
    apiKeyPlaceholder: "sk-...",
    apiKeyMaskedHint: "已保存（未填新值则保留）",

    // Default Agent
    fieldDefaultModel: "主模型",
    fieldImageModel: "图片输入模型",
    fieldImageGenModel: "图片生成模型",
    fieldThinkingDefault: "思考强度",
    fieldReasoningDefault: "推理模式",
    modelPickerPlaceholder: "选择 provider/model",

    // 校验
    errorRequired: "必填",
    errorBaseUrlRequired: "接口地址必填",
    errorAtLeastOneModel: "至少需要一个模型",
    errorInvalidJson: "非合法 JSON",
    errorIdConflict: "ID 已存在",

    // 状态 / 提示
    loading: "加载中…",
    loadFailed: "加载配置失败",
    saveSuccess: "保存成功",
    saveFailed: "保存失败",
    testSuccess: "连接成功",
    testFailed: "连接失败",
    emptyState: "尚未配置，点击「新增」开始",
    selectFirst: "请从左侧选择一项",
    discardConfirmTitle: "丢弃修改？",
    discardConfirmBody: "您有未保存的修改，关闭后将丢失。",
    btnDiscard: "丢弃",
    btnKeepEditing: "继续编辑",
    deleteConfirmTitle: "确认删除？",
    deleteConfirmBody: "此操作不可撤销。",
    resetPresetConfirmTitle: "重置 Artifex Nexus 默认 agent 预设？",
    resetPresetConfirmBody:
      "这会覆盖现有 Artifex Nexus agent 预设，但不影响您创建的其它 agent。继续？",

    // 模板 picker
    templatePickerTitle: "选择 Provider 模板",

    // 联动
    autoCreateAuthLabel: "同时新建鉴权凭据（推荐）",

    // v3 — 内联 Auth 折叠区
    sectionModels: "模型列表",
    sectionAuthInline: "鉴权凭据",
    sectionAdvanced: "高级配置",
    btnAddAuthInline: "新增鉴权凭据",
    btnTestAuthProfile: "测试此凭据",
    inlineAuthEmpty: "本 provider 暂无凭据，点击「新增」开始",
    inlineAuthLastWarn: "这是本 provider 的唯一凭据，删除后将无法测试连接。仍要删除？",
    advancedModeLabel: "高级模式",
    advancedModeHint: "显示独立的「鉴权凭据」标签页，便于跨 provider 共享或批量管理 key",

    // 协议枚举显示
    protocolOpenAi: "OpenAI",
    protocolOpenAiCompat: "OpenAI 兼容",
    protocolAnthropic: "Anthropic",
    protocolGoogle: "Google",
    protocolAzureOpenAi: "Azure OpenAI",

    // Auth mode 枚举显示
    authModeApiKey: "API Key",
    authModeOauth: "OAuth",
    authModeToken: "Token",
    authModePaste: "粘贴 Token",
  },
} as const;

export type SettingsI18n = typeof t.zhCN;
