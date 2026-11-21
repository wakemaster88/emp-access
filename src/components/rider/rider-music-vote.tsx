"use client";

import { useState } from "react";
import { VOTE_ACTIVE_HOURS, type MusicVoteView } from "@/lib/music-vote-rules";

const NOTE_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);

const CHECK_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L20 7" />
  </svg>
);

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/**
 * Musik-Abstimmung auf der Startseite: aktive Fahrer tippen eine Playlist an,
 * die mit den meisten Stimmen läuft. Nochmal antippen nimmt die Stimme zurück.
 */
export function RiderMusicVote({ token, initial }: { token: string; initial: MusicVoteView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = view.options.reduce((s, o) => s + o.votes, 0);

  async function vote(option: string) {
    const next = view.myOption === option ? null : option;
    setBusy(option);
    setError(null);
    try {
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}/music-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { view?: MusicVoteView; error?: string };
      if (!res.ok || !json.view) {
        setError(json.error ?? "Das hat nicht geklappt. Versuch es gleich nochmal.");
        return;
      }
      setView(json.view);
    } catch {
      setError("Keine Verbindung. Versuch es gleich nochmal.");
    } finally {
      setBusy(null);
    }
  }

  const status = view.holdUntil
    ? view.holdBy === "rider"
      ? `Gerade läuft ein Musik-Joker. Eure Wahl gilt wieder ab ${clock(view.holdUntil)} Uhr.`
      : `Das Team hat gerade selbst gewählt. Eure Wahl gilt wieder ab ${clock(view.holdUntil)} Uhr.`
    : !view.playingName
      ? "Gerade läuft keine Musik. Eure Wahl gilt, sobald sie startet."
      : view.playingOption == null
        ? `Gerade läuft ${view.playingName}.`
        : null;

  return (
    <section className="rd-card rd-vote" aria-label={`Musik ${view.where}`}>
      <div className="rd-between">
        <div className="rd-label">Musik · {view.where}</div>
        <span className="rd-muted" style={{ fontSize: 12 }}>
          {view.voters === 1 ? "1 Stimme" : `${view.voters} Stimmen`}
        </span>
      </div>
      <b style={{ fontSize: 15 }}>
        {view.canVote ? "Was soll laufen?" : "Die Fahrer wählen die Musik"}
      </b>
      <ul className="rd-vote-list">
        {view.options.map((o) => {
          const mine = view.myOption === o.key;
          const playing = view.playingOption === o.key;
          const percent = total > 0 ? Math.round((o.votes / total) * 100) : 0;
          return (
            <li key={o.key}>
              <button
                type="button"
                className={`rd-vote-opt${mine ? " rd-vote-mine" : ""}`}
                aria-pressed={mine}
                disabled={!view.canVote || busy != null}
                onClick={() => void vote(o.key)}
              >
                <span className="rd-vote-head">
                  <span className="rd-vote-mark">{mine ? CHECK_ICON : null}</span>
                  <span className="rd-grow rd-vote-name">{o.name}{o.kind === "STREAM" && <small className="rd-muted"> · Radio</small>}</span>
                  {playing && <span className="rd-pill rd-pill-open rd-vote-live">{NOTE_ICON}läuft</span>}
                  <span className="rd-vote-count">{o.votes}</span>
                </span>
                <span className="rd-bar" aria-hidden="true">
                  <i style={{ width: `${percent}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && <span className="rd-msg rd-msg-err" role="alert">{error}</span>}
      {status && <span className="rd-soft">{status}</span>}
      <span className="rd-muted" style={{ fontSize: 12 }}>
        {view.canVote
          ? view.myOption != null
            ? `Deine Stimme zählt, bis du ${VOTE_ACTIVE_HOURS} Stunden nicht mehr am Lift gestartet bist. Nochmal tippen nimmt sie zurück.`
            : "Die meisten Stimmen gewinnen. Du kannst jederzeit umentscheiden."
          : `Abstimmen kann, wer in den letzten ${VOTE_ACTIVE_HOURS} Stunden am Lift gestartet ist.`}
      </span>
    </section>
  );
}
