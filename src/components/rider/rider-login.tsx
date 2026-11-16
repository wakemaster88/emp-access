"use client";

import { useState } from "react";
import { clearRiderLocalData } from "@/lib/rider-local";

/** Anmeldung: Kartennummer des Abos und Geburtsdatum führen zum persönlichen Link. */
export function RiderLogin() {
  const [code, setCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rider/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, birthDate }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && typeof json.url === "string") {
        await clearRiderLocalData();
        window.location.assign(json.url);
        return;
      }
      setError(typeof json.error === "string" ? json.error : "Anmeldung fehlgeschlagen.");
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    }
    setBusy(false);
  }

  return (
    <form className="rd-card" onSubmit={submit} style={{ gap: 14 }}>
      <div className="rd-field">
        <label htmlFor="rd-code">Kartennummer</label>
        <input id="rd-code" className="rd-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" required minLength={3} />
        <span className="rd-muted">Steht auf deiner Abo-Karte.</span>
      </div>
      <div className="rd-field">
        <label htmlFor="rd-birth">Geburtsdatum</label>
        <input id="rd-birth" className="rd-input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} autoComplete="bday" required />
      </div>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy || !code.trim() || !birthDate}>
        <span>{busy ? "Einen Moment …" : "Anmelden"}</span>
      </button>
    </form>
  );
}
