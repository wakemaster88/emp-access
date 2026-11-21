/**
 * Gemeinsame Teile der Challenge-Karten (Seite „Challenges“ und Startseite):
 * Zeit-Marke, Regeltext und Gewinn-Kasten.
 */
import { Gift } from "lucide-react";
import type { RiderChallenge } from "@/lib/rider-challenges";
import { METRIC_LABEL } from "@/lib/gamification";
import { daysUntil } from "@/lib/rider-format";
import { clockText } from "@/lib/rider-announce-rules";

/** Kurzes Datum für die Marke oben rechts: „6.12.“ */
function shortDay(d: Date): string {
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "numeric", timeZone: "Europe/Berlin" });
}

export function challengeTimeText(c: RiderChallenge): string {
  const until = c.endTime ? ` bis ${clockText(c.endTime)}` : "";
  if (c.phase === "upcoming") {
    return c.endTime && c.startDate.getTime() === c.endDate.getTime()
      ? `${shortDay(c.startDate)}${until}`
      : `startet ${shortDay(c.startDate)}`;
  }
  if (c.phase === "ended") return `beendet ${shortDay(c.endDate)}`;
  // Der Endtag zählt mit: bis zum Ende des Tages.
  const days = daysUntil(new Date(c.endDate.getTime() + 86_400_000));
  if (days <= 1) return c.endTime ? `heute${until}` : "endet heute";
  return `noch ${days} Tage`;
}

export function challengeRuleText(c: RiderChallenge): string {
  const metric = METRIC_LABEL[c.metric];
  switch (c.kind) {
    case "TASK":
      return `Aufgabe: ${c.condition}`;
    case "TOP_X":
      return (c.topCount ?? 1) <= 1
        ? `Platz 1 nach ${metric} gewinnt`
        : `Die besten ${c.topCount} nach ${metric} gewinnen`;
    case "PHOTO":
      return (c.topCount ?? 1) === 1
        ? "Foto-Challenge: das Foto mit den meisten Stimmen gewinnt"
        : `Foto-Challenge: die ${c.topCount} Fotos mit den meisten Stimmen gewinnen`;
    case "POLL":
      return "Abstimmung: eine Stimme pro Person";
  }
}

/** Eigener Stand in einer kurzen Zeile, z. B. „Platz 2 von 21 · 22 Starts“. */
export function challengeStandText(c: RiderChallenge): string {
  const metric = METRIC_LABEL[c.metric];
  switch (c.kind) {
    case "TASK": {
      const t = c.threshold ?? 0;
      return `${Math.min(c.value, t)} von ${t} ${metric}`;
    }
    case "TOP_X":
      return c.rank != null ? `Platz ${c.rank} von ${c.participants} · ${c.value} ${metric}` : `Noch keine ${metric}, fahr mit!`;
    case "PHOTO":
      return c.voting?.myEntry ? "Dein Foto ist dabei" : "Lade dein Foto hoch";
    case "POLL":
      return c.voting?.myVoted ? "Du hast abgestimmt" : "Stimm ab";
  }
}

/** Gewinn als hervorgehobener Kasten, die Regel klein darunter; ohne Gewinn nur die Regel. */
export function ChallengePrize({ c }: { c: RiderChallenge }) {
  if (!c.voucherLabel && !c.skillLabel) return <div className="rd-muted">{challengeRuleText(c)}</div>;
  return (
    <div className="rd-prize">
      <Gift className="rd-prize-icon" aria-hidden />
      <div className="rd-grow">
        <div className="rd-label">{c.won ? "Dein Gewinn" : "Gewinn"}</div>
        {c.voucherLabel && <b>{c.voucherLabel}</b>}
        {c.skillLabel && <b>Skill: {c.skillLabel}</b>}
        <div className="rd-muted">{challengeRuleText(c)}</div>
      </div>
    </div>
  );
}
