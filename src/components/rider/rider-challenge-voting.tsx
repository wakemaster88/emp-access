"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, X } from "lucide-react";
import type { PhotoEntryView, VotingView } from "@/lib/challenge-voting";
import { CHALLENGE_PHOTO_PX, votesText } from "@/lib/challenge-voting-rules";

type Msg = { ok: boolean; text: string } | null;

interface Props {
  token: string;
  challengeId: number;
  kind: "PHOTO" | "POLL";
  running: boolean;
  ended: boolean;
  voting: VotingView;
  /** Die angemeldete Person selbst (Eltern stimmen nicht für ihr Kind ab). */
  canVote: boolean;
  /** Hat ein Ticket: darf ein Foto hochladen (selbst oder Eltern fürs Kind). */
  canUpload: boolean;
}

/** Foto auf höchstens 1600 px verkleinern, als JPEG. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Bild"));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("Bild");
    const scale = Math.min(1, CHALLENGE_PHOTO_PX / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bild");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function photoUrl(id: number): string {
  return `/api/rider/challenge-photo/${id}`;
}

/** Fotos, Stimmen und Antworten einer Foto-Challenge oder Abstimmung. */
export function RiderChallengeVoting({ token, challengeId, kind, running, ended, voting, canVote, canUpload }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [changing, setChanging] = useState(false);
  const [zoom, setZoom] = useState<PhotoEntryView | null>(null);
  const base = `/api/rider/${encodeURIComponent(token)}/challenges/${challengeId}`;

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  async function call(path: string, method: string, body?: unknown, done?: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setMsg({ ok: false, text: typeof json.error === "string" ? json.error : "Das hat nicht geklappt." });
        return false;
      }
      if (done) setMsg({ ok: true, text: done });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, text: "Keine Verbindung." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let photo: string;
    try {
      photo = await shrink(file);
    } catch {
      setMsg({ ok: false, text: "Das Bild lässt sich nicht öffnen. Bitte ein anderes wählen." });
      return;
    }
    setUploading(true);
    await call(`${base}/entry`, "POST", { photo }, "Foto hochgeladen.");
    setUploading(false);
  }

  const vote = (target: { entryId?: number | null; optionId?: number | null }, done: string) =>
    call(`${base}/vote`, "POST", target, done).then((ok) => ok && setChanging(false));

  const message = msg && (
    <div className={`rd-msg ${msg.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</div>
  );

  if (kind === "POLL") {
    const showBars = voting.showResults && !changing;
    return (
      <>
        {showBars ? (
          <div className="rd-poll" role="list">
            {voting.options.map((o) => (
              <div key={o.id} role="listitem" className={`rd-poll-row${o.voted ? " rd-poll-mine" : ""}`}>
                <div className="rd-between">
                  <span className="rd-poll-label">
                    {o.voted && <Check size={14} strokeWidth={3} aria-label="Deine Stimme" />} {o.label}
                  </span>
                  <b>{o.percent ?? 0} %</b>
                </div>
                <div className="rd-bar" aria-hidden><i style={{ width: `${o.percent ?? 0}%` }} /></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rd-poll" role="group" aria-label="Antworten">
            {voting.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`rd-poll-option${o.voted ? " rd-poll-option-mine" : ""}`}
                disabled={busy || !running || !canVote}
                onClick={() => vote({ optionId: o.id }, "Danke für deine Stimme.")}
              >
                {o.voted && <Check size={16} strokeWidth={3} aria-hidden />}
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="rd-between rd-muted">
          <span>{votesText(voting.totalVotes)}{!voting.showResults && running ? " · Ergebnis nach deiner Stimme" : ""}</span>
          {running && canVote && voting.myVoted && !changing && (
            <button type="button" className="rd-linkbtn" onClick={() => { setChanging(true); setMsg(null); }}>Stimme ändern</button>
          )}
          {changing && (
            <button type="button" className="rd-linkbtn" onClick={() => setChanging(false)}>Ergebnis zeigen</button>
          )}
        </div>
        {running && !canVote && <div className="rd-muted">Abstimmen kann jede Person nur selbst, in ihrem eigenen Zugang.</div>}
        {message}
      </>
    );
  }

  const others = voting.entries.filter((e) => !e.mine);
  const mine = voting.entries.find((e) => e.mine) ?? null;

  return (
    <>
      {running && (
        <div className="rd-photo-own">
          {mine ? (
            <>
              <button type="button" className="rd-photo-thumb" onClick={() => setZoom(mine)} aria-label="Dein Foto groß ansehen">
                {/* eslint-disable-next-line @next/next/no-img-element -- Foto aus der eigenen Schnittstelle */}
                <img src={photoUrl(mine.id)} alt="" />
              </button>
              <div className="rd-grow">
                <b>{mine.hidden ? "Dein Foto wurde ausgeblendet" : "Dein Foto ist dabei"}</b>
                <div className="rd-muted">{mine.hidden ? "Es passt nicht zur Challenge. Lad gern ein anderes hoch." : "Ein neues Foto ersetzt es, die Stimmen dafür verfallen."}</div>
              </div>
            </>
          ) : (
            <div className="rd-grow rd-muted">
              {canUpload ? "Lad dein Foto hoch, dann stimmen alle ab." : "Mitmachen kannst du, sobald du ein Abo oder Ticket hast. Abstimmen geht schon jetzt."}
            </div>
          )}
        </div>
      )}
      {running && canUpload && (
        <div className="rd-row">
          <button type="button" className="rd-btn rd-grow" disabled={busy} onClick={() => fileRef.current?.click()}>
            <span><Camera size={16} strokeWidth={2.4} aria-hidden /> {uploading ? "Wird geprüft …" : mine ? "Neues Foto" : "Foto hochladen"}</span>
          </button>
          {mine && (
            <button type="button" className="rd-btn rd-btn-ghost" disabled={busy} onClick={() => call(`${base}/entry`, "DELETE", undefined, "Dein Foto ist zurückgezogen.")}>
              <span>Zurückziehen</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={pick} />
        </div>
      )}
      {message}

      {(ended ? voting.entries : others).length > 0 ? (
        <div className="rd-gallery">
          {(ended ? voting.entries : others).map((e) => (
            <figure key={e.id} className={`rd-photo${e.voted ? " rd-photo-voted" : ""}${e.winner ? " rd-photo-win" : ""}`}>
              <button type="button" className="rd-photo-img" onClick={() => setZoom(e)} aria-label={`Foto von ${e.name} groß ansehen`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- Foto aus der eigenen Schnittstelle */}
                <img src={photoUrl(e.id)} alt="" loading="lazy" />
                {e.rank != null && <span className="rd-photo-rank">{e.rank}</span>}
              </button>
              <figcaption>
                <span className="rd-photo-name">{e.name}</span>
                {ended ? (
                  <span className="rd-muted">{votesText(e.votes ?? 0)}</span>
                ) : canVote ? (
                  <button
                    type="button"
                    className={`rd-vote${e.voted ? " rd-vote-on" : ""}`}
                    disabled={busy}
                    aria-pressed={e.voted}
                    onClick={() => (e.voted ? vote({ entryId: null }, "Stimme zurückgenommen.") : vote({ entryId: e.id }, "Danke für deine Stimme."))}
                  >
                    {e.voted ? <><Check size={14} strokeWidth={3} aria-hidden /> Deine Stimme</> : "Stimme geben"}
                  </button>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="rd-muted">{ended ? "Es wurde kein Foto eingereicht." : "Noch keine Fotos von anderen. Schau bald wieder vorbei."}</div>
      )}
      {running && (
        <div className="rd-muted">
          {canVote
            ? voting.myVoted ? "Du hast abgestimmt. Bis zum Ende kannst du deine Stimme ändern." : "Eine Stimme pro Person. Die Stimmen siehst du nach dem Ende."
            : "Abstimmen kann jede Person nur selbst, in ihrem eigenen Zugang."}
        </div>
      )}

      {zoom && (
        <div className="rd-lightbox" role="dialog" aria-modal="true" aria-label={`Foto von ${zoom.name}`} onClick={() => setZoom(null)}>
          <button type="button" className="rd-lightbox-close" aria-label="Schließen" onClick={() => setZoom(null)}>
            <X size={20} strokeWidth={2.4} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- Foto aus der eigenen Schnittstelle */}
          <img src={photoUrl(zoom.id)} alt={`Foto von ${zoom.name}`} onClick={(e) => e.stopPropagation()} />
          <div className="rd-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <b>{zoom.name}</b>
            {running && canVote && !zoom.mine && (
              <button
                type="button"
                className={`rd-vote${zoom.voted ? " rd-vote-on" : ""}`}
                disabled={busy}
                onClick={() => {
                  const target = zoom.voted ? { entryId: null } : { entryId: zoom.id };
                  setZoom(null);
                  vote(target, zoom.voted ? "Stimme zurückgenommen." : "Danke für deine Stimme.");
                }}
              >
                {zoom.voted ? <><Check size={14} strokeWidth={3} aria-hidden /> Deine Stimme</> : "Stimme geben"}
              </button>
            )}
            {ended && <span>{votesText(zoom.votes ?? 0)}</span>}
          </div>
        </div>
      )}
    </>
  );
}
