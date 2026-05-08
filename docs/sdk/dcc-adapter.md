# DCC Adapter SDK

> DCC 适配层抽象接口。所有 DCC（Blender / Maya / Max / UE）的 adapter 继承此基类。

## 抽象基类

**位置**：`packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/base_adapter.py`

```python
class BaseDCCAdapter(ABC):
    """DCC 适配层抽象接口"""

    # ── 基础信息 ──
    def get_software_name(self) -> str: ...       # "blender" / "maya" / "max"
    def get_software_version(self) -> str: ...    # "5.1" / "2024"
    def get_python_version(self) -> str: ...      # "3.11.0"

    # ── 生命周期 ──
    def on_startup(self) -> None: ...             # DCC 启动时调用
    def on_shutdown(self) -> None: ...            # DCC 关闭时调用

    # ── 主线程调度 ──
    def execute_on_main_thread(self, fn, *args) -> Any: ...  # 阻塞等待结果
    def execute_deferred(self, fn, *args) -> None: ...       # 非阻塞

    # ── 上下文采集 ──
    def get_selected_objects(self) -> List[Dict]: ...  # 选中对象列表
    def get_scene_info(self) -> Dict: ...              # 场景信息
    def get_current_file(self) -> Optional[str]: ...   # 当前文件路径

    # ── 代码执行 ──
    def execute_code(self, code: str, context=None) -> Dict: ...
    # → {"success": bool, "result": Any, "error": str|None, "output": str}
```

## 实现示例（Blender）

**位置**：`packages/dcc/blender/src/artifex_nexus/v5.0.0/blender_addon/blender_adapter.py`

```python
class BlenderAdapter(BaseDCCAdapter):
    def execute_code(self, code: str, context=None) -> Dict:
        """在 Blender 环境中执行 Python 代码。
        
        预注入变量：S（选中对象）/ W（文件路径）/ L（bpy）/ C（context）/ D（data）
        持久化命名空间：跨调用保持用户变量。
        Undo 支持：每次执行前 push undo step。
        """
```

## 主线程调度机制

Blender 不提供 `executeInMainThreadWithResult`，通过以下方式实现：

```
queue.Queue + bpy.app.timers.register()
  │
  ├─ 外部线程 → queue.put(task)
  └─ timer 回调（主线程）→ queue.get() → 执行 → Event.set()
```

超时：30s，超时抛出 `TimeoutError`。

## 新增 DCC Adapter

1. 创建 `{dcc}_adapter.py`，继承 `BaseDCCAdapter`
2. 实现所有抽象方法
3. 实现主线程调度（根据 DCC 特性选择 queue/timer 或原生 API）
4. 在 `mcp_server.py` 中注册 `run_python` 工具

## 相关

- `[[dcc-registry]]` — 前端 DCC 注册表
- `[[../specs/dcc-plugin-management]]` — 完整规范
