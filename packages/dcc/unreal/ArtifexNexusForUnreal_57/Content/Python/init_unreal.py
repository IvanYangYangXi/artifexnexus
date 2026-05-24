"""
init_unreal.py - UE Editor Agent Python 初始化入口
==================================================

阶段 0.4: 日志与调试重定向 (Logging System)
阶段 0.5: 依赖隔离与自动安装 (Dependency Management)

宪法约束:
  - 将 Python stdout/stderr 重定向至 UE Output Log，添加 LogArtifexNexus 前缀
    (开发路线图 §0.5 / 系统架构设计 §2.3)
  - 插件私有库路径加入 sys.path，不污染引擎环境
    (开发路线图 §0.4 / 项目概要 §五)
  - C++ 负责生命周期/UI/主线程调度，Python 负责 MCP 通信和 Skill 逻辑
    (系统架构设计 §2.3)

本文件在 UE 编辑器加载插件时由 PythonScriptPlugin 自动执行。
"""

import sys
import os
import traceback
import logging

import unreal


# ============================================================================
# 0. 路径常量
# ============================================================================

# 插件 Content/Python 目录（本文件所在目录）
_PLUGIN_PYTHON_DIR = os.path.dirname(os.path.abspath(__file__))

# 启动时清理 __pycache__，确保源码修改后不会加载过期的 .pyc
_pycache_dir = os.path.join(_PLUGIN_PYTHON_DIR, "__pycache__")
if os.path.isdir(_pycache_dir):
    import shutil
    try:
        shutil.rmtree(_pycache_dir)
    except Exception:
        pass

# 插件私有第三方库目录
_PLUGIN_LIB_DIR = os.path.join(_PLUGIN_PYTHON_DIR, "Lib")


# ============================================================================
# 0.5. UE 版本检测
# ============================================================================

def get_ue_engine_version():
    """获取当前运行的 UE 引擎版本字符串，如 "5.7.0" """
    try:
        return str(unreal.SystemLibrary.get_engine_version())
    except Exception:
        # UE 5.0 以下无此 API，回退到系统信息
        try:
            si = unreal.SystemLibrary.get_system_info()
            return si.get("engine_version", "unknown")
        except Exception:
            return "unknown"


def check_ue_version_compatibility():
    """检查当前 UE 版本是否与插件兼容。

    直接从 plugin_info.py 文件读取版本元数据（避免目录名含 '.' 的 import 问题）。

    Returns:
        (is_compatible: bool, message: str)
    """
    import ast
    _plugin_info_path = os.path.join(
        _PLUGIN_PYTHON_DIR, "..", "..", "src", "artifex_nexus_ue", "v0.1.0", "plugin_info.py"
    )
    _plugin_info_path = os.path.normpath(os.path.abspath(_plugin_info_path))
    ue_min = (5, 7, 0)
    ue_max = None

    try:
        with open(_plugin_info_path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())
        # 简单遍历 AST 提取 plugin_info 字典
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                if getattr(node.targets[0], "id", None) == "plugin_info":
                    if isinstance(node.value, ast.Dict):
                        for key, val in zip(node.value.keys, node.value.values):
                            k = getattr(key, "value", None)
                            if k == "ue_min" and isinstance(val, ast.Tuple):
                                ue_min = tuple(
                                    elt.value for elt in val.elts
                                    if isinstance(elt, ast.Constant)
                                )
                            elif k == "ue_max":
                                if isinstance(val, ast.Constant) and val.value is None:
                                    ue_max = None
                                elif isinstance(val, ast.Tuple):
                                    ue_max = tuple(
                                        elt.value for elt in val.elts
                                        if isinstance(elt, ast.Constant)
                                    )
    except Exception as e:
        # 开发环境下文件不存在是正常的（Content/Python/ 是 junction 场景）
        UELogger.debug(f"plugin_info.py parse skipped (dev mode): {e}")

    try:
        ver_str = get_ue_engine_version()
        # 版本号可能包含构建元数据（如 "5.7.4-51494982+++UE5+Release-5.7"），
        # 只提取各部分开头的数字部分
        parts = ver_str.split(".")
        current_parts = []
        for p in parts[:3]:
            # 提取前导数字（处理 "4-51494982+++UE5+Release-5" 这种情况）
            digits = ""
            for ch in p:
                if ch.isdigit():
                    digits += ch
                else:
                    break
            current_parts.append(int(digits) if digits else 0)
        current = tuple(current_parts)
    except Exception:
        return False, f"无法检测 UE 版本: {ver_str}"

    if current < ue_min:
        return False, (
            f"UE {ver_str} 低于插件最低要求 {'.'.join(str(v) for v in ue_min)}。"
            f"请升级到 UE {'.'.join(str(v) for v in ue_min)}+"
        )
    if ue_max is not None and current > ue_max:
        return False, (
            f"UE {ver_str} 高于插件最高支持版本 {'.'.join(str(v) for v in ue_max)}。"
            f"请升级插件或降级引擎"
        )
    return True, f"UE {ver_str} 兼容 ({'.'.join(str(v) for v in ue_min)}+)"


# ============================================================================
# 1. 日志系统 (阶段 0.4)
# ============================================================================

from artifex_nexus_logger import UELogger, _UELogLevel, log_mcp_call, PanelLogger

# 将当前模块注册为 'init_unreal'，使 C++ 侧的 ExecPythonCommand
# 可以通过 "from init_unreal import start_mcp_server" 正常导入。
# UE 以 startup script 方式执行本文件，模块在 __main__ 命名空间，
# 不会自动出现在 sys.modules['init_unreal']。
sys.modules['init_unreal'] = sys.modules[__name__]


