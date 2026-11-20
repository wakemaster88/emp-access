"use client";

import { useState } from "react";
import { clearRiderLocalData } from "@/lib/rider-local";

export interface AboChoiceRow {
  ticketId: number;
  holder: string;
  aboName: string;
  runtime: string;
  expired: boolean;
}

/** Auswahl der gefundenen Abos; ohne Auswahl geht es ohne Abo weiter. */
export function RiderAboChoice({ mailKey, abos }: { mailKey: string; abos: AboChoiceRow[] }) {
  // Laufende Abos sind vorausgewählt, wenn es nur eines gibt.
  const running = abos.filter((a) => !a.expired);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(running.length === 1 ? [running[0].ticketId] : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: number, on: boolean) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rider/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: mailKey, ticketIds: [...chosen] }),
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
      {abos.map((a) => (
        <label key={a.ticketId} className="rd-check">
          <span className="rd-grow">
            <b>{a.aboName}</b>
            <br />
            <span className="rd-muted">{a.holder} · {a.runtime}</span>
          </span>
          <input type="checkbox" checked={chosen.has(a.ticketId)} onChange={(e) => toggle(a.ticketId, e.target.checked)} />
        </label>
      ))}
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy}>
        <span>{busy ? "Einen Moment …" : chosen.size > 0 ? "Weiter" : abos.length > 0 ? "Ohne Abo weiter" : "Weiter"}</span>
      </button>
    </form>
  );
}
