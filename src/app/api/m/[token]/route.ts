import { NextResponse } from "next/server";
import { loadEmployeeByMobileToken } from "@/lib/employee-access";
import { publicLinkRateLimit } from "@/lib/rate-limit";

/**
 * Oeffentliche Mitarbeiter-PWA: liefert das Profil + erreichbare Geraete
 * fuer einen URL-Token. Der Token ist die einzige Auth - wer den Link hat,
 * sieht das Profil. Aus diesem Grund geben wir KEINE sensiblen
 * Account-internen Informationen heraus (z. B. andere Tickets, andere
 * Mitarbeiter, RFID-Codes, Email).
 */
/**
 * Anfragegrenze je Link und Anschluss: die Seite fragt einmal je Minute nach
 * (plus Neuladen von Hand); die Grenze laesst ein Vielfaches davon zu, auch
 * fuer mehrere Handys hinter derselben IP.
 */
const PROFILE_READ_LIMIT = { limit: 30, windowMs: 60_000 } as const;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }
  const limited = publicLinkRateLimit(req, token, "mobile-profile", PROFILE_READ_LIMIT);
  if (limited) return limited;

  const profile = await loadEmployeeByMobileToken(token);
  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: profile.id,
    name: profile.name,
    firstName: profile.firstName,
    lastName: profile.lastName,
    ticketTypeName: profile.ticketTypeName,
    profileImage: profile.profileImage,
    accountName: profile.accountName,
    status: profile.status,
    startDate: profile.startDate,
    endDate: profile.endDate,
    weekSchedule: profile.weekSchedule,
    devices: profile.devices.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      category: d.category,
      via: d.via,
    })),
    scheduleCheck: profile.scheduleCheck,
    contractOk: profile.contractOk,
    contractReason: profile.contractReason,
  });
}
