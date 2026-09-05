import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildKeyProtocolPdf, type KeySnapshot, type PolicySnapshot } from "@/lib/key-policy-pdf";
import { clientIp } from "@/lib/key-signature";
import { isPlausibleSignatureToken, signatureState } from "@/lib/keying";
import { keySignatureSubmitSchema } from "@/lib/validators";
import { storePdfColumn } from "@/lib/blob-store";

/**
 * Oeffentliche Signaturseite der Schliessanlage (QR-Link).
 *   GET  – Belehrung, Haftung und Schluesselliste aus dem Snapshot
 *   POST – Unterschrift entgegennehmen und Protokoll-PDF archivieren
 *
 * Kein Login: der Token IST die Berechtigung. Deshalb wird hier nie mehr
 * ausgeliefert als der eingefrorene Snapshot des jeweiligen Vorgangs.
 */

async function loadSignature(token: string) {
  if (!isPlausibleSignatureToken(token)) return null;
  return prisma.keySignature.findUnique({
    where: { token },
    select: {
      id: true,
      kind: true,
      expiresAt: true,
      signedAt: true,
      signedName: true,
      signerIp: true,
      policySnapshot: true,
      keySnapshot: true,
      signatureImage: true,
      handoverId: true,
      accountId: true,
      account: { select: { name: true } },
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const signature = await loadSignature((await params).token);
  if (!signature) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const state = signatureState(signature, new Date());
  const policy = signature.policySnapshot as unknown as PolicySnapshot;
  const keys = signature.keySnapshot as unknown as KeySnapshot;

  return NextResponse.json({
    state,
    kind: signature.kind,
    accountName: signature.account.name,
    expiresAt: signature.expiresAt.toISOString(),
    signedAt: signature.signedAt ? signature.signedAt.toISOString() : null,
    signedName: signature.signedName,
    policy,
    keys,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const signature = await loadSignature(token);
  if (!signature) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const state = signatureState(signature, new Date());
  if (state === "SIGNED") {
    return NextResponse.json({ error: "Bereits unterschrieben" }, { status: 409 });
  }
  if (state === "EXPIRED") {
    return NextResponse.json({ error: "Link ist abgelaufen" }, { status: 410 });
  }

  const parsed = keySignatureSubmitSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const policy = signature.policySnapshot as unknown as PolicySnapshot;
  const keys = signature.keySnapshot as unknown as KeySnapshot;

  if (policy.liabilityText?.trim() && parsed.data.acceptedLiability !== true) {
    return NextResponse.json(
      { error: "Haftungserklärung muss bestätigt werden" },
      { status: 400 },
    );
  }

  const signedAt = new Date();
  const ip = clientIp(request.headers);

  const pdf = buildKeyProtocolPdf({
    accountName: signature.account.name,
    kind: signature.kind === "RETURN" ? "RETURN" : "HANDOVER",
    policy,
    keys,
    signedName: parsed.data.signedName.trim(),
    signedAt: signedAt.toISOString(),
    signatureImage: parsed.data.signatureImage,
    signerIp: ip,
  });

  // PDF in den Blob-Speicher (Fallback: Bytes in der Spalte `pdf`).
  const storedPdf = await storePdfColumn(signature.accountId, new Uint8Array(pdf));

  // Bedingtes Update: falls zwei Geraete gleichzeitig absenden, gewinnt das
  // erste und das zweite bekommt 409 statt eines ueberschriebenen Dokuments.
  const claimed = await prisma.keySignature.updateMany({
    where: { id: signature.id, signedAt: null },
    data: {
      signedName: parsed.data.signedName.trim(),
      signatureImage: parsed.data.signatureImage,
      signedAt,
      signerIp: ip,
      signerUserAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      ...storedPdf,
    },
  });

  if (claimed.count === 0) {
    return NextResponse.json({ error: "Bereits unterschrieben" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, signedAt: signedAt.toISOString() });
}
