"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ForWhomAbo {
  ticketId: number;
  aboName: string;
  /** „bis 30.06.2027“ */
  runtime: string;
  lastName: string | null;
}

export interface ForWhomPerson {
  id: number;
  /** „Ich“ für die angemeldete Person, sonst der Name. */
  label: string;
}

/**
 * „Neues Abo: Für wen ist es?“ Je Abo des Kontos ohne Fahrer eine Karte:
 * ich, eine Person der Familie oder jemand Neues mit Name und Geburtsdatum.
 */
export function RiderForWhom({ token, abos, persons }: { token: string; abos: ForWhomAbo[]; persons: ForWhomPerson[] }) {
  return (
    <>
      {abos.map((a) => (
        <ForWhomCard key={a.ticketId} token={token} abo={a} persons={persons} />
      ))}
    </>
  );
}

function ForWhomCard({ token, abo, persons }: { token: string; abo: ForWhomAbo; persons: ForWhomPerson[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | "new" | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState(abo.lastName ?? "");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = `rd-for-${abo.ticketId}`;
  const ready = choice != null && (choice !== "new" || !!(firstName.trim() && birthDate));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const body = choice === "new"
        ? { ticketId: abo.ticketId, firstName, lastName, birthDate: birthDate || null }
        : { ticketId: abo.ticketId, personId: choice };
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}/rider`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok || res.status === 409) {
        router.refresh();
        return;
      }
      setError(typeof json.error === "string" ? json.error : "Das hat nicht geklappt.");
    } catch {
      setError("Keine Verbindung. Bitte noch einmal versuchen.");
    }
    setBusy(false);
  }

  return (
    <form className="rd-card" style={{ gap: 10 }} onSubmit={submit}>
      <div className="rd-label">Neues Abo</div>
      <div className="rd-between">
        <b style={{ fontSize: 15 }}>{abo.aboName}</b>
        <span className="rd-muted">{abo.runtime}</span>
      </div>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <legend style={{ marginBottom: 4 }}>Für wen ist es?</legend>
        {persons.map((p) => (
          <label key={p.id} className="rd-check">
            <span className="rd-grow"><b>{p.label}</b></span>
            <input type="radio" name={name} checked={choice === p.id} onChange={() => setChoice(p.id)} />
          </label>
        ))}
        <label className="rd-check">
          <span className="rd-grow"><b>Jemand anderes</b></span>
          <input type="radio" name={name} checked={choice === "new"} onChange={() => setChoice("new")} />
        </label>
      </fieldset>
      {choice === "new" && (
        <>
          <div className="rd-field">
            <label htmlFor={`${name}-first`}>Vorname</label>
            <input id={`${name}-first`} className="rd-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={80} autoComplete="off" />
          </div>
          <div className="rd-field">
            <label htmlFor={`${name}-last`}>Nachname</label>
            <input id={`${name}-last`} className="rd-input" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={80} autoComplete="off" />
          </div>
          <div className="rd-field">
            <label htmlFor={`${name}-birth`}>Geburtsdatum</label>
            <input id={`${name}-birth`} className="rd-input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
          </div>
        </>
      )}
      {error && <div className="rd-msg rd-msg-err" role="alert">{error}</div>}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy || !ready}>
        <span>{busy ? "Einen Moment …" : "Speichern"}</span>
      </button>
    </form>
  );
}
