/**
 * Voll-Abgleich mit emp-control: Entscheidung, welche Mitarbeiter-Tickets
 * gesperrt werden, wenn emp-control mit `fullSync: true` die vollstaendige
 * Mitarbeiterliste schickt.
 *
 * Reine Funktion ohne Datenbank, damit die Schutzregeln testbar sind. Ein
 * Fehler hier sperrt Personal an den Tueren aus, deshalb lehnt der Abgleich
 * lieber ab, als zu viel zu sperren:
 * - leere Liste: immer abgelehnt
 * - ein Eintrag ohne verwendbare ID: immer abgelehnt
 * - mehr als 3 Tickets UND mehr als 30 Prozent der gueltigen
 *   EMP_CONTROL-Tickets: abgelehnt, ausser mit `fullSyncForce: true`
 *
 * Eintraege, die nur die ID (und `active`) nennen, sind im Voll-Abgleich reine
 * Anwesenheitsmeldungen (`isPresenceMarker`): Sie halten das Ticket in der
 * Liste, ohne daran etwas zu aendern. Mit `active: false` gilt der
 * Mitarbeiter als nicht mehr gemeldet, sein Ticket wird wie ein fehlendes
 * behandelt (gleiche Schutzregeln).
 *
 * Betroffen sind nur Tickets, die der Webhook selbst anlegt (uuid `emp-<id>`).
 * Im Dashboard angelegte Mitarbeiter (uuid `emp-manual-…`) meldet emp-control
 * nie, sie bleiben beim Voll-Abgleich unberuehrt und zaehlen nicht mit.
 */

/** Ab hier gilt ein Abgleich als verdaechtig gross (beide Grenzen muessen ueberschritten sein). */
export const FULL_SYNC_MAX_COUNT = 3;
export const FULL_SYNC_MAX_PERCENT = 30;
/** So viele betroffene Mitarbeiter nennt eine Ablehnung hoechstens beim Namen. */
export const FULL_SYNC_PREVIEW_MAX = 50;

/** Praefix der uuid, die POST /api/employees fuer manuell angelegte Mitarbeiter vergibt. */
const MANUAL_UUID_PREFIX = "emp-manual-";

/**
 * true, wenn die uuid zu einem Ticket gehoert, das der Webhook angelegt hat
 * (`emp-<id>`), nicht zu einem manuell im Dashboard angelegten Mitarbeiter.
 */
export function isSyncedEmployeeUuid(uuid: string | null | undefined): uuid is string {
  return typeof uuid === "string" && uuid.startsWith("emp-") && !uuid.startsWith(MANUAL_UUID_PREFIX);
}

export type FullSyncTicket = { id: number; uuid: string | null };

export type FullSyncPlan =
  | {
      action: "deactivate";
      /** Ticket-IDs, die auf INVALID gesetzt werden (kann leer sein). */
      ticketIds: number[];
      /** Mitarbeiter-IDs (uuid ohne `emp-`) in derselben Reihenfolge. */
      employeeIds: string[];
    }
  | {
      action: "refuse";
      reason: "empty" | "missing-id" | "too-many";
      wouldDeactivate: number;
      total: number;
      error: string;
      /** Tickets, die gesperrt worden waeren (fuer die Anzeige beim Absender). */
      ticketIds: number[];
      /** Mitarbeiter-IDs (uuid ohne `emp-`) in derselben Reihenfolge. */
      employeeIds: string[];
    };

/**
 * Mitarbeiter-ID eines Eintrags wie im Webhook (`id`, sonst `employeeId`).
 * Verwendbar sind nicht-leere Texte und endliche Zahlen; alles andere gibt
 * null.
 */
export function employeeSyncId(entry: unknown): string | null {
  if (entry == null || typeof entry !== "object") return null;
  const e = entry as { id?: unknown; employeeId?: unknown };
  const id = e.id ?? e.employeeId;
  if (typeof id === "number") return Number.isFinite(id) ? String(id) : null;
  if (typeof id === "string") return id.trim() !== "" ? id : null;
  return null;
}

/** Felder, die eine reine Anwesenheitsmeldung tragen darf. */
const PRESENCE_KEYS: ReadonlySet<string> = new Set(["id", "employeeId", "active"]);

