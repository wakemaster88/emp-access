"use client";

import { useSearchParams } from "next/navigation";

/** Hinweis auf `/app?link=abgelaufen`. Im Browser gelesen, damit `/app` statisch bleibt. */
export function RiderLinkExpired() {
  if (useSearchParams().get("link") !== "abgelaufen") return null;
  return (
    <div className="rd-msg rd-msg-err" role="alert">Dieser Link gilt nicht mehr. Fordere unten einfach einen neuen an.</div>
  );
}
