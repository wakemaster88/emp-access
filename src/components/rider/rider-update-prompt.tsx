"use client";

import { useUpdateCheck } from "@/components/layout/use-update-check";

/**
 * „Neue Version verfügbar“ im Ride-Pass-Design. Gleiche Prüfung wie der
 * Verwaltungs-Dialog (`UpdatePrompt`), aber ohne dessen ui-Bausteine.
 */
export function RiderUpdatePrompt() {
  const { target, open, onOpenChange, apply } = useUpdateCheck();
  if (!target || !open) return null;
  return (
    <div className="rd-install rd-update" role="region" aria-label="Neue Version">
      <div className="rd-install-card" role="alertdialog" aria-labelledby="rd-update-title" aria-describedby="rd-update-text">
        <span className="rd-hint-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4" />
          </svg>
        </span>
        <div className="rd-grow">
          <b id="rd-update-title">Neue Version da</b>
          <p id="rd-update-text">Einmal aktualisieren, dann bist du auf dem neuesten Stand.</p>
          <div className="rd-update-actions">
            <button type="button" className="rd-btn" onClick={() => void apply()}>
              <span>Aktualisieren</span>
            </button>
            <button type="button" className="rd-btn rd-btn-ghost" onClick={() => onOpenChange(false)}>
              <span>Später</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
