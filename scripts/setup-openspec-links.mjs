#!/usr/bin/env node
/**
 * setup-openspec-links.mjs — 在本机生成 openspec/ 下的软链，全部指向 docs/
 *
 * 设计目标：
 * - openspec/ 是 OpenSpec CLI 的入口，但所有内容的真身在 docs/（单一信息源）
 * - 通过 fs.symlink 让 openspec/changes/<id>/* 与 openspec/specs/<cap>/spec.md
 *   实际读到 docs/ 同一份文件，**绝无双源**
 * - Windows: Node 的 fs.symlinkSync(target, path, 'junction') 对目录无需管理员权限，
 *           对文件用 'file' 类型（需开发者模式或管理员）
 * - macOS / Linux: 普通 symlink，无权限问题
 *
 * 使用：
 *   node scripts/setup-openspec-links.mjs            # 创建/刷新所有链接
 *   node scripts/setup-openspec-links.mjs --check    # 仅验证不修改
 *   node scripts/setup-openspec-links.mjs --clean    # 删除所有链接
 *
 * 配置源：本文件下方 LINKS 常量（手工维护，与 openspec/config.yaml 的 changes 段保持一致）
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const IS_WIN = platform() === "win32";

// ============================================================
// 链接清单（手工维护）
// 每条 = { link: 软链路径（相对仓库根）, target: docs/ 真身路径（相对仓库根）, type: 'file'|'dir' }
// ============================================================
const LINKS = [
  // ----- Active Change: epic-0001-batch2-openclaw-settings-webui-agent -----
  {
    link: "openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/proposal.md",
    target: "docs/inbox/EPIC-0001-batch2-openclaw-settings-webui-agent.md",
    type: "file",
    note: "原始需求 + triage 决策，作为 OpenSpec proposal",
  },
  {
    link: "openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/design.md",
    target: "docs/specs/openclaw-settings-panel.md",
    type: "file",
    note: "主设计文档（设置面板含完整字段表 / 状态机 / sidecar 对接）",
  },
  {
    link: "openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/tasks.md",
    target: "docs/tasks/_openspec/epic-0001-batch2.tasks.md",
    type: "file",
    note: "OpenSpec 进度计数源；该文件本身归 docs/，不是反链",
  },
  {
    link: "openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/specs/openclaw-settings-panel/spec.md",
    target: "docs/specs/openclaw-settings-panel.md",
    type: "file",
  },
  {
    link: "openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/specs/openclaw-web-ui-entry/spec.md",
    target: "docs/specs/ui/installer-structure.md",
    type: "file",
    note: "Web UI 入口的设计落在 installer-structure §11",
  },
  {
    link: "openspec/changes/epic-0001-batch2-openclaw-settings-webui-agent/specs/openclaw-agent-preset/spec.md",
    target: "docs/specs/openclaw-agent-preset.md",
    type: "file",
  },
  // ----- Capability registry: openspec/specs/<cap>/spec.md（已采纳的能力规约索引） -----
  // M1 第二批 capability 在 STORY done + change archive 后再迁到这里；
  // 现阶段保持空，避免 "in-progress capability 出现在 specs/"
];

// ============================================================
// 工具函数
// ============================================================

const args = process.argv.slice(2);
const MODE_CHECK = args.includes("--check");
const MODE_CLEAN = args.includes("--clean");

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function log(color, prefix, msg) {
  console.log(`${COLORS[color]}${prefix.padEnd(8)}${COLORS.reset} ${msg}`);
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function isJunction(path) {
  // Windows junction 在 Node 里 lstat.isSymbolicLink() 也返回 true
  return isSymlink(path);
}

function resolveTarget(linkAbs) {
  try {
    return readlinkSync(linkAbs);
  } catch {
    return null;
  }
}

function ensureParentDir(absPath) {
  const parent = dirname(absPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function removeLinkOrFile(absPath) {
  if (!existsSync(absPath) && !isSymlink(absPath)) return false;
  // 即使 symlink 指向不存在的目标，existsSync 也会返回 false——所以双判断
  try {
    if (isSymlink(absPath)) {
      unlinkSync(absPath);
    } else {
      const stat = lstatSync(absPath);
      if (stat.isDirectory()) rmSync(absPath, { recursive: true, force: true });
      else unlinkSync(absPath);
    }
    return true;
  } catch (e) {
    log("red", "ERROR", `删除失败 ${absPath}: ${e.message}`);
    return false;
  }
}

function createLink(linkRel, targetRel, type) {
  const linkAbs = resolve(REPO_ROOT, linkRel);
  const targetAbs = resolve(REPO_ROOT, targetRel);

  // 1. 验证目标存在
  if (!existsSync(targetAbs)) {
    log("red", "MISSING", `目标不存在 → ${targetRel}（链接 ${linkRel} 跳过）`);
    return { ok: false, reason: "target-missing" };
  }

  // 2. 确保父目录存在
  ensureParentDir(linkAbs);

  // 3. 已存在的链接：检查指向是否正确
  if (isSymlink(linkAbs)) {
    const current = resolveTarget(linkAbs);
    // Node 的 readlink 在 Win junction 上返回 absolute path
    const currentAbs = resolve(dirname(linkAbs), current);
    if (currentAbs === targetAbs) {
      log("gray", "OK", `${linkRel}  →  ${targetRel}`);
      return { ok: true, reason: "already-correct" };
    }
    log("yellow", "REPLACE", `指向不一致，重建 ${linkRel}`);
    unlinkSync(linkAbs);
  } else if (existsSync(linkAbs)) {
    log("yellow", "REPLACE", `非链接占位，覆盖 ${linkRel}`);
    removeLinkOrFile(linkAbs);
  }

  // 4. 创建链接
  // Windows: file type 需要管理员/开发者模式；junction 仅支持目录
  // 我们的 LINKS 全部链文件，所以 Win 上必须用 'file' 类型
  // Node 文档：在 Windows 上，symlinkSync 第三参可为 'dir' | 'file' | 'junction'
  const linkType = IS_WIN ? type : null; // Unix 不需要 type
  // 用相对路径作为 target 让 link 更稳定（仓库整体可移动）
  const targetForLink = IS_WIN ? targetAbs : relative(dirname(linkAbs), targetAbs);
  try {
    symlinkSync(targetForLink, linkAbs, linkType ?? undefined);
    log("green", "CREATE", `${linkRel}  →  ${targetRel}`);
    return { ok: true, reason: "created" };
  } catch (e) {
    if (IS_WIN && e.code === "EPERM") {
      log("red", "EPERM", `Windows 权限不足。请二选一：`);
      log("red", "  ", `  1. 启用"开发者模式"（设置 → 隐私和安全性 → 开发者选项）`);
      log("red", "  ", `  2. 以管理员身份运行此脚本`);
      return { ok: false, reason: "no-permission" };
    }
    log("red", "ERROR", `创建失败 ${linkRel}: ${e.message}`);
    return { ok: false, reason: "error" };
  }
}

function checkLink(linkRel, targetRel) {
  const linkAbs = resolve(REPO_ROOT, linkRel);
  const targetAbs = resolve(REPO_ROOT, targetRel);
  if (!isSymlink(linkAbs)) {
    log("red", "MISSING", `链接不存在 ${linkRel}`);
    return false;
  }
  const current = resolveTarget(linkAbs);
  const currentAbs = resolve(dirname(linkAbs), current);
  if (currentAbs !== targetAbs) {
    log("yellow", "DRIFT", `${linkRel}  →  ${current}（期望 ${targetRel}）`);
    return false;
  }
  if (!existsSync(targetAbs)) {
    log("red", "BROKEN", `${linkRel} 指向的 ${targetRel} 不存在`);
    return false;
  }
  log("gray", "OK", `${linkRel}`);
  return true;
}

function cleanLink(linkRel) {
  const linkAbs = resolve(REPO_ROOT, linkRel);
  if (isSymlink(linkAbs) || existsSync(linkAbs)) {
    if (removeLinkOrFile(linkAbs)) {
      log("yellow", "REMOVE", linkRel);
    }
  } else {
    log("gray", "SKIP", `${linkRel}（不存在）`);
  }
}

// ============================================================
// 主流程
// ============================================================

function main() {
  console.log(`${COLORS.cyan}OpenSpec 软链管理器${COLORS.reset}`);
  console.log(`${COLORS.gray}仓库根：${REPO_ROOT}${COLORS.reset}`);
  console.log(`${COLORS.gray}模式：${MODE_CHECK ? "check" : MODE_CLEAN ? "clean" : "create/update"}${COLORS.reset}`);
  console.log(`${COLORS.gray}平台：${platform()}${COLORS.reset}`);
  console.log("");

  let okCount = 0;
  let failCount = 0;

  for (const { link, target, type, note } of LINKS) {
    if (note && !MODE_CLEAN) {
      log("cyan", "NOTE", note);
    }
    if (MODE_CLEAN) {
      cleanLink(link);
      okCount++;
    } else if (MODE_CHECK) {
      if (checkLink(link, target)) okCount++;
      else failCount++;
    } else {
      const r = createLink(link, target, type);
      if (r.ok) okCount++;
      else failCount++;
    }
  }

  console.log("");
  if (failCount === 0) {
    log("green", "DONE", `${okCount} link(s) 处理完成`);
    process.exit(0);
  } else {
    log("red", "FAIL", `${failCount} 失败 / ${okCount} 成功`);
    process.exit(1);
  }
}

main();
