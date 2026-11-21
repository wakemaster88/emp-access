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
        <div className="rd-grow">
          <b id="rd-update-title">Neue Version verfügbar</b>
          <p id="rd-update-text">Lade die App neu, um die neue Version zu nutzen.</p>
          <div className="rd-update-actions">
            <button type="button" className="rd-btn rd-btn-sm" onClick={() => void apply()}>
              <span>Aktualisieren</span>
            </button>
            <button type="button" className="rd-btn rd-btn-sm rd-btn-ghost" onClick={() => onOpenChange(false)}>
              <span>Später</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
