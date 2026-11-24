"use client";

import { useInstallState } from "@/components/pwa/use-install-state";

const SHARE = (
  <svg aria-label="Teilen" role="img" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const PLUS = (
  <svg aria-label="Plus" role="img" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

/**
 * Hinweis „Ride Pass als App“ im Browser, über der Navigation der Kunden-App.
 * iPhone: Anleitung Teilen › Zum Home-Bildschirm (Safari hat keinen Dialog).
 * Android/Chrome: echte Taste „Installieren“. Verschwindet als installierte
 * App und lässt sich 14 Tage lang wegklicken (eigener Schlüssel, unabhängig
 * vom Hinweis der Verwaltung).
 */
export function RiderInstallHint({ name = "Ride Pass" }: { name?: string }) {
  const { info, canPrompt, install, dismiss, showBanner } = useInstallState("rd-install-dismissed-at");
  if (!info || !showBanner) return null;

  return (
    <div className="rd-install" role="region" aria-label="Als App installieren">
      <div className="rd-install-card">
        <span className="rd-hint-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
            <path d="M12 8v6M9 11h6M10.5 18.5h3" />
          </svg>
        </span>
        <div className="rd-grow">
          <b>{name} als App</b>
          {info.ios ? (
            <>
              <p>{!info.safari ? "Öffne die Seite in Safari, dann:" : "In zwei Schritten, mit Push-Nachrichten:"}</p>
              <ol className="rd-hint-steps">
                <li><span>1</span>Unten {SHARE} <strong>Teilen</strong> antippen</li>
                <li><span>2</span>{PLUS} <strong>Zum Home-Bildschirm</strong></li>
              </ol>
            </>
          ) : (
            <p>Startet im Vollbild, liegt auf dem Startbildschirm und bekommt Push-Nachrichten.</p>
          )}
          {canPrompt && !info.ios && (
            <div className="rd-update-actions">
              <button type="button" className="rd-btn" onClick={() => void install()}>
                <span>Installieren</span>
              </button>
              <button type="button" className="rd-btn rd-btn-ghost" onClick={dismiss}>
                <span>Später</span>
              </button>
            </div>
          )}
        </div>
        <button type="button" className="rd-install-close" onClick={dismiss} aria-label="Hinweis ausblenden">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
