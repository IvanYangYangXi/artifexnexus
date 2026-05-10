import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artifex Nexus",
  description: "The AI-Agent Bridge for Digital Creation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
