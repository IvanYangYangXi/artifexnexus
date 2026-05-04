// 首启向导：3 屏流程（选 DCC → 确认路径 → 完成）。
// 骨架阶段：静态 UI，后续接入 sidecar 配置写入。

import { useState } from "react";
import { useNavigate } from "react-router-dom";

const DCC_OPTIONS = ["Blender", "Maya", "3ds Max", "Houdini", "Unreal Engine"];

function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [selectedDcc, setSelectedDcc] = useState("");

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      // 完成，跳转到状态页
      navigate("/status");
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 500, margin: "0 auto" }}>
      <h1>Artifex Nexus — 首启向导</h1>

      {/* 步骤指示器 */}
      <div style={{ display: "flex", gap: "1rem", margin: "1.5rem 0" }}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: s <= step ? "#3b82f6" : "#e5e7eb",
              color: s <= step ? "#fff" : "#9ca3af",
              fontWeight: "bold",
            }}
          >
            {s}
          </div>
        ))}
      </div>

      {/* 第 1 屏：选择 DCC */}
      {step === 1 && (
        <div>
          <h2>选择你的 DCC 工具</h2>
          <p style={{ color: "#6b7280" }}>Artifex Nexus 将自动配置对应插件。</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}>
            {DCC_OPTIONS.map((dcc) => (
              <label
                key={dcc}
                style={{
                  padding: "0.75rem",
                  border: `2px solid ${selectedDcc === dcc ? "#3b82f6" : "#e5e7eb"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="dcc"
                  value={dcc}
                  checked={selectedDcc === dcc}
                  onChange={(e) => setSelectedDcc(e.target.value)}
                  style={{ marginRight: "0.5rem" }}
                />
                {dcc}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 第 2 屏：确认路径 */}
      {step === 2 && (
        <div>
          <h2>确认安装路径</h2>
          <p style={{ color: "#6b7280" }}>
            OpenClaw 将安装到 <code>~/.artifexnexus/.openclaw/</code>
          </p>
          <p style={{ color: "#6b7280" }}>
            默认端口：<strong>14523</strong>（冲突时自动扫描 14524–14599）
          </p>
        </div>
      )}

      {/* 第 3 屏：完成 */}
      {step === 3 && (
        <div>
          <h2>准备就绪</h2>
          <p style={{ color: "#6b7280" }}>
            已选择 <strong>{selectedDcc}</strong>，点击完成开始初始化。
          </p>
        </div>
      )}

      {/* 导航按钮 */}
      <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
        {step > 1 && (
          <button onClick={handleBack} style={{ padding: "0.5rem 1.5rem" }}>
            上一步
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={step === 1 && !selectedDcc}
          style={{
            padding: "0.5rem 1.5rem",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: step === 1 && !selectedDcc ? "not-allowed" : "pointer",
            opacity: step === 1 && !selectedDcc ? 0.5 : 1,
          }}
        >
          {step === 3 ? "完成" : "下一步"}
        </button>
      </div>
    </main>
  );
}

export default SetupWizard;
