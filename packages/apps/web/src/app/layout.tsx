import type { Metadata } from "next";
import "./globals.css";
import DisableContextMenu from "./DisableContextMenu";

export const metadata: Metadata = {
  title: "artifex-nexus·山雀",
  description: "The AI-Agent Bridge for Digital Creation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
        suppressHydrationWarning
      >
        <DisableContextMenu />
        {children}
      </body>
    </html>
  );
}
