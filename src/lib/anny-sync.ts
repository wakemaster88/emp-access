import { prisma } from "@/lib/prisma";
import { extractAnnyBookingScanCode } from "@/lib/anny-booking-scan-code";
import { normalizeAnnyBookingsResponse } from "@/lib/anny-jsonapi";
import type { AnnyBooking } from "@/lib/anny-types";

const DEFAULT_BASE_URL = "https://b.anny.co";
const SYNC_WINDOW_DAYS = 60;

interface BookingEntry {
  id: string;
  start: string | null;
  end: string | null;
  status: string | null;
}

interface TicketExtra {
  name: string;
  quantity: number;
}

interface BookingGroup {
  key: string;
  entries: BookingEntry[];
  bookingNumber: string | null;
  scanCode: string | null;
  customerName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  birthDate: Date | null;
  serviceName: string | null;
  resourceName: string | null;
  subscriptionName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  statuses: string[];
  extras: TicketExtra[];
}

interface AnnyMapping {
  mappings?: Record<string, number>;
  services?: string[];
  resources?: string[];
  subscriptions?: string[];
  resourceIds?: Record<string, string>;
  /// Auto-Pause bei offener/ueberfaelliger Abo-Zahlung. Wenn aktiv, werden Abos
  /// mit einer noch nicht beglichenen (`sent`) Abo-Rechnung, deren Faelligkeit
  /// (`due_date`) um >= `graceDays` ueberschritten ist, automatisch auf PAUSED
  /// gesetzt (Zutritt gesperrt) und mit einem "Zahlung offen"-Vermerk markiert.
  /// Sobald die Rechnung beglichen ist (Abo wieder ohne offene Rechnung), wird
  /// das Abo automatisch reaktiviert. Default: aus.
  paymentAutoPause?: {
    enabled?: boolean;
    /// Karenztage nach Faelligkeit, bevor gesperrt wird. 0 = ab Faelligkeit.
    graceDays?: number;
  };
}

/// Infos zu einer offenen (unbezahlten) Abo-Rechnung, gemappt je Abo-ID.
interface OpenSubInvoice {
  invoiceId: string;
  number: string | null;
  amount: number | null;
  currency: string | null;
  dueDate: string | null;
  /// true, wenn `due_date` um >= graceDays ueberschritten ist.
  overdue: boolean;
}

interface PlanSubscription {
  id?: string;
  name?: string;
  status?: string;
  starts_at?: string;
  ends_at?: string;
  contract_ends_at?: string;
  minimum_contract_months?: number;
  minimum_contract_period?: number;
  plan?: {
    id?: string;
    name?: string;
    title?: string;
    interval?: string;
    interval_count?: number;
    minimum_contract_months?: number;
    minimum_contract_period?: number;
    duration_months?: number;
  };
  customer?: {
    id?: string | number;
    full_name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    birth_date?: string;
  };
}

export interface AnnySyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails?: string[];
  invalidated: number;
  total: number;
  oldSkipped: number;
  syncWindowDays: number;
  pages: number;
  groups: number;
  resources: number;
  services: number;
  subscriptions: number;
  planSubscriptions: number;
  planSubscriptionsCreated: number;
  planSubscriptionsUpdated: number;
  unmapped: { annyName: string; count: number; customerSample: string[] }[];
}

function extractExtras(booking: AnnyBooking): TicketExtra[] {
  // ANNY benennt zugebuchte Artikel (Neoprenanzug, Flex-Option, …) je nach
  // Endpoint/Webhook unterschiedlich. Wir sammeln aus allen bekannten Quellen
  // und deduplizieren über den Namen.
  const sources: (AnnyBooking[keyof AnnyBooking] | undefined)[] = [
    booking.line_items,
    booking.products,
    booking.extras,
    booking.add_ons,
    booking.addOns,
    booking.addons,
    booking.modifications,
    booking.modifiers,
    booking.additional_services,
    booking.additionalServices,
    booking.order?.add_ons,
    booking.order?.addOns,
    booking.order?.modifications,
    booking.order?.line_items,
  ];

  const byName = new Map<string, TicketExtra>();
  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const item of src) {
      const name = item.name ?? item.title ?? item.product?.name ?? item.product?.title;
      if (!name) continue;
      const qty = item.quantity ?? 1;
      const existing = byName.get(name);
      if (existing) {
        existing.quantity = Math.max(existing.quantity, qty);
      } else {
        byName.set(name, { name, quantity: qty });
      }
    }
  }
  return [...byName.values()];
}

function mapGroupStatus(statuses: string[]): "VALID" | "INVALID" | "REDEEMED" {
  if (statuses.length === 0) return "VALID";
  const normalized = statuses.map((s) => s.toLowerCase());
  const allCancelled = normalized.every((s) =>
    s === "cancelled" || s === "canceled" || s === "rejected" || s === "no_show"
  );
  if (allCancelled) return "INVALID";
  const allDone = normalized.every((s) =>
    s === "checked_out" || s === "completed" || s === "cancelled" || s === "canceled"
  );
  if (allDone) return "REDEEMED";
  return "VALID";
}

function parseDurationMonthsFromName(name: string | null): number | null {
  if (!name) return null;
  const match = name.match(/(\d+)\s*M(?:\b|$)/i);
  if (match) return parseInt(match[1], 10);
  const yearMatch = name.match(/(\d+)\s*(?:Jahr|year)/i);
  if (yearMatch) return parseInt(yearMatch[1], 10) * 12;
  return null;
}

function calcSubscriptionEndDate(
  ps: PlanSubscription,
  startDate: Date | null,
  planName: string | null,
  subscriptionId: number | null,
  subDefaultEndDate: Map<number, Date | null>,
): Date | null {
  if (ps.contract_ends_at) return new Date(ps.contract_ends_at);

  const contractMonths =
    ps.minimum_contract_months ??
    ps.minimum_contract_period ??
    ps.plan?.minimum_contract_months ??
    ps.plan?.minimum_contract_period ??
    ps.plan?.duration_months ??
    null;

  if (contractMonths && startDate) {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + contractMonths);
    return end;
  }

  const nameMonths = parseDurationMonthsFromName(planName) ?? parseDurationMonthsFromName(ps.plan?.name ?? ps.plan?.title ?? null);
  if (nameMonths && startDate) {
    const end = new Date(startDate);
    end.setMonth(end.getMonth() + nameMonths);
    return end;
  }

  if (subscriptionId != null) {
    const defEnd = subDefaultEndDate.get(subscriptionId);
    if (defEnd) return defEnd;
  }

  if (ps.ends_at) return new Date(ps.ends_at);
  return null;
}

