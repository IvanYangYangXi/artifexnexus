// 设置页：端口、路径、DCC 配置。
// 骨架阶段：静态占位，后续接入 sidecar set_config。

function Settings() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 500, margin: "0 auto" }}>
      <h1>Artifex Nexus — 设置</h1>

      <div style={{ marginTop: "1.5rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          端口
          <input
            type="number"
            defaultValue={14523}
            style={{ marginLeft: "0.5rem", padding: "0.25rem 0.5rem", width: 80 }}
          />
        </label>

        <label style={{ display: "block", marginBottom: "0.5rem", marginTop: "1rem" }}>
          安装路径
          <input
            type="text"
            defaultValue="~/.artifexnexus/.openclaw/"
            style={{ marginLeft: "0.5rem", padding: "0.25rem 0.5rem", width: 250 }}
          />
        </label>
      </div>

      <p style={{ marginTop: "1.5rem", color: "#6b7280" }}>设置功能将在后续版本中接入 sidecar。</p>
    </main>
  );
}

export default Settings;
