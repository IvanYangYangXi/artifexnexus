#!/usr/bin/env node
/**
 * prepare-staging.mjs — Create apps/desktop/staging/ for Tauri dev/build.
 *
 * Replicates Phase 1 of package.ps1 (staging only, no build, no zip).
 * Run before `tauri dev` or `tauri build` if staging/ doesn't exist.
 *
 * Usage:  node scripts/prepare-staging.mjs
 */
import { cpSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const STAGING = join(ROOT, "apps", "desktop", "staging");

/** Copy a directory tree (contents only). Skips if source missing. */
function copyTree(srcRel, dstRel, label) {
  const src = join(ROOT, srcRel);
  const dst = join(STAGING, dstRel);
  if (!existsSync(src)) {
    console.log(`  [SKIP] ${label || srcRel} (not found)`);
    return;
  }
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`  [OK]   ${label || srcRel}`);
}

/** Copy a single file. Skips if source missing. */
function copyFile(srcRel, dstRel, label) {
  const src = join(ROOT, srcRel);
  const dst = join(STAGING, dstRel);
  if (!existsSync(src)) {
    console.log(`  [SKIP] ${label || srcRel} (not found)`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  console.log(`  [OK]   ${label || srcRel}`);
}

/** Recursively remove __pycache__ dirs and .pyc files. */
function cleanPycache(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "__pycache__") {
        rmSync(fullPath, { recursive: true });
      } else {
        cleanPycache(fullPath);
      }
    } else if (entry.endsWith(".pyc")) {
      rmSync(fullPath);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("");
console.log("=== Preparing staging directory ===");
console.log(`  Target: ${STAGING}`);
console.log("");

// Clean and recreate staging
if (existsSync(STAGING)) {
  rmSync(STAGING, { recursive: true });
}
mkdirSync(STAGING, { recursive: true });

// 1a. Python sidecar & wrapper
copyTree(
  "packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper",
  "packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper",
  "sidecar + wrapper",
);

// 1b. Platform core & skill modules
copyTree(
  "packages/platform/core/src/artifex_nexus/core",
  "packages/platform/core/src/artifex_nexus/core",
  "platform core",
);
copyTree(
  "packages/platform/skill/src/artifex_nexus/skill",
  "packages/platform/skill/src/artifex_nexus/skill",
  "platform skill",
);

// 1c. Contracts: data + schemas
copyTree(
  "packages/platform/contracts/data",
  "packages/platform/contracts/data",
  "contracts/data",
);
copyTree(
  "packages/platform/contracts/schemas",
  "packages/platform/contracts/schemas",
  "contracts/schemas",
);

// 1d. Gateway MCP Bridge plugin (required files only: index.js + openclaw.plugin.json)
//     These are at the gateway-plugin root, not in dist/
copyFile(
  "packages/adapters/openclaw/gateway-plugin/index.js",
  "packages/adapters/openclaw/gateway-plugin/index.js",
  "gateway-plugin/index.js",
);
copyFile(
  "packages/adapters/openclaw/gateway-plugin/openclaw.plugin.json",
  "packages/adapters/openclaw/gateway-plugin/openclaw.plugin.json",
  "gateway-plugin/openclaw.plugin.json",
);

// 1e. DCC plugins & SDK
copyTree("packages/dcc/unreal", "packages/dcc/unreal", "UE plugin");
copyTree("packages/dcc/blender/src", "packages/dcc/blender/src", "Blender addon");
copyTree(
  "packages/dcc/shared/artifex_nexus_sdk",
  "packages/dcc/shared/artifex_nexus_sdk",
  "SDK",
);

// 1f. Skills & Tools: official/ only
copyTree("skills/official", "skills/official", "skills/official");
copyTree("tools/official", "tools/official", "tools/official");
copyFile("tools/diagnose_dcc_tool_run.py", "tools/diagnose_dcc_tool_run.py", "diagnose.py");

// 1g. Root marker file
copyFile("pnpm-workspace.yaml", "pnpm-workspace.yaml", "pnpm-workspace.yaml");

// 1h. Frontend output placeholder (built by tauri beforeBuildCommand)
mkdirSync(join(STAGING, "packages/apps/web/out"), { recursive: true });
console.log("  [OK]   frontend out placeholder");

// 1j. Clean __pycache__ and .pyc
try {
  cleanPycache(STAGING);
  console.log("  [OK]   cleaned __pycache__");
} catch {
  // non-fatal
}

// Summary
function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

const total = countFiles(STAGING);
console.log("");
console.log(`  Staged ${total} files.`);
console.log("");
