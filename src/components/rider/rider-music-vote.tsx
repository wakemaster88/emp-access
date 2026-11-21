"use client";

import { useEffect, useState } from "react";
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

const CHEVRON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Sekunden-Takt bis zum nächsten Wechsel; nach Ablauf lädt die Karte den neuen Stand. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/**
 * Musik-Abstimmung als eingeklappte Zeile unter den Öffnungszeiten der
 * Startseite. Antippen klappt die Auswahl auf; aktive Fahrer tippen eine
 * Playlist oder ein Webradio an, die meisten Stimmen gewinnen. Nochmal
 * antippen nimmt die Stimme zurück.
 */
export function RiderMusicVote({ token, initial }: { token: string; initial: MusicVoteView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Eingeklappt: oben beim Betrieb steht nur eine Zeile (Aaron, 21.11.2026).
  const [open, setOpen] = useState(false);
  const now = useNow(view.nextSwitchAt != null);
  const left = view.nextSwitchAt ? new Date(view.nextSwitchAt).getTime() - now : null;
  const url = `/api/rider/${encodeURIComponent(token)}/music-vote`;

  // Runde vorbei: kurz warten (der Wechsel läuft im Minutentakt), dann neuen Stand holen.
  useEffect(() => {
    if (!view.nextSwitchAt) return;
    const wait = new Date(view.nextSwitchAt).getTime() - Date.now() + 65_000;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(url);
        const json = (await res.json().catch(() => ({}))) as { view?: MusicVoteView | null };
        if (res.ok && json.view) setView(json.view);
      } catch {
        // offline: beim nächsten Öffnen der Seite
      }
    }, Math.max(5_000, wait));
    return () => window.clearTimeout(t);
  }, [view.nextSwitchAt, url]);
  const total = view.options.reduce((s, o) => s + o.votes, 0);

  async function vote(option: string) {
    const next = view.myOption === option ? null : option;
    setBusy(option);
    setError(null);
    try {
      const res = await fetch(url, {
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
    ? `Das Team hat gerade selbst gewählt. Eure Wahl gilt wieder ab ${clock(view.holdUntil)} Uhr.`
    : !view.playingName
      ? "Gerade läuft keine Musik. Eure Wahl gilt, sobald sie startet."
      : view.playingOption == null
        ? `Gerade läuft ${view.playingName}.`
        : null;

  const summary = view.playingName ?? "keine Musik";
  const mineName = view.options.find((o) => o.key === view.myOption)?.name ?? null;

  return (
    <div className="rd-vote">
      <button
        type="button"
        className="rd-hours rd-vote-toggle"
        aria-expanded={open}
        aria-controls="rd-vote-panel"
        aria-label={`Musik ${view.where}: ${summary}. ${view.canVote ? "Abstimmen" : "Ansehen"}`}
        onClick={() => setOpen((v) => !v)}
      >
        {NOTE_ICON}
        <span className="rd-grow rd-vote-sum">
          <span className="rd-vote-where">Musik</span> {summary}
        </span>
        <span className="rd-hours-more">
          {left != null && left > 0 && <span className="rd-vote-timer">{countdown(left)}</span>}
          {mineName ? "Deine Wahl" : view.canVote ? "Abstimmen" : "Ansehen"}
          <span className={`rd-vote-chev${open ? " rd-vote-chev-open" : ""}`}>{CHEVRON}</span>
        </span>
      </button>
      {open && (
        <div id="rd-vote-panel" className="rd-vote-panel">
          <div className="rd-between">
            <b>{view.canVote ? "Was soll laufen?" : "Die Fahrer wählen die Musik"}</b>
            <span className="rd-muted" style={{ fontSize: 12 }}>
              {view.voters === 1 ? "1 Stimme" : `${view.voters} Stimmen`}
            </span>
          </div>
          {view.nextSwitchAt && left != null && (
            <span className="rd-soft">
              {left > 0
                ? `Nächster Wechsel um ${clock(view.nextSwitchAt)} Uhr, noch ${countdown(left)} Min. Bis dahin zählt jede Stimme.`
                : "Die Runde ist vorbei, gleich läuft die Mehrheit."}
            </span>
          )}
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
                      <span className="rd-grow rd-vote-name">{o.name}</span>
                      {playing && <span className="rd-pill rd-pill-open rd-vote-live">läuft</span>}
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
                : view.nextSwitchAt ? "Am Rundenende läuft, was die meisten Stimmen hat. Du kannst jederzeit umentscheiden." : "Die meisten Stimmen gewinnen. Du kannst jederzeit umentscheiden."
              : `Abstimmen kann, wer in den letzten ${VOTE_ACTIVE_HOURS} Stunden am Lift gestartet ist.`}
          </span>
        </div>
      )}
    </div>
  );
}
