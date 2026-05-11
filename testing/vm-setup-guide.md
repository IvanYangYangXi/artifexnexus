# 虚拟机测试环境搭建指南

为 Artifex Nexus 桌面应用创建可回滚的 Windows 虚拟机测试环境。

## 前提

- 宿主机 Windows 10/11，至少 16 GB 内存（虚拟机分配 4 GB，剩余宿主使用）
- 磁盘空闲 ≥ 30 GB（动态分配，实际占用随使用增长）
- VirtualBox 7.x + Extension Pack

---

## 一、安装 VirtualBox

```powershell
winget install Oracle.VirtualBox
```

或从 https://www.virtualbox.org/wiki/Downloads 下载安装。

安装完成后，务必安装 **Extension Pack**，支持：
- 共享文件夹
- USB 3.0
- 剪贴板共享

```powershell
# 终端一键安装 Extension Pack
#
# 注意：Oracle 7.2.x 版本扩展包下载链接可能变化，
# 推荐先手动下载 .vbox-extpack 文件，再用以下命令安装：

# 1. 浏览器打开下载页，下载 Extension Pack（All supported platforms）
start https://www.virtualbox.org/wiki/Downloads

# 2. 下载完成后，终端安装（自动找到最新下载的 .vbox-extpack 文件）
$extpack = Get-ChildItem "$env:USERPROFILE\Downloads\Oracle_VM_VirtualBox_Extension_Pack-*.vbox-extpack" `
    | Sort-Object LastWriteTime -Desc `
    | Select-Object -First 1

& 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe' extpack install --replace $extpack.FullName

# 3. 验证安装
& 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe' list extpacks
```

> **备选 GUI 方式**：VirtualBox 主界面 → 文件 → 工具 → Extension Pack Manager → 自动检测并下载。

---

## 二、获取 Windows 镜像

