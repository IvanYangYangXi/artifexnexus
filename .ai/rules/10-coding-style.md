# 编码与命名规范

## 包命名

- TS 包：`@artifex-nexus/<kebab-case>`
- Python 包：发布名 `artifex-nexus-<kebab>`，导入名 `artifex_nexus_<snake>`
- UE C++ 模块：`UEClawBridge`（保持与原项目一致，便于迁移）

## 文件结构（Python 包）

```
packages/<name>/
├── pyproject.toml
├── src/<import_name>/
│   ├── __init__.py
│   └── ...
└── tests/
    └── test_*.py
```

## 风格

- Python：ruff（line-length=100, py311+），强类型 + pydantic v2
- TS：strict 模式 + ESLint，禁止 `any`，公共 API 必须导出类型
- C++：UE 标准（PascalCase 类型，camelCase 变量），`F` / `U` / `A` 前缀
- 提交信息：Conventional Commits（feat/fix/docs/refactor/chore/test）

## 注释语言

代码注释 **中文**，公共 API docstring **中英双语**（英文一行简介 + 中文详述）。

## 测试

- Python：pytest，单元测试与集成测试分目录
- TS：vitest
- 每个新模块都要有最小 smoke test
