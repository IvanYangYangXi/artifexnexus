import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * 组件 gallery 预览配置。仅本包内使用，不发布。
 * 端口 18791 与 packages/apps/web（18790）相邻、不冲突。
 */
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  server: {
    port: 18791,
    host: "localhost",
    strictPort: true,
    open: false,
  },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(here, "../src"),
      "@artifex-nexus/ui": resolve(here, "../src"),
    },
  },
});
