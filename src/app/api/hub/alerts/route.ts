import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { diffAlerts, sanitizeReportedAlerts } from "@/lib/hub-alerts";
import { notifyOutage } from "@/lib/outage-notify";

const SOURCE_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_LINES = 12;

/**
 * POST (Hub): aktuelle Befunde einer Quelle, z. B. der Switch-Pruefung.
 * Body: { hubName?, source: "switch", alerts: [{ key, title, detail?, severity? }], keepPrefixes?: string[] }
 *
 * Die Liste ist immer vollstaendig: Was fehlt, gilt als erledigt. Neue
 * Befunde und Entwarnungen gehen gesammelt per Push und Telegram raus.
 * GET: offene Befunde (fuer UI/Diagnose).
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!SOURCE_RE.test(source)) {
    return NextResponse.json({ error: "source fehlt" }, { status: 400 });
  }
  const hubName =
    typeof body.hubName === "string" && body.hubName.trim() ? body.hubName.trim().slice(0, 80) : null;
  const reported = sanitizeReportedAlerts(body.alerts);

  const stored = await db.hubAlert.findMany({
    where: { accountId: account.id, source },
    select: { key: true, resolvedAt: true },
  });
  // Nicht abgefragte Teile (Switch stumm) gelten nicht als behoben.
  const keepPrefixes = (Array.isArray(body.keepPrefixes) ? body.keepPrefixes : [])
    .filter((p: unknown): p is string => typeof p === "string" && p.length >= 3)
    .slice(0, 50);
  const diff = diffAlerts(stored, reported);
  const { opened, still } = diff;
  const resolved = diff.resolved.filter((k) => !keepPrefixes.some((p: string) => k.startsWith(p)));
  const now = new Date();

  for (const a of opened) {
    await db.hubAlert.upsert({
      where: { accountId_key: { accountId: account.id, key: a.key } },
      create: {
        accountId: account.id,
        source,
        key: a.key,
        title: a.title,
        detail: a.detail ?? null,
        severity: a.severity ?? "warn",
        hubName,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        source,
        title: a.title,
        detail: a.detail ?? null,
        severity: a.severity ?? "warn",
        hubName,
        firstSeenAt: now,
        lastSeenAt: now,
        resolvedAt: null,
      },
    });
  }
  if (still.length > 0) {
    await db.hubAlert.updateMany({
      where: { accountId: account.id, key: { in: still.map((a) => a.key) } },
      data: { lastSeenAt: now },
    });
  }
  // Titel der erledigten Befunde fuer die Entwarnung holen, bevor sie zu sind.
  const resolvedRows =
    resolved.length > 0
      ? await db.hubAlert.findMany({
          where: { accountId: account.id, key: { in: resolved } },
          select: { title: true },
        })
      : [];
  if (resolved.length > 0) {
    await db.hubAlert.updateMany({
      where: { accountId: account.id, key: { in: resolved }, resolvedAt: null },
      data: { resolvedAt: now },
    });
  }

  const list = (lines: string[]) =>
    lines.slice(0, MAX_LINES).join("\n") + (lines.length > MAX_LINES ? `\n… und ${lines.length - MAX_LINES} weitere` : "");

  let sent = 0;
  if (opened.length > 0) {
    const single = opened.length === 1;
    const res = await notifyOutage(account.id, {
      title: single ? `⚠️ ${opened[0].title}` : `⚠️ ${opened.length} neue Befunde (Netzwerk-Prüfung)`,
      body: single
        ? opened[0].detail || "Vom Hub bei der Netzwerk-Prüfung gefunden."
        : list(opened.map((a) => `• ${a.title}`)),
      url: "/network",
      tag: `hub-alert-${source}`,
    });
    sent += res.pushed + res.telegram;
  }
  if (resolvedRows.length > 0) {
    const single = resolvedRows.length === 1;
    const res = await notifyOutage(account.id, {
      title: single ? `✅ Behoben: ${resolvedRows[0].title}` : `✅ ${resolvedRows.length} Befunde behoben`,
      body: single ? "Die Netzwerk-Prüfung findet den Fehler nicht mehr." : list(resolvedRows.map((a) => `• ${a.title}`)),
      url: "/network",
      tag: `hub-alert-${source}-ok`,
    });
    sent += res.pushed + res.telegram;
  }

  return NextResponse.json({
    ok: true,
    open: reported.length,
    opened: opened.length,
    resolved: resolved.length,
    sent,
  });
}

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const alerts = await db.hubAlert.findMany({
    where: { accountId: account.id, resolvedAt: null },
    orderBy: { firstSeenAt: "asc" },
    select: { source: true, key: true, title: true, detail: true, severity: true, firstSeenAt: true, lastSeenAt: true },
  });
  return NextResponse.json({ alerts });
}
