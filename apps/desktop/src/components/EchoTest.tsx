// Echo 测试组件：验证 Rust ↔ sidecar ↔ 前端链路。
// 开发阶段使用，后续可移除。

import { useState } from "react";
import { echo } from "../ipc/echo";

function EchoTest() {
  const [echoResult, setEchoResult] = useState("");

  const handleEcho = async () => {
    try {
      const result = await echo("Hello from frontend!");
      setEchoResult(result);
    } catch (e) {
      setEchoResult(`Error: ${e}`);
    }
  };

  return (
    <div
      style={{
        margin: "1.5rem",
        padding: "1rem",
        border: "1px dashed #d1d5db",
        borderRadius: 8,
        maxWidth: 500,
      }}
    >
      <p style={{ color: "#6b7280", fontSize: "0.875rem", margin: 0 }}>
        🧪 Echo 测试（开发用）
      </p>
      <button onClick={handleEcho} style={{ marginTop: "0.5rem", padding: "0.25rem 0.75rem" }}>
        Echo 测试
      </button>
      {echoResult && (
        <p style={{ marginTop: "0.5rem", color: "#3b82f6", fontSize: "0.875rem" }}>{echoResult}</p>
      )}
    </div>
  );
}

export default EchoTest;
