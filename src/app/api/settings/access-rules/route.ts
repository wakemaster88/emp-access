import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  PASSBACK_MAX_MINUTES,
  PASSBACK_MIN_MINUTES,
  mergeAccessRulesPatch,
  parseAccessRuleChanges,
  parseAccessRules,
} from "@/lib/access-rules";
import { clearAccessRulesCache } from "@/lib/access-rules-cache";
import { countAccessRulesAffected } from "@/lib/access-rules-affected";

/**
 * Einlass-Regeln (Einstellungen › Einlass-Regeln). Lesen und Ändern nur mit
 * Admin-Zugang. Jede Änderung eines Schalters wird mit dem Admin im
 * Änderungsverlauf (`Account.accessRules.changes`, die letzten 50) und im
 * Server-Log festgehalten.
 */

/** So oft wird bei parallelem Speichern neu gelesen, dann kommt 409. */
const ACCESS_RULES_SAVE_ATTEMPTS = 8;

const accessRulesPatchSchema = z
  .object({
    readerNeedsArea: z.boolean().optional(),
    ticketNeedsArea: z.boolean().optional(),
    handscannerDenyRedeemed: z.boolean().optional(),
    passbackMinutes: z
      .union([z.literal(0), z.number().int().min(PASSBACK_MIN_MINUTES).max(PASSBACK_MAX_MINUTES)])
      .optional(),
    voucherNeedsArea: z.boolean().optional(),
  })
  .strict();

/** GET (Session, Admin): Regeln, Änderungsverlauf und „Betrifft heute“. */
export async function GET() {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) {
    return NextResponse.json({ error: "No account assigned" }, { status: 403 });
  }

  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { accessRules: true },
  });

  return NextResponse.json({
    rules: parseAccessRules(account?.accessRules),
    changes: parseAccessRuleChanges(account?.accessRules),
    affected: await countAccessRulesAffected(db, accountId),
  });
}

/** PUT (Session, Admin): einzelne Regeln setzen; fehlende bleiben, wie sie sind. */
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) {
    return NextResponse.json({ error: "No account assigned" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = accessRulesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = session.session.user;
  const adminId = user.id ? String(user.id) : null;
  const admin = user.email ?? user.name ?? null;

  // Lesen, zusammenführen, schreiben: geschrieben wird nur, wenn
  // `accessRules` noch genau dem gelesenen Stand entspricht (Vergleich in der
  // Datenbank per jsonb-Gleichheit). Sonst hat ein paralleler PUT dazwischen
  // gespeichert, und es geht mit dessen Stand von vorn los. So geht keine
  // Änderung und kein Eintrag im Verlauf verloren, ohne Transaktion (gleich
  // mit Neon- und pg-Adapter und durch den Mandanten-Client). Noch nie
  // gespeichert (null) vergleicht mit `AnyNull`.
  for (let attempt = 0; attempt < ACCESS_RULES_SAVE_ATTEMPTS; attempt++) {
    const existing = await db.account.findUnique({
      where: { id: accountId },
      select: { accessRules: true },
    });
    const raw = existing?.accessRules ?? null;
    const { rules, changes, newChanges } = mergeAccessRulesPatch(raw, parsed.data, {
      at: new Date().toISOString(),
      adminId,
      admin,
    });
    if (newChanges.length === 0) return NextResponse.json({ rules, changes });

    const written = await db.account.updateMany({
      where: {
        id: accountId,
        accessRules: raw === null ? { equals: Prisma.AnyNull } : { equals: raw as Prisma.InputJsonValue },
      },
      data: { accessRules: { ...rules, changes } as unknown as Prisma.InputJsonValue },
    });
    if (written.count === 0) continue;

    for (const c of newChanges) {
      console.info("[einlass-regeln] geändert", { accountId, adminId, key: c.key, from: c.from, to: c.to });
    }
    clearAccessRulesCache();
    return NextResponse.json({ rules, changes });
  }

  return NextResponse.json(
    { error: "Die Einlass-Regeln wurden gerade woanders geändert. Bitte lade die Seite neu und versuche es noch einmal." },
    { status: 409 },
  );
}