class _UEOutputStream:
    """
    将 Python stdout / stderr 重定向到 UE Output Log。

    宪法约束:
      - 开发路线图 §0.5: 重定向 Python stdout/stderr 至 UE Output Log
      - 所有 print() 输出实时显示在 Output Log 中

    设计说明:
      - stdout  -> LogArtifexNexus       [INFO]
      - stderr  -> LogArtifexNexus_Error [ERROR]
      - 使用行缓冲：积累到完整一行后再输出，避免堆栈信息被拆成多条日志
      - 多行文本（如 traceback）合并为一条日志输出，避免刷屏
    """

    def __init__(self, level: str = _UELogLevel.INFO, category: str = None, original_stream=None):
        self._level = level
        # stderr 使用 ERROR 分类，stdout 使用 GENERAL 分类
        self._category = category or UELogger.CATEGORY_GENERAL
        self._original = original_stream
        self._buffer = ""

    def write(self, text: str):
        if not text:
            return

        # 同时写入原始流（保留 IDE 调试能力）
        if self._original:
            try:
                self._original.write(text)
            except Exception:
                pass

        # 累积到缓冲区，遇到换行时自动 flush（行缓冲模式）
        self._buffer += text
        if '\n' in self._buffer:
            self.flush()

    def flush(self):
        # 刷新时把缓冲区内容一次性输出（保持多行完整性）
        if self._buffer.strip():
            UELogger._log(self._category, self._level, self._buffer.rstrip("\n"))
            self._buffer = ""
        if self._original:
            try:
                self._original.flush()
            except Exception:
                pass

    def isatty(self):
        return False


def _install_stream_redirectors():
    """
    安装 stdout/stderr 重定向器。

    - stdout -> LogArtifexNexus       [INFO]
    - stderr -> LogArtifexNexus_Error [ERROR]
    """
    # 保存原始流引用
    original_stdout = sys.stdout
    original_stderr = sys.stderr

    sys.stdout = _UEOutputStream(
        level=_UELogLevel.INFO,
        category=UELogger.CATEGORY_GENERAL,
        original_stream=original_stdout,
    )
    sys.stderr = _UEOutputStream(
        level=_UELogLevel.ERROR,
        category=UELogger.CATEGORY_ERROR,
        original_stream=original_stderr,
    )


def _install_exception_hook():
    """
    安装全局未捕获异常处理器。

    确保 Python 未捕获的异常也能记录到 UE Output Log。
    """
    _original_excepthook = sys.excepthook

    def _ue_excepthook(exc_type, exc_value, exc_tb):
        tb_str = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        UELogger._log(
            UELogger.CATEGORY_ERROR,
            _UELogLevel.ERROR,
            f"Uncaught Exception:\n{tb_str}"
        )
        # 仍然调用原始 hook
        if _original_excepthook and _original_excepthook is not _ue_excepthook:
            _original_excepthook(exc_type, exc_value, exc_tb)

    sys.excepthook = _ue_excepthook


# log_mcp_call 装饰器已移至 artifex_nexus_logger.py，上面已 import


# ============================================================================
# 2. 依赖隔离与自动安装 (阶段 0.5)
# ============================================================================

# 必需依赖：安装失败则阻止插件功能
# 版本号固定策略：有界区间（>=min,<next-major），避免自动升级到不兼容大版本
# - websockets 12.x: 纯 Python，12.0 是当前稳定主线
# - pydantic 2.x: 2.10+ 已验证兼容 Python 3.11（UE 5.7）
# - cryptography 44-48.x: ABI 稳定，cffi 绑定，跨小版本兼容
_REQUIRED_PACKAGES = [
    ("websockets", "websockets>=12.0,<13.0"),
    ("pydantic", "pydantic>=2.10,<3.0"),
    ("cryptography", "cryptography>=44.0,<49.0"),
]

# 可选依赖：安装失败不影响核心功能
_OPTIONAL_PACKAGES = [
    ("yaml", "PyYAML>=6.0.3,<7.0"),
]


def _ensure_lib_dir():
    """确保插件私有 Lib 目录存在。"""
    if not os.path.exists(_PLUGIN_LIB_DIR):
        os.makedirs(_PLUGIN_LIB_DIR, exist_ok=True)
        UELogger.info(f"Created Lib directory: {_PLUGIN_LIB_DIR}")


def _add_lib_to_path():
    """
    将插件私有 Lib 目录加入 sys.path（优先级高于引擎目录）。

    设计要点：
      - 始终 remove + re-insert，而非仅在不存在时 insert。
        因为在 _initialize() 中本函数会在 _ensure_lib_dir() 之前被调用，
        Lib 目录尚不存在时加入 sys.path 会导致 Python 导入缓存
        (sys.path_importer_cache) 将该路径标记为无效 (None)。
        后续即使 Lib 被创建，缓存仍然过时，`__import__` 会跳过 Lib
        从而误报依赖缺失（假阴性）。

    宪法约束:
      - 开发路线图 §0.5: 将插件私有库路径加入 sys.path
      - 项目概要 §五: 每个插件独立虚拟环境，互不干扰
    """
    # 先移除（如果已存在），确保路径的导入缓存被刷新
    if _PLUGIN_LIB_DIR in sys.path:
        sys.path.remove(_PLUGIN_LIB_DIR)
    sys.path.insert(0, _PLUGIN_LIB_DIR)
    # 清除导入路径缓存，确保新创建的 Lib 目录能被 Python import 系统识别
    # （如果本函数在 _ensure_lib_dir() 之前被调用，Lib 当时不存在，
    #  sys.path_importer_cache 会缓存 None，后续即使 Lib 被创建也无法找到包）
    import importlib
    importlib.invalidate_caches()
    UELogger.debug(f"Added to sys.path: {_PLUGIN_LIB_DIR}")


