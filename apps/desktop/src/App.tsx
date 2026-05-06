// 桌面壳根组件：路由 + Echo 测试。
// 骨架阶段：路由（installer / status / settings）+ Echo 按钮。

import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import InstallerWizard from "./routes/InstallerWizard";
import SetupWizard from "./routes/SetupWizard";
import Status from "./routes/Status";
import Settings from "./routes/Settings";
import EchoTest from "./components/EchoTest";

function App() {
  return (
    <BrowserRouter>
      <div style={{ fontFamily: "system-ui, sans-serif" }}>
        {/* 导航栏 */}
        <nav
          style={{
            display: "flex",
            gap: "1rem",
            padding: "0.75rem 1.5rem",
            background: "#f3f4f6",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <Link to="/status" style={{ textDecoration: "none", color: "#3b82f6" }}>
            状态
          </Link>
          <Link to="/installer" style={{ textDecoration: "none", color: "#3b82f6" }}>
            安装向导
          </Link>
          <Link to="/settings" style={{ textDecoration: "none", color: "#3b82f6" }}>
            设置
          </Link>
        </nav>

        {/* 路由 */}
        <Routes>
          <Route path="/" element={<Status />} />
          <Route path="/status" element={<Status />} />
          <Route path="/installer" element={<InstallerWizard />} />
          <Route path="/setup-wizard" element={<SetupWizard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>

        {/* Echo 测试（开发用） */}
        <EchoTest />
      </div>
    </BrowserRouter>
  );
}

export default App;
