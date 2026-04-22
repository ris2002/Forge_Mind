import Logo from "./Logo";

/**
 * App shell — sidebar + content.
 *
 * Takes:
 *   modules          array of { id, name, icon (optional), available }
 *   activeModule     currently-selected id ("settings" counts too)
 *   onModuleSelect   (id) => void
 *   onOpenSettings   () => void
 *   activeProvider   {display_name, model, configured} | null
 *   onSignOut        () => void
 *   children         rendered in the main content area
 *
 * Shell does not know about MailMind or any specific module.
 */
export default function Shell({
  modules = [],
  activeModule,
  onModuleSelect,
  onOpenSettings,
  activeProvider,
  onSignOut,
  children,
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "240px 1fr",
      height: "100vh",
      background: "var(--bg-0)",
    }}>
      <aside style={{
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        padding: "18px 14px",
      }}>
        <div style={{ padding: "4px 6px 18px" }}>
          <Logo />
        </div>

        <SectionLabel>Modules</SectionLabel>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {modules.map(m => {
            const Icon = m.icon || DefaultModuleIcon;
            const isActive = activeModule === m.id;
            return (
              <button
                key={m.id}
                onClick={() => m.available !== false && onModuleSelect(m.id)}
                disabled={m.available === false}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  background: isActive ? "var(--bg-3)" : "transparent",
                  border: "1px solid",
                  borderColor: isActive ? "var(--border)" : "transparent",
                  borderRadius: "var(--r-md)",
                  color: isActive ? "var(--text-0)" : m.available !== false ? "var(--text-1)" : "var(--text-3)",
                  cursor: m.available !== false ? "pointer" : "not-allowed",
                  textAlign: "left",
                  fontSize: 13,
                  fontWeight: 500,
                  transition: "background 0.12s, color 0.12s",
                  position: "relative",
                }}
                onMouseEnter={e => {
                  if (!isActive && m.available !== false) e.currentTarget.style.background = "var(--bg-2)";
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                {isActive && (
                  <div style={{
                    position: "absolute",
                    left: -14, top: "50%",
                    transform: "translateY(-50%)",
                    width: 2, height: 16,
                    background: "var(--accent)",
                    borderRadius: "0 2px 2px 0",
                  }} />
                )}
                <Icon size={15} color={isActive ? "var(--accent)" : "currentColor"} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <span>{m.name}</span>
                  {m.available === false && (
                    <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 400 }}>
                      Coming soon
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Active-provider badge */}
        {activeProvider && (
          <div style={{
            margin: "0 4px 8px",
            padding: "10px 12px",
            background: "var(--bg-2)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-md)",
            fontSize: 11,
          }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 9,
              color: "var(--text-3)", letterSpacing: "0.08em",
              textTransform: "uppercase", marginBottom: 4,
            }}>
              Active model
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-1)" }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: activeProvider.configured ? "var(--success)" : "var(--danger)",
              }} />
              <span style={{ fontWeight: 500 }}>{activeProvider.display_name}</span>
            </div>
            {activeProvider.model && (
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--text-2)", marginTop: 2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {activeProvider.model}
              </div>
            )}
          </div>
        )}

        <div style={{
          display: "flex", flexDirection: "column", gap: 2,
          paddingTop: 8,
          borderTop: "1px solid var(--border-subtle)",
        }}>
          <SidebarItem label="Settings" icon={SettingsIcon}
            onClick={onOpenSettings} active={activeModule === "settings"} />
          {onSignOut && (
            <SidebarItem label="Sign out" icon={SignOutIcon}
              onClick={onSignOut} muted />
          )}
        </div>
      </aside>

      <main style={{ overflow: "auto", background: "var(--bg-0)" }}>
        {children}
      </main>
    </div>
  );
}

/* ── bits ─────────────────────────────────────────── */
function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: "var(--font-mono)", fontSize: 10,
      color: "var(--text-3)", letterSpacing: "0.08em",
      textTransform: "uppercase",
      padding: "12px 8px 8px",
    }}>
      {children}
    </div>
  );
}

function SidebarItem({ label, icon: Icon, onClick, active, muted }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 10px",
        background: active ? "var(--bg-3)" : "transparent",
        border: "1px solid",
        borderColor: active ? "var(--border)" : "transparent",
        borderRadius: "var(--r-md)",
        color: muted ? "var(--text-3)" : active ? "var(--text-0)" : "var(--text-1)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 13, fontWeight: 500,
        transition: "background 0.12s",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg-2)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function DefaultModuleIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12h8" />
    </svg>
  );
}

function SettingsIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function SignOutIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
