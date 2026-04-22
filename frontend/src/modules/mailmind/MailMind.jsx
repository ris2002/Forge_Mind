import { useState, useEffect } from "react";
import { mailmindApi } from "./api";

const Ic = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IC = {
  reply:   "M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l4 4v5M13 22l3-3-3-3M22 19h-6",
  send:    "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  x:       "M18 6L6 18M6 6l12 12",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  block:   "M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636",
  star:    "M12 2l3 7 7 .7-5.3 4.8L18 22l-6-3.5L6 22l1.3-7.5L2 9.7 9 9z",
};

const Skeleton = ({ width = "100%", height = 10 }) => (
  <div style={{
    width, height, borderRadius: 3,
    background: "linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%)",
    backgroundSize: "200% 100%",
    animation: "oc-shimmer 1.4s infinite",
  }} />
);

export default function MailMind() {
  const [emails, setEmails] = useState([]);
  const [status, setStatus] = useState({ last_check: "—" });
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [summarising, setSummarising] = useState(false);
  const [replyPanel, setReplyPanel] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [filtering, setFiltering] = useState(false);

  useEffect(() => {
    Promise.all([mailmindApi.daemonStatus(), mailmindApi.list()])
      .then(([s, e]) => {
        setStatus(s);
        setEmails(Array.isArray(e) ? e : []);
      })
      .catch(() => {});
    const interval = setInterval(() => mailmindApi.daemonStatus().then(setStatus).catch(() => {}), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectEmail = async (email) => {
    setReplyPanel(null);
    const preview = email.body ? email.body.slice(0, 200).replace(/\s+/g, " ") + "…" : "";
    setSelectedEmail({ ...email, _preview: preview });
    if (email.summarised) return;

    setSummarising(true);
    try {
      const res = await mailmindApi.summarise(email.id);
      const updated = { ...email, summary: res.summary, summarised: true, _preview: undefined };
      setSelectedEmail(updated);
      setEmails(prev => prev.map(e => e.id === email.id ? updated : e));
    } catch {
      setSelectedEmail(prev => ({ ...prev, summary: "Could not summarise.", summarised: true }));
    }
    setSummarising(false);
  };

  const handleFetch = async () => {
    setFetching(true);
    try {
      const fetched = await mailmindApi.fetchInbox();
      if (Array.isArray(fetched)) {
        setEmails(prev => {
          const prevMap = {};
          prev.forEach(e => { prevMap[e.id] = e; });
          return fetched.map(e => ({ ...e, flagged: prevMap[e.id]?.flagged ?? e.flagged }));
        });
      }
    } catch (e) { console.error(e); }
    setFetching(false);
  };

  const handleFlag = async (email) => {
    try {
      const res = await mailmindApi.flag(email.id);
      const updated = { ...email, flagged: res.flagged };
      setEmails(prev => prev.map(e => e.id === email.id ? updated : e));
      if (selectedEmail?.id === email.id) setSelectedEmail(updated);
    } catch (e) { console.error(e); }
  };

  const handleDismiss = (emailId) => {
    mailmindApi.dismiss(emailId).catch(() => {});
    setEmails(prev => prev.filter(e => e.id !== emailId));
    if (selectedEmail?.id === emailId) setSelectedEmail(null);
  };

  const handleBlockSender = async (emailId) => {
    await mailmindApi.blockSender(emailId).catch(() => {});
    setEmails(prev => prev.filter(e => e.id !== emailId));
    if (selectedEmail?.id === emailId) setSelectedEmail(null);
  };

  const handleDraftReply = async () => {
    setDraftLoading(true);
    try {
      const res = await mailmindApi.draftReply(replyPanel.emailId, replyPanel.intent);
      setReplyPanel(p => ({ ...p, draft: res.draft, stage: "review" }));
    } catch {
      setReplyPanel(p => ({
        ...p,
        draft: `Hi ${selectedEmail?.sender_first || "there"},\n\n${p.intent}\n\nBest regards,`,
        stage: "review",
      }));
    }
    setDraftLoading(false);
  };

  const handleSend = async () => {
    try { await mailmindApi.sendReply(replyPanel.emailId, replyPanel.draft); } catch (e) { console.error(e); }
    const emailId = replyPanel.emailId;
    setReplyPanel(null);
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, read: true } : e));
  };

  const handleFilter = async () => {
    setFiltering(true);
    try {
      const filtered = await mailmindApi.listFiltered(dateFrom, dateTo, flaggedOnly);
      setEmails(Array.isArray(filtered) ? filtered : []);
    } catch (e) { console.error(e); }
    setFiltering(false);
  };

  const handleClearFilter = async () => {
    setDateFrom(""); setDateTo(""); setFlaggedOnly(false);
    const all = await mailmindApi.list().catch(() => []);
    setEmails(Array.isArray(all) ? all : []);
  };

  const unread = emails.filter(e => !e.read).length;
  const summaryDisplay = selectedEmail?.summarised ? selectedEmail.summary : selectedEmail?._preview || "";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes oc-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes oc-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes oc-spin { to { transform: rotate(360deg); } }
        @keyframes oc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .oc-email-row:hover { background: var(--bg-2) !important; }
        .oc-email-row[data-selected="true"] { background: var(--accent-soft) !important; }
      `}</style>

      <div style={{
        padding: "20px 28px 16px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex", alignItems: "baseline", gap: 14,
      }}>
        <h1 style={{
          fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 22,
          color: "var(--text-0)", letterSpacing: "-0.01em", margin: 0,
        }}>MailMind</h1>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase",
        }}>Inbox triage</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>
          {emails.length} emails
          {unread > 0 && <span style={{ color: "var(--accent)" }}> · {unread} unread</span>}
          {status.last_check && status.last_check !== "—" && <> · last check {status.last_check}</>}
        </span>
        <button className="oc-btn oc-btn--primary" onClick={handleFetch} disabled={fetching}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12 }}>
          <span style={{ animation: fetching ? "oc-spin 1s linear infinite" : "none", display: "flex" }}>
            <Ic d={IC.refresh} size={12} />
          </span>
          {fetching ? "Checking…" : "Check inbox"}
        </button>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "340px 1fr", overflow: "hidden" }}>
        {/* List */}
        <div style={{ borderRight: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", background: "var(--bg-0)" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="oc-input"
                style={{ padding: "5px 8px", fontSize: 11, fontFamily: "var(--font-mono)", colorScheme: "dark" }} />
              <span style={{ fontSize: 10, color: "var(--text-3)" }}>→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="oc-input"
                style={{ padding: "5px 8px", fontSize: 11, fontFamily: "var(--font-mono)", colorScheme: "dark" }} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                Flagged only
              </label>
              <div style={{ flex: 1 }} />
              {(dateFrom || dateTo || flaggedOnly) && (
                <button onClick={handleClearFilter} style={{ fontSize: 10, color: "var(--text-3)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear</button>
              )}
              <button onClick={handleFilter}
                className={dateFrom || dateTo || flaggedOnly ? "oc-btn oc-btn--primary" : "oc-btn"}
                style={{ padding: "4px 10px", fontSize: 10 }}>
                {filtering ? "…" : "Filter"}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {emails.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center" }}>
                <p style={{ color: "var(--text-3)", fontSize: 12, margin: 0 }}>No emails yet</p>
                <p style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
                  Click <span style={{ color: "var(--accent)" }}>Check inbox</span> to fetch
                </p>
              </div>
            ) : emails.map((email, i) => (
              <div key={email.id} className="oc-email-row"
                data-selected={selectedEmail?.id === email.id ? "true" : "false"}
                onClick={() => handleSelectEmail(email)}
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  transition: "background 0.12s",
                  animation: `oc-fadein 0.25s ease ${i * 0.03}s both`,
                }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                    {!email.read && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />}
                    {email.flagged && (
                      <span style={{ color: "var(--accent)", display: "flex" }}>
                        <Ic d={IC.star} size={10} />
                      </span>
                    )}
                    <span style={{
                      fontSize: 12, fontWeight: email.read ? 400 : 500,
                      color: email.read ? "var(--text-2)" : "var(--text-0)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{email.sender}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", flexShrink: 0, marginLeft: 6 }}>
                    {email.time}
                  </span>
                </div>
                <p style={{
                  fontSize: 12, color: "var(--text-1)", margin: 0, marginBottom: 4, fontWeight: 500,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{email.subject}</p>
                {email.summarised ? (
                  <p style={{
                    fontSize: 11, color: "var(--text-2)", margin: 0, lineHeight: 1.5,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}>{email.summary}</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 2 }}>
                    <Skeleton width="90%" height={9} />
                    <Skeleton width="65%" height={9} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selectedEmail && !replyPanel ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px", animation: "oc-fadein 0.2s ease" }}>
              <h2 style={{
                fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 22,
                color: "var(--text-0)", lineHeight: 1.3,
                letterSpacing: "-0.01em", margin: 0, marginBottom: 8,
              }}>{selectedEmail.subject}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--text-1)" }}>{selectedEmail.sender}</span>
                <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{selectedEmail.sender_email}</span>
                <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{selectedEmail.time}</span>
              </div>

              <div style={{
                padding: 18, marginBottom: 22,
                background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
                borderRadius: "var(--r-md)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent)",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>{summarising ? "Summarising" : "AI Summary"}</span>
                  {summarising && (
                    <div style={{ display: "flex", gap: 3 }}>
                      {[0, 0.2, 0.4].map((d, i) => (
                        <div key={i} style={{
                          width: 4, height: 4, borderRadius: "50%",
                          background: "var(--accent)",
                          animation: `oc-pulse 1s ${d}s infinite`,
                        }} />
                      ))}
                    </div>
                  )}
                  <div style={{ flex: 1, height: 1, background: "var(--accent-line)" }} />
                </div>
                {summarising && !summaryDisplay ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Skeleton height={12} /><Skeleton width="85%" height={12} /><Skeleton width="65%" height={12} />
                  </div>
                ) : (
                  <p style={{
                    fontSize: 13, color: summarising ? "var(--text-2)" : "var(--text-1)",
                    lineHeight: 1.7, margin: 0, transition: "color 0.3s",
                  }}>{summaryDisplay || "Summary loading…"}</p>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="oc-btn oc-btn--primary"
                  onClick={() => setReplyPanel({ emailId: selectedEmail.id, intent: "", draft: "", stage: "intent" })}
                  style={{ flex: 2, minWidth: 140, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px" }}>
                  <Ic d={IC.reply} size={13} /> Draft reply
                </button>
                <button className="oc-btn" onClick={() => handleFlag(selectedEmail)}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px",
                    color: selectedEmail.flagged ? "var(--accent)" : "var(--text-2)",
                    borderColor: selectedEmail.flagged ? "var(--accent-line)" : "var(--border)",
                    background: selectedEmail.flagged ? "var(--accent-soft)" : "var(--bg-2)",
                  }}>
                  <Ic d={IC.star} size={12} />
                  {selectedEmail.flagged ? "Flagged" : "Flag"}
                </button>
                <button className="oc-btn" onClick={() => handleDismiss(selectedEmail.id)} style={{ padding: "10px 14px" }}>
                  Dismiss
                </button>
                <button className="oc-btn oc-btn--danger" onClick={() => handleBlockSender(selectedEmail.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5, padding: "10px 14px",
                    color: "var(--danger)", borderColor: "rgba(201,112,100,0.3)",
                  }}>
                  <Ic d={IC.block} size={12} /> Block
                </button>
              </div>

              {selectedEmail.body && (
                <details style={{
                  marginTop: 28, padding: 16,
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--r-md)", background: "var(--bg-1)",
                }}>
                  <summary style={{
                    cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10,
                    color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>Original message</summary>
                  <p style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-1)", lineHeight: 1.6 }}>
                    {selectedEmail.body}
                  </p>
                </details>
              )}
            </div>
          ) : replyPanel ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px", animation: "oc-fadein 0.2s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <button onClick={() => setReplyPanel(null)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-2)", display: "flex", padding: 4 }}>
                  <Ic d={IC.x} size={14} />
                </button>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 18, color: "var(--text-0)", margin: 0 }}>
                  Reply to {selectedEmail?.sender_first || selectedEmail?.sender?.split(" ")[0]}
                </h3>
              </div>

              {replyPanel.stage === "intent" ? (
                <div>
                  <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0, marginBottom: 14 }}>
                    What's your key point? Keep it rough — the AI writes the full reply.
                  </p>
                  <textarea value={replyPanel.intent}
                    onChange={e => setReplyPanel(p => ({ ...p, intent: e.target.value }))}
                    placeholder="e.g. Thursday 3pm works, will bring the metrics"
                    rows={5} className="oc-input"
                    style={{ resize: "vertical", lineHeight: 1.6, marginBottom: 14, fontSize: 13 }} />
                  <button className="oc-btn oc-btn--primary" onClick={handleDraftReply}
                    disabled={!replyPanel.intent || draftLoading}
                    style={{ width: "100%", padding: 11 }}>
                    {draftLoading ? "Drafting…" : "Generate draft →"}
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)",
                    letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8,
                  }}>Review and edit before sending</div>
                  <textarea value={replyPanel.draft}
                    onChange={e => setReplyPanel(p => ({ ...p, draft: e.target.value }))}
                    rows={12} className="oc-input"
                    style={{ resize: "vertical", lineHeight: 1.7, marginBottom: 12, fontSize: 13 }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="oc-btn oc-btn--primary" onClick={handleSend}
                      style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11 }}>
                      <Ic d={IC.send} size={12} /> Send reply
                    </button>
                    <button className="oc-btn" onClick={() => setReplyPanel(p => ({ ...p, stage: "intent" }))}
                      style={{ flex: 1, padding: 11 }}>Redraft</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.2, marginBottom: 12 }}>
                  <path d="M4 20 Q 6 10, 12 6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M9 21 Q 10 12, 14 5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
                  <path d="M15 21 Q 14 13, 18 7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
                </svg>
                <p style={{ color: "var(--text-3)", fontSize: 12, margin: 0 }}>Select an email to read</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