从 [Microsoft Evaluation Center](https://www.microsoft.com/evalcenter/evaluate-windows-11-enterprise) 下载：

- **Windows 11 Enterprise（评估版）**
- 语言：中文（简体）
- 有效期：90 天，到期前可用 `slmgr -rearm` 续期一次

> 评估版足以完成安装流程验证，无需正式授权。

---

## 三、创建虚拟机

### 3.1 新建虚拟机

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| 类型 | Microsoft Windows / Windows 11 (64-bit) | |
| 内存 | 4096 MB | WebView2 需要 |
| 虚拟硬盘 | 50 GB，VDI，动态分配 | 足够存放系统 + 测试数据 |
| CPU | 2–4 核 | 至少 2 核 |
| 显存 | 128 MB + 3D 加速 | WebView2 渲染 |

### 3.2 挂载 ISO

虚拟机设置 → 存储 → 光驱 → 选择下载的 Windows 11 ISO。

### 3.3 网络

保持默认 **NAT**，虚拟机可访问外网（需下载 WebView2 Runtime）。

### 3.4 共享文件夹

虚拟机设置 → 共享文件夹 → 添加：

| 设置项 | 值 |
|--------|-----|
| 文件夹路径 | `D:\MyProject_D\artifexnexus\apps\desktop\src-tauri\target\release\bundle\nsis` |
| 文件夹名称 | `artifex_builds` |
| 只读 | ✅ 勾选 |
| 自动挂载 | ✅ 勾选 |
| 挂载点 | `Z:` |

> 只读确保虚拟机内不会误修改构建产物。所有构建在宿主机执行。

---

## 四、安装 Windows

1. 启动虚拟机，进入 Windows 安装界面
2. 在选择网络界面，按 `Shift + F10` 打开命令提示符
3. 输入 `oobe\BypassNRO.cmd`，系统重启
4. 重启后会出现 **"我没有 Internet"** 选项
5. 选择 **"继续执行受限设置"**，使用本地账户登录

> 跳过 Microsoft 账户登录和联网要求，加速部署。

---

## 五、安装 Guest Additions

虚拟机菜单 → 设备 → 安装增强功能 → 运行光驱中的安装程序。

安装完成后重启虚拟机。Guest Additions 提供：
- 无边框鼠标（自动切换宿主/虚拟机）
- 共享剪贴板
- 共享文件夹自动挂载
- 显示分辨率自适应

---

## 六、安装必要运行时

### 6.1 WebView2 Runtime（关键！）

Tauri 桌面应用依赖 WebView2。Windows 11 自带，但评估版可能版本不够新，建议手动安装：

```powershell
# 在虚拟机内 PowerShell 中运行
Invoke-WebRequest `
    -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" `
    -OutFile "$env:TEMP\MicrosoftEdgeWebview2Setup.exe"
Start-Process "$env:TEMP\MicrosoftEdgeWebview2Setup.exe" -Wait
```

> 没有 WebView2 Runtime，Tauri 应用窗口将显示空白。

### 6.2 NSIS / VC++ 运行时（可选）

Artifex Nexus 安装包由 NSIS 生成，通常自带所需运行时。如果安装过程中出现 "缺少 VCRUNTIME140.dll" 等错误，安装：

```powershell
# Visual C++ Redistributable
winget install Microsoft.VCRedist.2015+.x64
```

---

## 七、创建基准快照

以上步骤完成后，系统处于"干净无 Artifex Nexus 痕迹"状态，创建基准快照：

```powershell
# 宿主机运行
& "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" snapshot "ArtifexNexus-Test-VM" take "01-Base-CleanSystem" --description "Win11 + Guest Additions + WebView2，无 Artifex Nexus"
```

或 GUI：虚拟机窗口 → 控制 → 生成备份 → 名称 `01-Base-CleanSystem`。

---

## 八、标准测试循环

每次发版或修改 `apps/desktop` 后，按以下流程测试：

### 宿主机操作

```powershell
# 构建最新安装包
cd D:\MyProject_D\artifexnexus
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
pnpm -C apps/desktop tauri build

# 记录产物信息（规则要求）
dir apps\desktop\src-tauri\target\release\bundle\nsis\*.exe
dir apps\desktop\src-tauri\target\release\artifex-nexus-desktop.exe
```

### 虚拟机操作

1. 还原到基准快照
2. 打开 Z: 盘（共享文件夹）
3. 双击 `Artifex Nexus_<version>_x64-setup.exe`
4. 按 `install-checklist.md` 逐项验证
5. 测试完毕，关闭虚拟机并还原快照

或使用自动化脚本（宿主机）：

```powershell
.\testing\test-vm.ps1
```

---

## 九、快照策略

| 快照名称 | 时机 | 内容 |
|----------|------|------|
| `01-Base-CleanSystem` | 初始环境搭建完成 | Win11 + Guest Additions + WebView2 |
| `02-Pre-Install` | 每次测试前 | 从 Base 恢复后临时创建，测试完删除 |
| `03-Post-Install` | 安装完成后 | 保留安装状态，用于后续功能测试 |

---

## 十、常见问题

### Q: 虚拟机内查不到 Z: 盘

确认 Guest Additions 已安装且虚拟机已重启。手动映射：
```
虚拟机窗口 → 设备 → 共享文件夹 → 添加共享文件夹
```

### Q: 安装包双击无反应

1. 检查 WebView2 Runtime 是否安装（控制面板 → 程序和功能 → 搜索 "WebView2"）
2. 检查 Windows 是否为 64 位（安装包是 x64）
3. 检查磁盘空间是否充足

### Q: 虚拟机启动后黑屏

1. 禁用 3D 加速重试
2. 检查显存是否 ≥ 128 MB
3. 检查 ISO 是否通过校验

### Q: 评估版到期

```cmd
# 虚拟机内管理员 cmd 运行
slmgr -rearm
# 可续期一次，总计 180 天
```
