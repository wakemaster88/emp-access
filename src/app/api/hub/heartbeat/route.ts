import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { writeHubAgentStatus } from "@/lib/hub-agent-status";
import { parseSentinelReport } from "@/lib/hub-sentinel";

/**
 * Heartbeat des lokalen Hubs. Auth per Account-API-Token (Bearer/`?token=`).
 * Upsert per (accountId, name); liefert die Anzahl offener Tasks zurueck,
 * damit der Hub sein Poll-Intervall dynamisch verkuerzen kann. Mit
 * Status-Teilen schreibt eine einzige Anweisung Zeile und Status
 * (`writeHubAgentStatus`).
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "hub";
  const parking =
    body.parking && typeof body.parking === "object" && !Array.isArray(body.parking)
      ? body.parking
      : undefined;

  // Systemzustand des Hub-Macs (Auto-Login, Ruhezustand, Einschaltplan).
  const system =
    body.system && typeof body.system === "object" && !Array.isArray(body.system)
      ? body.system
      : undefined;

  // Deploy-Key/Update-Zugang zum (privaten) Repo, fuer die Einstellungen.
  const repoAccess =
    body.repoAccess && typeof body.repoAccess === "object" && !Array.isArray(body.repoAccess)
      ? body.repoAccess
      : undefined;

  // Kameras, die der Waechter des Hubs gerade bewacht (lib/hub-sentinel.ts):
  // Dort meldet die Ueberwachung unbekannte Personen nicht selbst. Ein Hub
  // ohne das Feld laesst den abgelegten Stand stehen, er veraltet dann.
  const sentinel = parseSentinelReport(body.sentinel, new Date()) ?? undefined;

  // Nur die gemeldeten Teile von status ersetzen, die uebrigen (z. B. snmp
  // vom Switch-Upload, parking von der Parkmeldung) bleiben stehen.
  const statusPatch: Record<string, unknown> | undefined =
    parking || system || repoAccess || sentinel
      ? {
          ...(parking ? { parking } : {}),
          ...(system ? { system } : {}),
          ...(repoAccess ? { repoAccess } : {}),
          ...(sentinel ? { sentinel } : {}),
        }
      : undefined;

  const hostname = typeof body.hostname === "string" && body.hostname ? body.hostname : null;
  const version = typeof body.version === "string" && body.version ? body.version : null;
  const modules = body.modules ?? undefined;

  const agentId = statusPatch
    ? await writeHubAgentStatus(db, account.id, name, statusPatch, { hostname, version, modules })
    : (
        await db.hubAgent.upsert({
          where: { accountId_name: { accountId: account.id, name } },
          create: { name, hostname, version, modules, lastSeenAt: new Date(), accountId: account.id },
          update: { hostname, version, modules, lastSeenAt: new Date() },
          select: { id: true },
        })
      ).id;

  const pendingTasks = await db.hubTask.count({
    where: { accountId: account.id, status: "PENDING" },
  });

  return NextResponse.json({ ok: true, agentId, pendingTasks });
}
