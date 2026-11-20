"use client";

import { useState } from "react";
import { clearRiderLocalData } from "@/lib/rider-local";

export interface WhoPerson {
  id: number;
  name: string;
  /** „Ride Abo · 41 Jahre“ */
  detail: string;
}

/**
 * Anmeldung mit der Adresse eines Kundenkontos: Wer bist du? Eine Person des
 * Kontos oder „Ich fahre selbst nicht“ (Eltern, die nur für ihre Kinder
 * buchen). Die übrigen Personen kommen danach als Familie dazu.
 */
export function RiderWho({ mailKey, persons, guess }: { mailKey: string; persons: WhoPerson[]; guess: number | null }) {
  const [choice, setChoice] = useState<number | "none">(guess ?? "none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rider/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: mailKey, personId: choice === "none" ? null : choice }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && typeof json.url === "string") {
        await clearRiderLocalData();
        window.location.assign(json.url);
        return;
      }
      setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    }
    setBusy(false);
  }

  return (
    <form className="rd-card" style={{ gap: 12 }} onSubmit={submit}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <legend className="rd-label" style={{ marginBottom: 6 }}>Wer bist du?</legend>
        {persons.map((p) => (
          <label key={p.id} className="rd-check">
            <span className="rd-grow">
              <b>{p.name}</b>
              <br />
              <span className="rd-muted">{p.detail}</span>
            </span>
            <input type="radio" name="rd-who" checked={choice === p.id} onChange={() => setChoice(p.id)} />
          </label>
        ))}
        <label className="rd-check">
          <span className="rd-grow">
            <b>Ich fahre selbst nicht</b>
            <br />
            <span className="rd-muted">Ich buche nur für meine Familie.</span>
          </span>
          <input type="radio" name="rd-who" checked={choice === "none"} onChange={() => setChoice("none")} />
        </label>
      </fieldset>
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy}>
        <span>{busy ? "Einen Moment …" : "Weiter"}</span>
      </button>
    </form>
  );
}
