"""
max_ui.py - Artifex Nexus 3ds Max 简易 UI 面板
================================================

参照 Blender 侧栏面板，用 PySide2 创建 3ds Max 浮动窗口。
提供：状态指示、启动/停止、触发器开关。
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


# ── 样式常量 ──────────────────────────────────────────────────────────────

_COLOR_GREEN = "#27ae60"
_COLOR_GREEN_HOVER = "#2ecc71"
_COLOR_RED = "#c0392b"
_COLOR_RED_HOVER = "#e74c3c"
_COLOR_TEXT_DIM = "#999999"
_COLOR_TEXT_BRIGHT = "#cccccc"
_COLOR_BORDER = "#555555"
_COLOR_BG_BTN = "#3a3a3a"
_COLOR_BG_BTN_HOVER = "#4a4a4a"

_STYLE_START_BTN = (
    "QPushButton {"
    "  background-color: %s; color: white; border: none;"
    "  border-radius: 4px; font-size: 12px; font-weight: bold;"
    "}"
    "QPushButton:hover { background-color: %s; }"
    "QPushButton:pressed { background-color: #1e8449; }"
) % (_COLOR_GREEN, _COLOR_GREEN_HOVER)

_STYLE_STOP_BTN = (
    "QPushButton {"
    "  background-color: transparent; color: %s;"
    "  border: 1px solid %s; border-radius: 4px;"
    "  font-size: 12px; font-weight: bold;"
    "}"
    "QPushButton:hover {"
    "  background-color: %s; color: white; border-color: %s;"
    "}"
    "QPushButton:pressed { background-color: #a93226; color: white; }"
) % (_COLOR_RED, _COLOR_RED, _COLOR_RED, _COLOR_RED)

_STYLE_TRIGGER_BTN = (
    "QPushButton {"
    "  background-color: %s; color: #ddd; border: 1px solid %s;"
    "  border-radius: 3px; font-size: 12px;"
    "  padding: 3px 12px;"
    "}"
    "QPushButton:hover { background-color: #4a4a4a; border-color: #777; color: white; }"
)

_STYLE_TRIGGER_LABEL = (
    "font-size: 12px; font-weight: bold; padding: 2px 0;"
)


# ── 主面板 ────────────────────────────────────────────────────────────────

class ArtifexNexusPanel(QtWidgets.QDialog):
    """Artifex Nexus 简易 UI 面板 — Tool 窗口（跟随 Max 主窗口最小化）"""

    WINDOW_TITLE = "Artifex Nexus"
    WINDOW_WIDTH = 280
    WINDOW_HEIGHT = 220
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
        # 立即刷新一次（不用等 2s，避免初始显示"已停止"误导）
        self._refresh()

    # ── UI 构建 ──────────────────────────────────────────────────────

    def _build_ui(self):
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        # ── 状态指示 ──
        self._status_label = QtWidgets.QLabel("MCP Server 已停止")
        self._status_label.setAlignment(QtCore.Qt.AlignCenter)
        self._status_label.setStyleSheet(
            "font-size: 14px; font-weight: bold; color: %s; padding: 6px 4px;"
            % _COLOR_RED
        )
        layout.addWidget(self._status_label)

        # 端口/地址信息
        self._info_label = QtWidgets.QLabel("")
        self._info_label.setAlignment(QtCore.Qt.AlignCenter)
        self._info_label.setStyleSheet(
            "font-size: 11px; color: %s;" % _COLOR_TEXT_BRIGHT
        )
        layout.addWidget(self._info_label)

        # 分隔线
        self._add_separator(layout)

        # ── 启动/停止按钮 ──
        btn_row = QtWidgets.QHBoxLayout()
        btn_row.setSpacing(8)

        self._start_btn = QtWidgets.QPushButton("启动 MCP Server")
        self._start_btn.setMinimumHeight(34)
        self._start_btn.setStyleSheet(_STYLE_START_BTN)
        self._start_btn.setCursor(QtCore.Qt.PointingHandCursor)
        self._start_btn.clicked.connect(self._on_start)
        btn_row.addWidget(self._start_btn)

        self._stop_btn = QtWidgets.QPushButton("停止")
        self._stop_btn.setMinimumHeight(34)
        self._stop_btn.setFixedWidth(56)
        self._stop_btn.setStyleSheet(_STYLE_STOP_BTN)
        self._stop_btn.setCursor(QtCore.Qt.PointingHandCursor)
        self._stop_btn.clicked.connect(self._on_stop)
        self._stop_btn.hide()
        btn_row.addWidget(self._stop_btn)

        layout.addLayout(btn_row)

        # ── 触发器区域（加分组框） ──
        self._add_separator(layout)

        trig_group = QtWidgets.QWidget()
        trig_group.setStyleSheet(
            "background-color: #2a2a2a; border-radius: 4px; padding: 2px;"
        )
        trig_layout = QtWidgets.QVBoxLayout(trig_group)
        trig_layout.setContentsMargins(10, 8, 10, 8)
        trig_layout.setSpacing(6)

        trig_header = QtWidgets.QLabel("Nexus Tool 触发器")
        trig_header.setStyleSheet(
            "font-size: 10px; color: %s; font-weight: bold;" % _COLOR_TEXT_DIM
        )
        trig_header.setAlignment(QtCore.Qt.AlignLeft)
        trig_layout.addWidget(trig_header)

        trig_row = QtWidgets.QHBoxLayout()
        trig_row.setSpacing(6)

        self._trigger_label = QtWidgets.QLabel("已启用")
        self._trigger_label.setStyleSheet(
            _STYLE_TRIGGER_LABEL + "color: %s;" % _COLOR_GREEN
        )
        trig_row.addWidget(self._trigger_label)

        trig_row.addStretch()

        self._trigger_btn = QtWidgets.QPushButton("禁用")
        self._trigger_btn.setMinimumHeight(26)
        self._trigger_btn.setStyleSheet(
            _STYLE_TRIGGER_BTN % (_COLOR_BG_BTN, _COLOR_BORDER)
        )
        self._trigger_btn.setCursor(QtCore.Qt.PointingHandCursor)
        self._trigger_btn.clicked.connect(self._on_toggle_trigger)
        trig_row.addWidget(self._trigger_btn)

        trig_layout.addLayout(trig_row)
        layout.addWidget(trig_group)

        layout.addStretch()

        # ── 版本 ──
        ver_label = QtWidgets.QLabel("Artifex Nexus MCP Bridge v2023")
        ver_label.setAlignment(QtCore.Qt.AlignCenter)
        ver_label.setStyleSheet("font-size: 10px; color: %s;" % _COLOR_TEXT_DIM)
        layout.addWidget(ver_label)

    @staticmethod
    def _add_separator(parent_layout):
        line = QtWidgets.QFrame()
        line.setFrameShape(QtWidgets.QFrame.HLine)
        line.setStyleSheet("background-color: #444; max-height: 1px; margin: 2px 0;")
        parent_layout.addWidget(line)

    # ── 定时刷新 ────────────────────────────────────────────────────

    def _connect_refresh(self):
        self._timer = QtCore.QTimer(self)
        self._timer.timeout.connect(self._refresh)
        self._timer.start(self.REFRESH_MS)

    def _refresh(self):
        try:
            from artifex_nexus import get_status
            status = get_status()
            running = status.get("server_running", False)
            triggers = status.get("triggers_enabled", True)

            if running:
                self._status_label.setText("MCP Server 运行中")
                self._status_label.setStyleSheet(
                    "font-size: 14px; font-weight: bold; color: %s; padding: 6px 4px;"
                    % _COLOR_GREEN
                )
                addr = status.get("server_address", "ws://127.0.0.1:18082")
                self._info_label.setText(f"端口 18082  |  %s" % addr)
            else:
                self._status_label.setText("MCP Server 已停止")
                self._status_label.setStyleSheet(
                    "font-size: 14px; font-weight: bold; color: %s; padding: 6px 4px;"
                    % _COLOR_RED
                )
                self._info_label.setText("")

            self._start_btn.setVisible(not running)
            self._stop_btn.setVisible(running)

            if triggers:
                self._trigger_label.setText("已启用")
                self._trigger_label.setStyleSheet(
                    _STYLE_TRIGGER_LABEL + "color: %s;" % _COLOR_GREEN
                )
                self._trigger_btn.setText("禁用")
            else:
                self._trigger_label.setText("已禁用")
                self._trigger_label.setStyleSheet(
                    _STYLE_TRIGGER_LABEL + "color: %s;" % _COLOR_RED
                )
                self._trigger_btn.setText("启用")
        except Exception as e:
            logger.warning(f"面板刷新失败: {e}")

    # ── 按钮动作 ────────────────────────────────────────────────────

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
            logger.error(f"切换触发器失败: {e}")

    def closeEvent(self, event):
        global _global_panel
        _global_panel = None
        self._timer.stop()
        super().closeEvent(event)


# ── 公共 API ──────────────────────────────────────────────────────────────

def show_panel():
    """显示主面板（单例，重复调用聚焦已有窗口）"""
    global _global_panel

    if not _HAS_QT:
        logger.warning("PySide2 不可用，无法显示 UI 面板")
        if _HAS_MAX_AVAILABLE():
            try:
                from pymxs import runtime as rt
                rt.print("[Artifex Nexus] PySide2 不可用，无法打开面板", warning=True)
            except Exception:
                pass
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


def _HAS_MAX_AVAILABLE() -> bool:
    try:
        import pymxs  # noqa: F401
        return True
    except ImportError:
        return False
