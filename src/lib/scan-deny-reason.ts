/**
 * Reason-Codes in `scan.note` (Pi-Scan, Monitor-Klick, Scan-Check) auf
 * einen Satz fuer Personal/Monitor mappen. JSON-Notes (Wakesys) sind
 * keine Gruende und werden hier bewusst ignoriert.
 */

const SCAN_DENY_REASON_LABELS: Record<string, string> = {
  ticket_not_found: "Ticket nicht gefunden",
  status_invalid: "Ticket ungültig",
  status_paused: "Abo pausiert",
  status_canceled: "Ticket storniert",
  status_protected: "Ticket gesperrt",
  not_yet_valid: "Noch nicht gültig",
  expired: "Abgelaufen",
  slot_window: "Außerhalb Zeitslot",
  duration_expired: "Zeit abgelaufen",
  calendar_day_expired: "Nur am Gültigkeitstag",
  week_schedule: "Außerhalb Wochenplan",
  wrong_resource: "Falscher Bereich",
  ticket_already_redeemed: "Bereits eingelöst",
  no_exit_registered: "Bereits drin – kein Ausgang",
  no_reentry: "Kein Wiedereintritt",
  race_conflict: "Konflikt (parallel)",
  voucher_already_redeemed: "Gutschein eingelöst",
  voucher_benefit_only: "Gutschein gilt nur an der Kasse",
  voucher_disabled: "Gutschein deaktiviert",
  voucher_expired: "Gutschein abgelaufen",
  binarytec_denied: "Binarytec verweigert",
  partner_timeout: "Partner-System antwortet nicht rechtzeitig",
  scan_lock: "Zu schnell erneut gescannt",
  area_scan_lock: "Sperrzeit für diesen Bereich",
  // Einlass-Regeln (Einstellungen), ab Werk aus.
  device_unassigned: "Leser ohne Bereich",
  ticket_unassigned: "Ticket ohne Bereich",
  voucher_wrong_area: "Gutschein für anderen Bereich",
  area_passback: "Bereits drin – Wartezeit",
};

export function isScanDenyReasonCode(note: string | null | undefined): boolean {
  return !!note && Object.prototype.hasOwnProperty.call(SCAN_DENY_REASON_LABELS, note);
}

export function scanDenyReasonLabel(note: string | null | undefined): string | null {
  if (!note) return null;
  if (SCAN_DENY_REASON_LABELS[note]) return SCAN_DENY_REASON_LABELS[note];
  if (note.startsWith("{")) return null;
  return note;
}

/** Name/Foto/Alter aus einer Wakesys-JSON-Note. Reason-Codes sind keine Namen. */
export function parseScanDisplayNote(
  note?: string | null,
): { name?: string; picture?: string; age?: number } {
  if (!note || isScanDenyReasonCode(note)) return {};
  try {
    const parsed = JSON.parse(note) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as { name?: string; picture?: string; age?: number };
    }
  } catch {
    /* plain text */
  }
  return {};
}
