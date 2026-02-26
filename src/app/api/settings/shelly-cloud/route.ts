import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

// Fetch Shelly device list using saved credentials (no key required in request)
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  if (!config?.token || !config?.baseUrl) {
    return NextResponse.json({ error: "Keine Shelly Cloud Verbindung gespeichert" }, { status: 404 });
  }

  const cleanServer = config.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const baseUrl = `https://${cleanServer}`;
  const trimmedKey = config.token.trim();

  try {
    const res = await fetch(`${baseUrl}/interface/device/list`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ auth_key: trimmedKey }),
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }

    if (!res.ok || !data.isok) {
      return NextResponse.json({ error: "Shelly Cloud Anfrage fehlgeschlagen" }, { status: 502 });
    }

    type ShellyApiDevice = { name?: string; ip?: string; cloud_online?: boolean; type?: string };
    const rawDevices = (data as { data?: { devices?: Record<string, ShellyApiDevice> } }).data?.devices ?? {};

    const devices = Object.entries(rawDevices).map(([id, dev]) => ({
      id,
      type: dev.type ?? "unknown",
      name: dev.name ?? id,
      online: dev.cloud_online ?? false,
      ip: dev.ip,
    }));

    return NextResponse.json({ ok: true, devices, server: config.baseUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Verbindungsfehler" }, { status: 502 });
  }
}

export interface ShellyCloudDevice {
  id: string;
  type: string;
  name: string;
  online: boolean;
  ip?: string;
}

// Test connection and list Shelly Cloud devices
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { server, authKey } = body as { server: string; authKey: string };

  if (!server || !authKey) {
    return NextResponse.json({ error: "Server und Auth Key erforderlich" }, { status: 400 });
  }

  const cleanServer = server.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const baseUrl = `https://${cleanServer}`;
  const trimmedKey = authKey.trim();

  // Shelly Cloud Gen1 API – try both known endpoints
  const endpoints = [
    `${baseUrl}/interface/device/list`,
    `${baseUrl}/device/all_status`,
  ];

  let lastError = "";

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ auth_key: trimmedKey }),
        signal: AbortSignal.timeout(10000),
      });

      // Read body regardless of status
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* non-JSON response */ }

      if (!res.ok) {
        // Try to extract a meaningful error from the body
        const bodyError = (data as { errors?: { auth_key?: string }; error?: string }).errors?.auth_key
          ?? (data as { error?: string }).error
          ?? text.slice(0, 200);
        lastError = `HTTP ${res.status}${bodyError ? `: ${bodyError}` : ""}`;
        continue; // try next endpoint
      }

      if (!data.isok) {
        const errMsg = (data as { errors?: { auth_key?: string } }).errors?.auth_key ?? "Ungültiger Auth Key – bitte in Shelly Cloud unter User Settings → Security → Auth Cloud Key prüfen";
        return NextResponse.json({ error: errMsg }, { status: 401 });
      }

      // Parse devices – Shelly Cloud returns everything in data.devices,
      // with cloud_online per device (no separate devices_status)
      type ShellyApiDevice = {
        id?: string;
        type?: string;
        name?: string;
        cloud_online?: boolean;
        ip?: string;
        channel?: number;
        channels_count?: number;
        gen?: number;
      };
      const rawDevices = (data as { data?: { devices?: Record<string, ShellyApiDevice> } }).data?.devices ?? {};

      const devices: ShellyCloudDevice[] = Object.entries(rawDevices).map(([id, dev]) => ({
        id,
        type: dev.type ?? "unknown",
        name: dev.name ?? id,
        online: dev.cloud_online ?? false,
        ip: dev.ip,
      }));

      return NextResponse.json({ ok: true, devices });
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Verbindung fehlgeschlagen";
    }
  }

  return NextResponse.json(
    { error: `Verbindung zu ${cleanServer} fehlgeschlagen: ${lastError}` },
    { status: 502 }
  );
}

// Save Shelly Cloud credentials to ApiConfig
export async function PUT(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { server, authKey } = body as { server: string; authKey: string };

  const { db, accountId } = session;

  const existing = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  if (existing) {
    const updated = await db.apiConfig.update({
      where: { id: existing.id },
      data: { token: authKey, baseUrl: server, lastUpdate: new Date() },
    });
    return NextResponse.json(updated);
  }

  const config = await db.apiConfig.create({
    data: {
      accountId: accountId!,
      provider: "SHELLY",
      token: authKey,
      baseUrl: server,
    },
  });
  return NextResponse.json(config);
}

// Import a single Shelly Cloud device OR sync names of all imported devices
export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const { db, accountId } = session;

  // --- Bulk name sync: { sync: true } ---
  if ((body as { sync?: boolean }).sync) {
    const config = await db.apiConfig.findFirst({
      where: { accountId: accountId!, provider: "SHELLY" },
    });

    if (!config?.token || !config?.baseUrl) {
      return NextResponse.json({ error: "Keine Shelly Cloud Verbindung gespeichert" }, { status: 400 });
    }

    const cleanServer = config.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const baseUrl = `https://${cleanServer}`;
    const trimmedKey = config.token.trim();

    // Fetch current device list from Shelly Cloud
    const res = await fetch(`${baseUrl}/interface/device/list`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ auth_key: trimmedKey }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Shelly Cloud antwortet nicht (HTTP ${res.status})` }, { status: 502 });
    }

    const data = await res.json() as {
      isok: boolean;
      data?: { devices?: Record<string, { name?: string; ip?: string; cloud_online?: boolean }> };
    };

    if (!data.isok) {
      return NextResponse.json({ error: "Ungültiger Auth Key" }, { status: 401 });
    }

    const cloudDevices = data.data?.devices ?? {};

    // Find all local Shelly devices for this account
    const localDevices = await db.device.findMany({
      where: { accountId: accountId!, type: "SHELLY", shellyId: { not: null } },
    });

    let updated = 0;
    for (const local of localDevices) {
      const cloud = cloudDevices[local.shellyId!];
      if (!cloud) continue;

      const newName = cloud.name ?? local.name;
      const newIp = cloud.ip ?? local.ipAddress ?? null;

      if (newName !== local.name || newIp !== local.ipAddress) {
        await db.device.update({
          where: { id: local.id },
          data: { name: newName, ipAddress: newIp },
        });
        updated++;
      }
    }

    return NextResponse.json({ ok: true, updated });
  }

  // --- Import single device: { shellyId, name, ip } ---
  const { shellyId, name, ip } = body as { shellyId: string; name: string; ip?: string };

  if (!shellyId || !name) {
    return NextResponse.json({ error: "shellyId und name erforderlich" }, { status: 400 });
  }

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  // Upsert: update existing device with same shellyId, otherwise create
  const existing = await db.device.findFirst({
    where: { accountId: accountId!, shellyId },
  });

  let device;
  if (existing) {
    device = await db.device.update({
      where: { id: existing.id },
      data: {
        name,
        ipAddress: ip ?? existing.ipAddress,
        shellyAuthKey: config?.token ?? existing.shellyAuthKey,
      },
    });
  } else {
    device = await db.device.create({
      data: {
        name,
        type: "SHELLY",
        shellyId,
        shellyAuthKey: config?.token ?? null,
        ipAddress: ip ?? null,
        isActive: true,
        accountId: accountId!,
      },
    });
  }

  return NextResponse.json(device, { status: existing ? 200 : 201 });
}

// Delete Shelly Cloud config
export async function DELETE() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  await db.apiConfig.deleteMany({ where: { accountId: accountId!, provider: "SHELLY" } });
  return NextResponse.json({ ok: true });
}
