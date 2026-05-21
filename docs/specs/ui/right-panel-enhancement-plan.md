---
tags: [spec, ui, plan]
created: 2026-05-21
status: draft
---

# 右侧面板功能优化 — 实现计划

> 改造 `RightPanel.tsx` 的 D1-D4 面板。关联 spec: [[resource-explorer-structure]]

## 关键文件

| 文件 | 作用 | 改动类型 |
|------|------|----------|
| `packages/apps/web/src/components/shell/RightPanel.tsx` | D1-D4 主面板 | **重构** |
| `packages/apps/web/src/components/shell/AppShell.tsx` | Context providers | **修改** |
| `packages/apps/web/src/lib/useRecentStore.ts` | 最近使用 hook | **新建** |
| `packages/apps/web/src/lib/useResourceExplorer.ts` | 资源管理器 hook | **新建** |
| `packages/apps/web/src/components/shell/ResourceExplorer.tsx` | 资源管理器 UI | **新建** |
| `apps/desktop/src-tauri/src/commands/file_ops.rs` | Rust 文件操作命令 | **新建** |
| `apps/desktop/src-tauri/src/commands/mod.rs` | 命令注册 | **修改** |
| `packages/apps/web/src/components/skills/RunPanel.tsx` | Tool 运行面板 | **修改** |

---

## Task 1: Skill 列表点击 → D5 预览详情

**改动**：`RightPanel.tsx` D2 段，~5 行

```tsx
// D2 skill <li> 添加 onClick：
<li onClick={() => setPreview({
  kind: "skill-detail",
  title: s.display_name || s.name,
  data: { skillName: s.name },
})} className="... cursor-pointer ...">
```

PreviewRenderer 已支持 `skill-detail` → `SkillDetailPanel`（compact 模式），无需额外改动。

---

## Task 2: Skill/Tool 搜索

**改动**：`RightPanel.tsx` D2/D3 段，~30 行

在每个 panel 内部标题下方加紧凑搜索框：

```tsx
const [skillSearch, setSkillSearch] = useState("");
const [toolSearch, setToolSearch] = useState("");

// 过滤
const filteredSkills = skills.filter(s =>
  !skillSearch || (s.display_name || s.name).toLowerCase().includes(skillSearch.toLowerCase())
);
```

搜索框样式（参考 `design-language.md` §4.2）：
```tsx
<div className="relative px-2 pb-1">
  <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
  <Input className="h-6 pl-6 text-[11px]" placeholder="搜索 Skill..." />
</div>
```

---

## Task 3: 最近使用

### 3.1 新建 `useRecentStore.ts` (~80 行)

```typescript
const STORAGE_KEY = "artifex.shell.recentItems";
const MAX_ITEMS = 50;

interface RecentSkill { name: string; displayName: string; timestamp: number; type: "pin"; }
interface RecentTool { id: string; name: string; timestamp: number; type: "run"; }
type RecentItem = RecentSkill | RecentTool;
```

**状态**：模块级单例（React context 兼容），lazy init 从 localStorage 读。
**API**：`recentItems`、`addRecentSkill(name, displayName)`、`addRecentTool(id, name)`

### 3.2 集成点

| 位置 | 调用 |
|------|------|
| RightPanel D2 `togglePin`（钉选时） | `addRecentSkill(s.name, s.display_name \|\| s.name)` |
| RightPanel D3 Play 按钮 `handleToolRunFromPanel` | `addRecentTool(t.id, t.name)` |
| RunPanel `handleRun` 成功后 | `onToolRun(id, name)` 回调 → `addRecentTool` |

### 3.3 D1 渲染

