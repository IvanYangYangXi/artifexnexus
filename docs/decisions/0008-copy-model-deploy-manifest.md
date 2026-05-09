---
tags: [adr, deploy, install, copy, manifest, validation]
created: 2026-05-09
status: accepted
---

# ADR 0008 — 弃用 Junction/Symlink，统一为物理拷贝 + 部署清单校验

## Context

OpenClaw v2026.5.4 的插件 discovery 机制调用 `fs.realpathSync()` 解析目录路径，NTFS junction 的
`realpath` 指向源码盘（跨卷），被 trusted-root 安全检查拒绝，导致 Gateway 静默跳过 mcp-bridge
插件。此外，journal/symlink 部署方式缺乏文件完整性校验能力，用户无法判断已部署文件是否损坏或被
篡改。

## Decision

**所有 DCC 插件和 Gateway 插件的安装部署统一使用 `shutil.copytree()` 物理拷贝**，弃用
junction（`mklink /J`）和 symlink（`os.symlink`）。

每次安装后自动生成 `deploy-manifest.json`（路径：`OPENCLAW_HOME/state/deploy-manifest.json`），
记录每个部署项的：

- 文件清单：`{path, sha256, size}`
- 部署时间戳
- 源码版本号

全局校验函数 `validate_all_deployments()` 遍历 manifest，逐文件对比 sha256，返回：
`ok` / `outdated`（版本过时） / `missing`（目录不存在） / `corrupted`（文件缺失或校验不匹配）。

## Consequences

**正向**：
- 彻底消除跨卷 junction 路径逃逸问题
- 文件完整性可审计，`openclaw.deploy.validate` RPC 供前端"检测"按钮调用
- 新 DCC 接入零配置：安装函数调用 `_record_deployment()` 即自动注册

**负向**：
- 拷贝比 junction 慢（但插件目录通常 < 100 个文件，实际 < 1s）
- 源码更新后需重新"安装"（等同于重装）触发 manifest 更新；outdated 检测已在 manifest 中实现

## Alternatives Considered

1. **保留 junction 但 patch OpenClaw discovery** — 不可行，上游源码不可控
2. **使用 hardlink** — Windows 上目录不能 hardlink；且文件级 hardlink 跨卷仍不支持
3. **仅校验不迁移 copy** — junction 路径逃逸问题未解决

## Cross-References

- `docs/development/context-handoff-copy-model-and-validation.md` — 实施手册
- `packages/adapters/openclaw/wrapper/src/.../dcc_installer.py` — 安装/校验实现
- `.ai/rules/00-architecture.md` §安装与引用规则
