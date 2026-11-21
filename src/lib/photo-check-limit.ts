/**
 * Tagesgrenze der KI-Fotoprüfung (lib/profile-photo-check) je Person in der
 * Kunden-App: Profilbild und Challenge-Fotos zusammen.
 */
import { prisma } from "./prisma";
import { berlinYmd } from "./berlin-day";

/** So viele KI-Prüfungen (Profilbild und Challenge-Fotos) hat eine Person je Tag. */
export const PHOTO_CHECKS_PER_DAY = 20;
export const PHOTO_CHECKS_EXHAUSTED = "Für heute hast du genug Fotos ausprobiert. Morgen geht es wieder.";

/**
 * Eine KI-Prüfung für diese Person verbuchen. False, wenn die Tagesgrenze
 * erreicht ist; so bleiben die Kosten für die Bilderkennung begrenzt.
 */
export async function takePhotoCheck(profileId: number, now: Date = new Date()): Promise<boolean> {
  const today = berlinYmd(now);
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    UPDATE "RiderProfile"
    SET "photoChecks" = CASE WHEN "photoCheckDay" = ${today}::date THEN "photoChecks" + 1 ELSE 1 END,
        "photoCheckDay" = ${today}::date
    WHERE id = ${profileId}
      AND ("photoCheckDay" IS DISTINCT FROM ${today}::date OR "photoChecks" < ${PHOTO_CHECKS_PER_DAY})
    RETURNING id`;
  return rows.length === 1;
}
