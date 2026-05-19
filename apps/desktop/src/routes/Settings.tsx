// 设置页：常规（应用级设置）/ 关于（占位）。
// 常规分页接入 sidecar 的 app.settings.* RPC，持久化到
// <openclaw_home>/state/artifex/app-settings.json。

import { useCallback, useEffect, useState } from "react";
import {
  getAppSettings,
  patchAppSettings,
  resetAppSettings,
  type AppSettings,
} from "../ipc/app_settings";

type Tab = "general" | "about";

interface LoadState {
  kind: "idle" | "loading" | "ready" | "error";
  message?: string;
}

const SECONDS_HINTS = [60, 120, 300, 600, 1800];

function Settings() {
  const [tab, setTab] = useState<Tab>("general");
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [path, setPath] = useState<string>("");
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const r = await getAppSettings();
      setSettings(r.settings);
      setDefaults(r.defaults);
      setPath(r.path);
      setDirty(false);
      setSaveError(null);
      setLoad({ kind: "ready" });
    } catch (e) {
      setLoad({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateField = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setDirty(true);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await patchAppSettings(settings);
      setSettings(r.settings);
      setDefaults(r.defaults);
      setPath(r.path);
      setDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const handleReset = useCallback(async () => {
    if (!window.confirm("确认重置所有设置为默认值？")) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await resetAppSettings();
      setSettings(r.settings);
      setDefaults(r.defaults);
      setPath(r.path);
      setDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <main
      style={{
        padding: "1.5rem 2rem",
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: "0.5rem" }}>Artifex Nexus — 设置</h1>
      <div
        style={{
          fontSize: "0.85rem",
          color: "#6b7280",
          marginBottom: "1rem",
        }}
      >
        {path && <>持久化路径：<code style={{ wordBreak: "break-all" }}>{path}</code></>}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          borderBottom: "1px solid #e5e7eb",
          marginBottom: "1rem",
        }}
      >
        {(["general", "about"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              background: "transparent",
              borderBottom:
                tab === t ? "2px solid #3b82f6" : "2px solid transparent",
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "#1f2937" : "#6b7280",
              cursor: "pointer",
            }}
          >
            {t === "general" ? "常规" : "关于"}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <section>
          {load.kind === "loading" && <p style={{ color: "#6b7280" }}>加载中…</p>}
          {load.kind === "error" && (
            <p style={{ color: "#dc2626" }}>
              加载失败：{load.message}{" "}
              <button onClick={() => void refresh()}>重试</button>
            </p>
          )}
          {load.kind === "ready" && settings && defaults && (
            <GeneralForm
              settings={settings}
              defaults={defaults}
              onChange={updateField}
            />
          )}

          {/* Footer */}
          {load.kind === "ready" && (
            <div
              style={{
                marginTop: "1.5rem",
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                borderTop: "1px solid #e5e7eb",
                paddingTop: "1rem",
              }}
            >
              <button
                type="button"
                onClick={() => void handleReset()}
                disabled={saving}
                title="所有字段恢复默认值"
              >
                重置默认
              </button>
              <span style={{ flex: 1 }} />
              {saveError && (
                <span style={{ color: "#dc2626", fontSize: "0.85rem" }}>
                  保存失败：{saveError}
                </span>
              )}
              {!saveError && !dirty && !saving && (
                <span style={{ color: "#16a34a", fontSize: "0.85rem" }}>
                  已保存
                </span>
              )}
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={saving}
              >
                丢弃修改
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                style={{
                  padding: "0.4rem 1rem",
                  background: !dirty || saving ? "#cbd5e1" : "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: !dirty || saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          )}
        </section>
      )}

      {tab === "about" && <AboutTab />}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 子组件
// ─────────────────────────────────────────────────────────────────────────

interface GeneralFormProps {
  settings: AppSettings;
  defaults: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

function GeneralForm({ settings, defaults, onChange }: GeneralFormProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", margin: 0, color: "#374151" }}>
        Nexus-Tool 执行
      </h2>

      {/* nexusToolDefaultTimeoutSec */}
      <Field
        label="默认执行超时（秒）"
        hint={`通用 Nexus-Tool 的默认超时；manifest 里 implementation.timeout 可单工具覆盖。默认 ${defaults.nexusToolDefaultTimeoutSec}s。`}
      >
        <input
          type="number"
          min={1}
          max={86400}
          value={settings.nexusToolDefaultTimeoutSec}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v)) onChange("nexusToolDefaultTimeoutSec", v);
          }}
          style={inputStyle}
        />
        <span style={{ marginLeft: "0.5rem", color: "#9ca3af", fontSize: "0.8rem" }}>
          常用：
          {SECONDS_HINTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange("nexusToolDefaultTimeoutSec", s)}
              style={chipStyle}
            >
              {s}s
            </button>
          ))}
        </span>
      </Field>

      {/* nexusToolMaxConcurrent */}
      <Field
        label="最大并发数"
        hint={`同时允许运行的通用 Nexus-Tool 任务数；超出会被拒绝并提示等待。默认 ${defaults.nexusToolMaxConcurrent}。`}
      >
        <input
          type="number"
          min={1}
          max={64}
          value={settings.nexusToolMaxConcurrent}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v)) onChange("nexusToolMaxConcurrent", v);
          }}
          style={inputStyle}
        />
      </Field>

      {/* nexusToolKillProcessTree */}
      <Field
        label="取消时递归终止子进程"
        hint="工具自身可能 spawn 孙子进程；启用后 cancel 时会用 taskkill /T 或 psutil 递归终止。"
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <input
            type="checkbox"
            checked={settings.nexusToolKillProcessTree}
            onChange={(e) => onChange("nexusToolKillProcessTree", e.target.checked)}
          />
          启用（推荐）
        </label>
      </Field>

      <h2 style={{ fontSize: "1rem", margin: "0.5rem 0 0", color: "#374151" }}>
        日志
      </h2>

      {/* logLevel */}
      <Field
        label="日志等级"
        hint="影响 sidecar 后续输出（需 sidecar 重启或调用热更新 RPC 才完全生效，下个版本支持）。"
      >
        <select
          value={settings.logLevel}
          onChange={(e) => onChange("logLevel", e.target.value as AppSettings["logLevel"])}
          style={inputStyle}
        >
          {(["DEBUG", "INFO", "WARN", "ERROR"] as const).map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontWeight: 500,
          marginBottom: "0.25rem",
          color: "#374151",
        }}
      >
        {label}
      </label>
      <div>{children}</div>
      {hint && (
        <div
          style={{
            fontSize: "0.78rem",
            color: "#9ca3af",
            marginTop: "0.25rem",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function AboutTab() {
  return (
    <section style={{ color: "#374151" }}>
      <p>Artifex Nexus 桌面客户端</p>
      <p style={{ color: "#6b7280", fontSize: "0.85rem" }}>
        更多设置项（DCC 检测、Gateway、安装路径等）在各自专用面板中维护，
        本页仅集中管理"应用级"通用偏好。
      </p>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  width: 120,
};

const chipStyle: React.CSSProperties = {
  marginLeft: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontSize: "0.75rem",
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  borderRadius: 4,
  cursor: "pointer",
};

export default Settings;
