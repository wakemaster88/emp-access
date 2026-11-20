"use client";

import { useState, useSyncExternalStore } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { passkeyErrorMessage, passkeySupportSnapshot } from "@/lib/passkey-client";
import { clearRiderLocalData } from "@/lib/rider-local";

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
  return json as T;
}

function messageOf(e: unknown): string | null {
  if (e instanceof TypeError) return "Keine Verbindung. Bitte noch einmal versuchen.";
  return passkeyErrorMessage(e);
}

type RegOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

async function registerPasskey(api: string, resetKey?: string) {
  const optionsJSON = await post<RegOptions>(`${api}/passkey/register-options`, { resetKey });
  const response = await startRegistration({ optionsJSON });
  await post(`${api}/passkey/register`, { response, resetKey });
}

const KEY_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
    <circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" />
  </svg>
);

/**
 * Erstes Öffnen des Einladungslinks: Passkey oder Passwort einrichten. Mit
 * `resetKey` (Link aus der Mail „Passwort vergessen“) dasselbe für einen
 * bestehenden Zugang.
 */
export function RiderSetup({ token, resetKey }: { token: string; resetKey?: string }) {
  const api = `/api/rider/${encodeURIComponent(token)}/auth`;
  const home = `/app/${encodeURIComponent(token)}`;
  const supported = useSyncExternalStore(...passkeySupportSnapshot(browserSupportsWebAuthn, true));
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      // Neue Anmeldung: Seiten einer früheren Sitzung auf diesem Gerät verwerfen.
      await clearRiderLocalData();
      window.location.assign(home);
      return;
    } catch (e) {
      const text = messageOf(e);
      if (text) setError(text);
    }
    setBusy(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    void run(async () => {
      await post(`${api}/password`, { password, resetKey });
    });
  }

  return (
    <>
      {supported && (
        <div className="rd-card" style={{ gap: 10 }}>
          <b>Am einfachsten: Passkey</b>
          <span className="rd-muted">Du meldest dich mit Face ID, Fingerabdruck oder dem Code deines Handys an. Kein Passwort nötig.</span>
          <button type="button" className="rd-btn rd-btn-wide" disabled={busy} onClick={() => run(() => registerPasskey(api, resetKey))}>
            <span style={{ display: "inline-flex", alignItems: "center" }}>{KEY_ICON}Passkey einrichten</span>
          </button>
        </div>
      )}
      <form className="rd-card" onSubmit={submit} style={{ gap: 12 }}>
        <b>{supported ? (resetKey ? "Oder neues Passwort" : "Oder mit Passwort") : resetKey ? "Neues Passwort festlegen" : "Passwort festlegen"}</b>
        <div className="rd-field">
          <label htmlFor="rd-pw">Passwort</label>
          <input id="rd-pw" className="rd-input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="rd-muted">Mindestens 8 Zeichen.</span>
        </div>
        <div className="rd-field">
          <label htmlFor="rd-pw2">Passwort wiederholen</label>
          <input id="rd-pw2" className="rd-input" type="password" autoComplete="new-password" minLength={8} required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
        <button type="submit" className={`rd-btn rd-btn-wide${supported ? " rd-btn-ghost" : ""}`} disabled={busy || password.length < 8 || !repeat}>
          <span>{busy ? "Einen Moment …" : "Passwort speichern"}</span>
        </button>
      </form>
    </>
  );
}

