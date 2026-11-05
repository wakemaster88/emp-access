/**
 * Reine Hilfsfunktionen der Sperrliste (ohne Datenbank, testbar).
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Hoechstens alle 6 Stunden eine Meldung pro gesperrtem Geraet. */
export const BLOCKED_NOTIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldNotifyBlocked(notifiedAt: Date | null, now: Date): boolean {
  return !notifiedAt || now.getTime() - notifiedAt.getTime() >= BLOCKED_NOTIFY_INTERVAL_MS;
}

export interface BlockedHit {
  name: string;
  macAddress: string;
  ip: string | null;
  enforced: boolean;
}

export function formatBlockedAlert(hits: BlockedHit[]): string {
  const lines = hits.map((h) => {
    const parts = [h.ip ? `IP ${h.ip}` : null, `MAC ${h.macAddress}`].filter(Boolean);
    const hint = h.enforced
      ? "Die Sperre ist in Insight eingetragen, das Gerät kommt trotzdem rein (anderes WLAN oder Kabel?)."
      : "Die Sperre ist noch nicht in Insight eingetragen.";
    return `<b>${escapeHtml(h.name)}</b>\n${escapeHtml(parts.join(" · "))}\n${escapeHtml(hint)}`;
  });
  const head = hits.length === 1 ? "🚫 Gesperrtes Gerät im Netz" : `🚫 ${hits.length} gesperrte Geräte im Netz`;
  return `${head}\n\n${lines.join("\n\n")}`;
}
