"use client";

import { useState } from "react";

const MAIL_ICON = (
  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const ARROW = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Anmeldung: Link zur App an die eigene E-Mail-Adresse schicken lassen. */
export function RiderMailLink() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setDone(false);
    try {
      const res = await fetch("/api/rider/mail-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setDone(true);
      else setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="rd-card rd-wl-form rd-wl-sent" role="status">
        <span className="rd-wl-sent-icon">{MAIL_ICON}</span>
        <h2 className="rd-display rd-h3">Schau in dein Postfach</h2>
        <p className="rd-soft" style={{ margin: 0 }}>
          Wir haben dir den Link an <b className="rd-wl-mail">{email}</b> geschickt. Tipp ihn an, dann bist du drin. Er gilt bis zu 48 Stunden.
        </p>
        <p className="rd-muted" style={{ margin: 0 }}>Nichts da? Schau im Spam-Ordner nach.</p>
        <button type="button" className="rd-btn rd-btn-ghost rd-btn-wide" onClick={() => setDone(false)}>
          <span>Andere Adresse eingeben</span>
        </button>
      </div>
    );
  }

  return (
    <form className="rd-card rd-wl-form" onSubmit={submit}>
      <div>
        <h2 className="rd-display rd-h3">Los geht&apos;s</h2>
        <p className="rd-muted" style={{ margin: "4px 0 0" }}>Kein Passwort nötig: Wir schicken dir einen Link, mit dem du direkt drin bist.</p>
      </div>
      <div className="rd-field">
        <label htmlFor="rd-mail">E-Mail-Adresse</label>
        <input
          id="rd-mail"
          className="rd-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="du@beispiel.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={180}
        />
        <span className="rd-muted">Am besten die, mit der du dein Abo oder Ticket gebucht hast.</span>
      </div>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-accent rd-btn-wide" disabled={busy}>
        <span className="rd-wl-cta">{busy ? "Einen Moment …" : <>Link zur App schicken {ARROW}</>}</span>
      </button>
    </form>
  );
}
