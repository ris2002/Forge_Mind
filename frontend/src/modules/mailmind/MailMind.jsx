import { useState, useEffect, useRef } from "react";
import { mailmindApi } from "./api";

const Ic = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IC = {
  reply:    "M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l4 4v5M13 22l3-3-3-3M22 19h-6",
  send:     "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  x:        "M18 6L6 18M6 6l12 12",
  refresh:  "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  block:    "M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636",
  star:     "M12 2l3 7 7 .7-5.3 4.8L18 22l-6-3.5L6 22l1.3-7.5L2 9.7 9 9z",
  compose:  "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  contacts: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 1-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  trash:    "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
};

const composeLabelStyle = {
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)",
  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6,
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
  const [status, setStatus] = useState({ last_check: "—", running: false, paused: false });
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [summarising, setSummarising] = useState(false);
  const [summariseFailed, setSummariseFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [replyPanel, setReplyPanel] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [daemonLoading, setDaemonLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [thread, setThread] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [fetchingDates, setFetchingDates] = useState(false);
  const [composePanel, setComposePanel] = useState(null);
  const [composeDraftLoading, setComposeDraftLoading] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [refreshingFlagged, setRefreshingFlagged] = useState(false);
  const [contactsPanel, setContactsPanel] = useState(null);
  // contactsPanel shape: { stage: "loading"|"list"|"summary"|"confirm"|"done", contacts: [], selected: [], summaries: null, summarising: false, error: "", trashInGmail: true, deleting: false, deleteResult: null }

  const lastCheckRef = useRef("—");
  const filterRef   = useRef({ dateFrom: "", dateTo: "", flaggedOnly: false });
  const selectedEmailRef = useRef(null);
  selectedEmailRef.current = selectedEmail; // keep ref current for async callbacks

  const mergeEmails = (fresh, prev) => {
    const prevMap = {};
    prev.forEach(e => { prevMap[e.id] = e; });
    return fresh.map(e => {
      const old = prevMap[e.id];
      if (!old) return e;
      const backendReset = !e.summarised && !e.summary;
      // If backend has a fresh non-empty summary that differs from our local one, trust it
      // (covers background re-summarise of flagged threads after new emails arrive)
      const backendHasNew = e.summarised && e.summary && e.summary !== old.summary;
      return {
        ...e,
        flagged:    old.flagged ?? e.flagged,
        summarised: backendReset ? false : (backendHasNew ? true  : (old.summarised || e.summarised)),
        summary:    backendReset ? ""    : (backendHasNew ? e.summary : (old.summary || e.summary)),
      };
    });
  };

  const refreshStatus = async () => {
    try {
      const s = await mailmindApi.daemonStatus();
      setStatus(s);
      if (s.last_check !== "—" && s.last_check !== lastCheckRef.current) {
        lastCheckRef.current = s.last_check;
        const { dateFrom: df, dateTo: dt, flaggedOnly: fo } = filterRef.current;
        const fresh = await (df || dt || fo
          ? mailmindApi.listFiltered(df, dt, fo)
          : mailmindApi.list());
        if (Array.isArray(fresh)) {
          setEmails(prev => mergeEmails(fresh, prev));
          // Sync the open email's summary if backend updated it
          setSelectedEmail(sel => {
            if (!sel) return sel;
            const fe = fresh.find(e => e.id === sel.id);
            if (!fe) return sel;
            const backendReset = !fe.summarised && !fe.summary;
            if (backendReset) return { ...sel, summarised: false, summary: "" };
            if (fe.summarised && fe.summary && fe.summary !== sel.summary)
              return { ...sel, summary: fe.summary, summarised: true };
            return sel;
          });
          // Refresh thread for open flagged conversation
          const sel = selectedEmailRef.current;
          if (sel?.flagged) {
            mailmindApi.getThread(sel.id).then(t => setThread(Array.isArray(t) ? t : [])).catch(() => {});
          }
        }
      }
    } catch {}
  };

  useEffect(() => {
    Promise.all([mailmindApi.daemonStatus(), mailmindApi.list()])
      .then(([s, e]) => {
        setStatus(s);
        lastCheckRef.current = s.last_check ?? "—";
        setEmails(Array.isArray(e) ? e : []);
      })
      .catch(() => {});
    const tick = setInterval(refreshStatus, 15000);
    return () => clearInterval(tick);
  }, []);

  const handleSelectEmail = async (email) => {
    setReplyPanel(null);
    setComposePanel(null);
    setSummariseFailed(false);
    setRetryCount(0);
    setThread([]);
    const preview = email.body ? email.body.slice(0, 200).replace(/\s+/g, " ") + "…" : "";
    setSelectedEmail({ ...email, _preview: preview });
    if (email.flagged) {
      mailmindApi.getThread(email.id).then(t => setThread(Array.isArray(t) ? t : [])).catch(() => {});
    }
    if (email.summarised) return;
    await _runSummarise(email);
  };

  const _runSummarise = async (email) => {
    setSummarising(true);
    setSummariseFailed(false);
    try {
      const summary = await mailmindApi.summariseStream(email.id, (partial) => {
        setSelectedEmail(prev => prev?.id === email.id
          ? { ...prev, summary: partial, summarised: false }
          : prev
        );
      });
      const updated = { ...email, summary, summarised: true, _preview: undefined };
      setSelectedEmail(updated);
      setEmails(prev => prev.map(e => e.id === email.id ? updated : e));
    } catch {
      setSummariseFailed(true);
      setSelectedEmail(prev => ({ ...prev, summary: "" }));
    }
    setSummarising(false);
  };

  const handleRetrySummarise = () => {
    if (selectedEmail) {
      setRetryCount(c => c + 1);
      _runSummarise({ ...selectedEmail, summarised: false });
    }
  };

  const handleFetch = async () => {
    setFetching(true);
    setFetchError("");
    try {
      const fetched = await mailmindApi.fetchInbox();
      if (Array.isArray(fetched)) setEmails(prev => mergeEmails(fetched, prev));
    } catch (e) {
      setFetchError(e.message || "Inbox fetch failed — check Gmail connection.");
    }
    setFetching(false);
  };

  const handleStartDaemon = async () => {
    setDaemonLoading(true);
    await mailmindApi.startDaemon().catch(() => {});
    await refreshStatus();
    setDaemonLoading(false);
  };

  const handleStopDaemon = async () => {
    setDaemonLoading(true);
    await mailmindApi.stopDaemon().catch(() => {});
    await refreshStatus();
    setDaemonLoading(false);
  };

  const handlePauseDaemon = async () => {
    await mailmindApi.pauseDaemon().catch(() => {});
    await refreshStatus();
  };

  const handleResumeDaemon = async () => {
    await mailmindApi.resumeDaemon().catch(() => {});
    await refreshStatus();
  };

  const handleFlag = async (email) => {
    try {
      const res = await mailmindApi.flag(email.id);
      const updated = { ...email, flagged: res.flagged, summarised: false, summary: "" };
      setEmails(prev => prev.map(e => e.id === email.id ? updated : e));
      if (selectedEmail?.id === email.id) {
        setSelectedEmail(updated);
        setSummariseFailed(false);
        setRetryCount(0);
        if (res.flagged) {
          mailmindApi.getThread(email.id).then(t => setThread(Array.isArray(t) ? t : [])).catch(() => {});
        } else {
          setThread([]);
        }
        await _runSummarise(updated);
      }
    } catch (e) { console.error(e); }
  };

  const handleDismiss = async (emailId) => {
    try {
      const res = await mailmindApi.dismiss(emailId);
      if (res?.kept) {
        // Was flagged — email stays, just unflagged and summary reset
        setEmails(prev => prev.map(e =>
          e.id === emailId ? { ...e, flagged: false, summarised: false, summary: "" } : e
        ));
        if (selectedEmail?.id === emailId) {
          setSelectedEmail(prev => ({ ...prev, flagged: false, summarised: false, summary: "" }));
          setThread([]);
        }
      } else {
        setEmails(prev => prev.filter(e => e.id !== emailId));
        if (selectedEmail?.id === emailId) setSelectedEmail(null);
      }
    } catch {}
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
    setSending(true);
    setSendError("");
    const emailId = replyPanel.emailId;
    try {
      await mailmindApi.sendReply(emailId, replyPanel.draft);
      setReplyPanel(null);
      const wasFlagged = selectedEmail?.flagged;
      const updated = { ...(selectedEmail || {}), read: true, summarised: !wasFlagged, summary: wasFlagged ? "" : (selectedEmail?.summary || "") };
      setEmails(prev => prev.map(e => e.id === emailId ? { ...e, read: true } : e));
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(updated);
        if (wasFlagged) {
          // Refresh thread so sent reply appears immediately, then re-summarise
          mailmindApi.getThread(emailId).then(t => setThread(Array.isArray(t) ? t : [])).catch(() => {});
          setSummariseFailed(false);
          setRetryCount(0);
          await _runSummarise({ ...updated, summarised: false });
        }
      }
    } catch (e) {
      setSendError(e.message || "Failed to send — check your Gmail connection.");
    }
    setSending(false);
  };

  const handleRefreshFlagged = async () => {
    if (!selectedEmail?.flagged) return;
    setRefreshingFlagged(true);
    mailmindApi.getThread(selectedEmail.id).then(t => setThread(Array.isArray(t) ? t : [])).catch(() => {});
    await _runSummarise({ ...selectedEmail, summarised: false });
    setRefreshingFlagged(false);
  };

  const handleOpenContacts = async () => {
    setSelectedEmail(null);
    setReplyPanel(null);
    setComposePanel(null);
    setContactsPanel({ stage: "loading", contacts: [], selected: [], summaries: null, summarising: false, error: "", trashInGmail: true, deleting: false, deleteResult: null });
    try {
      const contacts = await mailmindApi.listContacts();
      setContactsPanel(p => ({ ...p, stage: "list", contacts: Array.isArray(contacts) ? contacts : [] }));
    } catch {
      setContactsPanel(p => ({ ...p, stage: "list", error: "Failed to load contacts." }));
    }
  };

  const handleContactToggle = (addr) => {
    setContactsPanel(p => ({
      ...p,
      selected: p.selected.includes(addr) ? p.selected.filter(e => e !== addr) : [...p.selected, addr],
    }));
  };

  const handleContactSelectAll = () => {
    setContactsPanel(p => {
      const all = p.contacts.map(c => c.sender_email);
      const allSelected = all.every(a => p.selected.includes(a));
      return { ...p, selected: allSelected ? [] : all };
    });
  };

  const handleSummariseContacts = async () => {
    const toSummarise = contactsPanel.selected;
    setContactsPanel(p => ({ ...p, stage: "summary", summaries: {}, summarising: true, error: "" }));
    for (const addr of toSummarise) {
      try {
        const result = await mailmindApi.summariseContacts([addr]);
        setContactsPanel(p => ({ ...p, summaries: { ...p.summaries, ...result } }));
      } catch {
        const info = contactsPanel.contacts.find(c => c.sender_email === addr);
        setContactsPanel(p => ({
          ...p,
          summaries: { ...p.summaries, [addr]: { sender: info?.sender || addr, email_count: info?.email_count || 0, summary: "Failed to generate summary." } },
        }));
      }
    }
    setContactsPanel(p => ({ ...p, summarising: false }));
  };

  const handleContactsDeleteIntent = () => {
    setContactsPanel(p => ({ ...p, stage: "confirm" }));
  };

  const handleConfirmDeleteContacts = async () => {
    const { selected, trashInGmail } = contactsPanel;
    setContactsPanel(p => ({ ...p, deleting: true, error: "" }));
    try {
      const result = await mailmindApi.deleteContactEmails(selected, trashInGmail);
      const deletedAddrs = new Set(selected.map(a => a.toLowerCase()));
      setEmails(prev => prev.filter(e => !deletedAddrs.has((e.sender_email || "").toLowerCase())));
      if (selectedEmail && deletedAddrs.has((selectedEmail.sender_email || "").toLowerCase())) setSelectedEmail(null);
      setContactsPanel(p => ({ ...p, deleting: false, stage: "done", deleteResult: result }));
    } catch (e) {
      setContactsPanel(p => ({ ...p, deleting: false, error: "Delete failed — check your Gmail connection." }));
    }
  };

  const handleComposeOpen = () => {
    setReplyPanel(null);
    setSelectedEmail(null);
    setComposePanel({ to: "", toName: "", cc: "", subject: "", intent: "", draft: "", flag: false, stage: "fields", error: "", sendError: "" });
  };

  const handleComposeDraft = async () => {
    setComposeDraftLoading(true);
    setComposePanel(p => ({ ...p, error: "" }));
    try {
      const res = await mailmindApi.draftCompose(composePanel.to, composePanel.toName, composePanel.cc, composePanel.subject, composePanel.intent);
      setComposePanel(p => ({ ...p, draft: res.draft, stage: "review" }));
    } catch {
      setComposePanel(p => ({ ...p, error: "Failed to generate draft — check your LLM provider is running." }));
    }
    setComposeDraftLoading(false);
  };

  const handleComposeSend = async () => {
    setComposeSending(true);
    setComposePanel(p => ({ ...p, sendError: "" }));
    try {
      const res = await mailmindApi.sendCompose(composePanel.to, composePanel.toName, composePanel.cc, composePanel.subject, composePanel.draft, composePanel.flag);
      setComposePanel(null);
      if (res?.flagged) {
        const fresh = await mailmindApi.list().catch(() => []);
        setEmails(Array.isArray(fresh) ? fresh : []);
      }
    } catch (e) {
      setComposePanel(p => ({ ...p, sendError: e.message || "Failed to send — check your Gmail connection." }));
    }
    setComposeSending(false);
  };

  const handleFilter = async () => {
    setFiltering(true);
    filterRef.current = { dateFrom, dateTo, flaggedOnly };
    try {
      if (dateFrom || dateTo) {
        setFetchingDates(true);
        const fetched = await mailmindApi.fetchInboxForDates(dateFrom, dateTo);
        setFetchingDates(false);
        if (Array.isArray(fetched)) setEmails(prev => mergeEmails(fetched, prev));
      }
      const filtered = await mailmindApi.listFiltered(dateFrom, dateTo, flaggedOnly);
      setEmails(Array.isArray(filtered) ? filtered : []);
    } catch (e) {
      setFetchingDates(false);
      console.error(e);
    }
    setFiltering(false);
  };

  const handleClearFilter = async () => {
    setDateFrom(""); setDateTo(""); setFlaggedOnly(false);
    filterRef.current = { dateFrom: "", dateTo: "", flaggedOnly: false };
    const all = await mailmindApi.list().catch(() => []);
    setEmails(Array.isArray(all) ? all : []);
  };

  const unread = emails.filter(e => !e.read).length;
  const summaryDisplay = selectedEmail?.summary || selectedEmail?._preview || "";

  const sortedEmails = [...emails].sort((a, b) => {
    const ta = a.time_raw ? new Date(a.time_raw).getTime() : 0;
    const tb = b.time_raw ? new Date(b.time_raw).getTime() : 0;
    return tb - ta;
  });

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
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
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

        {/* Daemon status pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 10px",
          background: status.running ? "var(--accent-soft)" : "var(--bg-2)",
          border: `1px solid ${status.running ? "var(--accent-line)" : "var(--border-subtle)"}`,
          borderRadius: 99, fontSize: 11, fontFamily: "var(--font-mono)",
          color: status.running ? "var(--accent)" : "var(--text-3)",
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: status.running && !status.paused ? "var(--accent)" : "var(--text-3)",
            animation: status.running && !status.paused ? "oc-pulse 2s infinite" : "none",
          }} />
          {status.running
            ? status.paused ? "auto · paused" : "auto · live"
            : "manual only"}
        </div>

        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>
          {emails.length} emails
          {unread > 0 && <span style={{ color: "var(--accent)" }}> · {unread} unread</span>}
          {status.last_check && status.last_check !== "—" && <> · last {status.last_check}</>}
        </span>

        {/* Daemon controls */}
        {status.running ? (
          <div style={{ display: "flex", gap: 6 }}>
            {status.paused ? (
              <button className="oc-btn" onClick={handleResumeDaemon}
                style={{ padding: "7px 12px", fontSize: 12 }}>Resume auto</button>
            ) : (
              <button className="oc-btn" onClick={handlePauseDaemon}
                style={{ padding: "7px 12px", fontSize: 12 }}>Pause auto</button>
            )}
            <button className="oc-btn oc-btn--danger" onClick={handleStopDaemon} disabled={daemonLoading}
              style={{ padding: "7px 12px", fontSize: 12, color: "var(--danger)", borderColor: "rgba(201,112,100,0.3)" }}>
              Stop auto
            </button>
          </div>
        ) : (
          <button className="oc-btn" onClick={handleStartDaemon} disabled={daemonLoading}
            style={{ padding: "7px 12px", fontSize: 12 }}>
            {daemonLoading ? "Starting…" : "Start auto"}
          </button>
        )}

        {/* Contacts */}
        <button className="oc-btn" onClick={handleOpenContacts}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12,
            color: contactsPanel ? "var(--accent)" : undefined,
            borderColor: contactsPanel ? "var(--accent-line)" : undefined,
            background: contactsPanel ? "var(--accent-soft)" : undefined,
          }}>
          <Ic d={IC.contacts} size={12} /> Contacts
        </button>

        {/* Compose new email */}
        <button className="oc-btn" onClick={handleComposeOpen}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12 }}>
          <Ic d={IC.compose} size={12} /> Compose
        </button>

        {/* Manual fetch — always available */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <button className="oc-btn oc-btn--primary" onClick={handleFetch} disabled={fetching}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12 }}>
            <span style={{ animation: fetching ? "oc-spin 1s linear infinite" : "none", display: "flex" }}>
              <Ic d={IC.refresh} size={12} />
            </span>
            {fetching ? "Checking…" : "Check inbox"}
          </button>
          {fetchError && (
            <span style={{ fontSize: 10, color: "var(--danger)", fontFamily: "var(--font-mono)", maxWidth: 200, textAlign: "right" }}>
              {fetchError}
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "340px 1fr", overflow: "hidden" }}>
        {/* List */}
        <div style={{ borderRight: "1px solid var(--border-subtle)", overflowY: "auto", background: "var(--bg-0)" }}>
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)",
            display: "flex", flexDirection: "column", gap: 6,
            position: "sticky", top: 0, zIndex: 2, background: "var(--bg-0)",
          }}>
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
              {(dateFrom || dateTo || flaggedOnly) && !filtering && (
                <button onClick={handleClearFilter} style={{ fontSize: 10, color: "var(--text-3)", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear</button>
              )}
              <button onClick={handleFilter} disabled={filtering}
                className={dateFrom || dateTo || flaggedOnly ? "oc-btn oc-btn--primary" : "oc-btn"}
                style={{ padding: "4px 10px", fontSize: 10 }}>
                {filtering ? "…" : "Filter"}
              </button>
            </div>

            {fetchingDates && (
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "7px 10px",
                background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
                borderRadius: "var(--r-sm)",
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  border: "1.5px solid var(--accent)",
                  borderTopColor: "transparent",
                  animation: "oc-spin 0.7s linear infinite",
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)", letterSpacing: "0.06em" }}>
                  Fetching from Gmail…
                </span>
              </div>
            )}
          </div>

          <div>
            {sortedEmails.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center" }}>
                <p style={{ color: "var(--text-3)", fontSize: 12, margin: 0 }}>No emails yet</p>
                <p style={{ color: "var(--text-3)", fontSize: 11, marginTop: 6 }}>
                  Click <span style={{ color: "var(--accent)" }}>Check inbox</span> to fetch
                </p>
              </div>
            ) : sortedEmails.map((email, i) => (
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
                  fontSize: 12, margin: 0,
                  fontWeight: email.read ? 400 : 500,
                  color: email.read ? "var(--text-3)" : "var(--text-1)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{email.subject}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {contactsPanel ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px", animation: "oc-fadein 0.2s ease" }}>
              {/* Contacts panel header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <button onClick={() => setContactsPanel(null)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-2)", display: "flex", padding: 4 }}>
                  <Ic d={IC.x} size={14} />
                </button>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 18, color: "var(--text-0)", margin: 0 }}>
                  Contacts
                </h3>
                {contactsPanel.stage === "list" && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {contactsPanel.contacts.length} sender{contactsPanel.contacts.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {contactsPanel.stage === "loading" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} />
                </div>

              ) : contactsPanel.stage === "done" ? (
                <div>
                  <p style={{ fontSize: 14, color: "var(--text-1)", marginBottom: 8 }}>
                    Deleted {contactsPanel.deleteResult?.deleted || 0} email{(contactsPanel.deleteResult?.deleted || 0) !== 1 ? "s" : ""} from MailMind.
                  </p>
                  {contactsPanel.deleteResult?.errors?.length > 0 && (
                    <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 12, padding: "8px 12px", background: "rgba(201,112,100,0.08)", borderRadius: "var(--r-sm)", border: "1px solid rgba(201,112,100,0.25)" }}>
                      {contactsPanel.deleteResult.errors.length} Gmail error{contactsPanel.deleteResult.errors.length !== 1 ? "s" : ""} — emails removed from MailMind but may still appear in Gmail.
                    </p>
                  )}
                  <button className="oc-btn" onClick={() => setContactsPanel(null)} style={{ padding: "8px 16px" }}>Close</button>
                </div>

              ) : contactsPanel.stage === "confirm" ? (
                (() => {
                  const total = contactsPanel.contacts
                    .filter(c => contactsPanel.selected.includes(c.sender_email))
                    .reduce((s, c) => s + c.email_count, 0);
                  return (
                    <div>
                      <p style={{ fontSize: 14, color: "var(--text-0)", fontWeight: 500, marginBottom: 8 }}>
                        Delete emails from {contactsPanel.selected.length} contact{contactsPanel.selected.length !== 1 ? "s" : ""}?
                      </p>
                      <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 20, lineHeight: 1.6 }}>
                        {total} email{total !== 1 ? "s" : ""} will be removed from MailMind.
                      </p>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, cursor: "pointer", fontSize: 13, color: "var(--text-1)" }}>
                        <input type="checkbox" checked={contactsPanel.trashInGmail}
                          onChange={e => setContactsPanel(p => ({ ...p, trashInGmail: e.target.checked }))}
                          style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                        Also move to Gmail trash
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>— recoverable for 30 days</span>
                      </label>
                      {contactsPanel.error && (
                        <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 12, padding: "8px 12px", background: "rgba(201,112,100,0.08)", borderRadius: "var(--r-sm)", border: "1px solid rgba(201,112,100,0.25)" }}>
                          {contactsPanel.error}
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="oc-btn oc-btn--danger" onClick={handleConfirmDeleteContacts}
                          disabled={contactsPanel.deleting}
                          style={{ flex: 2, padding: 11, color: "var(--danger)", borderColor: "rgba(201,112,100,0.3)" }}>
                          {contactsPanel.deleting ? "Deleting…" : "Confirm delete"}
                        </button>
                        <button className="oc-btn" onClick={() => setContactsPanel(p => ({ ...p, stage: "list", error: "" }))}
                          disabled={contactsPanel.deleting}
                          style={{ flex: 1, padding: 11 }}>Cancel</button>
                      </div>
                    </div>
                  );
                })()

              ) : contactsPanel.stage === "summary" ? (
                <div>
                  {contactsPanel.summarising && Object.keys(contactsPanel.summaries || {}).length === 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", marginBottom: 4 }}>
                        Summarising…
                      </p>
                      <Skeleton height={12} /><Skeleton width="85%" height={12} /><Skeleton width="65%" height={12} />
                    </div>
                  ) : (
                    <div>
                      {Object.entries(contactsPanel.summaries || {}).map(([addr, info]) => (
                        <div key={addr} style={{ marginBottom: 20, padding: 16, background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: "var(--r-md)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-0)" }}>{info.sender}</span>
                            <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                              {info.email_count} email{info.email_count !== 1 ? "s" : ""}
                            </span>
                            {contactsPanel.summarising && Object.keys(contactsPanel.summaries).indexOf(addr) === Object.keys(contactsPanel.summaries).length - 1 && (
                              <div style={{ display: "flex", gap: 3, marginLeft: 4 }}>
                                {[0, 0.2, 0.4].map((d, i) => (
                                  <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", animation: `oc-pulse 1s ${d}s infinite` }} />
                                ))}
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{info.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {contactsPanel.error && (
                    <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 12 }}>{contactsPanel.error}</p>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {!contactsPanel.summarising && (
                      <button className="oc-btn" onClick={() => setContactsPanel(p => ({ ...p, stage: "list", summaries: null, error: "" }))}
                        style={{ padding: "9px 16px", fontSize: 12 }}>← Back</button>
                    )}
                    {!contactsPanel.summarising && Object.keys(contactsPanel.summaries || {}).length > 0 && (
                      <button className="oc-btn oc-btn--danger" onClick={handleContactsDeleteIntent}
                        style={{ flex: 1, padding: 9, color: "var(--danger)", borderColor: "rgba(201,112,100,0.3)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <Ic d={IC.trash} size={12} /> Delete from Gmail
                      </button>
                    )}
                  </div>
                </div>

              ) : (
                /* list stage */
                <div>
                  {contactsPanel.error && (
                    <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 12 }}>{contactsPanel.error}</p>
                  )}
                  {contactsPanel.contacts.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--text-3)" }}>No contacts yet — fetch your inbox first.</p>
                  ) : (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                          <input type="checkbox"
                            checked={contactsPanel.contacts.length > 0 && contactsPanel.contacts.every(c => contactsPanel.selected.includes(c.sender_email))}
                            onChange={handleContactSelectAll}
                            style={{ accentColor: "var(--accent)" }} />
                          Select all
                        </label>
                        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>
                          {contactsPanel.selected.length} selected
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 20 }}>
                        {contactsPanel.contacts.map(c => {
                          const isSelected = contactsPanel.selected.includes(c.sender_email);
                          return (
                            <label key={c.sender_email} style={{
                              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                              cursor: "pointer", borderRadius: "var(--r-sm)",
                              background: isSelected ? "var(--accent-soft)" : "var(--bg-1)",
                              border: `1px solid ${isSelected ? "var(--accent-line)" : "var(--border-subtle)"}`,
                              transition: "background 0.12s",
                            }}>
                              <input type="checkbox"
                                checked={isSelected}
                                onChange={() => handleContactToggle(c.sender_email)}
                                style={{ accentColor: "var(--accent)", flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, color: "var(--text-0)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.sender}</div>
                                <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.sender_email}</div>
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={{ fontSize: 12, color: "var(--text-2)" }}>{c.email_count} email{c.email_count !== 1 ? "s" : ""}</div>
                                <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{c.last_email}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="oc-btn oc-btn--primary" onClick={handleSummariseContacts}
                          disabled={contactsPanel.selected.length === 0}
                          style={{ flex: 2, padding: 11, opacity: contactsPanel.selected.length === 0 ? 0.5 : 1 }}>
                          Summarise selected
                        </button>
                        <button className="oc-btn oc-btn--danger" onClick={handleContactsDeleteIntent}
                          disabled={contactsPanel.selected.length === 0}
                          style={{ flex: 1, padding: 11, color: "var(--danger)", borderColor: "rgba(201,112,100,0.3)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: contactsPanel.selected.length === 0 ? 0.5 : 1 }}>
                          <Ic d={IC.trash} size={12} /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : composePanel ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px", animation: "oc-fadein 0.2s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <button onClick={() => setComposePanel(null)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-2)", display: "flex", padding: 4 }}>
                  <Ic d={IC.x} size={14} />
                </button>
                <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 18, color: "var(--text-0)", margin: 0 }}>
                  New message
                </h3>
              </div>

              {composePanel.stage === "fields" ? (
                <div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                    <div>
                      <div style={composeLabelStyle}>To *</div>
                      <input type="text" value={composePanel.to}
                        onChange={e => setComposePanel(p => ({ ...p, to: e.target.value }))}
                        placeholder="recipient@example.com" className="oc-input" />
                    </div>
                    <div>
                      <div style={composeLabelStyle}>Their name *</div>
                      <input type="text" value={composePanel.toName}
                        onChange={e => setComposePanel(p => ({ ...p, toName: e.target.value }))}
                        placeholder="e.g. John" className="oc-input" />
                    </div>
                    <div>
                      <div style={composeLabelStyle}>CC</div>
                      <input type="text" value={composePanel.cc}
                        onChange={e => setComposePanel(p => ({ ...p, cc: e.target.value }))}
                        placeholder="Optional" className="oc-input" />
                    </div>
                    <div>
                      <div style={composeLabelStyle}>Subject *</div>
                      <input type="text" value={composePanel.subject}
                        onChange={e => setComposePanel(p => ({ ...p, subject: e.target.value }))}
                        placeholder="What's this email about?" className="oc-input" />
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0, marginBottom: 10 }}>
                    What do you want to say? Keep it rough — the AI writes the full email.
                  </p>
                  <textarea value={composePanel.intent}
                    onChange={e => setComposePanel(p => ({ ...p, intent: e.target.value }))}
                    placeholder="e.g. Introduce myself and ask for a 30-min call next week"
                    rows={5} className="oc-input"
                    style={{ resize: "vertical", lineHeight: 1.6, marginBottom: 14, fontSize: 13 }} />
                  {composePanel.error && (
                    <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10, padding: "8px 12px", background: "rgba(201,112,100,0.08)", borderRadius: "var(--r-sm)", border: "1px solid rgba(201,112,100,0.25)" }}>
                      {composePanel.error}
                    </p>
                  )}
                  <button className="oc-btn oc-btn--primary" onClick={handleComposeDraft}
                    disabled={!composePanel.to || !composePanel.toName || !composePanel.subject || !composePanel.intent || composeDraftLoading}
                    style={{ width: "100%", padding: 11 }}>
                    {composeDraftLoading ? "Drafting…" : "Generate draft →"}
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: 10, fontSize: 12, color: "var(--text-2)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>To: </span>
                    {composePanel.to}
                    {composePanel.cc && <><span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}> · CC: </span>{composePanel.cc}</>}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                    Review and edit before sending
                  </div>
                  <textarea value={composePanel.draft}
                    onChange={e => setComposePanel(p => ({ ...p, draft: e.target.value }))}
                    rows={12} className="oc-input"
                    style={{ resize: "vertical", lineHeight: 1.7, marginBottom: 12, fontSize: 13 }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, cursor: "pointer", fontSize: 13, color: "var(--text-1)" }}>
                    <input type="checkbox" checked={composePanel.flag}
                      onChange={e => setComposePanel(p => ({ ...p, flag: e.target.checked }))}
                      style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                    <Ic d={IC.star} size={12} />
                    Flag conversation
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>— track replies + auto-summarise</span>
                  </label>
                  {composePanel.sendError && (
                    <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 10, padding: "8px 12px", background: "rgba(201,112,100,0.08)", borderRadius: "var(--r-sm)", border: "1px solid rgba(201,112,100,0.25)" }}>
                      {composePanel.sendError}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="oc-btn oc-btn--primary" onClick={handleComposeSend}
                      disabled={composeSending}
                      style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11 }}>
                      <Ic d={IC.send} size={12} /> {composeSending ? "Sending…" : "Send"}
                    </button>
                    <button className="oc-btn" onClick={() => setComposePanel(p => ({ ...p, stage: "fields", sendError: "" }))}
                      style={{ flex: 1, padding: 11 }}>Redraft</button>
                  </div>
                </div>
              )}
            </div>
          ) : selectedEmail && !replyPanel ? (
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
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: summariseFailed ? "var(--danger)" : "var(--accent)",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>
                    {summarising
                      ? retryCount > 0 ? `Retrying (${retryCount})…` : (selectedEmail?.flagged ? "Building conversation…" : "Summarising")
                      : summariseFailed ? "Failed"
                      : selectedEmail?.flagged ? "Conversation" : "AI Summary"}
                  </span>
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
                  {summariseFailed && !summarising && (
                    <button onClick={handleRetrySummarise}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "transparent", border: "1px solid var(--border)",
                        borderRadius: "var(--r-sm)", padding: "3px 8px",
                        fontSize: 10, fontFamily: "var(--font-mono)",
                        color: "var(--text-2)", cursor: "pointer",
                      }}>
                      <Ic d={IC.refresh} size={10} /> {retryCount > 0 ? `Retry (${retryCount + 1})` : "Retry"}
                    </button>
                  )}
                  {selectedEmail?.flagged && !summarising && (
                    <button onClick={handleRefreshFlagged} disabled={refreshingFlagged}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "transparent", border: "1px solid var(--border)",
                        borderRadius: "var(--r-sm)", padding: "3px 8px",
                        fontSize: 10, fontFamily: "var(--font-mono)",
                        color: "var(--text-2)", cursor: "pointer", opacity: refreshingFlagged ? 0.5 : 1,
                      }}>
                      <Ic d={IC.refresh} size={10} /> {refreshingFlagged ? "…" : "Refresh"}
                    </button>
                  )}
                </div>
                {summarising && !summaryDisplay ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Skeleton height={12} /><Skeleton width="85%" height={12} /><Skeleton width="65%" height={12} />
                  </div>
                ) : summariseFailed && !summarising ? (
                  <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.7, margin: 0, fontStyle: "italic" }}>
                    Could not generate summary — check your LLM provider is running and try again.
                  </p>
                ) : (
                  <p style={{
                    fontSize: 13, color: summarising ? "var(--text-2)" : "var(--text-1)",
                    lineHeight: 1.7, margin: 0, transition: "color 0.3s",
                  }}>{summaryDisplay || "Summary loading…"}</p>
                )}
              </div>

              {selectedEmail.flagged && thread.length > 0 && (
                <div style={{ marginBottom: 22 }}>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)",
                    letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10,
                  }}>Thread · {thread.length} message{thread.length !== 1 ? "s" : ""}</div>
                  {thread.map((e) => {
                    const isSent = e.direction === "sent";
                    return (
                      <details key={e.id} style={{
                        marginBottom: 6,
                        border: `1px solid ${isSent ? "var(--accent-line)" : "var(--border-subtle)"}`,
                        borderRadius: "var(--r-md)",
                        background: isSent ? "var(--accent-soft)" : "var(--bg-1)",
                        overflow: "hidden",
                      }}>
                        <summary style={{
                          padding: "10px 14px", cursor: "pointer", listStyle: "none",
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          <span style={{
                            fontSize: 12, fontWeight: 500,
                            color: isSent ? "var(--accent)" : "var(--text-0)",
                            flexShrink: 0,
                          }}>{isSent ? "You" : e.sender}</span>
                          <span style={{
                            fontSize: 11, color: "var(--text-2)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                          }}>{e.subject}</span>
                          <span style={{
                            fontSize: 10, color: "var(--text-3)",
                            fontFamily: "var(--font-mono)", flexShrink: 0,
                          }}>{e.time}</span>
                        </summary>
                        <p style={{
                          margin: 0, padding: "0 14px 14px",
                          fontSize: 13, color: "var(--text-1)", lineHeight: 1.65,
                          whiteSpace: "pre-wrap", borderTop: "1px solid var(--border-subtle)",
                          paddingTop: 12, marginTop: 0,
                        }}>{e.body}</p>
                      </details>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="oc-btn oc-btn--primary"
                  onClick={() => { setReplyPanel({ emailId: selectedEmail.id, intent: "", draft: "", stage: "intent" }); setSendError(""); }}
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
                  {sendError && (
                    <p style={{
                      fontSize: 12, color: "var(--danger)", marginBottom: 10,
                      padding: "8px 12px", background: "rgba(201,112,100,0.08)",
                      borderRadius: "var(--r-sm)", border: "1px solid rgba(201,112,100,0.25)",
                    }}>{sendError}</p>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="oc-btn oc-btn--primary" onClick={handleSend}
                      disabled={sending}
                      style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11 }}>
                      <Ic d={IC.send} size={12} /> {sending ? "Sending…" : "Send reply"}
                    </button>
                    <button className="oc-btn" onClick={() => { setReplyPanel(p => ({ ...p, stage: "intent" })); setSendError(""); }}
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
