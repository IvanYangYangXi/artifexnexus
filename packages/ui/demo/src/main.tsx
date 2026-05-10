import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";
import { App } from "./App";
import { TooltipProvider, Toaster } from "@artifex-nexus/ui";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>,
);
