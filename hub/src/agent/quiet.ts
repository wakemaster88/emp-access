/** Ruhezeit fuer Warnungen des Waechters (nur Logik). */
/** "22-7" → Ruhezeit 22:00–06:59. Leer/"0" = keine Ruhezeit. */
export function inQuietHours(spec: string, hour: number): boolean {
  const m = spec.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

