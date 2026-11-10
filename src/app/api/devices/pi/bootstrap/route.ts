import { NextRequest } from "next/server";
import { piBootstrapScript } from "@/lib/pi-bootstrap";

/**
 * Einrichtungsskript fuer neue Raspberry Pis, ausgeliefert von der Cloud statt
 * von raw.githubusercontent.com – das geht nicht mehr, sobald das Repository
 * privat ist.
 *
 *   curl -sSL https://<cloud>/api/devices/pi/bootstrap | sudo bash
 *   curl -sSL "https://<cloud>/api/devices/pi/bootstrap?kind=audio" | sudo bash
 *
 * Das Skript erzeugt den Deploy-Key des Geraets (/etc/emp-access), zeigt den
 * oeffentlichen Schluessel an, wartet, bis er bei GitHub eingetragen ist, klont
 * per SSH und startet dann den eigentlichen Installer aus dem Repository.
 * Ist das Repository (noch) oeffentlich, wird ohne Schluessel per HTTPS geklont.
 *
 * Bewusst ohne Anmeldung: Das Skript enthaelt keine Geheimnisse; der
 * Schluessel entsteht erst auf dem Geraet.
 */

export function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind") === "audio" ? "audio" : "scanner";
  return new Response(piBootstrapScript(kind), {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
