"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SwitchPerson {
  token: string;
  name: string;
  /** Die angemeldete Person selbst. */
  self: boolean;
}

const CHEVRON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Wie riderAppPath (lib/rider-app lädt Prisma, darf hier nicht rein). */
function appPath(token: string): string {
  return `/app/${encodeURIComponent(token)}`;
}

function initial(name: string): string {
  const clean = name.replace(/^TEST:\s*/i, "").trim();
  return (clean[0] ?? "?").toUpperCase();
}

/**
 * „Hi Aaron“ im Kopf der Startseite. In einer Familie ist der Gruß der
 * Schalter: antippen klappt direkt darunter die Personen auf (kein Dialog,
 * Aaron 21.11.2026). Ohne Familie bleibt es die normale Überschrift.
 */
export function RiderHeroName({ greeting, current, persons }: { greeting: string; current: string; persons: SwitchPerson[] }) {
  if (persons.length < 2) {
    return <h1 className="rd-display rd-hero-hi">{greeting}</h1>;
  }
  return (
    <details className="rd-switch">
      <summary aria-label={`${greeting}, Person wechseln`}>
        <h1 className="rd-display rd-hero-hi">{greeting}</h1>
        <span className="rd-switch-chev">{CHEVRON}</span>
      </summary>
      <nav className="rd-switch-list" aria-label="Person wechseln">
        {persons.map((p) => (
          <Link
            key={p.token}
            href={appPath(p.token)}
            prefetch
            aria-current={p.token === current ? "true" : undefined}
          >
            <span className="rd-switch-dot" aria-hidden="true">{initial(p.name)}</span>
            {p.self ? "Ich" : p.name}
          </Link>
        ))}
      </nav>
    </details>
  );
}

/**
 * Auf den übrigen Seiten nur ein schmaler Hinweis, wenn gerade eine andere
 * Person der Familie angezeigt wird; gewechselt wird auf der Startseite.
 */
export function RiderViewing({ token, name, selfToken }: { token: string; name: string; selfToken: string }) {
  const pathname = usePathname();
  if (pathname === appPath(token)) return null;
  return (
    <div className="rd-viewing">
      <span>Ansicht von <b>{name}</b></span>
      <Link href={appPath(selfToken)} prefetch>Zu mir</Link>
    </div>
  );
}
