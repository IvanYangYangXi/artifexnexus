---
id: STORY-0063
kind: story
title: Sidecar dcc_installer + bootstrap 扩展
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1.5d
created: 2026-05-25
updated: 2026-05-25
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_adr: [0006]
related_specs: ["../../specs/maya-max-mcp-integration", "../../specs/dcc-plugin-management"]
related_packages: ["packages/adapters/openclaw/wrapper"]
tags: [story, sidecar, dcc_installer, maya, 3ds_max]
---

# Sidecar dcc_installer + bootstrap 扩展

## 背景与目标

Python Sidecar 的安装器（`dcc_installer.py`）和配置引导（`bootstrap.py`）需要扩展支持 Maya 和 3ds Max。当前代码中 Maya/Max 相关配置已有占位符（注释），需要取消注释并实现完整逻辑。

## 范围 / 非范围

- 范围：`dcc_installer.py` / `bootstrap.py` / `nexus_tool_rpc.py`
- 非范围：不修改 Blender/UE 现有逻辑

## 验收标准

### dcc_installer.py

- [ ] `_DCC_VERSION_SCAN_PATHS` 取消注释 Maya/Max 路径
- [ ] `_DCC_ADDON_PATH_TEMPLATES` 取消注释 Maya/Max 模板
- [ ] `_DCC_DEFAULT_PORTS` 取消注释，Maya=18081，Max=18082
- [ ] 实现 `find_maya_versions()` + `find_max_versions()`（含 Max 版本号格式兼容 `"2024 - 64bit"`）
- [ ] 实现 `install_maya_addon()` + `install_max_addon()`（含 locale 同步逻辑）
- [ ] 实现 `uninstall_maya_addon()` + `uninstall_max_addon()`
- [ ] `get_addon_source_dir(dcc)` 扩展支持 Maya/Max

### bootstrap.py

- [ ] `_generate_default_config()` 添加 `maya-primary` / `max-primary` servers

### nexus_tool_rpc.py

- [ ] `_DCC_TO_MCP_SERVER` 确认 Maya/Max 映射正确
- [ ] 添加 Maya/Max 连接指引

## 设计要点

- Maya locale 同步：扫描 `xx_XX/scripts/` 目录 → `link_or_copy_dir` junction
- Max locale 同步：全 locale 目录（ENU/CHS/JPN 等）
- Max 版本扫描：支持 `"2024"` 和 `"2024 - 64bit"` 格式，提取版本号后 set 去重

## 子任务（TASK 列表）

- [ ] `dcc_installer.py` 取消注释配置 + 实现 find/install/uninstall 函数
- [ ] `bootstrap.py` 添加 Maya/Max server 配置
- [ ] `nexus_tool_rpc.py` 完善连接指引

## 进展日志

- 2026-05-25 created
