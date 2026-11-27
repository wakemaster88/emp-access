import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { readRequestBody } from "@/lib/api-body";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { loadGroupRows } from "@/lib/newsletter/groups";
import { parseGroupName } from "@/lib/newsletter/rules";

/** Gruppen mit Anzahl der Mitglieder (alle und angemeldete). */
export async function GET() {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ groups: await loadGroupRows(auth.db, auth.accountId) });
}

/** Eigene Gruppe anlegen. */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const body = await readRequestBody(request);
  const parsed = parseGroupName(body?.name);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const count = await auth.db.newsletterGroup.count({ where: { accountId: auth.accountId } });
  if (count >= 50) return NextResponse.json({ error: "Höchstens 50 Gruppen" }, { status: 409 });
  try {
    const group = await auth.db.newsletterGroup.create({ data: { accountId: auth.accountId, name: parsed.name }, select: { id: true } });
    return NextResponse.json({ id: group.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Eine Gruppe mit diesem Namen gibt es schon" }, { status: 409 });
    }
    throw err;
  }
}
