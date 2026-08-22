import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * POST (Hub): Parkplatz-Kamera aus der Kiosk-Config in die Cloud übernehmen,
 * falls sie dort noch fehlt (z. B. neue Halle auf anderer IP).
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const host = String(body.host ?? "").trim();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const requestedName = String(body.name ?? "").trim();
  if (!host || !username || !password) {
    return NextResponse.json({ error: "host, username, password erforderlich" }, { status: 400 });
  }

  const existing = await db.camera.findFirst({
    where: { accountId: account.id, host },
    select: { id: true, name: true, host: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, created: false, camera: existing });
  }

  const base = requestedName
    ? /^kamera\s/i.test(requestedName)
      ? requestedName
      : `Kamera ${requestedName}`
    : "Kamera Halle";
  const taken = new Set(
    (
      await db.camera.findMany({
        where: { accountId: account.id },
        select: { name: true },
      })
    ).map((c) => c.name),
  );
  let name = base;
  let n = 2;
  while (taken.has(name)) {
    name = `${base} ${n}`;
    n += 1;
  }

  const camera = await db.camera.create({
    data: {
      name,
      kind: body.kind === "DOORBIRD" ? "DOORBIRD" : "REOLINK",
      host,
      httpPort: Number.isInteger(Number(body.httpPort)) && Number(body.httpPort) > 0 ? Number(body.httpPort) : 80,
      https: body.https === true,
      username,
      password,
      channel: Number.isInteger(Number(body.channel)) && Number(body.channel) >= 0 ? Number(body.channel) : 0,
      enabled: true,
      vehicleDetection: false,
      notes: "Parkfläche (Hub-Kiosk)",
      accountId: account.id,
    },
    select: { id: true, name: true, host: true },
  });

  return NextResponse.json({ ok: true, created: true, camera }, { status: 201 });
}
