// 全局错误边界：捕获 React 组件树中任何未处理异常，
// 防止单个组件崩溃导致整个 WebView 白屏/黑屏。
//
// Global error boundary: catches any unhandled exception in the React
// component tree to prevent a single component crash from turning the
// entire WebView white/black.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 降级 UI 的自定义消息（可选） */
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // 输出到 console 便于调试（Tauri dev 模式可在终端看到）
    console.error("[ErrorBoundary] 捕获到未处理异常:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#f9fafb",
            color: "#374151",
          }}
        >
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "#111827",
                marginBottom: 12,
              }}
            >
              {this.props.fallbackMessage ?? "界面渲染出错"}
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "#6b7280",
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              应用遇到了一个意外错误。这通常是暂时性问题，重试即可恢复。
            </p>
            {this.state.error && (
              <pre
                style={{
                  textAlign: "left",
                  fontSize: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 6,
                  padding: "10px 14px",
                  color: "#b91c1c",
                  maxHeight: 200,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  marginBottom: 16,
                }}
              >
                {this.state.error.name}: {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                padding: "8px 20px",
                fontSize: 14,
                fontWeight: 500,
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
