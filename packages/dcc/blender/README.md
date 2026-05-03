# Artifex Nexus for Blender

Blender 5.1 addon。

## 安装方式

Blender 主动扫描 addons 目录，**用 symlink 引用源码即可**：

```bash
artifex install --dcc blender
# 等价于：ln -s $(pwd)/packages/dcc/blender/src/artifex_nexus_blender \
#               ~/Library/Application Support/Blender/5.1/scripts/addons/artifex_nexus_blender
```

源码改了立即生效（Blender 内 reload addon 即可）。

打包发布则用 `artifex package --dcc blender` 产出 zip。