def _get_project_root() -> str:
    """
    获取 artartifex_nexus 项目根目录。

    查找顺序:
      1. ~/.artifexnexus/config.json 的 project_root
      2. 从插件源码树相对路径推算
    返回空串表示未找到。
    """
    # 方法 1: config.json
    try:
        config_path = os.path.join(os.path.expanduser("~"), ".artifexnexus", "config.json")
        if os.path.exists(config_path):
            import json
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            root = cfg.get("project_root", "")
            if root and os.path.isdir(root):
                return os.path.normpath(root)
    except Exception:
        pass

    # 方法 2: 相对路径推算
    # Content/Python/ → ../../ = ArtifexNexus/ → 不同层级尝试找 core/
    for levels in (6, 4):
        candidate = os.path.normpath(os.path.join(
            _PLUGIN_PYTHON_DIR, *([os.pardir] * levels)))
        if os.path.isdir(os.path.join(candidate, "core")):
            return candidate

    return ""


def _add_shared_modules_to_path():
    """
    将共享模块目录加入 sys.path，使 UE 可以直接引用源码而非副本。

    添加的目录（优先级低于 _PLUGIN_PYTHON_DIR，用 append）:
      - {project_root}/core/               → bridge_core, bridge_config 等
      - {project_root}/platforms/openclaw/  → openclaw_ws, openclaw_chat 等
      - {project_root}/subprojects/DCCArtifexNexus/core/
                                            → artifex_nexus_sdk, tool_event_writer 等
    """
    project_root = _get_project_root()
    if not project_root:
        UELogger.debug("Project root not found, shared modules will use local copies")
        return

    dirs_to_add = [
        os.path.join(project_root, "core"),
        os.path.join(project_root, "platforms", "openclaw"),
        os.path.join(project_root, "subprojects", "DCCArtifexNexus", "core"),
    ]

    for d in dirs_to_add:
        if os.path.isdir(d) and d not in sys.path:
            sys.path.append(d)
            UELogger.debug(f"Shared modules path: {d}")

    UELogger.info(f"Shared modules loaded from project root: {project_root}")


def _check_package_available(import_name: str) -> bool:
    """检查指定包是否可导入。

    对 cryptography 做深度验证：不仅检查 import，还验证 _cffi_backend C 扩展
    是否与当前 Python 版本匹配。避免 pip 用错 Python 版本导致 .pyd 不兼容。
    """
    try:
        __import__(import_name)
    except ImportError:
        return False

    if import_name == "cryptography":
        try:
            from cryptography.hazmat.primitives.serialization import load_pem_public_key  # noqa: F401
        except ImportError as exc:
            UELogger.warning(
                f"cryptography import OK but hazmat module failed: {exc}. "
                f"This usually means _cffi_backend .pyd is for the wrong Python version. "
                f"UE uses Python {sys.version_info.major}.{sys.version_info.minor}, "
                f"please reinstall with UE's own Python."
            )
            return False

    return True


def _find_ue_python_executable() -> str:
    """
    查找 UE 内置 Python 解释器路径。

    注意：在 UE 内嵌 Python 中，sys.executable 指向 UnrealEditor.exe，
    不能直接用于 subprocess。必须找到真正的 python.exe。

    策略：
      1. sysconfig.get_config_var('BINDIR') — 编译期记录，最可靠
      2. unreal.Paths.engine_dir() — UE API 路径推算
      3. sys.prefix — CPython 安装前缀
    """
    import sysconfig

    # 方法 1: sysconfig BINDIR — 编译时硬编码的 Python 二进制目录
    try:
        bindir = sysconfig.get_config_var('BINDIR')
        if bindir:
            for name in ('python.exe', 'python3.exe', 'python311.exe'):
                candidate = os.path.join(bindir, name)
                if os.path.isfile(candidate):
                    UELogger.info(f"Found UE Python via sysconfig: {candidate}")
                    return os.path.normpath(candidate)
    except Exception:
        pass

    # 方法 2: unreal.Paths.engine_dir() — UE API
    try:
        engine_dir = unreal.Paths.engine_dir()
        possible_paths = [
            os.path.join(engine_dir, "Binaries", "ThirdParty", "Python3", "Win64", "python.exe"),
            os.path.join(engine_dir, "Binaries", "ThirdParty", "Python3", "Win64", "python3.exe"),
            os.path.join(engine_dir, "Binaries", "ThirdParty", "Python3", "Win64", "python311.exe"),
        ]
        for p in possible_paths:
            if os.path.isfile(p):
                UELogger.info(f"Found UE Python via engine_dir: {p}")
                return os.path.normpath(p)
    except Exception:
        pass

    # 方法 3: sys.prefix / sys.base_prefix
    for attr in ('base_prefix', 'prefix'):
        prefix = getattr(sys, attr, '')
        if prefix:
            for name in ('python.exe', 'python3.exe'):
                candidate = os.path.join(prefix, name)
                if os.path.isfile(candidate):
                    UELogger.info(f"Found UE Python via sys.{attr}: {candidate}")
                    return os.path.normpath(candidate)

    # 方法 4: sys.executable（仅当它确实是 python.exe，不可能是 UnrealEditor）
    if sys.executable and os.path.isfile(sys.executable):
        exe_name = os.path.basename(sys.executable).lower()
        if "python" in exe_name and "unreal" not in exe_name:
            UELogger.info(f"Using sys.executable: {sys.executable}")
            return sys.executable

    return ""


