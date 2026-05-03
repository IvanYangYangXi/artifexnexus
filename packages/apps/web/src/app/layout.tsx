export const metadata = {
  title: "Artifex Nexus",
  description: "The AI-Agent Bridge for Digital Creation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
