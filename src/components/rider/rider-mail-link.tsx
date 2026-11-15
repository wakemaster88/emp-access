"use client";

import { useState } from "react";

/** Tagesgäste: Link zur App an die E-Mail-Adresse der Buchung schicken lassen. */
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
        <span className="rd-muted">Die Adresse, mit der du gebucht hast oder die du an der Kasse angegeben hast.</span>
      </div>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      {done && (
        <div className="rd-msg rd-msg-ok" role="status">
          Wenn wir zu dieser Adresse ein Ticket aus dieser Saison haben, ist dein Link gleich im Postfach. Sonst trägt die Kasse deine Adresse gern ein.
        </div>
      )}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy}>
        <span>{busy ? "Einen Moment …" : "Link per E-Mail schicken"}</span>
      </button>
    </form>
  );
}
