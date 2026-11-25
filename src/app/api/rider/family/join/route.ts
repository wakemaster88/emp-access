import { after, NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderAppPath } from "@/lib/rider-app";
import { sessionRider } from "@/lib/rider-auth";
import { FamilyError, joinFamily } from "@/lib/rider-family";
import { FAMILY_INVITE_COOKIE } from "@/lib/rider-family-invite";
import { notifyFamilyJoin } from "@/lib/rider-push";

/** POST: Einer Familien-Einladung folgen. Braucht die eigene Anmeldung; die übrigen Erwachsenen bekommen einen Push. */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-family-join", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const person = await sessionRider();
  if (!person) return NextResponse.json({ error: "Bitte melde dich zuerst in deiner App an." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== "string") return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  try {
    const familyId = await joinFamily(person, body.key);
    // Die übrigen Erwachsenen erfahren vom Beitritt; erst nach der Antwort.
    if (familyId != null) {
      after(() =>
        notifyFamilyJoin(person.accountId, familyId, person.id).catch((err) => {
          console.error("[rider] family join push failed:", err);
        }),
      );
    }
  } catch (e) {
    if (e instanceof FamilyError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  const res = NextResponse.json({ url: `${riderAppPath(person.token)}/profil` });
  res.cookies.delete(FAMILY_INVITE_COOKIE);
  return res;
}

/** DELETE: Einladung nicht annehmen. Der Hinweis in der App verschwindet, an der Familie ändert sich nichts. */
export async function DELETE(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-family-join", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const person = await sessionRider();
  const res = NextResponse.json({ url: person ? riderAppPath(person.token) : "/app" });
  res.cookies.delete(FAMILY_INVITE_COOKIE);
  return res;
}
