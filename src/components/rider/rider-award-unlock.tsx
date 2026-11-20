"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AwardBadge } from "./award-badge";
import { GiftIcon } from "./award-parts";
import type { AwardBadgeData, RiderUnlock } from "@/lib/rider-app";

/** Auf diesem Gerät schon gezeigte Vergaben (die Seite kann aus dem lokalen Cache kommen). */
const SEEN_KEY = "rd-awards-seen";
const SEEN_MAX = 200;
/** Wartet die Logo-Animation beim App-Start ab. */
const INTRO_MS = 1500;

function readSeen(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function rememberSeen(ids: number[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), ...ids])].slice(-SEEN_MAX)));
  } catch {
    // Privat-Tab ohne Speicher: dann merkt es sich nur der Server.
  }
}

const CONFETTI_COLORS = ["#fbbf24", "#7fd6db", "#ffffff", "#f472b6", "#a78bfa"];
// Feste Werte je Stück statt Zufall: Server und Browser zeichnen dasselbe.
const CONFETTI = Array.from({ length: 44 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: ((i * 53) % 90) / 100 + (i % 3) * 0.35,
  duration: 2.6 + ((i * 29) % 22) / 10,
  drift: ((i * 71) % 120) - 60,
  spin: 360 + ((i * 97) % 540),
  wide: i % 3 === 0,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
}));

export interface UnlockNext extends AwardBadgeData {
  value: number;
}

/**
 * Freischalt-Moment: zeigt frisch vergebene Awards nacheinander, mit
 * Abzeichen, Konfetti und dem Gutschein. Jede Vergabe erscheint einmal: der
 * Server merkt es sich (`seenAt`), dieses Gerät zusätzlich selbst.
 */
export function RiderAwardUnlock({
  token,
  base,
  unlocks,
  next,
  stats,
}: {
  token: string;
  base: string;
  unlocks: RiderUnlock[];
  /** Nächstes Ziel nach dem letzten Award. */
  next: UnlockNext | null;
  stats: Array<{ value: string; label: string }>;
}) {
  const [queue, setQueue] = useState<RiderUnlock[]>([]);
  const [index, setIndex] = useState(0);
  const shown = useRef(new Set<number>());
  const primary = useRef<HTMLElement | null>(null);
  const open = queue.length > 0;

  useEffect(() => {
    const seen = new Set(readSeen());
    const fresh = unlocks.filter((u) => !seen.has(u.awardId) && !shown.current.has(u.awardId));
    if (fresh.length === 0) return;
    const skipIntro = document.documentElement.getAttribute("data-rd-intro") === "skip"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => {
      for (const u of fresh) shown.current.add(u.awardId);
      rememberSeen(fresh.map((u) => u.awardId));
      setIndex(0);
      setQueue(fresh);
      void fetch(`/api/rider/${encodeURIComponent(token)}/awards/seen`, { method: "POST" }).catch(() => {});
    }, skipIntro ? 150 : INTRO_MS);
    return () => clearTimeout(timer);
  }, [unlocks, token]);

  const close = useCallback(() => setQueue([]), []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) primary.current?.focus({ preventScroll: true });
  }, [open, index]);

  if (!open) return null;
  const u = queue[Math.min(index, queue.length - 1)];
  const last = index >= queue.length - 1;
  const setPrimary = (el: HTMLElement | null) => {
    primary.current = el;
  };

  return (
    <div className="rd-ul" role="dialog" aria-modal="true" aria-label={`Award freigeschaltet: ${u.name}`}>
      <div className="rd-ul-rays" aria-hidden="true" />
      <div className="rd-ul-confetti" aria-hidden="true" key={`c${u.awardId}`}>
        {CONFETTI.map((c, i) => (
          <i
            key={i}
            style={{
              left: `${c.left}%`,
              width: c.wide ? 10 : 6,
              height: c.wide ? 4 : 12,
              background: c.color,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              ["--rd-drift" as string]: `${c.drift}px`,
              ["--rd-spin" as string]: `${c.spin}deg`,
            }}
          />
        ))}
      </div>
      <div className="rd-ul-body" key={u.awardId}>
        <div className="rd-ul-top">
          <span className="rd-hero-line">Award freigeschaltet</span>
          {queue.length > 1 && <span className="rd-ul-count">{index + 1} von {queue.length}</span>}
        </div>
        <div className="rd-ul-badge">
          <AwardBadge award={u} size={220} ribbon sweep />
        </div>
        <h2 className="rd-display rd-ul-name">{u.name}</h2>
        <p className="rd-ul-sub">{u.text}</p>
        {stats.length > 0 && (
          <div className="rd-ul-stats">
            {stats.map((s) => (
              <div key={s.label}>
                <b className="rd-display">{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {u.voucherLabel && (
          <div className="rd-ul-reward">
            <span className="rd-aw-gift"><GiftIcon size={22} /></span>
            <span>
              <small>Dein Gutschein</small>
              <b>{u.voucherLabel}</b>
              {u.bonus && <span>Dazu: {u.bonus}.</span>}
            </span>
          </div>
        )}
        {last && next && (
          <div className="rd-ul-next">
            <span className="rd-aw-tease"><AwardBadge award={next} size={48} /></span>
            <span>
              Nächstes Ziel: <b>{next.name}</b>
              <span className="rd-aw-bar"><i style={{ width: `${Math.min(100, (next.value / next.threshold) * 100)}%` }} /></span>
            </span>
            <span>{next.value.toLocaleString("de-DE")} / {next.threshold.toLocaleString("de-DE")}</span>
          </div>
        )}
        <div className="rd-ul-actions">
          {!last ? (
            <>
              <button type="button" className="rd-ul-pri" ref={setPrimary} onClick={() => setIndex((i) => i + 1)}>Weiter</button>
              <button type="button" onClick={close}>Überspringen</button>
            </>
          ) : (
            <>
              <Link
                href={u.voucherId != null ? `${base}/gutscheine/${u.voucherId}` : `${base}/awards`}
                className="rd-ul-pri"
                ref={setPrimary}
                onClick={close}
              >
                {u.voucherId != null ? "Gutschein zeigen" : "Zu den Awards"}
              </Link>
              <button type="button" onClick={close}>Schließen</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
