"use client";

import { useSearchParams } from "next/navigation";

/**
 * Hinweis auf `/app?link=abgelaufen`. Im Browser gelesen, damit `/app`
 * statisch bleibt; schwebt oben über der Seite, damit nach dem Laden nichts
 * verrutscht (Lighthouse 21.11.2026: CLS 0,15 als Block im Fluss).
 */
export function RiderLinkExpired() {
  if (useSearchParams().get("link") !== "abgelaufen") return null;
  return (
    <div className="rd-install rd-update" role="region" aria-label="Link abgelaufen">
      <div className="rd-install-card rd-expired-card" role="alert">
        Dieser Link gilt nicht mehr. Fordere unten einfach einen neuen an.
      </div>
    </div>
  );
}
