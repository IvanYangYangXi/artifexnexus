"use client";

/**
 * ViewErrorBoundary — 视图渲染错误边界
 *
 * 作用：任一视图组件渲染抛错时（如 BarView 撞到极端聚合维度、Recharts 内部
 * 异常等），只在视图区显示降级 UI + 重试按钮，避免整页变白。
 *
 * 用法：包裹 ViewContainer 内的视图组件。activeView 变化时 reset。
 */

import * as React from "react";
import { uiLog } from "../../../lib/ui-log";

interface Props {
  /** 由父组件传入，变化时重置错误状态（如 activeView 切换） */
  resetKey?: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ViewErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    uiLog.error("ViewErrorBoundary", "viewCrashed", {
      message: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-3xl">⚠️</div>
          <div className="text-sm font-medium text-foreground">视图渲染失败</div>
          <div className="max-w-md break-words text-xs text-foreground/60">
            {this.state.error.message || "未知错误"}
          </div>
          <div className="text-[10px] text-foreground/40">
            常见原因：聚合维度基数过大 / 字段类型不匹配 / 数据为空。
            <br />
            可在左侧「列配置」过滤或切换字段后重试。
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-xs text-foreground hover:bg-white/[0.08]"
              onClick={this.reset}
            >
              重试当前视图
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
