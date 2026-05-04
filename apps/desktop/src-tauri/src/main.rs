// 桌面壳入口：禁止在此写业务逻辑，仅做 Tauri 应用启动。
// 所有系统能力通过 modes/ 下的模块暴露。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    artifex_nexus_desktop_lib::run()
}