function ticketChanged(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  incoming: Record<string, any>,
): boolean {
  const keys = ["name", "firstName", "lastName", "email", "ticketTypeName", "barcode",
    "status", "accessAreaId", "subscriptionId", "serviceId", "qrCode"];
  for (const k of keys) {
    if ((incoming[k] ?? null) !== (existing[k] ?? null)) return true;
  }
  const eStart = existing.startDate ? new Date(existing.startDate).getTime() : null;
  const iStart = incoming.startDate ? new Date(incoming.startDate).getTime() : null;
  if (eStart !== iStart) return true;
  const eEnd = existing.endDate ? new Date(existing.endDate).getTime() : null;
  const iEnd = incoming.endDate ? new Date(incoming.endDate).getTime() : null;
  if (eEnd !== iEnd) return true;
  return false;
}

/** Stabiler (key-order-unabhaengiger) Vergleich zweier extras-JSON-Objekte.
 *  Wird genutzt, um unnoetige Updates bei gleichbleibenden Zahlungs-/Pause-
 *  Flags zu vermeiden. */
function extrasEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = norm((v as Record<string, unknown>)[k]);
      }
      return sorted;
    }
    return v;
  };
  return JSON.stringify(norm(a ?? {})) === JSON.stringify(norm(b ?? {}));
}

/** Versucht beim P2002 (barcode unique) den barcode dem alten INVALID/CANCELED
 *  Konflikt-Ticket wegzunehmen. Verhindert, dass eine veraltete Orphan-Reservierung
 *  einen Barcode dauerhaft blockiert (sonst landet das aktive Ticket immer wieder
 *  mit barcode=null und wird beim naechsten Sync wieder als "changed" erkannt). */
async function freeConflictingBarcode(
  accountId: number,
  excludeTicketId: number | null,
  barcode: string,
): Promise<boolean> {
  const conflict = await prisma.ticket.findFirst({
    where: { accountId, barcode, ...(excludeTicketId != null ? { NOT: { id: excludeTicketId } } : {}) },
    select: { id: true, status: true },
  });
  if (!conflict) return false;
  if (conflict.status === "INVALID" || conflict.status === "CANCELED") {
    await prisma.ticket.update({ where: { id: conflict.id }, data: { barcode: null } });
    return true;
  }
  return false;
}

async function createTicketSafe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticketData: any,
  uuid: string,
  accountId: number,
) {
  try {
    return await prisma.ticket.create({ data: { ...ticketData, uuid, accountId } });
  } catch (e: unknown) {
    const isPrismaUnique =
      e != null &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2002";
    if (isPrismaUnique) {
      // Bevor wir den barcode opfern: pruefen ob das blockierende Ticket
      // eh INVALID/CANCELED ist - dann steal'n wir den barcode dort weg.
      if (ticketData.barcode) {
        const freed = await freeConflictingBarcode(accountId, null, ticketData.barcode);
        if (freed) {
          try {
            return await prisma.ticket.create({ data: { ...ticketData, uuid, accountId } });
          } catch { /* fall through to barcode: null */ }
        }
      }
      console.warn(`[anny sync] barcode conflict uuid=${uuid}, retrying without barcode`);
      return await prisma.ticket.create({ data: { ...ticketData, barcode: null, uuid, accountId } });
    }
    throw e;
  }
}

