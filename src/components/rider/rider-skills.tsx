"use client";

import { useState } from "react";
import type { RiderSkillView } from "@/lib/rider-skills";
import { voucherValidity } from "@/lib/rider-format";

const BOLT_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
  </svg>
);

/**
 * Gewonnene Skills: je Skill eine große Taste, darunter warum sie gerade
 * nicht geht (geschlossen, nicht vor Ort, läuft, Pause). Beim Musik-Joker
 * wählt die Person zuerst, was laufen soll.
 */
export function RiderSkills({ token, initial }: { token: string; initial: RiderSkillView[] }) {
  const [skills, setSkills] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ id: number; ok: boolean; text: string } | null>(null);

  if (skills.length === 0) return null;

  async function trigger(s: RiderSkillView) {
    const option = s.kind === "MUSIC" ? choice[s.id] ?? null : null;
    if (s.kind === "MUSIC" && !option) {
      setMsg({ id: s.id, ok: false, text: "Wähl zuerst, was laufen soll." });
      return;
    }
    setBusy(s.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/rider/${encodeURIComponent(token)}/skill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId: s.id, option }),
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string; skills?: RiderSkillView[] };
      if (!res.ok) {
        setMsg({ id: s.id, ok: false, text: json.error ?? "Das hat nicht geklappt. Versuch es gleich noch einmal." });
        return;
      }
      if (json.skills) setSkills(json.skills);
      setMsg({ id: s.id, ok: true, text: json.text ?? "Läuft." });
    } catch {
      setMsg({ id: s.id, ok: false, text: "Keine Verbindung. Versuch es gleich noch einmal." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rd-skills" aria-label="Deine Skills">
      <div className="rd-aw-sec-h">
        <span className="rd-label">Deine Skills</span>
        <span className="rd-aw-cnt">{skills.length}</span>
      </div>
      {skills.map((s) => {
        const m = msg?.id === s.id ? msg : null;
        return (
          <div key={s.id} className="rd-card rd-skill">
            <div className="rd-between">
              <b className="rd-display rd-skill-name">{s.name}</b>
              <span className="rd-pill rd-pill-open">{s.left === 1 ? "noch 1×" : `noch ${s.left}×`}</span>
            </div>
            {s.description && <span className="rd-muted">{s.description}</span>}
            {s.kind === "MUSIC" && s.options.length > 0 && (
              <div className="rd-chips" role="radiogroup" aria-label="Was soll laufen?">
                {s.options.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={choice[s.id] === o.key}
                    className={`rd-chip${choice[s.id] === o.key ? " rd-chip-on" : ""}`}
                    onClick={() => setChoice((c) => ({ ...c, [s.id]: o.key }))}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="rd-btn rd-btn-accent rd-btn-wide"
              disabled={s.block != null || busy != null}
              onClick={() => void trigger(s)}
            >
              <span className="rd-skill-go">
                {BOLT_ICON}
                {busy === s.id ? "Schaltet …" : s.kind === "MUSIC" ? `Meine Musik · ${s.runs}` : `Einschalten · ${s.runs}`}
              </span>
            </button>
            {m ? (
              <span className={`rd-msg ${m.ok ? "rd-msg-ok" : "rd-msg-err"}`} role={m.ok ? "status" : "alert"}>{m.text}</span>
            ) : (
              s.blockText && <span className="rd-soft">{s.blockText}</span>
            )}
            <span className="rd-muted" style={{ fontSize: 12 }}>
              {s.source} · gültig {voucherValidity(s.expiresAt)}
            </span>
          </div>
        );
      })}
    </section>
  );
}