/** Anmeldung an einem eingerichteten Zugang. */
export function RiderSignIn({ token, hasPassword, hasPasskey }: { token: string; hasPassword: boolean; hasPasskey: boolean }) {
  const api = `/api/rider/${encodeURIComponent(token)}/auth`;
  const home = `/app/${encodeURIComponent(token)}`;
  const supported = useSyncExternalStore(...passkeySupportSnapshot(browserSupportsWebAuthn, true));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      // Neue Anmeldung: Seiten einer früheren Sitzung auf diesem Gerät verwerfen.
      await clearRiderLocalData();
      window.location.assign(home);
      return;
    } catch (e) {
      const text = messageOf(e);
      if (text) setError(text);
    }
    setBusy(false);
  }

  const withPasskey = () =>
    run(async () => {
      const optionsJSON = await post<AuthOptions>(`${api}/passkey/login-options`);
      const response = await startAuthentication({ optionsJSON });
      await post(`${api}/passkey/login`, { response });
    });

  return (
    <>
      {hasPasskey && supported && (
        <div className="rd-card">
          <button type="button" className="rd-btn rd-btn-wide" disabled={busy} onClick={withPasskey}>
            <span style={{ display: "inline-flex", alignItems: "center" }}>{KEY_ICON}Mit Passkey anmelden</span>
          </button>
        </div>
      )}
      {hasPassword && (
        <form className="rd-card" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await post(`${api}/login`, { password }); }); }}>
          <div className="rd-field">
            <label htmlFor="rd-pw">Passwort</label>
            <input id="rd-pw" className="rd-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className={`rd-btn rd-btn-wide${hasPasskey && supported ? " rd-btn-ghost" : ""}`} disabled={busy || !password}>
            <span>{busy ? "Einen Moment …" : "Anmelden"}</span>
          </button>
        </form>
      )}
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      {hasPasskey && !hasPassword && !supported && (
        <div className="rd-msg rd-msg-err" role="alert">Dieser Browser kann keine Passkeys. Öffne die App auf dem Gerät, auf dem du sie eingerichtet hast.</div>
      )}
    </>
  );
}

/**
 * Passwort vergessen: Link zum Neufestlegen an die Adresse des Zugangs
 * schicken. Ohne bekannte Adresse bleibt nur die Kasse.
 */
export function RiderForgot({ token, maskedEmail }: { token: string; maskedEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  if (!maskedEmail) {
    return (
      <p className="rd-muted" style={{ margin: 0 }}>
        Passwort vergessen oder neues Handy? An der Kasse setzen wir deinen Zugang zurück und du bekommst einen neuen Link.
      </p>
    );
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post(`/api/rider/${encodeURIComponent(token)}/auth/reset`);
      setSent(true);
    } catch (e) {
      setError(messageOf(e) ?? "Das hat nicht geklappt.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="rd-card" role="status" style={{ gap: 8 }}>
        <b>Schau in dein Postfach</b>
        <span className="rd-soft">
          Wir haben dir einen Link an <b>{maskedEmail}</b> geschickt. Damit legst du ein neues Passwort oder einen Passkey fest. Er gilt 60 Minuten.
        </span>
        <span className="rd-muted">Nichts da? Schau im Spam-Ordner nach oder frag an der Kasse.</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={() => setOpen(true)}>
        <span>Passwort vergessen?</span>
      </button>
    );
  }

  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <b>Passwort vergessen?</b>
      <span className="rd-muted">
        Wir schicken dir einen Link an <b>{maskedEmail}</b>. Damit legst du ein neues Passwort fest oder richtest gleich einen Passkey ein.
      </span>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="button" className="rd-btn rd-btn-wide" disabled={busy} onClick={send}>
        <span>{busy ? "Einen Moment …" : "Link schicken"}</span>
      </button>
      <span className="rd-muted">Andere Adresse oder kein Zugriff mehr? An der Kasse setzen wir deinen Zugang zurück.</span>
    </div>
  );
}

/**
 * Startseite ohne Link: mit einem Passkey dieses Geräts anmelden. Das Handy
 * zeigt die eingerichteten Passkeys; der gewählte führt zur eigenen App.
 */
