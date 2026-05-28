---
tags: [inbox, idea, installer, M0]
created: 2026-05-04
status: triaged
linked_epic: "[[../tasks/backlog/EPIC-0000-m0-installer-wizard]]"
---

# 安装向导（新需求）

> 本想法已归入 M0 EPIC → [[../tasks/backlog/EPIC-0000-m0-installer-wizard]]。

首启向导调整下，名称改为 安装向导，不要显示为步骤，而是显示为安装列表，列表第一条为openClaw（artifex nexus的基础底座），然后是web ui，后面再是软件列表，每个DCC都要需要支持展开的子列表（因为DCC会有不同版本，UE项目会有不同版本和工程路径，安装路径，安装脚本都可能不同），每个列表项需要有 检测、设置、安装  按钮，需要自动检测安装状态（不可用、待安装、已安装），并显示状态，必须要先安装openClaw，再安装其他内容。