export async function syncAnnyForAccount(accountId: number): Promise<AnnySyncResult> {
  const config = await prisma.apiConfig.findFirst({
    where: { accountId, provider: "ANNY" },
  });

  if (!config) {
    throw new Error("anny.co nicht konfiguriert");
  }

  const baseUrl = config.baseUrl?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const apiBase = `${baseUrl}/api/v1`;

  const syncCutoff = new Date();
  syncCutoff.setDate(syncCutoff.getDate() - SYNC_WINDOW_DAYS);
  syncCutoff.setHours(0, 0, 0, 0);

  // Mit Accept: application/vnd.api+json bekommen wir konsistent JSON:API mit
  // `meta.page.total` / `last-page` zurueck. Wichtig, weil wir dadurch Pages
  // parallel statt sequenziell holen koennen und nicht mehr "page-by-page
  // probieren" muessen.
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/vnd.api+json",
  };

  /** Liest ein einfaches Listen-Endpoint (resources/services/plans/...) komplett aus,
   *  parallel ab Page 2 wenn `meta.page.last-page` bekannt ist. Liefert die
   *  flatten'd Attribute (id, name, attributes inline).
   *
   *  WICHTIG: ANNYs /services, /resources, /plans erzwingen `page[size]` ≤ 50
   *  (400-Error sonst). /bookings erlaubt 500. Default 50 deckt die schmaleren
   *  Endpoints ab; bookings ueberschreibt explizit. */
  async function fetchAllPages(
    path: string,
    extra: Record<string, string> = {},
    pageSize = 50,
    pageLimit = 25,
  ): Promise<Record<string, unknown>[]> {
    const buildUrl = (n: number) => {
      const p = new URLSearchParams({ ...extra, "page[size]": String(pageSize), "page[number]": String(n) });
      return `${apiBase}/${path}?${p}`;
    };
    const first = await fetch(buildUrl(1), { headers, signal: AbortSignal.timeout(15000) });
    if (!first.ok) {
      if (first.status === 404) return [];
      const body = await first.text().catch(() => "");
      throw new Error(`anny.co /${path} ${first.status}: ${body.slice(0, 200)}`);
    }
    const firstJson = await first.json();
    const items: Record<string, unknown>[] = Array.isArray(firstJson?.data) ? firstJson.data : Array.isArray(firstJson) ? firstJson : [];
    const lastPage: number = firstJson?.meta?.page?.["last-page"] ?? 1;
    if (lastPage > 1) {
      const remaining = [];
      const cap = Math.min(lastPage, pageLimit);
      for (let n = 2; n <= cap; n++) remaining.push(n);
      const responses = await Promise.all(
        remaining.map((n) =>
          fetch(buildUrl(n), { headers, signal: AbortSignal.timeout(15000) }).then((r) => r.ok ? r.json() : null),
        ),
      );
      for (const j of responses) {
        if (!j) continue;
        const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        items.push(...arr);
      }
    }
    return items;
  }

  /** JSON:API-Resource zu flachem Object machen (attributes + id inline). */
  function flattenResource(r: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (r.attributes && typeof r.attributes === "object") Object.assign(out, r.attributes as Record<string, unknown>);
    if (r.id != null) out.id = r.id;
    return out;
  }

  /** Liest plan-subscriptions inkl. `included` (customer/plan) und resolved die
   *  Relationships zu eingebetteten Sub-Objekten. fetchAllPages reicht nicht,
   *  weil dort `included` verworfen wird. */
  async function fetchAllPlanSubscriptions(): Promise<PlanSubscription[]> {
    // ANNY-Limit: page[size] <= 50 fuer /plan-subscriptions (wie /services).
    const pageSize = 50;
    const pageLimit = 50;
    const extra = { include: "customer,plan" };
    const buildUrl = (n: number) => {
      const p = new URLSearchParams({ ...extra, "page[size]": String(pageSize), "page[number]": String(n) });
      return `${apiBase}/plan-subscriptions?${p}`;
    };

    const firstRes = await fetch(buildUrl(1), { headers, signal: AbortSignal.timeout(15000) });
    if (!firstRes.ok) {
      if (firstRes.status === 404) return [];
      return [];
    }
    const firstJson = await firstRes.json();
    const lastPage: number = firstJson?.meta?.page?.["last-page"] ?? 1;

    const allData: Record<string, unknown>[] = Array.isArray(firstJson?.data) ? firstJson.data : [];
    const allIncluded: Record<string, unknown>[] = Array.isArray(firstJson?.included) ? firstJson.included : [];

    if (lastPage > 1) {
      const remaining: number[] = [];
      const cap = Math.min(lastPage, pageLimit);
      for (let n = 2; n <= cap; n++) remaining.push(n);
      const responses = await Promise.all(
        remaining.map((n) =>
          fetch(buildUrl(n), { headers, signal: AbortSignal.timeout(15000) }).then((r) => r.ok ? r.json() : null),
        ),
      );
      for (const j of responses) {
        if (!j) continue;
        if (Array.isArray(j.data)) allData.push(...j.data);
        if (Array.isArray(j.included)) allIncluded.push(...j.included);
      }
    }

    // Lookup-Map "type:id" -> resource
    const incMap = new Map<string, Record<string, unknown>>();
    for (const inc of allIncluded) {
      const t = String(inc.type ?? "");
      const id = inc.id != null ? String(inc.id) : "";
      if (t && id) incMap.set(`${t}:${id}`, inc);
    }

    const resolved: PlanSubscription[] = [];
    for (const raw of allData) {
      const attrs = (raw.attributes ?? {}) as Record<string, unknown>;
      const rels = (raw.relationships ?? {}) as Record<string, { data?: { type?: string; id?: string } }>;

      const ps: PlanSubscription = { ...(attrs as Record<string, unknown>), id: raw.id != null ? String(raw.id) : undefined };

      const custRef = rels.customer?.data;
      if (custRef?.type && custRef.id) {
        const inc = incMap.get(`${custRef.type}:${custRef.id}`);
        if (inc) {
          const cAttr = (inc.attributes ?? {}) as Record<string, unknown>;
          ps.customer = { ...(cAttr as Record<string, unknown>), id: custRef.id } as PlanSubscription["customer"];
        } else {
          ps.customer = { id: custRef.id };
        }
      }

      const planRef = rels.plan?.data;
      if (planRef?.type && planRef.id) {
        const inc = incMap.get(`${planRef.type}:${planRef.id}`);
        if (inc) {
          const pAttr = (inc.attributes ?? {}) as Record<string, unknown>;
          ps.plan = { ...(pAttr as Record<string, unknown>), id: planRef.id } as PlanSubscription["plan"];
        } else {
          ps.plan = { id: planRef.id };
        }
      }

      resolved.push(ps);
    }
    return resolved;
  }

  /** Liest /invoices und liefert je Abo-ID die offene (unbezahlte) Rechnung.
   *  "Offen" = Invoice-Status `sent` (finalisiert + versendet, aber nicht
   *  `paid`). Nur Rechnungen, deren `reference` auf eine `plan-subscriptions`
   *  zeigt, sind relevant (Einmal-/Buchungsrechnungen ignorieren wir).
   *  `due_date` wird gegen jetzt - graceDays geprueft, um `overdue` zu setzen.
   *  Bei mehreren offenen Rechnungen pro Abo gewinnt die mit der fruehesten
   *  Faelligkeit (die "aelteste Schuld"). */
  async function fetchOpenSubscriptionInvoices(graceDays: number): Promise<Map<string, OpenSubInvoice>> {
    const pageSize = 50;
    const pageLimit = 50;
    const buildUrl = (n: number) => {
      const p = new URLSearchParams({ include: "reference", "page[size]": String(pageSize), "page[number]": String(n) });
      return `${apiBase}/invoices?${p}`;
    };
    const firstRes = await fetch(buildUrl(1), { headers, signal: AbortSignal.timeout(15000) });
    if (!firstRes.ok) return new Map();
    const firstJson = await firstRes.json();
    const lastPage: number = firstJson?.meta?.page?.["last-page"] ?? 1;
    const all: Record<string, unknown>[] = Array.isArray(firstJson?.data) ? firstJson.data : [];
    if (lastPage > 1) {
      const remaining: number[] = [];
      const cap = Math.min(lastPage, pageLimit);
      for (let n = 2; n <= cap; n++) remaining.push(n);
      const responses = await Promise.all(
        remaining.map((n) =>
          fetch(buildUrl(n), { headers, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)),
        ),
      );
      for (const j of responses) {
        if (j && Array.isArray(j.data)) all.push(...j.data);
      }
    }

    const graceMs = Math.max(0, graceDays) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - graceMs;
    const out = new Map<string, OpenSubInvoice>();
    for (const inv of all) {
      const a = (inv.attributes ?? {}) as Record<string, unknown>;
      const status = String(a.status ?? "").toLowerCase();
      // Nur finalisierte, aber unbezahlte Rechnungen. `paid`/`refunded`/`void`
      // sind erledigt, `draft` ist noch nicht gestellt.
      if (status !== "sent") continue;
      const rels = (inv.relationships ?? {}) as Record<string, { data?: { type?: string; id?: string } }>;
      const ref = rels.reference?.data;
      if (!ref || ref.type !== "plan-subscriptions" || !ref.id) continue;
      const subId = String(ref.id);
      const dueRaw = a.due_date ? String(a.due_date) : null;
      const dueMs = dueRaw ? Date.parse(dueRaw) : NaN;
      const overdue = Number.isFinite(dueMs) ? dueMs < cutoff : false;
      const entry: OpenSubInvoice = {
        invoiceId: inv.id != null ? String(inv.id) : "",
        number: (a.formatted_number as string) ?? (a.number as string) ?? null,
        amount: typeof a.total === "number" ? a.total : null,
        currency: (a.currency as string) ?? null,
        dueDate: dueRaw,
        overdue,
      };
      const prev = out.get(subId);
      // Frueheste Faelligkeit gewinnt (aelteste offene Schuld).
      if (!prev || (entry.dueDate && prev.dueDate && entry.dueDate < prev.dueDate) || (entry.dueDate && !prev.dueDate)) {
        out.set(subId, entry);
      }
    }
    return out;
  }

  // --- Bookings: page[size]=500 + parallel pages ---

  const bookingsExtra = { include: "customer,resource,service" };
  const firstBookingsRes = await fetch(
    `${apiBase}/bookings?` + new URLSearchParams({ ...bookingsExtra, "page[size]": "500", "page[number]": "1" }),
    { headers, signal: AbortSignal.timeout(20000) },
  );
  if (!firstBookingsRes.ok) {
    const body = await firstBookingsRes.text().catch(() => "");
    throw new Error(`anny.co API Fehler: ${firstBookingsRes.status} – ${body.slice(0, 300)}`);
  }
  const firstBookingsJson = await firstBookingsRes.json();
  const firstBookings = normalizeAnnyBookingsResponse(firstBookingsJson);
  const lastBookingPage: number = firstBookingsJson?.meta?.page?.["last-page"] ?? 1;
  const totalBookingsReported: number | undefined = firstBookingsJson?.meta?.page?.total;

  const allBookings: AnnyBooking[] = [];
  let oldSkipped = 0;
  const accumulate = (bs: AnnyBooking[]) => {
    for (const b of bs) {
      if (b.start_date && new Date(b.start_date) < syncCutoff) oldSkipped++;
      else allBookings.push(b);
    }
  };
  accumulate(firstBookings);

  if (lastBookingPage > 1) {
    const remainingPages: number[] = [];
    const cap = Math.min(lastBookingPage, 50);
    for (let n = 2; n <= cap; n++) remainingPages.push(n);
    // 4er-Chunks parallel, um die anny.co API nicht zu ueberlasten.
    const CHUNK = 4;
    for (let i = 0; i < remainingPages.length; i += CHUNK) {
      const chunk = remainingPages.slice(i, i + CHUNK);
      const responses = await Promise.all(
        chunk.map((n) =>
          fetch(
            `${apiBase}/bookings?` + new URLSearchParams({ ...bookingsExtra, "page[size]": "500", "page[number]": String(n) }),
            { headers, signal: AbortSignal.timeout(20000) },
          ).then((r) => r.ok ? r.json() : null),
        ),
      );
      for (const j of responses) {
        if (!j) continue;
        accumulate(normalizeAnnyBookingsResponse(j));
      }
    }
  }
  const pageCount = lastBookingPage;

  // --- Discovery (resources/services/plans) + plan-subscriptions parallel ---

  const discoveredServiceNames = new Set<string>();
  const discoveredResourceNames = new Set<string>();
  const discoveredSubscriptionNames = new Set<string>();
  const discoveredResourceIds: Record<string, string> = {};
  // Cache fuer den linksToUpdate-Block am Ende: spart einen 2. /services-Fetch.
  const serviceMetaByName = new Map<string, { interval: number; price: string }>();

  // /subscriptions existiert in der admin-API nicht (404) - bewusst entfernt.
  // plan-subscriptions braucht include-Resolution (customer/plan), daher
  // eigener Helper.
  // .catch loggt + leeres Array, damit ein temporaerer Discovery-Fehler nicht
  // das gesamte Sync abreisst, aber auch nicht stillschweigend bleibt.
  const logDiscoveryError = (kind: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[anny sync] discovery ${kind} failed: ${msg}`);
    return [] as Record<string, unknown>[];
  };
  const [resourcesRaw, servicesRaw, plansRaw, allPlanSubscriptions] = await Promise.all([
    fetchAllPages("resources").catch(logDiscoveryError("resources")),
    fetchAllPages("services").catch(logDiscoveryError("services")),
    fetchAllPages("plans").catch(logDiscoveryError("plans")),
    fetchAllPlanSubscriptions().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[anny sync] discovery plan-subscriptions failed: ${msg}`);
      return [] as PlanSubscription[];
    }),
  ]);

  for (const raw of resourcesRaw) {
    const r = flattenResource(raw);
    const name = (r.name ?? r.title) as string | undefined;
    const id = r.id;
    if (name && id != null) {
      discoveredResourceNames.add(name);
      discoveredResourceIds[name] = String(id);
    }
  }
  for (const raw of servicesRaw) {
    const s = flattenResource(raw);
    const name = (s.name ?? s.title) as string | undefined;
    if (!name) continue;
    discoveredServiceNames.add(name);
    const interval = (s.booking_interval as number) || (s.min_duration as number) || 0;
    const price = (s.price_label as string) || (s.price != null ? `${s.price}€` : "");
    if (interval > 0) serviceMetaByName.set(name, { interval, price });
  }
  for (const raw of plansRaw) {
    const p = flattenResource(raw);
    const name = (p.name ?? p.title) as string | undefined;
    if (name) discoveredSubscriptionNames.add(name);
  }
  // --- Deduplicate ---

  const seenBookingIds = new Set<string>();
  const uniqueBookings: AnnyBooking[] = [];
  for (const b of allBookings) {
    const bid = String(b.id);
    if (!seenBookingIds.has(bid)) {
      seenBookingIds.add(bid);
      uniqueBookings.push(b);
    }
  }

  let annyConfig: AnnyMapping = {};
  try {
    if (config.extraConfig) annyConfig = JSON.parse(config.extraConfig);
  } catch { /* ignore */ }

  const annyLinks = await prisma.annyResourceLink.findMany({
    where: { accountId },
    select: { annyName: true, accessAreaId: true },
  });
  const areaMappings: Record<string, number> = {};
  for (const link of annyLinks) {
    areaMappings[link.annyName] = link.accessAreaId;
  }

  console.log(`[anny sync] account=${accountId} ${uniqueBookings.length} bookings in window (${SYNC_WINDOW_DAYS}d), ${oldSkipped} older skipped, ${pageCount} pages, total reported=${totalBookingsReported ?? "?"}`);

  // --- Group bookings ---

  const groups = new Map<string, BookingGroup>();
  const cancelledStatuses = new Set(["cancelled", "canceled", "rejected", "no_show"]);

  for (const booking of uniqueBookings) {
    const customer = booking.customer;
    const customerId = customer?.id;

    const serviceName = booking.service?.name || null;
    const resourceName = booking.resource?.name || null;
    const subscriptionName = booking.subscription?.name || booking.subscription?.title || null;
    if (serviceName) discoveredServiceNames.add(serviceName);
    if (resourceName) discoveredResourceNames.add(resourceName);
    if (subscriptionName) discoveredSubscriptionNames.add(subscriptionName);
    const resId = booking.resource?.id;
    if (resId && resourceName) discoveredResourceIds[resourceName] = String(resId);

    if (!customerId) continue;
    if (booking.status && cancelledStatuses.has(booking.status.toLowerCase())) continue;

    const svcId = booking.service?.id ?? booking.resource?.id ?? booking.subscription?.id ?? "none";
    const key = `anny:${customerId}:${svcId}:${booking.id}`;

    const customerName = customer?.full_name || customer?.name || "";
    const nameParts = customerName.split(/\s+/);
    const startDate = booking.start_date ? new Date(booking.start_date) : null;
    const endDate = booking.end_date ? new Date(booking.end_date) : null;

    const entry: BookingEntry = {
      id: String(booking.id),
      start: booking.start_date || null,
      end: booking.end_date || null,
      status: booking.status || null,
    };

    const bookingExtras = extractExtras(booking);
    const existing = groups.get(key);

    if (existing) {
      const isDupeId = existing.entries.some((e) => e.id === entry.id);
      if (!isDupeId) existing.entries.push(entry);
      if (!existing.bookingNumber && booking.number) existing.bookingNumber = booking.number;
      const scan = extractAnnyBookingScanCode(booking);
      if (scan) {
        if (!existing.scanCode) {
          existing.scanCode = scan;
        } else if ((scan.startsWith("!") || /^TIX/i.test(scan)) && !existing.scanCode.startsWith("!")) {
          existing.scanCode = scan;
        }
      }
      if (startDate && (!existing.startDate || startDate < existing.startDate)) existing.startDate = startDate;
      if (endDate && (!existing.endDate || endDate > existing.endDate)) existing.endDate = endDate;
      if (booking.status) existing.statuses.push(booking.status);
      for (const ex of bookingExtras) {
        if (!existing.extras.some((e) => e.name === ex.name)) existing.extras.push(ex);
      }
    } else {
      groups.set(key, {
        key,
        entries: [entry],
        bookingNumber: booking.number || null,
        scanCode: extractAnnyBookingScanCode(booking),
        customerName,
        firstName: customer?.given_name ?? customer?.first_name ?? nameParts[0] ?? "",
        lastName: customer?.family_name ?? customer?.last_name ?? nameParts.slice(1).join(" ") ?? "",
        email: customer?.email?.trim() || null,
        birthDate: customer?.birth_date ? new Date(customer.birth_date) : null,
        serviceName,
        resourceName,
        subscriptionName,
        startDate,
        endDate,
        statuses: booking.status ? [booking.status] : [],
        extras: bookingExtras,
      });
    }
  }

  // --- Load local mappings ---

  interface ValidityDefaults {
    validityType?: string | null;
    validityDurationMinutes?: number | null;
    slotStart?: string | null;
    slotEnd?: string | null;
  }

  const dbSubscriptions = await prisma.subscription.findMany({
    where: { accountId },
    select: { id: true, annyNames: true, defaultEndDate: true, defaultValidityType: true, defaultValidityDurationMinutes: true, defaultSlotStart: true, defaultSlotEnd: true },
  });
  const subNameMap = new Map<string, number>();
  const subDefaultEndDate = new Map<number, Date | null>();
  const subDefaults = new Map<number, ValidityDefaults>();
  for (const sub of dbSubscriptions) {
    subDefaultEndDate.set(sub.id, sub.defaultEndDate);
    subDefaults.set(sub.id, {
      validityType: sub.defaultValidityType,
      validityDurationMinutes: sub.defaultValidityDurationMinutes,
      slotStart: sub.defaultSlotStart,
      slotEnd: sub.defaultSlotEnd,
    });
    if (sub.annyNames) {
      try {
        const names: string[] = JSON.parse(sub.annyNames);
        for (const n of names) subNameMap.set(n, sub.id);
      } catch { /* ignore */ }
    }
  }

  const servicesList = await prisma.service.findMany({
    where: { accountId },
    select: { id: true, annyNames: true, defaultValidityType: true, defaultValidityDurationMinutes: true, defaultSlotStart: true, defaultSlotEnd: true },
  });
  const svcNameMap = new Map<string, number>();
  // ANNY-Service-Namen, die sich mehrere EMP-Services teilen (z.B.
  // "Exklusive Bahnmiete - Wochentag" fuer Seilbahn A UND B). Fuer solche
  // Namen ist der Service-Name allein NICHT eindeutig - wir disambiguieren
  // dann ueber den (spezifischeren) Resource-Namen der Buchung.
  const ambiguousSvcNames = new Set<string>();
  const svcDefaults = new Map<number, ValidityDefaults>();
  for (const svc of servicesList) {
    svcDefaults.set(svc.id, {
      validityType: svc.defaultValidityType,
      validityDurationMinutes: svc.defaultValidityDurationMinutes,
      slotStart: svc.defaultSlotStart,
      slotEnd: svc.defaultSlotEnd,
    });
    if (svc.annyNames) {
      try {
        const names: string[] = JSON.parse(svc.annyNames);
        for (const n of names) {
          if (svcNameMap.has(n) && svcNameMap.get(n) !== svc.id) {
            ambiguousSvcNames.add(n);
          }
          svcNameMap.set(n, svc.id);
        }
      } catch { /* ignore */ }
    }
  }

  // --- Upsert tickets ---

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: string[] = [];
  const activeUuids: string[] = [];
  const usedBarcodes = new Set<string>();
  const unmapped: { annyName: string; count: number; customerSample: string[] }[] = [];
  const unmappedNames = new Map<string, { count: number; customers: Set<string> }>();

  const allGroupUuids = [...groups.keys()];
  const legacyUuids = [...new Set(allGroupUuids.map((k) => k.split(":").slice(0, 3).join(":")))];
  const allLookupUuids = [...new Set([...allGroupUuids, ...legacyUuids])];
  const existingTickets = allLookupUuids.length > 0
    ? await prisma.ticket.findMany({
        where: { accountId, uuid: { in: allLookupUuids } },
        select: {
          id: true, uuid: true, name: true, firstName: true, lastName: true,
          startDate: true, endDate: true, status: true, ticketTypeName: true,
          barcode: true, accessAreaId: true, subscriptionId: true, serviceId: true,
          qrCode: true, email: true,
        },
      })
    : [];
  const existingByUuid = new Map(existingTickets.map((t) => [t.uuid, t]));
  const claimedLegacy = new Set<string>();

  // ANNY liefert customer.id mal als UUID (Webhook-Payload), mal als numerische
  // ID (JSON:API GET /bookings). Wechselt sich die Form zwischen zwei Syncs,
  // entstand bisher ein Duplikat: gleiches booking.id, aber andere UUID -
  // existingByUuid greift nicht, ein neues Ticket wird erstellt, das alte wird
  // als Orphan invalidiert (mit dem original barcode!), der Scan trifft das
  // INVALID-Ticket -> "Ticket ungueltig".
  //
  // Fix: Zusaetzlich nach UUID-Suffix ":<booking.id>" suchen. Wenn ein Ticket
  // mit gleicher booking.id existiert, dessen UUID wir nicht direkt matchen,
  // updaten wir es (uuid wird umgeschrieben) statt ein neues zu erstellen.
  const allBookingIds = new Set<string>();
  for (const group of groups.values()) {
    for (const entry of group.entries) {
      if (entry.id) allBookingIds.add(entry.id);
    }
  }
  const existingByBookingId = new Map<string, typeof existingTickets[number]>();
  if (allBookingIds.size > 0) {
    const byBidTickets = await prisma.ticket.findMany({
      where: {
        accountId,
        source: "ANNY",
        OR: [...allBookingIds].map((bid) => ({ uuid: { endsWith: `:${bid}` } })),
      },
      select: {
        id: true, uuid: true, name: true, firstName: true, lastName: true,
        startDate: true, endDate: true, status: true, ticketTypeName: true,
        barcode: true, accessAreaId: true, subscriptionId: true, serviceId: true,
        qrCode: true, email: true,
      },
      orderBy: { id: "asc" },
    });
    for (const t of byBidTickets) {
      const bid = t.uuid?.split(":").pop();
      if (!bid) continue;
      existingByBookingId.set(bid, t);
    }
  }

  const customerIds = [...new Set(
    [...groups.keys()].map((k) => k.split(":")[1]).filter(Boolean)
  )];
  const customerDataMap = new Map<string, { rfidCode: string | null; profileImage: string | null }>();
  if (customerIds.length > 0) {
    const prefixConditions = customerIds.map((cid) => ({ uuid: { startsWith: `anny:${cid}:` } }));
    const existingCustomerTickets = await prisma.ticket.findMany({
      where: {
        accountId,
        OR: prefixConditions,
        NOT: { rfidCode: null, profileImage: null },
      },
      select: { uuid: true, rfidCode: true, profileImage: true },
    });

    for (const t of existingCustomerTickets) {
      const cid = t.uuid?.split(":")[1];
      if (!cid) continue;
      const prev = customerDataMap.get(cid);
      if (!prev || (!prev.rfidCode && t.rfidCode)) {
        customerDataMap.set(cid, {
          rfidCode: t.rfidCode ?? prev?.rfidCode ?? null,
          profileImage: t.profileImage ?? prev?.profileImage ?? null,
        });
      } else if (!prev.profileImage && t.profileImage) {
        prev.profileImage = t.profileImage;
      }
    }
  }

  for (const group of groups.values()) {
    const uuid = group.key;
    const count = group.entries.length;

    group.entries.sort((a, b) => {
      if (!a.start) return 1;
      if (!b.start) return -1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    const displayName = group.serviceName || group.resourceName || group.subscriptionName || null;
    let typeName = displayName;
    if (typeName && count > 1) typeName = `${typeName} (${count} Termine)`;

    let subscriptionId: number | null = null;
    let serviceId: number | null = null;
    let accessAreaId: number | null = null;

    if (group.subscriptionName && subNameMap.has(group.subscriptionName)) {
      subscriptionId = subNameMap.get(group.subscriptionName)!;
    } else if (group.serviceName && subNameMap.has(group.serviceName)) {
      subscriptionId = subNameMap.get(group.serviceName)!;
    } else if (group.resourceName && subNameMap.has(group.resourceName)) {
      subscriptionId = subNameMap.get(group.resourceName)!;
    }

    if (!subscriptionId) {
      const svcByService = group.serviceName ? svcNameMap.get(group.serviceName) : undefined;
      const svcByResource = group.resourceName ? svcNameMap.get(group.resourceName) : undefined;
      // Geteilter Service-Name (Seilbahn A/B): die Buchung traegt den
      // generischen Service-Namen, aber der Resource-Name ("...Bahnmieten B")
      // ist eindeutig - den bevorzugen wir, damit B-Buchungen nicht auf A
      // (oder umgekehrt) landen.
      if (
        group.serviceName
        && ambiguousSvcNames.has(group.serviceName)
        && svcByResource != null
      ) {
        serviceId = svcByResource;
      } else if (svcByService != null) {
        serviceId = svcByService;
      } else if (svcByResource != null) {
        serviceId = svcByResource;
      }
    }

    // AccessArea: normalerweise ueber den Service-Namen. ABER bei geteilten
    // Service-Namen (Seilbahn A/B) ist der service-basierte Area-Link nicht
    // eindeutig (z.B. "Exklusive Bahnmiete - Wochentag" -> immer Area A). In
    // dem Fall ist der physische Resource-Name die autoritative Quelle.
    const areaByService =
      group.serviceName && areaMappings[group.serviceName] != null
        ? areaMappings[group.serviceName]
        : null;
    const areaByResource =
      group.resourceName && areaMappings[group.resourceName] != null
        ? areaMappings[group.resourceName]
        : null;
    if (
      group.serviceName
      && ambiguousSvcNames.has(group.serviceName)
      && areaByResource != null
    ) {
      accessAreaId = areaByResource;
    } else if (areaByService != null) {
      accessAreaId = areaByService;
    } else if (areaByResource != null) {
      accessAreaId = areaByResource;
    }

    if (!subscriptionId && !serviceId && !accessAreaId) {
      const unmappedKey = displayName || "Unbekannt";
      const entry = unmappedNames.get(unmappedKey);
      if (entry) {
        entry.count += count;
        if (group.customerName && entry.customers.size < 3) entry.customers.add(group.customerName);
      } else {
        const customers = new Set<string>();
        if (group.customerName) customers.add(group.customerName);
        unmappedNames.set(unmappedKey, { count, customers });
      }
      skipped++;
      continue;
    }

    activeUuids.push(uuid);

    let barcode = group.scanCode || group.bookingNumber || null;
    if (barcode && usedBarcodes.has(barcode)) {
      barcode = group.bookingNumber && !usedBarcodes.has(group.bookingNumber)
        ? group.bookingNumber
        : null;
    }
    if (barcode) usedBarcodes.add(barcode);

    const defaults = (serviceId && svcDefaults.get(serviceId))
      || (subscriptionId && subDefaults.get(subscriptionId))
      || {};

    const custId = uuid.split(":")[1];
    const custData = custId ? customerDataMap.get(custId) : null;

    const ticketData = {
      name: group.customerName || `Buchung ${group.entries[0].id}`,
      firstName: group.firstName || null,
      lastName: group.lastName || null,
      email: group.email,
      birthDate: group.birthDate,
      startDate: group.startDate,
      endDate: group.endDate,
      status: mapGroupStatus(group.statuses),
      ticketTypeName: typeName,
      barcode,
      qrCode: JSON.stringify(group.entries),
      extras: group.extras.length > 0 ? JSON.parse(JSON.stringify(group.extras)) : undefined,
      source: "ANNY" as const,
      accessAreaId,
      subscriptionId,
      serviceId,
      ...(defaults.validityType ? { validityType: defaults.validityType as "DATE_RANGE" | "DURATION" | "TIME_SLOT" } : {}),
      ...(defaults.validityDurationMinutes != null ? { validityDurationMinutes: defaults.validityDurationMinutes } : {}),
      ...(defaults.slotStart ? { slotStart: defaults.slotStart } : {}),
      ...(defaults.slotEnd ? { slotEnd: defaults.slotEnd } : {}),
    };

    try {
      const existing = existingByUuid.get(uuid)
        ?? (group.entries[0]?.id ? existingByBookingId.get(group.entries[0].id) : undefined);
      if (existing) {
        if (!ticketChanged(existing, ticketData)) {
          skipped++;
          continue;
        }
        try {
          await prisma.ticket.update({ where: { id: existing.id }, data: { ...ticketData, uuid } });
        } catch (ue: unknown) {
          const isBarcode = ue != null && typeof ue === "object" && "code" in ue && (ue as { code: string }).code === "P2002";
          if (isBarcode) {
            // Konfliktierendes Orphan-Ticket den barcode wegnehmen, dann nochmal versuchen.
            const freed = ticketData.barcode ? await freeConflictingBarcode(accountId, existing.id, ticketData.barcode) : false;
            if (freed) {
              await prisma.ticket.update({ where: { id: existing.id }, data: { ...ticketData, uuid } });
            } else {
              await prisma.ticket.update({ where: { id: existing.id }, data: { ...ticketData, barcode: null, uuid } });
            }
          } else {
            throw ue;
          }
        }
        updated++;
      } else {
        const inherited: Record<string, unknown> = {};
        if (custData?.rfidCode) inherited.rfidCode = custData.rfidCode;
        if (custData?.profileImage) inherited.profileImage = custData.profileImage;
        const createData = { ...ticketData, ...inherited };

        const legacy = uuid.split(":").slice(0, 3).join(":");
        const legacyTicket = existingByUuid.get(legacy);
        if (!claimedLegacy.has(legacy) && legacyTicket) {
          try {
            const claimed = await prisma.ticket.updateMany({
              where: { id: legacyTicket.id, uuid: legacy },
              data: { ...createData, uuid },
            });
            if (claimed.count > 0) {
              claimedLegacy.add(legacy);
              updated++;
            } else {
              await createTicketSafe(createData, uuid, accountId);
              created++;
            }
          } catch (le: unknown) {
            const isBarcode = le != null && typeof le === "object" && "code" in le && (le as { code: string }).code === "P2002";
            if (isBarcode) {
              await createTicketSafe({ ...createData, barcode: null }, uuid, accountId);
              created++;
            } else {
              throw le;
            }
          }
        } else {
          await createTicketSafe(createData, uuid, accountId);
          created++;
        }
      }
    } catch (e) {
      if (barcode) usedBarcodes.delete(barcode);
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[anny sync] ticket error uuid=${uuid} barcode=${barcode}:`, msg);
      errorDetails.push(`${uuid}: ${msg.slice(0, 120)}`);
      errors++;
    }
  }

  // --- Plan subscriptions ---

  let subCreated = 0;
  let subUpdated = 0;

  // Offene/ueberfaellige Abo-Rechnungen ziehen (nur wenn Auto-Pause aktiv),
  // damit wir Abos mit "Zahlung offen" automatisch pausieren/reaktivieren.
  const paymentCfg = annyConfig.paymentAutoPause;
  const paymentAutoPauseEnabled = paymentCfg?.enabled === true;
  const paymentGraceDays = Math.max(0, paymentCfg?.graceDays ?? 0);
  let openSubInvoices = new Map<string, OpenSubInvoice>();
  if (paymentAutoPauseEnabled) {
    try {
      openSubInvoices = await fetchOpenSubscriptionInvoices(paymentGraceDays);
      const overdueCount = [...openSubInvoices.values()].filter((i) => i.overdue).length;
      console.log(`[anny sync] account=${accountId} payment-auto-pause aktiv: ${openSubInvoices.size} Abos mit offener Rechnung, davon ${overdueCount} ueberfaellig (grace=${paymentGraceDays}d)`);
    } catch (e) {
      console.error(`[anny sync] account=${accountId} Abo-Rechnungen konnten nicht geladen werden:`, e instanceof Error ? e.message : String(e));
    }
  }

  const subUuids = allPlanSubscriptions
    .filter((ps) => ps.customer?.id)
    .map((ps) => `anny-sub:${ps.customer!.id}:${ps.id ?? ps.plan?.name ?? ps.plan?.title ?? ps.name?.replace(/#\d+$/, "").trim() ?? ""}`);
  const existingSubTickets = subUuids.length > 0
    ? await prisma.ticket.findMany({
        where: { accountId, uuid: { in: subUuids } },
        select: {
          id: true, uuid: true, status: true, extras: true, endDate: true,
          name: true, firstName: true, lastName: true, startDate: true,
          ticketTypeName: true, subscriptionId: true, email: true,
        },
      })
    : [];
  const existingSubByUuid = new Map(existingSubTickets.map((t) => [t.uuid, t]));

  for (const ps of allPlanSubscriptions) {
    const customerId = ps.customer?.id;
    if (!customerId) continue;

    const planName = ps.plan?.name ?? ps.plan?.title ?? ps.name?.replace(/#\d+$/, "").trim() ?? null;
    if (!planName) continue;

    const subscriptionId = subNameMap.get(planName) ?? null;
    if (!subscriptionId) continue;

    const psStatus = (ps.status ?? "").toLowerCase();
    const baseStatus =
      psStatus === "active" || psStatus === "trialing" ? ("VALID" as const)
      : psStatus === "paused" || psStatus === "on_hold" || psStatus === "suspended" || psStatus === "frozen" ? ("PAUSED" as const)
      : psStatus === "canceled" || psStatus === "cancelled" ? ("CANCELED" as const)
      : ("INVALID" as const);

    // Zahlung offen? Nur ueberschreiben, wenn ANNY das Abo selbst als aktiv
    // fuehrt (sonst gilt der ANNY-Status, z. B. gekuendigt). Eine ueberfaellige,
    // unbezahlte Abo-Rechnung pausiert den Zutritt bis zur Begleichung.
    const openInvoice = paymentAutoPauseEnabled && ps.id ? openSubInvoices.get(String(ps.id)) : undefined;
    const paymentBlock = baseStatus === "VALID" && !!openInvoice?.overdue;
    const ticketStatus = paymentBlock ? ("PAUSED" as const) : baseStatus;

    const uuid = `anny-sub:${customerId}:${ps.id ?? planName}`;
    if (ticketStatus === "VALID" || ticketStatus === "PAUSED") activeUuids.push(uuid);

    const customerName = ps.customer?.full_name ?? "";
    const firstName = ps.customer?.given_name ?? customerName.split(/\s+/)[0] ?? "";
    const lastName = ps.customer?.family_name ?? customerName.split(/\s+/).slice(1).join(" ") ?? "";
    const email = ps.customer?.email?.trim() || null;

    const startDate = ps.starts_at ? new Date(ps.starts_at) : null;
    const endDate = calcSubscriptionEndDate(ps, startDate, planName, subscriptionId, subDefaultEndDate);
    const birthDate = ps.customer?.birth_date ? new Date(ps.customer.birth_date) : null;

    const ticketData = {
      name: customerName || `Abo ${ps.id ?? ""}`,
      firstName: firstName || null,
      lastName: lastName || null,
      email,
      birthDate,
      startDate,
      endDate,
      status: ticketStatus,
      ticketTypeName: planName,
      source: "ANNY" as const,
      subscriptionId,
      accessAreaId: null as number | null,
      serviceId: null as number | null,
    };

    try {
      const existing = existingSubByUuid.get(uuid);
      if (existing) {
        const prevExtras = (existing.extras as Record<string, unknown>) ?? {};
        const hadAnnyPause = !!prevExtras.pausedAt;
        const wasPaymentPaused = !!prevExtras.paymentPause;

        // extras ohne unsere verwalteten Flags (pausedAt = ANNY-/manuelle Pause,
        // paymentPause = Zahlungs-Pause). Je nach Fall ergaenzen wir wieder.
        const baseExtras: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(prevExtras)) {
          if (k !== "pausedAt" && k !== "paymentPause") baseExtras[k] = v;
        }

        const nextExtras: Record<string, unknown> = { ...baseExtras };

        if (ticketStatus === "PAUSED") {
          // Beim Pausieren das Ablaufdatum einfrieren (nicht weiterlaufen lassen).
          ticketData.endDate = existing.endDate;
          if (paymentBlock) {
            // Zahlungs-Pause: "Zahlung offen"-Vermerk setzen/aktualisieren. KEIN
            // endDate-Bonus bei Reaktivierung (Kunde war nur im Zahlungsverzug).
            const prevPay = (prevExtras.paymentPause as Record<string, unknown> | undefined) ?? undefined;
            const since = (wasPaymentPaused && typeof prevPay?.since === "string")
              ? (prevPay!.since as string)
              : new Date().toISOString();
            nextExtras.paymentPause = {
              since,
              note: "Zahlung offen",
              dueDate: openInvoice?.dueDate ?? null,
              invoiceNumber: openInvoice?.number ?? null,
              amount: openInvoice?.amount ?? null,
              currency: openInvoice?.currency ?? null,
            };
          } else {
            // ANNY-/manuelle Pause: pausedAt-Marker (steuert endDate-Verlaengerung
            // bei Reaktivierung) erhalten bzw. setzen.
            nextExtras.pausedAt = hadAnnyPause ? prevExtras.pausedAt : new Date().toISOString();
          }
        } else if (ticketStatus === "VALID" && existing.status === "PAUSED") {
          if (hadAnnyPause && !wasPaymentPaused) {
            // Ende einer ANNY-/manuellen Pause: endDate um Pausendauer verlaengern.
            const pausedAt = new Date(prevExtras.pausedAt as string);
            const pauseMs = Date.now() - pausedAt.getTime();
            if (existing.endDate && pauseMs > 0) {
              ticketData.endDate = new Date(existing.endDate.getTime() + pauseMs);
            }
          } else {
            // Zahlung beglichen -> reaktivieren ohne Verlaengerung; endDate bleibt.
            ticketData.endDate = existing.endDate;
          }
          // beide Flags entfernen (nextExtras == baseExtras)
        }

        const statusChanged = ticketStatus !== existing.status;
        const extrasChanged = !extrasEqual(prevExtras, nextExtras);
        (ticketData as Record<string, unknown>).extras = nextExtras;
        if (!statusChanged && !extrasChanged && !ticketChanged(existing, ticketData)) {
          skipped++;
          continue;
        }

        await prisma.ticket.update({ where: { id: existing.id }, data: ticketData });
        subUpdated++;
      } else {
        const subCustData = customerDataMap.get(String(customerId));
        const inherited: Record<string, unknown> = {};
        if (subCustData?.rfidCode) inherited.rfidCode = subCustData.rfidCode;
        if (subCustData?.profileImage) inherited.profileImage = subCustData.profileImage;
        if (paymentBlock) {
          (ticketData as Record<string, unknown>).extras = {
            paymentPause: {
              since: new Date().toISOString(),
              note: "Zahlung offen",
              dueDate: openInvoice?.dueDate ?? null,
              invoiceNumber: openInvoice?.number ?? null,
              amount: openInvoice?.amount ?? null,
              currency: openInvoice?.currency ?? null,
            },
          };
        }
        await prisma.ticket.create({ data: { ...ticketData, ...inherited, uuid, accountId } });
        subCreated++;
      }
    } catch { /* skip */ }
  }

  created += subCreated;
  updated += subUpdated;

  for (const [name, { count, customers }] of unmappedNames) {
    unmapped.push({ annyName: name, count, customerSample: [...customers] });
  }

  // --- Invalidate orphans (only within sync window) ---

  // Sicherheitsnetz: barcode + qrCode auf null beim Invalidate. Sonst koennte
  // ein altes (durch frueheren Sync-Bug entstandenes) Duplikat-Ticket weiter
  // gescannt werden, obwohl ein neues gueltiges Ticket fuer dieselbe Buchung
  // existiert.
  const orphaned = await prisma.ticket.updateMany({
    where: {
      accountId,
      source: "ANNY",
      uuid: { notIn: activeUuids },
      status: { notIn: ["INVALID", "PAUSED", "CANCELED"] },
      OR: [
        { startDate: { gte: syncCutoff } },
        { uuid: { startsWith: "anny-sub:" } },
      ],
    },
    data: { status: "INVALID", barcode: null, qrCode: null },
  });

  // --- Update config ---

  const updatedAnnyConfig: AnnyMapping = {
    ...annyConfig,
    services: [...discoveredServiceNames].sort(),
    resources: [...discoveredResourceNames].sort(),
    subscriptions: [...discoveredSubscriptionNames].sort(),
    resourceIds: { ...(annyConfig.resourceIds || {}), ...discoveredResourceIds },
  };

  const syncResult = {
    at: new Date().toISOString(),
    created,
    updated,
    skipped,
    errors,
    errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 20) : undefined,
    invalidated: orphaned.count,
    total: uniqueBookings.length,
    groups: groups.size,
    planSubs: allPlanSubscriptions.length,
  };

  await prisma.apiConfig.update({
    where: { id: config.id },
    data: {
      lastUpdate: new Date(),
      extraConfig: JSON.stringify({ ...updatedAnnyConfig, lastSyncResult: syncResult }),
    },
  });

  // --- Update service cache on AnnyResourceLink ---
  // serviceMetaByName wurde bereits beim Discovery-Block befuellt - kein zweiter
  // /services-Fetch noetig.

  try {
    const linksToUpdate = await prisma.annyResourceLink.findMany({ where: { accountId } });
    await Promise.all(
      linksToUpdate.map(async (link) => {
        const svc = serviceMetaByName.get(link.annyName);
        if (!svc) return;
        if (link.bookingInterval === svc.interval && (link.priceLabel ?? "") === svc.price) return;
        await prisma.annyResourceLink.update({
          where: { id: link.id },
          data: { bookingInterval: svc.interval, priceLabel: svc.price },
        });
      }),
    );
  } catch { /* best-effort */ }

  return {
    created,
    updated,
    skipped,
    errors,
    errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 20) : undefined,
    invalidated: orphaned.count,
    total: uniqueBookings.length,
    oldSkipped,
    syncWindowDays: SYNC_WINDOW_DAYS,
    pages: pageCount,
    groups: groups.size,
    resources: discoveredResourceNames.size,
    services: discoveredServiceNames.size,
    subscriptions: discoveredSubscriptionNames.size,
    planSubscriptions: allPlanSubscriptions.length,
    planSubscriptionsCreated: subCreated,
    planSubscriptionsUpdated: subUpdated,
    unmapped,
  };
}