def _bootstrap_pip(python_exe: str) -> bool:
    """
    引导安装 pip（UE 内嵌 Python 默认不含 pip，需 ensurepip）。

    确保引导后 pip 真正可用（二次验证）。

    Returns:
        True 如果 pip 可用（含引导成功）
    """
    import subprocess

    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

    def _run(args, timeout=60):
        proc = subprocess.Popen(
            [python_exe] + args,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=creationflags,
        )
        try:
            _, stderr_bytes = proc.communicate(timeout=timeout)
            stderr_str = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            return -1, "timeout"
        return proc.returncode, stderr_str

    # Step 1: 检查 pip 是否已可用
    rc, _ = _run(["-m", "pip", "--version"], timeout=30)
    if rc == 0:
        return True  # pip 已就绪

    # Step 2: ensurepip 引导
    PanelLogger.emit("PIP", "pip 未安装，正在通过 ensurepip 引导...")
    UELogger.info("Running ensurepip --default-pip ...")
    rc, stderr = _run(["-m", "ensurepip", "--default-pip", "--upgrade"], timeout=180)
    if rc != 0:
        PanelLogger.emit("PIP", f"ensurepip 引导失败 (code={rc})", _UELogLevel.ERROR)
        UELogger.error(f"ensurepip failed (code={rc}): {stderr}")
        # 尝试不用 --upgrade 再引导一次（某些 UE Python 不支持 upgrade 参数）
        UELogger.info("Retrying ensurepip without --upgrade ...")
        rc2, stderr2 = _run(["-m", "ensurepip", "--default-pip"], timeout=180)
        if rc2 != 0:
            UELogger.error(f"ensurepip retry also failed (code={rc2}): {stderr2}")
            return False

    # Step 3: 验证 pip 真的可用
    rc, _ = _run(["-m", "pip", "--version"], timeout=30)
    if rc == 0:
        PanelLogger.emit("PIP", "pip 引导完成")
        UELogger.info("pip bootstrapped and verified")
        return True

    PanelLogger.emit("PIP", "pip 引导后仍不可用", _UELogLevel.ERROR)
    UELogger.error("pip --version failed after ensurepip")
    return False


_PIP_ERROR_GUIDANCE = {
    "certificate verify failed": (
        "SSL 证书验证失败。可能原因: 公司代理 / 防火墙 / 系统 CA 证书未更新。"
        "临时绕过（不推荐）: pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org ..."
    ),
    "Could not fetch URL": (
        "无法连接 PyPI。请检查: ① 网络连接 ② 是否需配置代理 "
        "(set HTTP_PROXY=https://proxy:port)。"
    ),
    "No matching distribution found": (
        "指定版本的包在 PyPI 上找不到。可能是 Python 版本不兼容 "
        "或版本号有误。当前 UE Python: {py_ver}。"
    ),
    "Permission denied": (
        "写入 Lib 目录权限不足。请检查: {target_dir} 的写入权限。"
    ),
    "No module named ensurepip": (
        "UE Python 未包含 ensurepip 模块（可能被裁剪过）。"
        "请手动安装 pip 后再重试。"
    ),
    "externally-managed-environment": (
        "UE Python 标记为 externally-managed。pip install 需加 --break-system-packages。"
    ),
}


def _pip_install(package_spec: str, target_dir: str) -> bool:
    """
    使用 pip install --target 安装包到指定目录。

    首次运行时会自动通过 ensurepip 引导 pip（UE 内嵌 Python 默认不含 pip）。

    宪法约束:
      - 开发路线图 §0.4: pip install --target 定向安装，不污染引擎环境
      - 项目概要 §五: 依赖隔离
    """
    import subprocess

    python_exe = _find_ue_python_executable()
    if not python_exe:
        UELogger.error(
            f"Cannot find UE Python executable. "
            f"Manual command: pip install --target \"{target_dir}\" {package_spec}"
        )
        return False

    # 安全检查：确保不是 UnrealEditor.exe
    exe_basename = os.path.basename(python_exe).lower()
    if "unreal" in exe_basename or "editor" in exe_basename:
        UELogger.error(
            f"Detected UnrealEditor as python executable ({python_exe}), aborting pip install. "
            f"Manual command: pip install --target \"{target_dir}\" {package_spec}"
        )
        return False

    UELogger.debug(f"Using Python: {python_exe} (version {sys.version_info.major}.{sys.version_info.minor})")

    # ── 辅助：运行子进程并捕获输出 ──
    def _run(args, timeout=180, capture_stdout=False):
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        proc = subprocess.Popen(
            [python_exe] + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
        )
        try:
            out_bytes, err_bytes = proc.communicate(timeout=timeout)
            out_str = out_bytes.decode("utf-8", errors="replace") if out_bytes else ""
            err_str = err_bytes.decode("utf-8", errors="replace") if err_bytes else ""
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            return -1, "", "timeout"
        result = out_str if capture_stdout else err_str
        return proc.returncode, result, err_str

    # ── Step 1: 确保 pip 可用 ──
    if not _bootstrap_pip(python_exe):
        return False

    # ── Step 2: pip install（带重试） ──
    cmd_base = [
        "-m", "pip", "install",
        "--target", target_dir,
        "--no-user",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--retries", "3",
        "--timeout", "60",
    ]

    PanelLogger.emit("PIP", f"安装: {package_spec}")
    UELogger.info(f"Installing: {package_spec} -> {target_dir}")

    rc, stderr, _ = _run(cmd_base + [package_spec], timeout=180)

    if rc == 0:
        PanelLogger.emit("PIP", f"安装成功: {package_spec}")
        UELogger.info(f"Successfully installed: {package_spec}")
        return True

    # ── Step 3: 错误分析与指引 ──
    combined_err = stderr.strip()
    PanelLogger.emit("PIP", f"安装失败: {package_spec} (code={rc})", _UELogLevel.ERROR)
    UELogger.error(f"pip install failed for {package_spec} (code={rc})")

    if combined_err:
        UELogger.error(f"  stderr: {combined_err[:500]}")

    # 匹配常见错误模式，输出可操作的排查指引
    guidance = None
    for pattern, message in _PIP_ERROR_GUIDANCE.items():
        if pattern.lower() in combined_err.lower():
            guidance = message.format(
                py_ver=f"{sys.version_info.major}.{sys.version_info.minor}",
                target_dir=target_dir,
            )
            break

    if guidance:
        UELogger.error(f"  === 排查指引 ===\n  {guidance}")
    else:
        UELogger.error(
            f"  无法自动诊断。请手动执行:\n"
            f"  \"{python_exe}\" -m pip install --target \"{target_dir}\" {package_spec}"
        )

    return False