export function RiderPasskeyLogin() {
  const supported = useSyncExternalStore(...passkeySupportSnapshot(browserSupportsWebAuthn, false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!supported) return null;

  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const optionsJSON = await post<AuthOptions>("/api/rider/passkey/options");
      const response = await startAuthentication({ optionsJSON });
      const { url } = await post<{ url: string }>("/api/rider/passkey/login", { response });
      await clearRiderLocalData();
      window.location.assign(url);
      return;
    } catch (e) {
      const text = messageOf(e);
      if (text) setError(text);
    }
    setBusy(false);
  }

  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div>
        <b>Schon dabei?</b>
        <p className="rd-muted" style={{ margin: "4px 0 0" }}>Mit Face ID oder Fingerabdruck direkt in deine App.</p>
      </div>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" disabled={busy} onClick={login}>
        <span style={{ display: "inline-flex", alignItems: "center" }}>{KEY_ICON}{busy ? "Einen Moment …" : "Mit Passkey anmelden"}</span>
      </button>
    </div>
  );
}

/** Im Profil: Passkey hinzufügen, Passwort setzen oder ändern, abmelden. */
export function RiderSecurity({ token, hasPassword, passkeys }: { token: string; hasPassword: boolean; passkeys: number }) {
  const api = `/api/rider/${encodeURIComponent(token)}/auth`;
  const supported = useSyncExternalStore(...passkeySupportSnapshot(browserSupportsWebAuthn, true));
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, setState] = useState({ hasPassword, passkeys });

  async function run(action: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await action() });
    } catch (e) {
      const text = messageOf(e);
      if (text) setMsg({ ok: false, text });
    }
    setBusy(false);
  }

  const addPasskey = () =>
    run(async () => {
      await registerPasskey(api);
      setState((s) => ({ ...s, passkeys: s.passkeys + 1 }));
      return "Passkey eingerichtet.";
    });

  const savePassword = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await post(`${api}/password`, { password, current });
      setState((s) => ({ ...s, hasPassword: true }));
      setOpen(false);
      setCurrent("");
      setPassword("");
      return "Passwort gespeichert.";
    });
  };

  return (
    <div className="rd-card rd-list rd-set">
      <div>
        <span className="rd-grow">
          <b>Passkey</b>
          <span className="rd-dim">{state.passkeys > 0 ? `${state.passkeys} eingerichtet` : "Anmelden mit Face ID oder Fingerabdruck"}</span>
        </span>
        {supported && (
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={busy} onClick={addPasskey}>
            <span>{state.passkeys > 0 ? "Weiterer" : "Einrichten"}</span>
          </button>
        )}
      </div>
      {open ? (
        <form onSubmit={savePassword} className="rd-set-form">
          {state.hasPassword && (
            <div className="rd-field">
              <label htmlFor="rd-cur">Bisheriges Passwort</label>
              <input id="rd-cur" className="rd-input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          )}
          <div className="rd-field">
            <label htmlFor="rd-new">Neues Passwort</label>
            <input id="rd-new" className="rd-input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="rd-muted">Mindestens 8 Zeichen.</span>
          </div>
          <div className="rd-row">
            <button type="submit" className="rd-btn rd-grow" disabled={busy || password.length < 8}><span>Speichern</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" disabled={busy} onClick={() => setOpen(false)}><span>Abbrechen</span></button>
          </div>
        </form>
      ) : (
        <div>
          <span className="rd-grow">
            <b>Passwort</b>
            <span className="rd-dim">{state.hasPassword ? "gesetzt" : "nicht gesetzt"}</span>
          </span>
          <button type="button" className="rd-btn rd-btn-ghost rd-btn-sm" disabled={busy} onClick={() => { setOpen(true); setMsg(null); }}>
            <span>{state.hasPassword ? "Ändern" : "Festlegen"}</span>
          </button>
        </div>
      )}
      {msg && <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
    </div>
  );
}

/** Abmelden auf diesem Gerät; lokal gespeicherte Seiten werden gelöscht. */
export function RiderLogout({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    await post(`/api/rider/${encodeURIComponent(token)}/auth/logout`).catch(() => null);
    // Lokal gespeicherte Seiten (Abo, Gutscheine, Familie) gehören nicht aufs Gerät, wenn niemand angemeldet ist.
    await clearRiderLocalData();
    window.location.assign(`/app/${encodeURIComponent(token)}`);
  }
  return (
    <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" disabled={busy} onClick={logout}><span>Abmelden</span></button>
  );
}
