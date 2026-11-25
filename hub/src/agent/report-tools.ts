/**
 * Welche Werkzeuge der Assistent ohne Chat (Tagesbericht) bekommt.
 *
 * Nur lesende Werkzeuge ("read"), und auch davon keine, die Bilder
 * verschicken. Alles mit "act" (Schalten, remember) braucht den Knopf in
 * Telegram und faellt hier heraus.
 */
export const REPORT_EXCLUDED_TOOLS = ["camera_snapshot", "look_at_camera"];

export function reportToolAllowed(name: string, risk: string | undefined): boolean {
  return risk === "read" && !REPORT_EXCLUDED_TOOLS.includes(name);
}
