"use client";

import { useState } from "react";

interface Props {
  token: string;
  nickname: string | null;
  showInRanking: boolean;
}

/** Spitzname, Einwilligung für Ranglisten und der Ausstieg. */
export function RiderProfileForm({ token, nickname, showInRanking }: Props) {
  const [nick, setNick] = useState(nickname ?? "");
  const [ranking, setRanking] = useState(showInRanking);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  async function remove() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        window.location.assign("/app");
        return;
      }
      setMsg({ ok: false, text: "Löschen fehlgeschlagen." });
    } catch {
      setMsg({ ok: false, text: "Keine Verbindung." });
    }
    setBusy(false);
  }

  return (
    <>
      <form className="rd-card" onSubmit={save} style={{ gap: 12 }}>
        <div className="rd-field">
          <label htmlFor="rd-nick">Spitzname</label>
          <input id="rd-nick" className="rd-input" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} autoComplete="off" />
          <span className="rd-muted">Für andere sichtbar, nie dein Name oder Foto.</span>
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

      <div className="rd-card" style={{ gap: 10 }}>
        <b>Statistik löschen und aussteigen</b>
        <span className="rd-muted">
          Löscht deine Besuchstage, Starts und Meilensteine. Danach wird nichts mehr gezählt. Offene Gutscheine bleiben gültig, du findest sie dann an der Kasse über deinen Namen.
        </span>
        {confirmDelete ? (
          <div className="rd-row">
            <button type="button" className="rd-btn rd-btn-danger rd-grow" onClick={remove} disabled={busy}><span>Wirklich löschen</span></button>
            <button type="button" className="rd-btn rd-btn-ghost rd-grow" onClick={() => setConfirmDelete(false)} disabled={busy}><span>Abbrechen</span></button>
          </div>
        ) : (
          <button type="button" className="rd-btn rd-btn-danger rd-btn-wide" onClick={() => setConfirmDelete(true)}><span>Aussteigen</span></button>
        )}
      </div>
    </>
  );
}
