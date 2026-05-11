# Testing — 虚拟环境测试

本目录存放 Artifex Nexus 桌面应用在**隔离虚拟机环境**中的安装/运行测试相关脚本与文档。

## 目录结构

```
testing/
├── README.md                # 本文件
├── test-vm.ps1              # 自动化测试脚本（宿主机运行）
├── vm-setup-guide.md        # VM 环境搭建详细指南
├── install-checklist.md     # 安装流程逐项检查清单
└── sandbox.wsb              # Windows Sandbox 配置文件（备选轻量方案）
```

## 快速开始

### 前提条件

- 宿主机：Windows 10/11，已安装 [VirtualBox](https://www.virtualbox.org/) + Guest Additions
- Extension Pack 为可选（共享文件夹依赖它），拖放/剪贴板可替代传输文件

### 一键测试

```powershell
# 在项目根目录执行
.\testing\test-vm.ps1
```

脚本会自动执行：
1. 运行 `pnpm tauri build` 构建最新安装包
2. 打印产物信息（文件名、大小、时间戳）
3. 还原虚拟机到基准快照
4. 启动虚拟机

随后在虚拟机内手动执行安装测试（参照 `install-checklist.md`）。

### 手动测试流程

如果不想用脚本，手动步骤见 `vm-setup-guide.md` 的"标准测试循环"章节。

## 两种方案对比

| 方案 | 文件 | 适用场景 |
|------|------| ---------|
| VirtualBox + 快照 | `vm-setup-guide.md` | 完整安装流程验证，模拟真实用户环境 |
| Windows Sandbox | `sandbox.wsb` | 快速冒烟测试（需 Win Pro/Enterprise） |

## 相关文档

- 构建与发版规则：`.ai/rules/40-build-and-release.md`
- 项目速览：`.ai/context/project-overview.md`
- Sidecar 运行时架构：`.ai/context/project-overview.md#sidecar-运行时架构`