def _check_offline_bundle() -> bool:
    """
    检查并安装离线依赖包。

    离线 bundle 位于 Content/Python/Lib_bundle/ 目录。
    """
    bundle_dir = os.path.join(_PLUGIN_PYTHON_DIR, "Lib_bundle")
    if not os.path.isdir(bundle_dir):
        return False

    # 检查是否有 .whl 或 .tar.gz 文件
    wheel_files = [
        f for f in os.listdir(bundle_dir)
        if f.endswith((".whl", ".tar.gz", ".zip"))
    ]

    if not wheel_files:
        return False

    UELogger.info(f"Found offline bundle with {len(wheel_files)} packages")

    import subprocess
    python_exe = _find_ue_python_executable()
    if not python_exe:
        return False

    # 安全检查：确保不是 UnrealEditor.exe
    exe_basename = os.path.basename(python_exe).lower()
    if "unreal" in exe_basename or "editor" in exe_basename:
        UELogger.warning("Cannot use UnrealEditor as pip executable for offline bundle")
        return False

    cmd = [
        python_exe, "-m", "pip", "install",
        "--target", _PLUGIN_LIB_DIR,
        "--no-index",
        "--find-links", bundle_dir,
        "--no-user",
        "--disable-pip-version-check",
    ]
    # 安装 bundle 目录下所有包
    cmd.extend([os.path.join(bundle_dir, f) for f in wheel_files])

    try:
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
        )
        try:
            stdout_bytes, stderr_bytes = proc.communicate(timeout=120)
            stderr_str = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            UELogger.warning("Offline bundle install timed out")
            return False

        if proc.returncode == 0:
            UELogger.info("Offline bundle installed successfully")
            return True
        else:
            UELogger.warning(f"Offline bundle install failed: {stderr_str}")
            return False
    except Exception:
        UELogger.exception("Offline bundle install error")
        return False


def _check_dependencies_fast() -> bool:
    """
    快速检测依赖是否已安装（不安装，仅检测）。

    Returns:
        True 如果所有必需包都已可用
    """
    _ensure_lib_dir()
    _add_lib_to_path()
    _add_shared_modules_to_path()

    for import_name, _ in _REQUIRED_PACKAGES:
        if not _check_package_available(import_name):
            return False
    return True


def _install_dependencies():
    """
    主依赖安装流程。

    流程：
    1. 确保 Lib 目录存在
    2. 将 Lib 加入 sys.path
    3. 检测每个依赖是否可用
    4. 缺失时：先尝试离线 bundle，再尝试在线 pip install
    5. 必需包全部就绪后返回 True

    宪法约束:
      - 开发路线图 §0.4: 启动时检测 site-packages
      - 项目概要 §五: dependency_manager 统一管理
    """
    _ensure_lib_dir()
    _add_lib_to_path()
    _add_shared_modules_to_path()

    missing_required = []
    missing_optional = []

    # 检测缺失的包
    for import_name, _ in _REQUIRED_PACKAGES:
        if not _check_package_available(import_name):
            missing_required.append((import_name, _))

    for import_name, _ in _OPTIONAL_PACKAGES:
        if not _check_package_available(import_name):
            missing_optional.append((import_name, _))

    all_missing = missing_required + missing_optional

    if not all_missing:
        UELogger.info("All dependencies are already installed")
        return True

    UELogger.info(f"Missing packages: {[m[0] for m in all_missing]}")

    # 尝试离线安装
    offline_success = False
    if missing_required or missing_optional:
        offline_success = _check_offline_bundle()
        if offline_success:
            # 重新加载 Lib 目录以识别新安装的包
            _add_lib_to_path()

    # 在线安装缺失的必需包
    required_ok = True
    for import_name, package_spec in missing_required:
        if not _check_package_available(import_name):
            success = _pip_install(package_spec, _PLUGIN_LIB_DIR)
            if not success:
                required_ok = False
                UELogger.error(
                    f"CRITICAL: Required package '{import_name}' installation failed! "
                    f"Manual install: pip install --target \"{_PLUGIN_LIB_DIR}\" {package_spec}"
                )

    # 在线安装缺失的可选包
    for import_name, package_spec in missing_optional:
        if not _check_package_available(import_name):
            success = _pip_install(package_spec, _PLUGIN_LIB_DIR)
            if not success:
                UELogger.warning(
                    f"Optional package '{import_name}' installation failed (non-critical)"
                )

    # 最终验证
    if required_ok:
        # pip install 到 Lib 后，Python import 缓存可能过期，必须刷新
        _add_lib_to_path()

        # 重新验证所有必需包
        all_verified = True
        for import_name, _ in _REQUIRED_PACKAGES:
            if _check_package_available(import_name):
                UELogger.info(f"  Verified: {import_name}")
            else:
                UELogger.error(f"  MISSING: {import_name}")
                all_verified = False

        if all_verified:
            UELogger.info("All dependencies installed successfully")
            return True

    UELogger.error(
        "Some required dependencies are missing. "
        "Plugin functionality may be limited. "
        "Please check the Output Log for details."
    )
    return False


