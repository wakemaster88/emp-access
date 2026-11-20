"use client";

import { useState } from "react";

interface Props {
  token: string;
  nickname: string | null;
  showInRanking: boolean;
  /** Eltern bearbeiten das Profil ihres Kindes. */
  managed?: boolean;
}

/** Spitzname und Einwilligung für Ranglisten. */
export function RiderProfileForm({ token, nickname, showInRanking, managed = false }: Props) {
  const [nick, setNick] = useState(nickname ?? "");
  const [ranking, setRanking] = useState(showInRanking);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `/api/rider/${encodeURIComponent(token)}/profile`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nick, showInRanking: ranking }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setNick(json.nickname ?? "");
        setMsg({ ok: true, text: "Gespeichert." });
      } else {
        setMsg({ ok: false, text: typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen." });
      }
    } catch {
      setMsg({ ok: false, text: "Keine Verbindung." });
    }
    setBusy(false);
  }

  return (
    <form className="rd-card" onSubmit={save} style={{ gap: 12 }}>
      <div className="rd-field">
        <label htmlFor="rd-nick">Spitzname</label>
        <input id="rd-nick" className="rd-input" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} autoComplete="off" />
        <span className="rd-muted">{managed ? "Für andere sichtbar, nie der Name oder ein Foto." : "Für andere sichtbar, nie dein Name oder Foto."}</span>
      </div>
      <label className="rd-check">
        <span className="rd-grow">
          <b>Rangliste</b>
          <br />
          <span className="rd-muted">Mit Spitznamen in Ranglisten und Challenges stehen</span>
        </span>
        <input type="checkbox" checked={ranking} onChange={(e) => setRanking(e.target.checked)} />
      </label>
      {msg && <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      <button type="submit" className="rd-btn rd-btn-wide" disabled={busy}><span>Speichern</span></button>
    </form>
  );
}
