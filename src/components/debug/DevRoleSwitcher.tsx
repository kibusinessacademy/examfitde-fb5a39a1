import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

/**
 * Dev-only role switcher for the preview/test environment.
 *
 * - Only renders on preview hosts (lovable.app, localhost) — never on examfit.de / berufos.com.
 * - Stores test credentials per role in localStorage (`dev:role:<role>` => {email,password}).
 * - One-click sign-in + jump to common test surfaces (Oral-Trainer, Dashboard, Admin).
 *
 * Activate visibility:
 *   localStorage.setItem('dev:role-switcher','1'); location.reload();
 * Or append `?devroles=1` once to enable persistently.
 */

type Role = "learner" | "admin" | "teacher" | "org";
type Creds = { email: string; password: string };

const ROLES: { id: Role; label: string; emoji: string }[] = [
  { id: "learner", label: "Learner", emoji: "🎓" },
  { id: "teacher", label: "Teacher", emoji: "🧑‍🏫" },
  { id: "admin", label: "Admin", emoji: "🛡️" },
  { id: "org", label: "Unternehmen (B2B)", emoji: "🏢" },
];

const QUICK_LINKS = [
  { label: "Oral-Trainer", path: "/oral-exam" },
  { label: "Dashboard", path: "/dashboard" },
  { label: "AI-Tutor", path: "/app/ai-tutor" },
  { label: "Admin", path: "/admin" },
  { label: "Org-Konsole", path: "/app/org" },
  { label: "Org-Team", path: "/app/org" },
  { label: "Org-Lizenzen", path: "/app/org" },
  { label: "B2B-Checkout", path: "/berufski/corporate" },
];

function isPreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".lovable.app") ||
    h.endsWith(".lovableproject.com")
  );
}

function loadCreds(role: Role): Creds | null {
  try {
    const raw = localStorage.getItem(`dev:role:${role}`);
    return raw ? (JSON.parse(raw) as Creds) : null;
  } catch {
    return null;
  }
}

function saveCreds(role: Role, creds: Creds) {
  localStorage.setItem(`dev:role:${role}`, JSON.stringify(creds));
}

export function DevRoleSwitcher() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPass, setDraftPass] = useState("");
  const [busy, setBusy] = useState<Role | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPreviewHost()) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("devroles") === "1") {
      localStorage.setItem("dev:role-switcher", "1");
      url.searchParams.delete("devroles");
      window.history.replaceState({}, "", url.toString());
    }
    setEnabled(localStorage.getItem("dev:role-switcher") === "1");
  }, []);

  if (!enabled) return null;

  const handleSwitch = async (role: Role) => {
    const creds = loadCreds(role);
    if (!creds) {
      setEditRole(role);
      setDraftEmail("");
      setDraftPass("");
      return;
    }
    setBusy(role);
    setLastError(null);
    try {
      if (user) await signOut();
      const email = creds.email.trim().toLowerCase();
      const password = creds.password.trim();
      const { error } = await signIn(email, password);
      if (error) {
        const message =
          error.message === "Invalid login credentials"
            ? `Login fehlgeschlagen: ${email} existiert in diesem Test-Backend nicht oder das Passwort passt nicht.`
            : `Login fehlgeschlagen: ${error.message}`;
        setLastError(message);
        toast.error(message);
      } else {
        toast.success(`Eingeloggt als ${role} (${email})`);
        setOpen(false);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSaveCreds = () => {
    if (!editRole) return;
    if (!draftEmail || !draftPass) {
      toast.error("E-Mail und Passwort nötig");
      return;
    }
    saveCreds(editRole, { email: draftEmail.trim().toLowerCase(), password: draftPass.trim() });
    toast.success(`Credentials für ${editRole} gespeichert`);
    const role = editRole;
    setEditRole(null);
    handleSwitch(role);
  };

  return (
    <div
      role="complementary"
      aria-label="Dev role switcher"
      style={{
        position: "fixed",
        bottom: 12,
        left: 12,
        zIndex: 99998,
        font: "12px/1.4 ui-sans-serif,system-ui,sans-serif",
      }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: "rgba(15,23,42,0.92)",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 999,
            padding: "8px 14px",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
          }}
          title="Dev role switcher"
        >
          🧪 {user ? `as ${user.email?.split("@")[0]}` : "Login"}
        </button>
      ) : (
        <div
          style={{
            background: "rgba(15,23,42,0.96)",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 10,
            padding: 12,
            minWidth: 260,
            maxWidth: "calc(100vw - 24px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Dev Role Switcher</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ background: "transparent", color: "#94a3b8", border: "none", cursor: "pointer" }}
              aria-label="close"
            >
              ✕
            </button>
          </div>

          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
            {user ? `Aktiv: ${user.email}` : "Nicht eingeloggt"}
          </div>
          <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 8 }}>
            Hinweis: Der Switcher speichert Zugangsdaten nur lokal. Die Nutzer müssen zusätzlich im aktuellen Test-Backend existieren.
          </div>

          {editRole ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                Credentials für <strong>{editRole}</strong> speichern (nur lokal in diesem Browser)
              </div>
              <input
                type="email"
                placeholder="email@example.com"
                value={draftEmail}
                onChange={(e) => setDraftEmail(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <input
                type="password"
                placeholder="password"
                value={draftPass}
                onChange={(e) => setDraftPass(e.target.value)}
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={handleSaveCreds} style={primaryBtn}>
                  Speichern & Login
                </button>
                <button type="button" onClick={() => setEditRole(null)} style={ghostBtn}>
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ROLES.map((r) => {
                  const creds = loadCreds(r.id);
                  return (
                    <div key={r.id} style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => handleSwitch(r.id)}
                        disabled={busy !== null}
                        style={{ ...rowBtn, flex: 1, opacity: busy === r.id ? 0.5 : 1 }}
                      >
                        {r.emoji} Login als {r.label}
                        {creds ? (
                          <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>
                            {creds.email}
                          </span>
                        ) : (
                          <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>
                            (Setup nötig)
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditRole(r.id);
                          setDraftEmail(creds?.email ?? "");
                          setDraftPass("");
                        }}
                        style={ghostBtn}
                        title="Credentials bearbeiten"
                      >
                        ✎
                      </button>
                    </div>
                  );
                })}
              </div>

              {lastError && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid #7f1d1d",
                    background: "rgba(127,29,29,0.22)",
                    color: "#fecaca",
                    fontSize: 11,
                  }}
                >
                  {lastError}
                </div>
              )}

              <div style={{ borderTop: "1px dashed #334155", marginTop: 10, paddingTop: 8 }}>
                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Schnellsprung:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {QUICK_LINKS.map((l) => (
                    <button
                      key={l.path}
                      type="button"
                      onClick={() => navigate(l.path)}
                      style={chipBtn}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {user && (
                <button
                  type="button"
                  onClick={async () => {
                    await signOut();
                    toast.success("Abgemeldet");
                  }}
                  style={{ ...ghostBtn, width: "100%", marginTop: 8 }}
                >
                  Logout
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem("dev:role-switcher");
                  setEnabled(false);
                }}
                style={{
                  background: "transparent",
                  color: "#64748b",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  marginTop: 6,
                }}
              >
                Switcher ausblenden
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  background: "#2dd4a8",
  color: "#0f172a",
  border: "none",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
  fontWeight: 600,
  flex: 1,
};

const ghostBtn: React.CSSProperties = {
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
};

const rowBtn: React.CSSProperties = {
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "6px 10px",
  cursor: "pointer",
  textAlign: "left",
};

const chipBtn: React.CSSProperties = {
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 999,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 11,
};
