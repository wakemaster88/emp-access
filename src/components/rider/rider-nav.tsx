"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  start: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  challenges: <><path d="M8 4h8v6a4 4 0 0 1-8 0z" /><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 20h8" /></>,
  gutscheine: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" /></>,
  profil: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
};

/** Ab so viel Scrollweg nach unten wird die Leiste kompakt (nur Symbole). */
const COMPACT_AFTER_PX = 64;
/** Kleine Zitterbewegungen beim Scrollen ignorieren. */
const SCROLL_SLOP_PX = 6;

/**
 * Scrollt die Seite nach unten, wird die Leiste kompakt, beim Zurückscrollen
 * oder oben auf der Seite wieder voll. Gilt nur für die Seite, auf der
 * gescrollt wurde: eine neue Seite zeigt die Leiste wieder voll.
 */
function useCompactOnScroll(pathname: string) {
  const [state, setState] = useState({ path: pathname, compact: false });

  useEffect(() => {
    const setCompact = (compact: boolean) => {
      const path = window.location.pathname;
      setState((prev) => (prev.compact === compact && prev.path === path ? prev : { path, compact }));
    };
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = window.scrollY;
        const delta = top - last;
        if (top < COMPACT_AFTER_PX) setCompact(false);
        else if (delta > SCROLL_SLOP_PX) setCompact(true);
        else if (delta < -SCROLL_SLOP_PX) setCompact(false);
        if (Math.abs(delta) > SCROLL_SLOP_PX || top < COMPACT_AFTER_PX) last = top;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return state.path === pathname && state.compact;
}

/**
 * Untere Navigation der Kunden-App: eine schwebende Glas-Kapsel (dunkles
 * Grund, durchscheinend, Weichzeichner) im Stil von iOS 26/27. Der aktive
 * Eintrag sitzt auf einer schrägen gelben Linse, die zum angetippten Eintrag
 * gleitet. Beim Scrollen nach unten schrumpft die Leiste auf die Symbole.
 */
export function RiderNav({ base }: { base: string }) {
  const pathname = usePathname();
  const compact = useCompactOnScroll(pathname);
  const items = [
    { key: "start" as const, label: "Start", href: base, active: pathname === base },
    { key: "challenges" as const, label: "Challenges", href: `${base}/challenges`, active: pathname.startsWith(`${base}/challenges`) },
    { key: "gutscheine" as const, label: "Gutscheine", href: `${base}/gutscheine`, active: pathname.startsWith(`${base}/gutscheine`) },
    { key: "profil" as const, label: "Profil", href: `${base}/profil`, active: pathname.startsWith(`${base}/profil`) },
  ];
  const activeIndex = items.findIndex((it) => it.active);
  return (
    <div className="rd-nav-wrap" data-compact={compact || undefined}>
      <nav className="rd-nav" aria-label="Hauptnavigation" style={{ "--rd-nav-count": items.length } as React.CSSProperties}>
        {activeIndex >= 0 && (
          <span aria-hidden="true" className="rd-nav-lens" style={{ transform: `translateX(${activeIndex * 100}%)` }} />
        )}
        {items.map((it) => (
          <Link key={it.key} href={it.href} aria-current={it.active ? "page" : undefined} aria-label={it.label}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {ICONS[it.key]}
            </svg>
            <span aria-hidden="true">{it.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
