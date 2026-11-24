/**
 * Attrappe fuer `prisma.admin.update`/`updateMany` in Tests: arbeitet auf einem
 * einzelnen Datensatz im Speicher und versteht genau die Bedingungen, die
 * login-lockout.ts und two-factor.ts benutzen (Gleichheit, null, lt/lte/gt/gte,
 * `has` und `equals` auf Listen, OR) sowie `increment` und `decrement`.
 *
 * Jeder Aufruf laeuft in einem Stueck durch – wie ein einzelnes UPDATE in der
 * Datenbank. Damit lassen sich gleichzeitige Anfragen nachstellen: mehrere
 * Aufrufer starten mit demselben gelesenen Stand, die Bedingung entscheidet
 * aber am aktuellen.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function compareValues(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function fieldMatches(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  if (typeof condition !== "object") return value === condition;

  const ops = condition as Record<string, unknown>;
  for (const [op, operand] of Object.entries(ops)) {
    if (op === "has") {
      if (!Array.isArray(value) || !value.includes(operand)) return false;
      continue;
    }
    if (op === "equals" && Array.isArray(operand)) {
      // Listenvergleich wie in Postgres: gleiche Eintraege in gleicher Reihenfolge.
      if (!Array.isArray(value) || value.length !== operand.length) return false;
      if (!value.every((entry, i) => entry === operand[i])) return false;
      continue;
    }
    // Vergleiche mit NULL sind in SQL nie wahr.
    if (value === null || value === undefined) return false;
    const c = compareValues(value, operand);
    if (op === "lt" && !(c < 0)) return false;
    if (op === "lte" && !(c <= 0)) return false;
    if (op === "gt" && !(c > 0)) return false;
    if (op === "gte" && !(c >= 0)) return false;
    if (!["lt", "lte", "gt", "gte"].includes(op)) throw new Error(`Attrappe kennt den Operator ${op} nicht`);
  }
  return true;
}

function rowMatches(row: Row, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      if (!(condition as Where[]).some((alt) => rowMatches(row, alt))) return false;
      continue;
    }
    if (!fieldMatches(row[key], condition)) return false;
  }
  return true;
}

function apply(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && "increment" in value) {
      row[key] = (row[key] as number) + (value as { increment: number }).increment;
    } else if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && "decrement" in value) {
      row[key] = (row[key] as number) - (value as { decrement: number }).decrement;
    } else {
      row[key] = value;
    }
  }
}

export function fakeAdminDb<T extends { id: number }>(row: T) {
  const writes: Array<{ where: Where; data: Row; count: number }> = [];
  return {
    writes,
    admin: {
      async update({ data }: { where: { id: number }; data: Row }) {
        apply(row as unknown as Row, data);
        return {};
      },
      async updateMany({ where, data }: { where: Where; data: Row }) {
        const hit = rowMatches(row as unknown as Row, where);
        if (hit) apply(row as unknown as Row, data);
        writes.push({ where, data, count: hit ? 1 : 0 });
        return { count: hit ? 1 : 0 };
      },
    },
  };
}

/**
 * Attrappe fuer `prisma.adminLoginLock` und `prisma.adminLoginPace`
 * (login-lockout.ts): mehrere Datensaetze im Speicher, eindeutig je
 * (emailHash, ipHash) bzw. je emailHash wie in der Datenbank. Versteht
 * dieselben Bedingungen wie oben, dazu `createMany` mit `skipDuplicates`,
 * `deleteMany`, `count` und die Summe ueber `failures`.
 */
export type FakeLoginLockRow = {
  emailHash: string;
  ipHash: string;
  failures: number;
  lockedUntil: Date | null;
  lastAttemptAt: Date;
  succeededAt?: Date | null;
};

export type FakeLoginPaceRow = { emailHash: string; nextAllowedAt: Date };

function fakeTable<T extends object>(rows: T[], unique: (a: Row, b: Row) => boolean, defaults: () => Row) {
  const matching = (where: Where) => rows.filter((row) => rowMatches(row as unknown as Row, where));
  return {
    async updateMany({ where, data }: { where: Where; data: Row }) {
      const hits = matching(where);
      for (const row of hits) apply(row as unknown as Row, data);
      return { count: hits.length };
    },
    async createMany({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) {
      let count = 0;
      for (const entry of data) {
        const exists = rows.some((r) => unique(r as unknown as Row, entry));
        if (exists) {
          if (skipDuplicates) continue;
          throw new Error("Eindeutigkeit verletzt");
        }
        rows.push({ ...defaults(), ...entry } as unknown as T);
        count += 1;
      }
      return { count };
    },
    async deleteMany({ where }: { where: Where }) {
      const hits = matching(where);
      for (const row of hits) rows.splice(rows.indexOf(row), 1);
      return { count: hits.length };
    },
    async count({ where }: { where: Where }) {
      return matching(where).length;
    },
    async aggregate({ where }: { where: Where; _sum: { failures: true } }) {
      const hits = matching(where) as unknown as Array<{ failures: number }>;
      return { _sum: { failures: hits.length ? hits.reduce((sum, r) => sum + r.failures, 0) : null } };
    },
  };
}

export function fakeLoginLockDb(rows: FakeLoginLockRow[] = [], paceRows: FakeLoginPaceRow[] = []) {
  return {
    rows,
    paceRows,
    adminLoginLock: fakeTable(
      rows,
      (a, b) => a.emailHash === b.emailHash && a.ipHash === b.ipHash,
      () => ({ failures: 0, lockedUntil: null, lastAttemptAt: new Date(), succeededAt: null }),
    ),
    adminLoginPace: fakeTable(paceRows, (a, b) => a.emailHash === b.emailHash, () => ({})),
  };
}
