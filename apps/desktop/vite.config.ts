import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 开发配置
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Vite 环境变量前缀，防止与 Tauri 冲突
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri 2 在 Windows 上使用 Chromium，在 macOS 上使用 WebKit
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    // 不为 < 1% 市场份额的浏览器编译
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // 生成 sourcemap 用于调试
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  server: {
    port: 1420,
    strictPort: false, // 端口被占用时自动尝试下一个可用端口
  },
});