/**
 * Reine Anwesenheitsmeldung im Voll-Abgleich: Der Eintrag nennt nur die ID
 * (und optional `active`). Sie legt nie ein Ticket an und aendert an einem
 * vorhandenen nichts. Mit `active: false` zaehlt der Mitarbeiter als nicht
 * mehr gemeldet: Sein gueltiges Ticket wird zusammen mit den fehlenden
 * gesperrt und faellt unter dieselben Schutzregeln. So kann emp-control
 * taeglich die vollstaendige Liste schicken, ohne Chip, Namen, Bereiche oder
 * einen hier gesetzten Status zu ueberschreiben. Ausserhalb des
 * Voll-Abgleichs gilt die Regel nicht, dort bleibt alles wie bisher.
 */
export function isPresenceMarker(entry: unknown): boolean {
  if (entry == null || typeof entry !== "object" || Array.isArray(entry)) return false;
  if (employeeSyncId(entry) == null) return false;
  const record = entry as Record<string, unknown>;
  return Object.keys(record).every((key) => record[key] === undefined || PRESENCE_KEYS.has(key));
}

/** Anwesenheitsmeldung mit `active: false`: der Mitarbeiter gilt als nicht mehr gemeldet. */
export function isInactiveMarker(entry: unknown): boolean {
  return isPresenceMarker(entry) && (entry as { active?: unknown }).active === false;
}

export function planFullSync(input: {
  /** Die Mitarbeiterliste des Aufrufs, so wie sie im Body steht. */
  employees: readonly unknown[];
  /** Tickets des Mandanten mit Quelle EMP_CONTROL und Status VALID, die gesperrt werden duerfen. */
  validTickets: readonly FullSyncTicket[];
  /**
   * Anzahl der gueltigen Webhook-Tickets (uuid `emp-<id>`) VOR der
   * Verarbeitung dieses Aufrufs, Nenner der Prozent-Regel. Im selben Aufruf
   * neu angelegte Tickets zaehlen so nicht mit. Fehlt der Wert, zaehlt
   * validTickets.
   */
  validBefore?: number;
  force: boolean;
}): FullSyncPlan {
  const { employees, validTickets, force } = input;
  const listed = new Set<string>();
  let missing = 0;
  for (const entry of employees) {
    const id = employeeSyncId(entry);
    if (id == null) missing++;
    else if (!isInactiveMarker(entry)) listed.add(`emp-${id}`);
  }

  const leaving = validTickets
    .filter((t) => isSyncedEmployeeUuid(t.uuid) && !listed.has(t.uuid))
    .sort((a, b) => a.id - b.id);
  const total = input.validBefore ?? validTickets.filter((t) => isSyncedEmployeeUuid(t.uuid)).length;
  const n = leaving.length;
  const ticketIds = leaving.map((t) => t.id);
  const employeeIds = leaving.map((t) => (t.uuid as string).slice(4));

  if (employees.length === 0) {
    return {
      action: "refuse",
      reason: "empty",
      wouldDeactivate: n,
      total,
      error: `Voll-Abgleich abgelehnt: Die Mitarbeiterliste ist leer, es würden ${n} von ${total} gültigen Mitarbeiter-Tickets gesperrt.`,
      ticketIds,
      employeeIds,
    };
  }
  if (missing > 0) {
    return {
      action: "refuse",
      reason: "missing-id",
      wouldDeactivate: n,
      total,
      error: `Voll-Abgleich abgelehnt: ${missing} von ${employees.length} Einträgen haben keine verwendbare ID, es wurden keine Mitarbeiter-Tickets gesperrt.`,
      ticketIds,
      employeeIds,
    };
  }
  // Ganzzahlig vergleichen: n / total > 30 % <=> n * 100 > total * 30
  const tooMany = n > FULL_SYNC_MAX_COUNT && n * 100 > total * FULL_SYNC_MAX_PERCENT;
  if (tooMany && !force) {
    return {
      action: "refuse",
      reason: "too-many",
      wouldDeactivate: n,
      total,
      error: `Voll-Abgleich abgelehnt: Es würden ${n} von ${total} gültigen Mitarbeiter-Tickets gesperrt (mehr als ${FULL_SYNC_MAX_COUNT} und mehr als ${FULL_SYNC_MAX_PERCENT} Prozent). Mit fullSyncForce: true wird trotzdem gesperrt.`,
      ticketIds,
      employeeIds,
    };
  }
  return { action: "deactivate", ticketIds, employeeIds };
}
