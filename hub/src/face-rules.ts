/**
 * Reine Regeln fuer die Gesichtserkennung am Hub (ohne I/O, testbar):
 *  - faceQuality(): Guete eines erkannten Gesichts, um aus einer kurzen
 *    Bildserie das beste Bild zu waehlen.
 *  - fuseEmbeddings(): Merkmale mehrerer Bilder derselben Person mitteln.
 *  - rankGallery(): Abgleich je Person mit Abstand zum Zweitbesten.
 */

export interface FaceShot {
  embedding: number[];
  detScore: number;
  /** Kantenlaenge des Gesichts in Originalpixeln. */
  size?: number;
  /** 0..1, aus dem Face-Dienst; fehlt bei aelteren Diensten. */
  frontal?: number;
  sharp?: number;
  upscaled: boolean;
}

export interface GalleryItem {
  listedPersonId: number;
  name: string;
  listType: string;
  embedding: number[];
}

export interface Ranked {
  listedPersonId: number;
  name: string;
  score: number;
  listType: string;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}

/**
 * Guete 0..1: Detektor-Sicherheit × Groesse (ArcFace arbeitet mit 112 px)
 * × wie frontal × wie scharf. Hochskalierte Mini-Gesichter zaehlen halb.
 */
export function faceQuality(f: FaceShot): number {
  const size = Math.min(1, Math.max(0, (f.size ?? 56) / 112));
  const frontal = Math.min(1, Math.max(0, f.frontal ?? 1));
  const sharp = Math.min(1, Math.max(0, f.sharp ?? 1));
  // Schaerfe und Drehung nicht auf 0 druecken lassen: ein leicht
  // gedrehtes, scharfes Gesicht ist noch brauchbar.
  const q = f.detScore * (0.4 + 0.6 * size) * (0.3 + 0.7 * frontal) * (0.3 + 0.7 * sharp);
  return f.upscaled ? q * 0.5 : q;
}

/** Bestes Bild einer Serie (Index), -1 bei leerer Liste. */
export function bestShot(shots: FaceShot[]): number {
  let best = -1;
  let bestQ = -1;
  shots.forEach((s, i) => {
    const q = faceQuality(s);
    if (q > bestQ) {
      bestQ = q;
      best = i;
    }
  });
  return best;
}

/**
 * Merkmale mehrerer Bilder mitteln, gewichtet nach Guete. Nur Bilder, die
 * dem besten Bild aehnlich genug sind (dieselbe Person), gehen ein; ein
 * zweites Gesicht im Bild verwaessert das Ergebnis sonst.
 */
export function fuseEmbeddings(shots: FaceShot[], sameMin = 0.4): { embedding: number[]; used: number } | null {
  const i = bestShot(shots);
  if (i < 0) return null;
  const ref = shots[i].embedding;
  const dims = ref.length;
  const acc = new Array<number>(dims).fill(0);
  let used = 0;
  for (const s of shots) {
    if (s.embedding.length !== dims) continue;
    if (s !== shots[i] && cosine(ref, s.embedding) < sameMin) continue;
    const w = Math.max(0.05, faceQuality(s));
    const e = normalize(s.embedding);
    for (let k = 0; k < dims; k++) acc[k] += w * e[k];
    used++;
  }
  return { embedding: normalize(acc), used };
}

/**
 * Abgleich gegen die Gallery: je Person der beste Wert, Treffer nur ab
 * `threshold` und mit mindestens `margin` Abstand zur zweitbesten Person.
 * Liegen zwei Personen fast gleichauf, ist der Treffer unsicher
 * (`ambiguous`) – dann lieber „unbekannt“ als die falsche Person.
 */
export function rankGallery(
  embedding: number[],
  gallery: GalleryItem[],
  threshold: number,
  margin: number
): { match: Ranked | null; nearest: Ranked | null; second: Ranked | null; ambiguous: boolean } {
  const perPerson = new Map<number, Ranked>();
  for (const g of gallery) {
    const score = cosine(embedding, g.embedding);
    const cur = perPerson.get(g.listedPersonId);
    if (!cur || score > cur.score) {
      perPerson.set(g.listedPersonId, { listedPersonId: g.listedPersonId, name: g.name, score, listType: g.listType });
    }
  }
  const ranked = [...perPerson.values()].sort((a, b) => b.score - a.score);
  const nearest = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const above = !!nearest && nearest.score >= threshold;
  const ambiguous = above && !!second && nearest!.score - second.score < margin;
  return { match: above && !ambiguous ? nearest : null, nearest, second, ambiguous };
}

/** So lange gilt der Gesichts-Dienst nach einer erfolgreichen Antwort als bereit. */
export const FACE_HEALTH_TTL_MS = 20_000;

/** Letzte erfolgreiche Antwort frisch genug, um die /health-Abfrage zu sparen? */
export function healthFresh(healthyAt: number, now: number, ttlMs = FACE_HEALTH_TTL_MS): boolean {
  return healthyAt > 0 && now >= healthyAt && now - healthyAt < ttlMs;
}

