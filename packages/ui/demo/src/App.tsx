import { useEffect, useState } from "react";

import { Gallery } from "./Gallery";
import { StyleA } from "./styles/StyleA";
import { StyleB } from "./styles/StyleB";
import { StyleC } from "./styles/StyleC";
import { StyleD } from "./styles/StyleD";
import { StyleE } from "./styles/StyleE";
import { RegionTokensLab } from "./styles/RegionTokensLab";

type Route =
  | "gallery"
  | "style-a"
  | "style-b"
  | "style-c"
  | "style-d"
  | "style-e"
  | "region-tokens";

const ROUTES: { id: Route; label: string; desc: string }[] = [
  { id: "style-e", label: "✨ E · 主风格（已应用）", desc: "玻璃分层 + 信息层级 · 已应用到组件库" },
  { id: "gallery", label: "🧱 组件 Gallery", desc: "26 组件 + ToolCallGroup（升级到 E 风）" },
  { id: "region-tokens", label: "🎚 灰阶 vs 玻璃", desc: "Region tokens 共存方案对比" },
  { id: "style-a", label: "🍎 A", desc: "原方案 A · Liquid Glass" },
  { id: "style-b", label: "🪟 B", desc: "原方案 B · Mica Fluent 2" },
  { id: "style-c", label: "⚡ C", desc: "原方案 C · Cursor / Linear" },
  { id: "style-d", label: "🌌 D", desc: "原方案 D · Aurora Mesh" },
];

function parseHash(): Route {
  const h = window.location.hash.replace("#/", "").trim();
  if (
    h === "gallery" ||
    h === "style-a" ||
    h === "style-b" ||
    h === "style-c" ||
    h === "style-d" ||
    h === "style-e" ||
    h === "region-tokens"
  ) {
    return h;
  }
  return "style-e";
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const handler = () => setRoute(parseHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <RouteNav route={route} />
      <div>
        {route === "gallery" && <Gallery />}
        {route === "style-a" && <StyleA />}
        {route === "style-b" && <StyleB />}
        {route === "style-c" && <StyleC />}
        {route === "style-d" && <StyleD />}
        {route === "style-e" && <StyleE />}
        {route === "region-tokens" && <RegionTokensLab />}
      </div>
    </div>
  );
}

function RouteNav({ route }: { route: Route }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-titlebar/90 px-4 py-2 text-titlebar-foreground backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-3 text-xs font-semibold uppercase tracking-wider opacity-60">
          UI 实验室
        </span>
        {ROUTES.map((r) => {
          const active = route === r.id;
          return (
            <a
              key={r.id}
              href={`#/${r.id}`}
              className={[
                "rounded-md px-3 py-1.5 text-xs transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent hover:bg-accent",
              ].join(" ")}
              title={r.desc}
            >
              {r.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
