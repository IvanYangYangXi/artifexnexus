"""
max_ui.py - Artifex Nexus 3ds Max 简易 UI 面板
================================================

参照 Blender 侧栏，用 PySide2 创建 Tool 窗口。简洁为主，不堆视觉效果。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("artifex.max.ui")

try:
    from PySide2 import QtWidgets, QtCore, QtGui
    _HAS_QT = True
except ImportError:
    _HAS_QT = False
    logger.warning("PySide2 不可用，Max UI 面板将跳过")

_global_panel = None


# ── 颜色 ──────────────────────────────────────────────────────────────────

_C_GREEN   = "#27ae60"
_C_RED     = "#c0392b"
_C_TEXT    = "#cccccc"
_C_DIM     = "#999999"
_C_BORDER  = "#555555"
_C_BG      = "#3a3a3a"
_C_BG_HOV  = "#4a4a4a"


class ArtifexNexusPanel(QtWidgets.QDialog):
    """Artifex Nexus 面板 — Tool 窗口"""

    WINDOW_TITLE = "Artifex Nexus"
    WINDOW_WIDTH = 260
    WINDOW_HEIGHT = 170
    REFRESH_MS = 2000

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(self.WINDOW_TITLE)
        self.setMinimumWidth(self.WINDOW_WIDTH)
        self.setFixedHeight(self.WINDOW_HEIGHT)
        self.setWindowFlags(
            QtCore.Qt.Tool
            | QtCore.Qt.WindowCloseButtonHint
            | QtCore.Qt.WindowMinimizeButtonHint
        )
        self._build_ui()
        self._connect_refresh()
        self._refresh()

    # ── UI ──────────────────────────────────────────────────────────

    def _build_ui(self):
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(8)

        # 状态
        self._status_label = QtWidgets.QLabel("MCP Server 已停止")
        self._status_label.setAlignment(QtCore.Qt.AlignCenter)
        self._status_label.setStyleSheet(
            "font-size: 13px; font-weight: bold; color: %s;" % _C_RED
        )
        layout.addWidget(self._status_label)

        self._info_label = QtWidgets.QLabel("")
        self._info_label.setAlignment(QtCore.Qt.AlignCenter)
        self._info_label.setStyleSheet("font-size: 11px; color: %s;" % _C_DIM)
        layout.addWidget(self._info_label)

        # 启动 / 停止
        btn_row = QtWidgets.QHBoxLayout()
        btn_row.setSpacing(8)

        self._start_btn = QtWidgets.QPushButton("启动 MCP Server")
        self._start_btn.setMinimumHeight(32)
        self._start_btn.setStyleSheet(_btn_style(_C_GREEN, _C_GREEN, "#1a7a40"))
        self._start_btn.setCursor(QtCore.Qt.PointingHandCursor)
        self._start_btn.clicked.connect(self._on_start)
        btn_row.addWidget(self._start_btn)

        self._stop_btn = QtWidgets.QPushButton("停止")
        self._stop_btn.setMinimumHeight(26)
        self._stop_btn.setStyleSheet(_btn_outline_style(_C_RED))
        self._stop_btn.setCursor(QtCore.Qt.PointingHandCursor)
        self._stop_btn.clicked.connect(self._on_stop)
        self._stop_btn.hide()
        btn_row.addWidget(self._stop_btn)

        layout.addLayout(btn_row)

        # 分隔
        layout.addWidget(_h_line())

        # 触发器
        trig_row = QtWidgets.QHBoxLayout()
        trig_row.setSpacing(6)

        trig_prefix = QtWidgets.QLabel("触发器状态：")
        trig_prefix.setStyleSheet("font-size: 12px; color: %s;" % _C_DIM)
        trig_row.addWidget(trig_prefix)

        self._trigger_label = QtWidgets.QLabel("已启用")
        self._trigger_label.setStyleSheet(
            "font-size: 12px; font-weight: bold; color: %s;" % _C_GREEN
        )
        trig_row.addWidget(self._trigger_label)
        trig_row.addStretch()

        self._trigger_btn = QtWidgets.QPushButton("禁用")
        self._trigger_btn.setMinimumHeight(26)
        self._trigger_btn.setStyleSheet(_btn_style(_C_BG, _C_BORDER, _C_BG_HOV))
        self._trigger_btn.setCursor(QtCore.Qt.PointingHandCursor)
        self._trigger_btn.clicked.connect(self._on_toggle_trigger)
        trig_row.addWidget(self._trigger_btn)

        layout.addLayout(trig_row)

        layout.addStretch()

        # 版本
        ver = QtWidgets.QLabel("Artifex Nexus v2023")
        ver.setAlignment(QtCore.Qt.AlignCenter)
        ver.setStyleSheet("font-size: 10px; color: %s;" % _C_DIM)
        layout.addWidget(ver)

    # ── 刷新 ────────────────────────────────────────────────────────

    def _connect_refresh(self):
        self._timer = QtCore.QTimer(self)
        self._timer.timeout.connect(self._refresh)
        self._timer.start(self.REFRESH_MS)

    def _refresh(self):
        try:
            from artifex_nexus import get_status
            s = get_status()
            running = s.get("server_running", False)
            triggers = s.get("triggers_enabled", True)

            if running:
                self._status_label.setText("MCP Server 运行中")
                self._status_label.setStyleSheet(
                    "font-size: 13px; font-weight: bold; color: %s;" % _C_GREEN
                )
                addr = s.get("server_address", "ws://127.0.0.1:18082")
                self._info_label.setText(f"端口 18082  |  %s" % addr)
            else:
                self._status_label.setText("MCP Server 已停止")
                self._status_label.setStyleSheet(
                    "font-size: 13px; font-weight: bold; color: %s;" % _C_RED
                )
                self._info_label.setText("")

            self._start_btn.setVisible(not running)
            self._stop_btn.setVisible(running)

            if triggers:
                self._trigger_label.setText("已启用")
                self._trigger_label.setStyleSheet(
                    "font-size: 12px; font-weight: bold; color: %s;" % _C_GREEN
                )
                self._trigger_btn.setText("禁用")
            else:
                self._trigger_label.setText("已禁用")
                self._trigger_label.setStyleSheet(
                    "font-size: 12px; font-weight: bold; color: %s;" % _C_RED
                )
                self._trigger_btn.setText("启用")
        except Exception as e:
            logger.warning(f"刷新失败: {e}")

    # ── 动作 ────────────────────────────────────────────────────────

    def _on_start(self):
        try:
            from artifex_nexus import start_server, _print_status
            if start_server():
                _print_status()
            self._refresh()
        except Exception as e:
            logger.error(f"启动失败: {e}")

    def _on_stop(self):
        try:
            from artifex_nexus import stop_server, _print_status
            stop_server()
            _print_status()
            self._refresh()
        except Exception as e:
            logger.error(f"停止失败: {e}")

    def _on_toggle_trigger(self):
        try:
            from artifex_nexus import toggle_triggers, _print_status
            toggle_triggers()
            _print_status()
            self._refresh()
        except Exception as e:
            logger.error(f"切换失败: {e}")

    def closeEvent(self, event):
        global _global_panel
        _global_panel = None
        self._timer.stop()
        super().closeEvent(event)


# ── 按钮样式 ──────────────────────────────────────────────────────────────

def _btn_style(bg: str, border: str, hover_bg: str) -> str:
    return (
        "QPushButton {"
        "  background-color: %s; color: white; border: 1px solid %s;"
        "  border-radius: 3px; font-size: 12px; padding: 2px 12px;"
        "}"
        "QPushButton:hover { background-color: %s; border-color: #777; }"
        "QPushButton:pressed { background-color: #2c2c2c; }"
    ) % (bg, border, hover_bg)


def _btn_outline_style(color: str) -> str:
    return (
        "QPushButton {"
        "  background-color: transparent; color: %s;"
        "  border: 1px solid %s; border-radius: 3px;"
        "  font-size: 12px; padding: 2px 8px;"
        "}"
        "QPushButton:hover {"
        "  background-color: %s; color: white;"
        "}"
    ) % (color, color, color)


def _h_line() -> QtWidgets.QFrame:
    line = QtWidgets.QFrame()
    line.setFrameShape(QtWidgets.QFrame.HLine)
    line.setStyleSheet("background-color: #444; max-height: 1px;")
    return line


# ── 公开 API ──────────────────────────────────────────────────────────────

def show_panel():
    global _global_panel

    if not _HAS_QT:
        logger.warning("PySide2 不可用")
        return

    if _global_panel is not None:
        try:
            _global_panel.raise_()
            _global_panel.activateWindow()
        except RuntimeError:
            _global_panel = None
        else:
            return

    parent = None
    try:
        parent = QtWidgets.QApplication.activeWindow()
    except Exception:
        pass

    _global_panel = ArtifexNexusPanel(parent)
    _global_panel.show()
    _global_panel.raise_()
    _global_panel.activateWindow()


def close_panel():
    global _global_panel
    if _global_panel is not None:
        try:
            _global_panel.close()
        except RuntimeError:
            pass
        _global_panel = None
