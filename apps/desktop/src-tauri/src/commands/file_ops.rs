// 文件操作 Tauri Commands：列出目录、读取文件文本、读取文件 base64（图片预览）。
// 文件行数硬上限 300。

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// 目录条目
#[derive(Debug, Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 文件文本读取结果
#[derive(Debug, Serialize, Clone)]
pub struct ReadFileResult {
    pub ok: bool,
    pub content: String,
    pub error: Option<String>,
}

/// 列出目录内容（仅第一层，不递归）。
/// 文件夹在前，文件在后，各自按名称排序。
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("不是目录: {path}"));
    }

    let mut dirs: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏文件/目录（以 . 开头）
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path().to_string_lossy().to_string();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        let size = if is_dir { 0 } else { metadata.len() };

        let fe = FileEntry { name, path, is_dir, size };

        if is_dir {
            dirs.push(fe);
        } else {
            files.push(fe);
        }
    }

    // 按名称排序
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    dirs.append(&mut files);
    Ok(dirs)
}

/// 图片 base64 结果
#[derive(Debug, Serialize, Clone)]
pub struct ReadBase64Result {
    pub ok: bool,
    pub data: String,   // base64 编码（不含 data:xxx;base64, 前缀）
    pub mime: String,   // MIME 类型（如 image/png）
    pub error: Option<String>,
}

/// 读取文件为 base64（图片预览用）。
/// 大小上限 10MB。
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<ReadBase64Result, String> {
    let p = Path::new(&path);

    if !p.is_file() {
        return Ok(ReadBase64Result {
            ok: false,
            data: String::new(),
            mime: String::new(),
            error: Some(format!("不是文件: {path}")),
        });
    }

    let metadata = p.metadata().map_err(|e| format!("读取文件元数据失败: {e}"))?;
    if metadata.len() > 10_485_760 {
        return Ok(ReadBase64Result {
            ok: false,
            data: String::new(),
            mime: String::new(),
            error: Some("文件超过 10MB，无法预览".to_string()),
        });
    }

    let bytes = fs::read(p).map_err(|e| format!("读取文件失败: {e}"))?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);

    // 根据扩展名推断 MIME
    let mime = match p.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("tga") => "image/x-targa",
        _ => "application/octet-stream",
    };

    Ok(ReadBase64Result {
        ok: true,
        data,
        mime: mime.to_string(),
        error: None,
    })
}

/// 读取文本文件内容（UTF-8）。
/// 仅支持小于 1MB 的文本文件，二进制文件返回错误。
#[tauri::command]
pub fn read_file_text(path: String) -> Result<ReadFileResult, String> {
    let p = Path::new(&path);

    if !p.is_file() {
        return Ok(ReadFileResult {
            ok: false,
            content: String::new(),
            error: Some(format!("不是文件: {path}")),
        });
    }

    // 大小限制 50MB（数据导入 CSV/JSON 需要更大上限；其他场景请走专用接口）
    let metadata = p.metadata().map_err(|e| format!("读取文件元数据失败: {e}"))?;
    if metadata.len() > 50 * 1_048_576 {
        return Ok(ReadFileResult {
            ok: false,
            content: String::new(),
            error: Some("文件超过 50MB，无法读取".to_string()),
        });
    }

    match fs::read_to_string(p) {
        Ok(content) => Ok(ReadFileResult {
            ok: true,
            content,
            error: None,
        }),
        Err(e) => {
            // 可能是二进制文件
            Ok(ReadFileResult {
                ok: false,
                content: String::new(),
                error: Some(format!("读取失败（可能为二进制文件）: {e}")),
            })
        }
    }
}

/// 递归搜索目录，返回所有匹配搜索词的文件/文件夹。
/// 最大深度 5 层，跳过隐藏目录和 node_modules/.git 等。
#[tauri::command]
pub fn search_dir(path: String, query: String, max_depth: u32) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("不是目录: {path}"));
    }

    let q = query.to_lowercase();
    let mut results: Vec<FileEntry> = Vec::new();
    let max = max_depth.min(8); // 硬上限

    fn walk(dir: &Path, q: &str, depth: u32, max: u32, results: &mut Vec<FileEntry>) {
        if depth > max {
            return;
        }

        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }

            let path = entry.path().to_string_lossy().to_string();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_dir = metadata.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };

            // 跳过大型不相关目录
            if is_dir && (name == "node_modules" || name == ".git" || name == "target" || name == "__pycache__") {
                continue;
            }

            if name.to_lowercase().contains(q) {
                results.push(FileEntry {
                    name,
                    path,
                    is_dir,
                    size,
                });
            }

            if is_dir {
                walk(&entry.path(), q, depth + 1, max, results);
            }
        }
    }

    walk(root, &q, 0, max, &mut results);

    // 文件夹在前
    results.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(results)
}

/// 删除文件/目录到回收站（Windows）
#[tauri::command]
pub fn delete_to_trash(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        // 使用 PowerShell 将文件移到回收站
        let ps_script = format!(
            "$shell = New-Object -ComObject Shell.Application; \
             $item = $shell.Namespace(0).ParseName('{}'); \
             if ($item) {{ $item.InvokeVerb('delete') }} else {{ \
               Add-Type -AssemblyName Microsoft.VisualBasic; \
               [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{}', 'OnlyErrorDialogs', 'SendToRecycleBin') \
             }}",
            p.file_name().unwrap_or_default().to_string_lossy(),
            path.replace('\\', "\\\\"),
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("执行失败: {e}"))?;
        Ok(format!("已移至回收站: {path}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS/Linux: 直接删除（可后续引入 trash crate）
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| format!("删除失败: {e}"))?;
        } else {
            fs::remove_file(p).map_err(|e| format!("删除失败: {e}"))?;
        }
        Ok(format!("已删除: {path}"))
    }
}

/// 彻底删除文件/目录（不可恢复）
#[tauri::command]
pub fn delete_permanent(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }

    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {e}"))?;
    } else {
        fs::remove_file(p).map_err(|e| format!("删除文件失败: {e}"))?;
    }

    Ok(format!("已彻底删除: {path}"))
}
