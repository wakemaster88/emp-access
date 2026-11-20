"use client";

import { useState } from "react";

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

  return (
    <form className="rd-card" style={{ gap: 12 }} onSubmit={submit}>
      <div className="rd-field">
        <label htmlFor="rd-mail">E-Mail-Adresse</label>
        <input id="rd-mail" className="rd-input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={180} />
        <span className="rd-muted">Am besten die Adresse, mit der du dein Abo oder Ticket gebucht hast.</span>
      </div>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      {done && (
        <div className="rd-msg rd-msg-ok" role="status">
          Dein Link ist gleich im Postfach. Er gilt 48 Stunden.
        </div>
      )}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy}>
        <span>{busy ? "Einen Moment …" : "Link per E-Mail schicken"}</span>
      </button>
    </form>
  );
}
