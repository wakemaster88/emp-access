/**
 * Reine Regeln fuer „erkannte Personen“ in der Zentrale (ohne I/O, testbar).
 */
export type SeenKind = "face" | "staff" | "cleared" | "suspicious" | "unknown";

export interface SeenSource {
  camera: string;
  at: number;
  /** Ereignis-Titel bzw. Label der Wiedererkennung. */
  title: string;
  /** Gesichtsliste WHITELIST | BLACKLIST. */
  list: string | null;
  origin: "face" | "sentinel" | "cleared";
}

export interface SeenPerson {
  cameraId: number;
  camera: string;
  label: string;
  kind: SeenKind;
  /** Letzte Sichtung (ms), null = nur die Kamera meldet gerade eine Person. */
  at: number | null;
  /** Kamera meldet gerade eine Person. */
  active: boolean;
}

/** Wer ist das? Juengste aussagekraeftige Quelle zuerst; null = unbekannt. */
export function personLabel(newestFirst: SeenSource[]): { text: string; kind: SeenKind } | null {
  for (const s of newestFirst) {
    if (s.origin === "face") {
      const m = /^Person erkannt:\s*(.+)$/.exec(s.title);
      if (m) return { text: m[1].trim(), kind: s.list === "BLACKLIST" ? "suspicious" : "face" };
      continue;
    }
    if (s.origin === "sentinel") {
      if (/vermutlich Mitarbeiter/i.test(s.title)) return { text: "Mitarbeiter", kind: "staff" };
      if (/auffällig/i.test(s.title)) return { text: "Auffällig", kind: "suspicious" };
      continue;
    }
    const text = s.title.trim() || "unbedenklich";
    return { text, kind: /mitarbeiter/i.test(text) ? "staff" : "cleared" };
  }
  return null;
}

/** Eine Zeile je Kamera: gerade aktive zuerst, dann die juengste Sichtung. */
export function mergeSeen(
  cams: Array<{ id: number; name: string; person: boolean }>,
  sources: SeenSource[],
  _now: number
): SeenPerson[] {
  const out: SeenPerson[] = [];
  for (const cam of cams) {
    const mine = sources.filter((s) => s.camera === cam.name).sort((a, b) => b.at - a.at);
    if (!cam.person && !mine.length) continue;
    const label = personLabel(mine);
    out.push({
      cameraId: cam.id,
      camera: cam.name,
      label: label?.text ?? "Person",
      kind: label?.kind ?? "unknown",
      at: mine[0]?.at ?? null,
      active: cam.person,
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || (b.at ?? Infinity) - (a.at ?? Infinity));
}