# ============================================================================
# 3. Subsystem 桥接 (阶段 0.2 延续)
# ============================================================================

def sync_connection_state(is_online: bool):
    """
    同步连接状态到 C++ 子系统。

    宪法约束:
      - 系统架构设计 §1.3: 核心执行层统一管理
      - 开发路线图 §0.2: UArtifexNexusSubsystem 作为状态真值来源
    """
    subsystem = unreal.get_editor_subsystem(unreal.ArtifexNexusSubsystem)
    if subsystem:
        subsystem.set_connection_status(is_online)
        UELogger.info(f"Agent connection status synced: {is_online}")
    else:
        UELogger.warning("ArtifexNexusSubsystem not available, cannot sync connection state")


# ============================================================================
# 4. 初始化入口
# ============================================================================

def _is_mcp_server_alive(host: str = "127.0.0.1", port: int = 18080, timeout: float = 1.0) -> bool:
    """检测 MCP Server 是否正在监听"""
    import socket
    try:
        s = socket.create_connection((host, port), timeout=timeout)
        s.close()
        return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False



def _start_mcp_gateway():
    """
    启动 MCP WebSocket 通信网关 (阶段 1.1)。

    流程:
      1. 检测 MCP Server 是否已在运行 (端口 8080)
      2. 如果已在运行 → 跳过，避免重复启动
      3. 如果未运行 → 先尝试关闭残留实例，再启动新实例
      4. 端口就绪验证通过 deferred tick 异步完成，不阻塞主线程

    宪法约束:
      - 开发路线图 §1.1: WebSocket 服务器在插件启动时自动启动
      - 系统架构设计 §1.2: WebSocket 传输层
    """
    import builtins as _bi
    host, port = "127.0.0.1", 18080

    # 步骤 0: 防止并发/重复启动（用 builtins 跨 exec 持久化）
    if getattr(_bi, '_UE_MCP_GATEWAY_STARTING', False):
        UELogger.info("MCP Gateway startup already in progress, skipping duplicate call")
        return

    # 步骤 1: 检测是否已在运行
    if _is_mcp_server_alive(host, port):
        UELogger.info(f"MCP Server already running on {host}:{port}")
        return

    _bi._UE_MCP_GATEWAY_STARTING = True

    # 步骤 2: 清理可能残留的旧实例（非阻塞：不 sleep）
    UELogger.info(f"MCP Server not detected on {host}:{port}, starting...")
    try:
        import importlib
        _mcp_mod = importlib.import_module("ue_mcp_server")
        if hasattr(_mcp_mod, "stop_mcp_server") and hasattr(_mcp_mod, "_mcp_server"):
            if _mcp_mod._mcp_server is not None:
                UELogger.info("Cleaning up stale MCP Server instance...")
                _mcp_mod.stop_mcp_server()
    except (ImportError, Exception) as e:
        UELogger.info(f"No stale instance to clean: {e}")

    # 步骤 3: 启动新实例（start_mcp_server 内部通过 slate tick 驱动 asyncio，不阻塞）
    try:
        from ue_mcp_server import start_mcp_server
        success = start_mcp_server(host="localhost", port=port)
        if not success:
            UELogger.warning("MCP Gateway start_mcp_server returned False")
            _bi._UE_MCP_GATEWAY_STARTING = False
            return

        # Update C++ Subsystem state so the UE Panel shows "Running"
        try:
            import unreal as _unreal
            _subsystem = _unreal.get_editor_subsystem(_unreal.ArtifexNexusSubsystem)
            if _subsystem:
                _subsystem.set_server_port(port)
                _subsystem.set_server_running(True)
                UELogger.info(f"Subsystem state updated: port={port}, running=True")
        except Exception as _se:
            UELogger.warning(f"Failed to update Subsystem state: {_se}")

    except ImportError as e:
        UELogger.warning(f"MCP Server module not available: {e}")
        _bi._UE_MCP_GATEWAY_STARTING = False
        return
    except Exception:
        UELogger.exception("MCP Gateway startup error")
        _bi._UE_MCP_GATEWAY_STARTING = False
        return

    # 步骤 4: 异步验证端口就绪（通过 tick 回调，不用 time.sleep）
    _verify_counter = [0]
    _max_checks = 600  # 600 次 tick，覆盖启动期间低帧率场景（约 10 秒超时）

    def _verify_tick(delta_time):
        _verify_counter[0] += 1
        if _is_mcp_server_alive(host, port):
            UELogger.info(f"MCP Gateway verified on {host}:{port} (after {_verify_counter[0]} ticks)")
            unreal.unregister_slate_post_tick_callback(_verify_handle)
            return
        # 也检查递增端口
        for alt_port in range(port + 1, port + 5):
            if _is_mcp_server_alive(host, alt_port):
                UELogger.info(f"MCP Gateway verified on {host}:{alt_port} (after {_verify_counter[0]} ticks)")
                unreal.unregister_slate_post_tick_callback(_verify_handle)
                return
        if _verify_counter[0] >= _max_checks:
            UELogger.warning(
                f"MCP Gateway startup may have failed — "
                f"port {port} not responding after {_max_checks} ticks. "
                f"Use /diagnose to troubleshoot."
            )
            unreal.unregister_slate_post_tick_callback(_verify_handle)

    _verify_handle = unreal.register_slate_post_tick_callback(_verify_tick)


