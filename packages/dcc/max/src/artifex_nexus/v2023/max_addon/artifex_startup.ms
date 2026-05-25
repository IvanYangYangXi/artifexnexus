/*
 * artifex_startup.ms — Artifex Nexus 3ds Max 启动脚本 (MaxScript)
 * ================================================================
 * 放入 3ds Max 的 scripts/startup/ 目录，自动执行。
 * 通过 python.executeFile 调用 Python 启动脚本。
 */

(
    -- 获取当前脚本所在目录
    local startupDir = getFilenamePath(getSourceFileName())
    local startupPy = startupDir + "artifex_startup.py"

    -- 如果 artifex_startup.py 不存在，尝试使用 startup.py
    if not doesFileExist startupPy do (
        startupPy = startupDir + "startup.py"
    )

    if doesFileExist startupPy then (
        python.ExecuteFile startupPy
    ) else (
        format "[Artifex Nexus] Python 启动脚本未找到: %\n" startupPy
    )
)
