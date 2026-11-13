import { NextRequest, NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { requireCurrentAdmin } from "@/lib/account-security";
import {
  MAX_PASSKEYS_PER_ADMIN,
  cleanPasskeyName,
  passkeyListSelect,
  relyingPartyFrom,
  verifyRegistration,
} from "@/lib/passkey";

/** Passkeys des eigenen Kontos – nie die eines anderen Admins. */

export async function GET() {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const passkeys = await prisma.passkey.findMany({
    where: { adminId: admin.id },
    select: passkeyListSelect,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ passkeys });
}

/** Schliesst die Registrierung ab (Optionen kommen von ./options). */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; response?: RegistrationResponseJSON }
    | null;
  const name = cleanPasskeyName(body?.name);
  if (!name || !body?.response || typeof body.response !== "object") {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const count = await prisma.passkey.count({ where: { adminId: admin.id } });
  if (count >= MAX_PASSKEYS_PER_ADMIN) {
    return NextResponse.json(
      { error: `Höchstens ${MAX_PASSKEYS_PER_ADMIN} Passkeys je Konto. Bitte zuerst einen alten löschen.` },
      { status: 409 },
    );
  }

  let credential;
  try {
    credential = await verifyRegistration(relyingPartyFrom(request.headers), admin.id, body.response);
  } catch {
    credential = null;
  }
  if (!credential) {
    return NextResponse.json(
      { error: "Passkey konnte nicht geprüft werden. Bitte erneut versuchen." },
      { status: 400 },
    );
  }

  const exists = await prisma.passkey.findUnique({ where: { credentialId: credential.credentialId } });
  if (exists) {
    return NextResponse.json({ error: "Dieser Passkey ist schon eingerichtet." }, { status: 409 });
  }

  const passkey = await prisma.passkey.create({
    data: { ...credential, adminId: admin.id, name },
    select: passkeyListSelect,
  });
  return NextResponse.json({ passkey }, { status: 201 });
}
