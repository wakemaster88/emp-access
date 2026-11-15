"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  start: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  gutscheine: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" /></>,
  profil: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
};

/** Untere Navigation der Kunden-App. */
export function RiderNav({ base }: { base: string }) {
  const pathname = usePathname();
  const items = [
    { key: "start" as const, label: "Start", href: base, active: pathname === base },
    { key: "gutscheine" as const, label: "Gutscheine", href: `${base}/gutscheine`, active: pathname.startsWith(`${base}/gutscheine`) },
    { key: "profil" as const, label: "Profil", href: `${base}/profil`, active: pathname.startsWith(`${base}/profil`) },
  ];
  return (
    <nav className="rd-nav" aria-label="Hauptnavigation">
      {items.map((it) => (
        <Link key={it.key} href={it.href} aria-current={it.active ? "page" : undefined}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONS[it.key]}
          </svg>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