/** Zeitlimit (AbortSignal.timeout) oder echter Verbindungsfehler? */
export function isTimeout(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Ausgabe des Gesichts-Dienstes in Log-Zeilen zerlegen: ein Datenblock kann
 * mehrere Zeilen tragen (sie landeten sonst ohne Zeitstempel im Log), und der
 * Dienst stellt „[face]“ teils schon selbst voran.
 */
export function sidecarLogLines(chunk: string): string[] {
  return chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => (l.startsWith("[face]") ? l : `[face] ${l}`));
}

/** Ein hochgeladenes Sichtungsbild, wie der Hub es sich je Kamera merkt (nur im Arbeitsspeicher). */
export interface SightingUpload {
  at: number;
  /** Erkannte Person (listedPersonId); null = unbekannt. */
  personId: number | null;
  /** Merkmal des hochgeladenen Gesichts (Vergleich unbekannter Gesichter). */
  embedding: number[];
  /** faceQuality des hochgeladenen Gesichts. */
  quality: number;
}

/** Die Sichtung, die gleich hochgeladen wuerde. */
export interface SightingCandidate extends SightingUpload {
  /** Liste der erkannten Person (BLACKLIST = gesperrt); null = unbekannt. */
  listType: string | null;
}

/** So lange merkt sich der Hub die Uploads je Kamera. */
export const SIGHTING_MEMORY_MS = 10 * 60_000;
/** Hoechstens so viele Uploads je Kamera. */
export const SIGHTING_MEMORY_MAX = 10;
/** Dieselbe erkannte Person an derselben Kamera: innerhalb dieser Zeit eine Wiederholung. */
export const SIGHTING_SAME_PERSON_MS = 5 * 60_000;
/** Unbekanntes Gesicht: ab diesem Kosinus zu einem Upload ist es dasselbe Gesicht. */
export const SIGHTING_SIMILAR_MIN = 0.5;
/** Unbekanntes Gesicht: ab dieser Guete (Vielfaches) ist es deutlich besser und keine Wiederholung. */
export const SIGHTING_BETTER_FACTOR = 1.3;

export interface SightingDecision {
  /** Hochladen (true) oder als Wiederholung weglassen. */
  store: boolean;
  /** Wiederholung eines Uploads dieser Kamera; null = keine. */
  repeat: { known: boolean; gapS: number; sim: number | null } | null;
  /** Wiederholung, die trotzdem gespeichert wird; null = keine Ausnahme. */
  exempt: "gesperrt" | "Überwachung" | null;
}

/**
 * Ist diese Sichtung eine Wiederholung eines Uploads derselben Kamera aus den
 * letzten SIGHTING_MEMORY_MS?
 *  - Erkannte Person: dieselbe Person vor weniger als SIGHTING_SAME_PERSON_MS.
 *  - Unbekanntes Gesicht: einem Upload aehnlich (Kosinus ab SIGHTING_SIMILAR_MIN)
 *    und nicht deutlich besser (unter SIGHTING_BETTER_FACTOR mal dessen Guete);
 *    unter mehreren zaehlt der aehnlichste. Der Kosinus steht im Ergebnis, die
 *    Zaehlung laesst sich so spaeter auch mit einer strengeren Schwelle
 *    auswerten.
 * Eine Wiederholung wird trotzdem gespeichert bei einer gesperrten Person und
 * in der Ueberwachungszeit (`surveillance`; null = unbekannt, zaehlt wie
 * Ueberwachungszeit).
 */
export function shouldStoreSighting(
  recent: readonly SightingUpload[],
  next: SightingCandidate,
  opts: { now: number; surveillance: boolean | null }
): SightingDecision {
  const live = recent.filter((u) => opts.now - u.at >= 0 && opts.now - u.at < SIGHTING_MEMORY_MS);
  let repeat: SightingDecision["repeat"] = null;
  if (next.personId != null) {
    let last: SightingUpload | null = null;
    for (const u of live) {
      if (u.personId === next.personId && opts.now - u.at < SIGHTING_SAME_PERSON_MS && (!last || u.at > last.at)) last = u;
    }
    if (last) repeat = { known: true, gapS: Math.round((opts.now - last.at) / 1000), sim: null };
  } else {
    let best: { u: SightingUpload; sim: number } | null = null;
    for (const u of live) {
      const sim = cosine(u.embedding, next.embedding);
      if (sim < SIGHTING_SIMILAR_MIN) continue;
      if (next.quality >= SIGHTING_BETTER_FACTOR * u.quality) continue;
      if (!best || sim > best.sim) best = { u, sim };
    }
    if (best) repeat = { known: false, gapS: Math.round((opts.now - best.u.at) / 1000), sim: Number(best.sim.toFixed(3)) };
  }
  if (!repeat) return { store: true, repeat: null, exempt: null };
  if (next.listType === "BLACKLIST") return { store: true, repeat, exempt: "gesperrt" };
  if (opts.surveillance !== false) return { store: true, repeat, exempt: "Überwachung" };
  return { store: false, repeat, exempt: null };
}

/** Upload merken: nur die letzten SIGHTING_MEMORY_MS, hoechstens SIGHTING_MEMORY_MAX je Kamera. */
export function rememberSighting(recent: readonly SightingUpload[], add: SightingUpload, now: number): SightingUpload[] {
  return [...recent.filter((u) => now - u.at >= 0 && now - u.at < SIGHTING_MEMORY_MS), add].slice(-SIGHTING_MEMORY_MAX);
}
