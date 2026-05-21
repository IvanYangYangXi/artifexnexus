---
tags: [spec, ui, resource-explorer]
created: 2026-05-21
status: draft
---

# 资源管理器 — 结构规格 / Resource Explorer Structure Spec

> D4 右侧面板资源管理器。参考 VS Code 文件资源管理器设计，遵循 [[design-language]] 设计语言。

## 1. 设计目标

- 窄面板（300–500px）下提供完整的文件浏览体验
- 支持任意目录选择、搜索、收藏管理
- 右键上下文菜单（复制路径、收藏/取消收藏、打开资源管理器）
- 收藏夹作为快捷导航（点击跳转到对应位置）

## 2. 布局结构

```
┌─────────────────────────────────┐
│ 1. 面包屑导航                    │  ← 显示当前路径 + 📂 选择目录按钮
│    [📂] /Documents/projects/... │
├─────────────────────────────────┤
│ 2. 搜索框                        │
│    🔍 搜索文件...               │
├─────────────────────────────────┤
│ 3. 收藏夹（可折叠）              │  ← 折叠/展开，点击跳转
│  ⭐ 收藏夹               [展开]  │
│    📄 config.json                │  → 点击：文件列表定位到对应位置
│    📁 my_skills/                 │  → 点击：文件列表进入该目录
│    📁 projects/                  │
├─────────────────────────────────┤
│ 4. 当前目录文件列表              │
│  📁 subdir/                      │  → 点击进入子目录
│  📁 artifacts/                   │
│  📄 README.md                    │  → 点击在 D5 预览
│  📄 main.py                      │
│  📄 index.ts                     │
│  ...                             │
└─────────────────────────────────┘
```

### 2.1 各区域说明

| 区域 | 高度 | 说明 |
|------|------|------|
| 面包屑 | 28px | 紧凑行高，📂 = 目录选择按钮，路径可点击分段 |
| 搜索框 | 26px | 紧凑搜索，实时过滤文件列表 |
| 收藏夹 | 自适应 | 可折叠（`CollapsiblePanel` 内嵌或独立折叠区），每行 22px |
| 文件列表 | flex-1 | 主区域，类似 VSCode 文件树，每行 22px |

## 3. 右键菜单

参考项目已有的 `ContextMenu` 组件（`@artifex-nexus/ui`），对文件/文件夹条目右键弹出：

| 菜单项 | 图标 | 说明 |
|--------|------|------|
| 打开（仅文件） | `ExternalLink` | 调用 `shell_open_path` 打开文件 |
| 在资源管理器中打开 | `FolderOpen` | 调用 `shell_open_path` 打开所在目录 |
| 复制路径 | `Copy` | 复制绝对路径到剪贴板 |
| 添加/移除收藏 | `Star` / `StarOff` | 切换收藏状态 |

**交互细节**：
- 右键时高亮当前行（`bg-accent/40`），弹出菜单
- 菜单使用 `ContextMenu` 组件，遵循 `glass-surface` 样式
- 空白处右键仅显示「选择目录」选项

## 4. UI 规范（遵循 design-language.md）

### 4.1 色彩

| 元素 | Token/Class |
|------|------------|
| 面板背景 | `bg-panel` (L4, 14.5%) |
| 行 hover | `hover:bg-accent/40` |
| 行选中/激活 | `bg-accent/60` |
| 收藏图标 | `text-amber-400` |
| 文本 | `text-panel-foreground` / `text-muted-foreground` |

### 4.2 字体与尺寸

| 元素 | 规范 |
|------|------|
| 面包屑 | `text-[11px] text-muted-foreground` |
| 搜索框 | `h-6 text-[11px]` |
| 文件名 | `text-xs` (12px) |
| 文件夹名 | `text-xs font-medium` |
| 行高 | 22px（紧凑；VSCode 参考为 22px） |
| 缩进 | 每级 `pl-4`（参考 VSCode 树缩进） |

### 4.3 圆角与边框

| 元素 | 规范 |
|------|------|
| 列表行 | `rounded` (6px) |
| 搜索框 | `rounded-[8px]` + `border-white/[0.08]` |
| 右键菜单 | `glass-surface`（rounded-[16px] + border-white/[0.08]） |

### 4.4 动效

| 场景 | 规范 |
|------|------|
| 行 hover | `transition-colors duration-150` |
| 收藏夹折叠 | `transition-all duration-200` |

## 5. 数据模型

```typescript
interface FileEntry {
  name: string;
  path: string;        // 绝对路径
  isDir: boolean;
  size?: number;
}

interface FavoriteEntry {
  path: string;
  name: string;
  isDir: boolean;
}

// localStorage key: "artifex.explorer.favorites"
// 存储: FavoriteEntry[]
```

## 6. 交互逻辑

### 6.1 面包屑
- 📂 图标按钮 → 调用 Tauri `open_dir_dialog` 选择目录
- 路径分段可点击 → 跳转到对应层级目录
- 路径过长时省略中间段（`/root/.../leaf`）

### 6.2 收藏夹
- 默认折叠（首次使用无收藏时自动隐藏）
- 点击收藏的文件 → 导航到该文件所在目录 + 高亮该文件
- 点击收藏的文件夹 → 导航到该文件夹
- 每个收藏项右侧有 ⭐ 按钮（移除收藏）

### 6.3 文件列表
- 文件夹在前（按名称排序），文件在后
- 点击文件夹 → 进入子目录
- 点击文件 → 在 D5 预览面板中显示内容
- 右键 → 上下文菜单（打开/复制路径/收藏）

## 7. Tauri 命令

新增 Rust 命令模块 `commands/file_ops.rs`：

| 命令 | 说明 |
|------|------|
| `list_dir(path)` | 列出目录内容 → `Vec<FileEntry>` |
| `read_file_text(path)` | 读取文本文件 → `{ ok, content }` |
| `open_dir_dialog()` | 原生目录选择对话框 → `{ path }` |

这些命令直连 Rust，不经 Python sidecar（文件操作无需 sidecar 开销）。

## 相关

- [[design-language]] — 设计语言 Token
- [[web-chat-structure]] — 整体界面结构化
- RightPanel 实现：`packages/apps/web/src/components/shell/RightPanel.tsx`
