# Vendored OpenClaw

Artifex Nexus 锚定一个固定版本的 OpenClaw，从 fork 分支拉取，
**整体安装到 `~/.artifexnexus/.openclaw/`**（与 Artifex Nexus 自身完全隔离）。

## 接入方式（待定，二选一）

1. **git submodule**（开发期推荐）
   ```bash
   git submodule add -b artifex-nexus/v0.x \
     https://github.com/<org>/openclaw.git vendor/openclaw/upstream
   ```

2. **release tarball pin**（发布期推荐）
   - `installer/scripts/fetch-vendor.{sh,ps1}` 固定 tag + sha256
   - CI 拉取 → 校验 → 写入 `vendor/openclaw/upstream/`

## fork 后必做修改

- [ ] OpenClaw 自身默认安装目录改为 `~/.artifexnexus/.openclaw/`
- [ ] 启动横幅 / About 字样：`Artifex Nexus (powered by OpenClaw vX.Y.Z)`
- [ ] 修改对外端口默认值（避免与未 vendor 的 OpenClaw 冲突，可选）

详见 `docs/decisions/0002-vendor-openclaw-fork.md`。
