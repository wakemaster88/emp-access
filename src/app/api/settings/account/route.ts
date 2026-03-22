import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z
  .object({
    /** Neuen zufälligen Token erzeugen (empfohlen) */
    regenerate: z.boolean().optional(),
    /** Eigenen Token setzen (min. 16 Zeichen) */
    apiToken: z.string().min(16).max(256).optional(),
  })
  .refine((d) => d.regenerate === true || (d.apiToken != null && d.apiToken.trim().length >= 16), {
    message: "Entweder regenerate: true oder apiToken (min. 16 Zeichen) angeben",
    path: ["apiToken"],
  });

export async function PATCH(request: NextRequest) {
  const session = await safeAuth();
  if (!session?.user?.accountId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const newToken =
    parsed.data.regenerate === true
      ? randomBytes(32).toString("hex")
      : parsed.data.apiToken!.trim();

  try {
    const account = await db.account.update({
      where: { id: accountId },
      data: { apiToken: newToken },
      select: { id: true, apiToken: true },
    });
    return NextResponse.json(account);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Dieser API-Token ist bereits vergeben. Bitte erneut generieren oder anderen Wert wählen." },
        { status: 409 },
      );
    }
    throw e;
  }
}
