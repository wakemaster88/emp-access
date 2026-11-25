import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  ACCESS_RULE_CHANGES_KEPT,
  PASSBACK_MAX_MINUTES,
  PASSBACK_MIN_MINUTES,
  diffAccessRules,
  parseAccessRuleChanges,
  parseAccessRules,
  type AccessRuleChange,
  type AccessRules,
} from "@/lib/access-rules";
import { clearAccessRulesCache } from "@/lib/access-rules-cache";
import { countAccessRulesAffected } from "@/lib/access-rules-affected";

/**
 * Einlass-Regeln (Einstellungen › Einlass-Regeln). Lesen und Ändern nur mit
 * Admin-Zugang. Jede Änderung eines Schalters wird mit dem Admin im
 * Änderungsverlauf (`Account.accessRules.changes`, die letzten 50) und im
 * Server-Log festgehalten.
 */

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

  const existing = await db.account.findUnique({
    where: { id: accountId },
    select: { accessRules: true },
  });
  const before = parseAccessRules(existing?.accessRules);
  const next: AccessRules = { ...before };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) (next as Record<string, boolean | number>)[key] = value;
  }

  const user = session.session.user;
  const at = new Date().toISOString();
  const adminId = user.id ? String(user.id) : null;
  const admin = user.email ?? user.name ?? null;
  const newChanges: AccessRuleChange[] = diffAccessRules(before, next).map((c) => ({ at, adminId, admin, ...c }));
  const changes = [...newChanges.reverse(), ...parseAccessRuleChanges(existing?.accessRules)].slice(
    0,
    ACCESS_RULE_CHANGES_KEPT,
  );

  if (newChanges.length > 0) {
    await db.account.update({
      where: { id: accountId },
      data: { accessRules: { ...next, changes } as unknown as Prisma.InputJsonValue },
    });
    for (const c of newChanges) {
      console.info("[einlass-regeln] geändert", { accountId, adminId, key: c.key, from: c.from, to: c.to });
    }
    clearAccessRulesCache();
  }

  return NextResponse.json({ rules: next, changes });
}
