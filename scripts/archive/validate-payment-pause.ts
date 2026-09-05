/**
 * DRY-RUN: Validiert die Auto-Pause-Logik fuer offene Abo-Zahlungen gegen die
 * echten ANNY-Daten, OHNE etwas in der DB zu aendern. Zeigt, welche Abos der
 * naechste Sync bei aktiviertem `paymentAutoPause` pausieren bzw. reaktivieren
 * wuerde.
 *
 * Aufruf:  npx tsx scripts/validate-payment-pause.ts [graceDays]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

const graceDays = Number(process.argv[2] ?? "0");

interface OpenInv { dueDate: string | null; number: string | null; amount: number | null; overdue: boolean }

async function pageAll(apiBase: string, headers: Record<string, string>, path: string, extra: Record<string, string> = {}) {
  const out: Record<string, unknown>[] = [];
  const included: Record<string, unknown>[] = [];
  for (let n = 1; n <= 50; n++) {
    const p = new URLSearchParams({ ...extra, "page[size]": "50", "page[number]": String(n) });
    const r = await fetch(`${apiBase}/${path}?${p}`, { headers });
    if (!r.ok) break;
    const j = await r.json();
    if (Array.isArray(j.data)) out.push(...j.data);
    if (Array.isArray(j.included)) included.push(...j.included);
    if ((j?.meta?.page?.["last-page"] ?? 1) <= n) break;
  }
  return { out, included };
}

async function main() {
  const cfg = await prisma.apiConfig.findFirst({ where: { provider: "ANNY" } });
  if (!cfg) { console.log("Keine ANNY-Config"); return; }
  const apiBase = (cfg.baseUrl || "https://b.anny.co").replace(/\/+$/, "") + "/api/v1";
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.api+json" };
  console.log(`Account ${cfg.accountId}, graceDays=${graceDays}\n`);

  // 1) Abos: ps.id -> { customerId, status, name }
  const { out: subs, included: subInc } = await pageAll(apiBase, headers, "plan-subscriptions", { include: "customer" });
  const incMap = new Map<string, Record<string, unknown>>();
  for (const i of subInc) incMap.set(`${i.type}:${i.id}`, i);
  const subInfo = new Map<string, { customerId: string; status: string; name: string }>();
  for (const s of subs) {
    const a = (s.attributes ?? {}) as Record<string, unknown>;
    const rels = (s.relationships ?? {}) as Record<string, { data?: { type?: string; id?: string } }>;
    const custId = rels.customer?.data?.id ?? "";
    const cust = incMap.get(`customers:${custId}`) ?? incMap.get(`customer:${custId}`);
    const cn = ((cust?.attributes ?? {}) as Record<string, unknown>).full_name as string | undefined;
    subInfo.set(String(s.id), { customerId: String(custId), status: String(a.status ?? ""), name: cn ?? "" });
  }

  // 2) offene/ueberfaellige Abo-Rechnungen
  const cutoff = Date.now() - Math.max(0, graceDays) * 86400000;
  const { out: invs } = await pageAll(apiBase, headers, "invoices", { include: "reference" });
  const open = new Map<string, OpenInv>();
  for (const inv of invs) {
    const a = (inv.attributes ?? {}) as Record<string, unknown>;
    if (String(a.status ?? "").toLowerCase() !== "sent") continue;
    const rels = (inv.relationships ?? {}) as Record<string, { data?: { type?: string; id?: string } }>;
    const ref = rels.reference?.data;
    if (!ref || ref.type !== "plan-subscriptions" || !ref.id) continue;
    const due = a.due_date ? String(a.due_date) : null;
    const dueMs = due ? Date.parse(due) : NaN;
    const overdue = Number.isFinite(dueMs) ? dueMs < cutoff : false;
    const entry: OpenInv = { dueDate: due, number: (a.formatted_number as string) ?? null, amount: typeof a.total === "number" ? a.total : null, overdue };
    const prev = open.get(String(ref.id));
    if (!prev || (entry.dueDate && prev.dueDate && entry.dueDate < prev.dueDate)) open.set(String(ref.id), entry);
  }
  const overdueSubs = [...open.entries()].filter(([, v]) => v.overdue);
  console.log(`Offene Abo-Rechnungen: ${open.size}, davon ueberfaellig: ${overdueSubs.length}\n`);

  // 3) lokale Tickets laden
  const tickets = await prisma.ticket.findMany({
    where: { accountId: cfg.accountId, uuid: { startsWith: "anny-sub:" } },
    select: { uuid: true, status: true, name: true, extras: true, endDate: true },
  });
  const byUuid = new Map(tickets.map((t) => [t.uuid!, t]));

  // 4a) Wuerde pausieren
  console.log("=== WUERDE PAUSIEREN (ueberfaellige Zahlung, lokal aktiv) ===");
  let wouldPause = 0, alreadyPaused = 0, notActive = 0, noTicket = 0;
  for (const [subId, inv] of overdueSubs) {
    const info = subInfo.get(subId);
    if (!info) { console.log(`  ${subId}: kein Abo-Objekt`); continue; }
    const uuid = `anny-sub:${info.customerId}:${subId}`;
    const t = byUuid.get(uuid);
    const dueDays = inv.dueDate ? Math.floor((Date.now() - Date.parse(inv.dueDate)) / 86400000) : null;
    if (!t) { noTicket++; console.log(`  [kein Ticket] ${info.name} (${uuid}) faellig vor ${dueDays}d, ${inv.amount}€ ${inv.number ?? ""}`); continue; }
    const annyActive = info.status.toLowerCase() === "active" || info.status.toLowerCase() === "trialing";
    if (!annyActive) { notActive++; console.log(`  [ANNY ${info.status}] ${t.name} -> kein Override`); continue; }
    if (t.status === "PAUSED") { alreadyPaused++; console.log(`  [schon PAUSED] ${t.name} faellig vor ${dueDays}d`); continue; }
    if (t.status === "VALID") { wouldPause++; console.log(`  -> PAUSE: ${t.name} faellig vor ${dueDays}d, ${inv.amount}€ ${inv.number ?? ""}`); continue; }
    console.log(`  [status ${t.status}] ${t.name} -> kein Override`);
  }

  // 4b) Wuerde reaktivieren: lokal paymentPause gesetzt, aber keine ueberfaellige Rechnung mehr
  console.log("\n=== WUERDE REAKTIVIEREN (Zahlungs-Pause, aber keine ueberfaellige Rechnung mehr) ===");
  const overdueSet = new Set(overdueSubs.map(([id]) => id));
  let wouldResume = 0;
  for (const t of tickets) {
    const ex = (t.extras as Record<string, unknown> | null) ?? {};
    if (!ex.paymentPause) continue;
    const subId = t.uuid!.split(":").slice(2).join(":");
    if (!overdueSet.has(subId)) { wouldResume++; console.log(`  -> REAKTIVIEREN: ${t.name} (${t.uuid}) status=${t.status}`); }
    else console.log(`  [bleibt PAUSED] ${t.name} (noch ueberfaellig)`);
  }

  console.log(`\nZusammenfassung: pause=${wouldPause}, schonPaused=${alreadyPaused}, reaktivieren=${wouldResume}, ANNY-nicht-aktiv=${notActive}, ohne-Ticket=${noTicket}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
