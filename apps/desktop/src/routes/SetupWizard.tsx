// 旧首启向导路由：重定向到新安装向导。
// Legacy setup wizard route: redirects to new installer wizard.
// 保留文件避免引用断裂，下一 STORY 删除。

import { Navigate } from "react-router-dom";

function SetupWizard() {
  return <Navigate to="/installer" replace />;
}

export default SetupWizard;