def _register_shutdown_hook():
    """
    注册编辑器关闭时的清理回调。

    确保 MCP 服务器在编辑器关闭时正确释放端口。
    """
    import atexit

    def _on_shutdown():
        try:
            UELogger.info("Editor shutting down, stopping MCP Gateway...")
        except Exception:
            pass
        try:
            from ue_mcp_server import stop_mcp_server
            stop_mcp_server()
        except Exception:
            try:
                UELogger.debug("MCP Gateway cleanup skipped (may have been released)")
            except Exception:
                pass

    atexit.register(_on_shutdown)


def _deferred_startup():
    """
    延迟启动：后台线程安装依赖，主线程 tick 检测完毕后启动 MCP。

    设计要点：
      - 依赖安装（pip install）在后台线程执行，避免阻塞编辑器启动
      - slate_post_tick_callback 必须在主线程注册，因此在 _deferred_startup()
        （运行于主线程）中注册，不在后台线程中注册
      - 后台线程完成后设置标志，主线程 tick 回调检测标志后启动 MCP
      - 使用 threading.Event + Lock 保护跨线程状态
    """
    import threading

    # 跨线程同步原语
    _deps_done = threading.Event()
    _deps_lock = threading.Lock()
    _deps_success = [False]  # 列表包装，便于闭包修改

    _tick_handle = [None]

    def _bg_install_deps():
        """后台线程：安装缺失依赖（可能触发 pip install，需联网）"""
        ok = False
        try:
            ok = _install_dependencies()
        except Exception:
            UELogger.exception("Deferred dependency install error")
            ok = False
        finally:
            with _deps_lock:
                _deps_success[0] = ok
            _deps_done.set()  # 通知主线程

    def _tick_poll_deps(_delta_time):
        """主线程 tick：轮询依赖安装状态，完成后启动 MCP"""
        if not _deps_done.is_set():
            return  # 继续等待

        # 依赖安装完成 → 注销自身
        handle = _tick_handle[0]
        if handle is not None:
            unreal.unregister_slate_post_tick_callback(handle)
            _tick_handle[0] = None

        with _deps_lock:
            ok = _deps_success[0]

        if ok:
            try:
                start_mcp_server(port=18080)
                _register_shutdown_hook()
                UELogger.info("MCP Gateway started (post dependency install)")
            except Exception:
                UELogger.exception("MCP Gateway start failed")
        else:
            UELogger.warning("Dependencies incomplete, MCP Gateway skipped")

    # Step 1: 在主线程注册 slate tick 回调（轮询依赖状态）
    _tick_handle[0] = unreal.register_slate_post_tick_callback(_tick_poll_deps)

    # Step 2: 启动后台线程安装依赖
    PanelLogger.emit("SYSTEM", "开始后台安装依赖...")
    thread = threading.Thread(
        target=_bg_install_deps, daemon=True,
        name="ArtifexNexus-DepsInstall"
    )
    thread.start()
    UELogger.info("Deferred dependency install dispatched to background thread")


def _initialize():
    """
    插件 Python 层初始化入口。

    执行顺序：
    1. 安装日志重定向 (0.4) — 同步，极快
    2. 安装异常处理器 (0.4) — 同步，极快
    3. 快速检测依赖 — 同步，仅 import 检查
    4a. 依赖已就绪 → 延迟到首个 Slate tick 启动 MCP 网关
    4b. 依赖缺失 → 延迟到后台线程安装，安装完成后回主线程启动 MCP

    注意：本函数可能在 Engine Init 阶段被调用（Slate 尚未 tick），
    因此 MCP 启动必须通过 slate_post_tick_callback 延迟执行。
    """
    # --- 阶段 0.4: 日志系统（极快） ---
    _install_stream_redirectors()
    _install_exception_hook()
    UELogger.info("=" * 60)
    UELogger.info("Artifex Nexus for Unreal - Python Layer Initializing")

    # --- 阶段 0.5: UE 版本检测 ---
    ue_ver = get_ue_engine_version()
    UELogger.info(f"Detected UE Engine Version: {ue_ver}")
    compat, msg = check_ue_version_compatibility()
    if compat:
        UELogger.info(f"Version compatibility: {msg}")
    else:
        UELogger.error(f"Version INCOMPATIBILITY: {msg}")
    UELogger.info("=" * 60)

    # --- 阶段 0.4.1: 共享模块路径注册 ---
    _add_lib_to_path()
    _add_shared_modules_to_path()

    # --- 阶段 0.3.5: 共享模块完整性检查 ---
    try:
        from integrity_check import check_and_repair

        integrity = check_and_repair(_PLUGIN_PYTHON_DIR, auto_repair=True)
        if integrity.repaired:
            UELogger.info(f"共享模块自动修复: {', '.join(integrity.repaired)}")
        if not integrity.ok:
            UELogger.error(f"共享模块缺失且无法修复: {', '.join(integrity.failed)}")
            UELogger.error("请使用 install.py 重新安装插件")
    except Exception as e:
        UELogger.warning(f"完整性检查跳过: {e}")

    # --- 快速依赖检测（仅 import 检查，不安装） ---
    deps_ready = _check_dependencies_fast()

    # 初始化连接状态（默认离线）
    sync_connection_state(False)

    if deps_ready:
        # 依赖已就绪 → 延迟到首个 Slate tick 再启动 MCP
        # 不在这里直接调用 start_mcp_server()，因为 Engine Init 阶段
        # Slate 还没 tick，asyncio bridge 无法运转
        UELogger.info("All dependencies ready, deferring MCP Gateway to first Slate tick...")
        UELogger.info("-" * 40)

        def _deferred_mcp_tick(delta_time):
            """首个 Slate tick 回调：启动 MCP 网关"""
            try:
                start_mcp_server(port=18080)
                _register_shutdown_hook()
                UELogger.info("Python layer initialization complete")
            except Exception:
                UELogger.exception("Deferred MCP Gateway start failed")
            finally:
                try:
                    unreal.unregister_slate_post_tick_callback(_deferred_mcp_handle)
                except Exception:
                    pass

        _deferred_mcp_handle = unreal.register_slate_post_tick_callback(_deferred_mcp_tick)
    else:
        # 依赖缺失 → 后台安装，不阻塞编辑器
        UELogger.info("Missing dependencies detected, deferring install to background...")
        UELogger.info("-" * 40)
        UELogger.info("Python layer initialized (MCP Gateway pending dependency install)")
        _deferred_startup()


