/** Reine Typen und Pruefung der Personal-Antwort (ohne Hub-Konfiguration, testbar). */

export interface StaffMember {
  id: string;
  name: string;
  department: string | null;
  /** Einstempelzeit (ISO). */
  since: string | null;
  onBreak: boolean;
  plannedDepartment: string | null;
  /** Geplantes Schichtende (ISO). */
  plannedEnd: string | null;
  startDiffMin: number | null;
}

export interface StaffShift {
  department: string | null;
  /** Schichtbeginn (ISO). */
  start: string | null;
  /** Schichtende als „HH:MM“ (Berlin). */
  end: string | null;
  /** Zugewiesen, noch nicht eingestempelt. */
  pending: string[];
  totalAssigned: number;
  clockedIn: number;
}

export interface StaffSnapshot {
  fetchedAt: string;
  working: StaffMember[];
  shifts: StaffShift[];
}

/** Antwort der Cloud pruefen; unbrauchbare Teile fallen weg statt alles zu verwerfen. */
export function parseStaffResponse(body: unknown): StaffSnapshot | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.fetchedAt !== "string" || !Array.isArray(b.working)) return null;
  const working = b.working.filter(
    (w): w is StaffMember => !!w && typeof (w as StaffMember).name === "string",
  );
  const shifts = Array.isArray(b.shifts)
    ? b.shifts.filter((s): s is StaffShift => !!s && Array.isArray((s as StaffShift).pending))
    : [];
  return { fetchedAt: b.fetchedAt, working, shifts };
}

