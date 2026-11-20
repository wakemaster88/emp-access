"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * „Teilen“ über das Teilen-Menü des Geräts. Erscheint nur, wo der Browser es
 * anbietet; geteilt wird ein kurzer Text mit der Adresse der App-Startseite.
 */
export function RiderShare({ title, text, className }: { title: string; text: string; className?: string }) {
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);
  if (!canShare) return <span aria-hidden="true" style={{ width: 56 }} />;
  return (
    <button
      type="button"
      className={className ?? "rd-aw-share"}
      onClick={() => {
        void navigator.share({ title, text, url: `${window.location.origin}/app` }).catch(() => {});
      }}
    >
      Teilen
    </button>
  );
}