```tsx
{recentItems.map(item => (
  <li key={`${item.type}-${item.type === "pin" ? item.name : item.id}`}
      className="flex h-5 cursor-pointer items-center gap-2 rounded px-2 hover:bg-accent/40"
      onClick={() => { /* 点击钉选 → 跳 D2/D5 */ }}>
    {item.type === "pin"
      ? <Pin className="h-3 w-3 text-amber-400 shrink-0" />
      : <Play className="h-3 w-3 text-emerald-400 shrink-0" />}
    <span className="truncate text-[11px]">{item.displayName || item.name}</span>
    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
      {formatRelativeTime(item.timestamp)}
    </span>
  </li>
))}
```

---

## Task 4: 资源管理器

详见 [[resource-explorer-structure]]。以下为实现要点。

### 4.1 `ResourceExplorer.tsx` 组件 (~120 行)

使用 `useResourceExplorer` hook，渲染四个区域：

1. **面包屑**：📂 图标按钮 + 路径文本（可点击分段）
2. **搜索框**：即时过滤文件列表
3. **收藏夹**：可折叠，点击项 → 导航到对应位置
4. **文件列表**：VSCode 风格单列树，文件夹/文件排序

### 4.2 `useResourceExplorer.ts` Hook (~100 行)

| API | 说明 |
|-----|------|
| `currentDir` | 当前浏览目录 |
| `entries: FileEntry[]` | 文件列表 |
| `filteredEntries` | 搜索过滤后 |
| `favorites: FavoriteEntry[]` | 收藏夹 |
| `selectDirectory()` | 调用 Tauri 原生目录选择器 |
| `navigateTo(dirPath)` | 进入目录 |
| `navigateUp()` | 返回上级 |
| `toggleFavorite(entry)` | 切换收藏 |
| `isFavorited(path)` | 是否已收藏 |

localStorage key: `artifex.explorer.favorites`

### 4.3 右键菜单

使用 `ContextMenu` 组件（`@artifex-nexus/ui`，参考 Sidebar.tsx 用法）：

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    {/* 文件/文件夹行 */}
  </ContextMenuTrigger>
  <ContextMenuContent className="w-44">
    <ContextMenuItem onClick={handleOpen}>
      <ExternalLink /> 打开
    </ContextMenuItem>
    <ContextMenuItem onClick={handleOpenInExplorer}>
      <FolderOpen /> 在资源管理器中打开
    </ContextMenuItem>
    <ContextMenuItem onClick={handleCopyPath}>
      <Copy /> 复制路径
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={handleToggleFavorite}>
      {isFavorited ? <StarOff /> : <Star />}
      {isFavorited ? "移除收藏" : "添加到收藏"}
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

### 4.4 Rust 命令 `file_ops.rs` (~50 行)

```rust
#[derive(Serialize)]
struct FileEntry { name: String, path: String, is_dir: bool, size: u64 }

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileEntry>, String> { ... }

#[tauri::command]
fn read_file_text(path: String) -> Result<serde_json::Value, String> { ... }

#[tauri::command]
async fn open_dir_dialog(app: tauri::AppHandle) -> Result<serde_json::Value, String> { ... }
```

注册：`mod.rs` 加 `pub mod file_ops;`，`main.rs` 注册 handler。

---

## 实现顺序

1. **Task 1** — Skill 点击预览
2. **Task 3** — Skill/Tool 搜索（与 Task 1 同区域）
3. **Task 2** — 最近使用（新建 hook + 集成）
4. **Task 4** — 资源管理器（最后，最大改动 + Rust 命令）

## 遵循规范

- [[design-language]]：色彩 token、字体、间距、圆角、动效
- [[resource-explorer-structure]]：资源管理器 UI 结构
- [[web-chat-structure]]：现有 D 区面板结构
- `apps/desktop/src-tauri/commands/` 的 Rust 命令模式

## 风险

1. Rust `list_dir` 需新命令 → `pnpm tauri build` 重新编译
2. `read_file_text` 仅支持文本文件（UTF-8），二进制文件跳过
3. localStorage 总量 < 100KB，无性能问题
4. 资源管理器只浏览不编辑/删除，无数据丢失风险
