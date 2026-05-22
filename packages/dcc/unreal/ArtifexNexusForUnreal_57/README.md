# Artifex Nexus for Unreal

UE 5.7 Editor 插件。

## 安装方式

UE 工程结构对路径敏感（`.uplugin` 必须在 `<Project>/Plugins/<Name>/` 或 `Engine/Plugins/.../`），
**部署用 copy，不用 symlink**：

```bash
artifex install --dcc unreal --project /path/to/MyProject
# 等价于：cp -r packages/dcc/unreal/  <Project>/Plugins/ArtifexNexusForUnreal/
```

升级时由 `artifex update --dcc unreal` 重新拷贝（也可直接拷贝覆盖）。

## 目录

- `Source/ArtifexNexus/`   C++ 模块（UI / EditorSubsystem / 主线程调度桥）
- `Content/Python/`        Python 运行时（MCP Server / Skill Hub 等）
- `Resources/`             图标资源
