import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { gardenaListValves } from "@/lib/gardena";

// Zugangsdaten liegen in ApiConfig (provider = GARDENA):
//   token       = Application Key (client_id / X-Api-Key)
//   extraConfig = Application Secret (client_secret)

// Ventile/Pumpen mit gespeicherten Zugangsdaten listen (kein Key im Request).
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "GARDENA" },
  });

  if (!config?.token || !config?.extraConfig) {
    return NextResponse.json({ error: "Keine GARDENA Verbindung gespeichert" }, { status: 404 });
  }

  const res = await gardenaListValves(config.token, config.extraConfig);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error ?? "GARDENA Anfrage fehlgeschlagen" },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    );
  }
  return NextResponse.json({ ok: true, valves: res.valves });
}

// Verbindung testen mit uebergebenen Zugangsdaten (Key + Secret).
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { applicationKey, applicationSecret } = body as {
    applicationKey?: string;
    applicationSecret?: string;
  };

  if (!applicationKey?.trim() || !applicationSecret?.trim()) {
    return NextResponse.json(
      { error: "Application Key und Application Secret erforderlich" },
      { status: 400 },
    );
  }

  const res = await gardenaListValves(applicationKey.trim(), applicationSecret.trim());
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? "Ungültige Zugangsdaten – Application Key/Secret prüfen und sicherstellen, dass die GARDENA smart system API mit deiner Anwendung verbunden ist."
        : res.error ?? "Verbindung fehlgeschlagen";
    return NextResponse.json({ error: msg }, { status: res.status === 401 || res.status === 403 ? 401 : 502 });
  }

  return NextResponse.json({ ok: true, valves: res.valves });
}

// Zugangsdaten in ApiConfig speichern.
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { applicationKey, applicationSecret } = body as {
    applicationKey?: string;
    applicationSecret?: string;
  };

  if (!applicationKey?.trim() || !applicationSecret?.trim()) {
    return NextResponse.json(
      { error: "Application Key und Application Secret erforderlich" },
      { status: 400 },
    );
  }

  const { db, accountId } = session;
  const existing = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "GARDENA" },
  });

  if (existing) {
    const updated = await db.apiConfig.update({
      where: { id: existing.id },
      data: {
        token: applicationKey.trim(),
        extraConfig: applicationSecret.trim(),
        lastUpdate: new Date(),
      },
    });
    return NextResponse.json(updated);
  }

  const created = await db.apiConfig.create({
    data: {
      accountId: accountId!,
      provider: "GARDENA",
      token: applicationKey.trim(),
      extraConfig: applicationSecret.trim(),
    },
  });
  return NextResponse.json(created);
}

// Einzelnes Ventil/Pumpe als Device importieren (Upsert ueber gardenaServiceId).
export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { serviceId, name } = body as { serviceId?: string; name?: string };

  if (!serviceId || !name) {
    return NextResponse.json({ error: "serviceId und name erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;

  const existing = await db.device.findFirst({
    where: { accountId: accountId!, gardenaServiceId: serviceId },
  });

  let device;
  if (existing) {
    device = await db.device.update({
      where: { id: existing.id },
      data: { name },
    });
  } else {
    device = await db.device.create({
      data: {
        name,
        type: "GARDENA_VALVE",
        category: "SCHALTER",
        gardenaServiceId: serviceId,
        isActive: true,
        accountId: accountId!,
      },
    });
  }

  return NextResponse.json(device, { status: existing ? 200 : 201 });
}

// GARDENA Verbindung trennen (Zugangsdaten entfernen).
export async function DELETE() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  await db.apiConfig.deleteMany({ where: { accountId: accountId!, provider: "GARDENA" } });
  return NextResponse.json({ ok: true });
}
