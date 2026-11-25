import { isScanDenyReasonCode } from "@/lib/scan-deny-reason";

/**
 * Gescannte Codes und Notizen für die MCP-Schnittstelle: Der Code geht nur
 * gekürzt hinaus (Anfang plus Länge), die Notiz nur als fester Grund-Code.
 */

/** Feste Grund-Codes in `scan.note`, die der Pi-Scan schreibt, aber nicht in scan-deny-reason.ts stehen. */
const EXTRA_REASON_CODES = new Set(["reserved_code"]);

/** Erste 3 Zeichen (bei kurzen Codes höchstens die Hälfte), dann „…“. */
export function maskScanCode(code: string | null | undefined): { code: string; length: number } | null {
  if (!code) return null;
  const chars = Array.from(code);
  const keep = Math.min(3, Math.floor(chars.length / 2));
  return { code: `${chars.slice(0, keep).join("")}…`, length: chars.length };
}

/** Nur feste Ablehnungs-Gründe; JSON- oder Freitext-Notizen (Partner-Systeme) fallen weg. */
export function mcpScanNote(note: string | null | undefined): string | null {
  if (!note) return null;
  return isScanDenyReasonCode(note) || EXTRA_REASON_CODES.has(note) ? note : null;
}
