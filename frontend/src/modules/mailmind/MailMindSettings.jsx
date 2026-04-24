import { useState, useEffect } from "react";
import { mailmindApi } from "./api";

/**
 * MailMind settings tab. Rendered inside the generic Settings page via the module registry.
 * All state / save flow for MailMind-scoped settings lives here.
 */
export default function MailMindSettings() {
  const [settings, setSettings] = useState(null);
  const [blocklist, setBlocklist] = useState([]);
  const [blockInput, setBlockInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    mailmindApi.getSettings().then(setSettings).catch(() => {});
    mailmindApi.getBlocklist().then(r => setBlocklist(r.blocklist || [])).catch(() => {});
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await mailmindApi.saveSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e.message);
    }
    setSaving(false);
  };

  const addBlock = async () => {
    if (!blockInput.trim()) return;
    const r = await mailmindApi.addBlock(blockInput.trim());
    setBlocklist(r.blocklist);
    setBlockInput("");
  };

  const removeBlock = async (entry) => {
    const r = await mailmindApi.removeBlock(entry);
    setBlocklist(r.blocklist);
  };

  if (!settings) return <div style={{ color: "var(--text-3)", fontSize: 12 }}>Loading…</div>;

  const fields = [
    { key: "user_name",      label: "Your name",            type: "text",   placeholder: "Rishil",     full: true },
    { key: "user_title",     label: "Job title",            type: "text",   placeholder: "ML Engineer", full: true },
    { key: "work_start",     label: "Work start",           type: "time" },
    { key: "work_end",       label: "Work end",             type: "time" },
    { key: "check_interval", label: "Check interval (min)", type: "number", placeholder: "30" },
  ];

  return (
    <div>
      {/* Profile + hours */}
      <section style={{ marginBottom: 36 }}>
        <h3 style={sectionHeadingStyle}>Profile & hours</h3>
        <p style={sectionSubStyle}>
          Used to personalise replies. Work hours bound the daemon's check window.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          {fields.map(f => (
            <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : "auto" }}>
              <div style={labelStyle}>{f.label}</div>
              <input
                type={f.type}
                value={settings[f.key] ?? ""}
                placeholder={f.placeholder}
                min={f.type === "number" ? 1 : undefined}
                onChange={e => setSettings(s => ({
                  ...s,
                  [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value,
                }))}
                className="oc-input"
                style={{ fontFamily: f.type === "text" ? "inherit" : "var(--font-mono)" }}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="oc-btn oc-btn--primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && <span style={{ fontSize: 12, color: "var(--success)" }}>✓ Saved</span>}
        </div>
      </section>

      {/* System prompt */}
      <section style={{ marginBottom: 36 }}>
        <h3 style={sectionHeadingStyle}>Reply instructions</h3>
        <p style={sectionSubStyle}>
          Tell the AI how to write your replies — tone, style, things to always or never say.
          Takes effect immediately on the next draft you generate.
        </p>
        <textarea
          value={settings.system_prompt || ""}
          onChange={e => setSettings(s => ({ ...s, system_prompt: e.target.value }))}
          onBlur={save}
          placeholder={"e.g. Always be concise and direct. Never use filler phrases like \"I hope this email finds you well\". Sign off formally."}
          rows={5}
          className="oc-input"
          style={{ marginTop: 14, resize: "vertical", lineHeight: 1.6, fontSize: 13 }}
        />
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="oc-btn oc-btn--primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span style={{ fontSize: 12, color: "var(--success)" }}>✓ Saved</span>}
        </div>
      </section>

      {/* Blocklist */}
      <section style={{ marginBottom: 36 }}>
        <h3 style={sectionHeadingStyle}>Blocklist</h3>
        <p style={sectionSubStyle}>
          Block senders, domains, or keywords. Blocked emails never appear in your inbox.
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 14, marginBottom: 14 }}>
          <input type="text" value={blockInput} onChange={e => setBlockInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addBlock()}
            placeholder="uber.com · jobs@apply4u.co.uk · linkedin"
            className="oc-input"
            style={{ flex: 1, fontFamily: "var(--font-mono)" }} />
          <button className="oc-btn oc-btn--primary" onClick={addBlock}>Add</button>
        </div>

        {blocklist.length === 0 ? (
          <div style={{ padding: "18px 0", textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
            No blocked senders yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {blocklist.map(entry => (
              <div key={entry} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: "var(--bg-2)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--r-sm)",
              }}>
                <span style={{ flex: 1, fontSize: 12, color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>
                  {entry}
                </span>
                <button onClick={() => removeBlock(entry)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 12, padding: 4 }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Storage */}
      <section>
        <h3 style={sectionHeadingStyle}>Vector store</h3>
        <p style={sectionSubStyle}>
          Where flagged email embeddings live. Delete this folder to wipe memory.
        </p>
        <div style={{ marginTop: 14 }}>
          <div style={labelStyle}>ChromaDB path</div>
          <input type="text" value={settings.chroma_path || ""}
            onChange={e => setSettings(s => ({ ...s, chroma_path: e.target.value }))}
            className="oc-input" style={{ fontFamily: "var(--font-mono)" }} />
        </div>
        <button className="oc-btn oc-btn--primary" onClick={save} disabled={saving} style={{ marginTop: 14 }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </section>
    </div>
  );
}

/* ── shared styles ───────────────────── */
const labelStyle = {
  fontFamily: "var(--font-mono)", fontSize: 10,
  color: "var(--text-3)", letterSpacing: "0.08em",
  textTransform: "uppercase", marginBottom: 6,
};

const sectionHeadingStyle = {
  fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16,
  color: "var(--text-0)", margin: 0, marginBottom: 4,
};

const sectionSubStyle = {
  fontSize: 13, color: "var(--text-2)", margin: 0, lineHeight: 1.6,
};