# ============================================================================
# 5. Public API — called from C++ control panel (MUST precede init guard)
# ============================================================================

def start_mcp_server(port: int = 18080):
    """
    Start MCP WebSocket server (public API, callable from C++ panel).

    Performs port occupation check before starting.  If port is in use
    by an external process, logs a warning and does not attempt to start.

    Args:
        port: WebSocket port (default: 18080)

    Returns:
        bool: True if server started successfully (or was already running)
    """
    from ue_mcp_server import start_mcp_server as _start

    # -- Get subsystem (must succeed) --
    try:
        import unreal
        subsystem = unreal.get_editor_subsystem(unreal.ArtifexNexusSubsystem)
    except Exception as e:
        UELogger.error(f"Cannot get ArtifexNexusSubsystem: {e}")
        return False

    if not subsystem:
        UELogger.error("ArtifexNexusSubsystem is None")
        return False

    if subsystem.is_server_running():
        unreal.log("[ArtifexNexus] MCP Server already running, not starting again")
        return True

    # ── Port occupation check ──
    if _is_mcp_server_alive(host="127.0.0.1", port=port):
        PanelLogger.emit("MCP", f"端口 {port} 已被占用，无法启动", _UELogLevel.WARNING)
        unreal.log_warning(
            f"[ArtifexNexus] Port {port} is already occupied! "
            f"Please stop the process using this port first, then try again."
        )
        return False

    PanelLogger.emit("MCP", f"正在启动 MCP 服务器 (端口 {port})...")
    success = _start(host="localhost", port=port)
    if success:
        try:
            subsystem.set_server_port(port)
            subsystem.set_server_running(True)
            PanelLogger.emit("MCP", f"MCP 服务器已启动 (端口 {port})")
            unreal.log(f"[ArtifexNexus] MCP Server started on port {port}")
        except Exception as e:
            PanelLogger.emit("MCP", f"状态同步失败: {e}", _UELogLevel.ERROR)
            UELogger.error(f"MCP Server started but failed to update subsystem state: {e}")
            return False
        return True
    else:
        PanelLogger.emit("MCP", "MCP 服务器启动失败", _UELogLevel.ERROR)
        UELogger.warning(f"Failed to start MCP Server on port {port}")
        return False


def stop_mcp_server():
    """
    Stop MCP WebSocket server (public API, callable from C++ panel).

    Returns:
        bool: True if server stopped successfully
    """
    import unreal as _unreal
    try:
        from ue_mcp_server import stop_mcp_server as _stop
        _stop()
    except Exception as e:
        PanelLogger.emit("MCP", f"停止服务器失败: {e}", _UELogLevel.ERROR)
        UELogger.warning(f"Failed to stop MCP Server: {e}")
        return False

    # 仅在 stop 成功后更新 C++ 状态，避免假阴性
    try:
        subsystem = _unreal.get_editor_subsystem(_unreal.ArtifexNexusSubsystem)
        if subsystem and subsystem.is_server_running():
            subsystem.set_server_running(False)
        PanelLogger.emit("MCP", "MCP 服务器已停止")
        _unreal.log("[ArtifexNexus] MCP Server stopped")
    except Exception as e:
        PanelLogger.emit("MCP", f"状态同步失败: {e}", _UELogLevel.ERROR)
        UELogger.warning(f"MCP Server stopped but failed to update subsystem: {e}")
    return True


def get_panel_logs(count: int = 100) -> str:
    """
    获取面板日志（Public API，供 C++ Panel 轮询）。

    Args:
        count: 返回最近 N 条日志

    Returns:
        str: 换行符分隔的日志文本
    """
    from artifex_nexus_logger import PanelLogger
    return "\n".join(PanelLogger.get_recent(count))


# ── 模块别名：使 C++ ExecPythonCommand("import init_unreal") 可靠工作 ──
# init_unreal.py 通过 UE startup script 机制执行，位于 __main__ 命名空间。
# 建立别名后，import init_unreal 可正确返回已加载的模块。
import sys as _sys
_sys.modules.setdefault('init_unreal', _sys.modules[__name__])

# ============================================================================
# 6. 初始化守卫 — 防止重复执行
# ============================================================================
# UE PythonScriptPlugin 可能多次 exec 本文件（Engine Init 阶段 + 延迟加载阶段），
# C++ 端的 ConnectOpenArtifexNexus 也会 import 并调用 _start_mcp_gateway。
#
# 关键：UE 的 exec() 不走 sys.modules 缓存，所以模块级变量每次都被重置。
# 必须用 builtins 或全局字典来跨 exec 持久化标志。

import builtins as _builtins

if not getattr(_builtins, '_UE_AGENT_INITIALIZED', False):
    _builtins._UE_AGENT_INITIALIZED = True
    _initialize()
else:
    UELogger.info("Python layer already initialized, skipping duplicate _initialize()")
