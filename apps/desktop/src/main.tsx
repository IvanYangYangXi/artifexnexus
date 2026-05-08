import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackMessage="Artifex Nexus 界面渲染出错">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
