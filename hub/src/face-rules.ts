/**
 * Reine Regeln fuer die Gesichtserkennung am Hub (ohne I/O, testbar):
 *  - faceQuality(): Guete eines erkannten Gesichts, um aus einer kurzen
 *    Bildserie das beste Bild zu waehlen.
 *  - fuseEmbeddings(): Merkmale mehrerer Bilder derselben Person mitteln.
 *  - rankGallery(): Abgleich je Person mit Abstand zum Zweitbesten.
 *  - compareWays(): Mitmessen des zweiten Rechenwegs (FACE_NATIVE).
 *  - faceLabel(): Sorte, Groesse und Sicherheit eines Gesichts fuers Log.
 *  - galleryMargin(), sightingQualityParams(): Guete des Gesichts fuer den
 *    Sichtungs-Upload (die Cloud lernt nur aus klaren Treffern dazu).
 *  - nearMissHint(): wann Beinahe-Treffer einen Hinweis wert sind.
 */

/**
 * Rechenweg des zweiten Merkmals, das der Gesichts-Dienst zu einem kleinen
 * Gesicht mitliefert (FACE_NATIVE):
 *  - "native": aus dem Originalbild der Kamera. `embedding` ist dann das
 *    bisherige aus dem verkleinerten Bild (Stufe shadow; in Stufe on bei
 *    einem Bild, in dem der Weg ueber das Original kein Gesicht fand).
 *  - "scaled": aus dem verkleinerten Bild. `embedding` ist dann das aus dem
 *    Original (Stufe on).
 */
export type OtherWay = "native" | "scaled";

export interface OtherFace {
  way: OtherWay;
  /** null: Der andere Weg hat dieses Gesicht nicht gefunden. */
  embedding: number[] | null;
}

export interface FaceShot {
  embedding: number[];
  detScore: number;
  /** Kantenlaenge des Gesichts in Pixeln des Kamerabilds (jede Sorte). */
  size?: number;
  /**
   * Kantenlaenge im verkleinerten Suchbild (bis 1920 px). Aus diesem Bild
   * stammt das Merkmal eines direkt gefundenen Gesichts (embedSize()).
   * Fehlt bei aelteren Diensten.
   */
  sizeScaled?: number;
  /** 0..1, aus dem Face-Dienst; fehlt bei aelteren Diensten. */
  frontal?: number;
  sharp?: number;
  upscaled: boolean;
  /** Sorte laut Gesichts-Dienst: full … right (direkt), rescue_zoom, small_keep, zoom_upper, zoom_center. */
  region?: string;
  /** Zweites Merkmal desselben Gesichts; fehlt, wo es nur einen Rechenweg gibt (direkt gefundene Gesichter). */
  other?: OtherFace;
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
 * × wie frontal × wie scharf. Hochskalierte Mini-Gesichter zaehlen halb, die
 * Notloesung ohne zweite Suche (small_keep) ein Viertel: Dort hat der
 * Detektor das Gesicht nach dem Vergroessern nicht wiedergefunden.
 * Fehlt ein Frontal- oder Schaerfewert, gilt die Mitte (0,5) statt des
 * Bestwerts: Ein Gesicht ohne Messung soll keines mit Messung verdraengen.
 */
export function faceQuality(f: FaceShot): number {
  const size = Math.min(1, Math.max(0, (f.size ?? 56) / 112));
  const frontal = Math.min(1, Math.max(0, f.frontal ?? 0.5));
  const sharp = Math.min(1, Math.max(0, f.sharp ?? 0.5));
  // Schaerfe und Drehung nicht auf 0 druecken lassen: ein leicht
  // gedrehtes, scharfes Gesicht ist noch brauchbar.
  const q = f.detScore * (0.4 + 0.6 * size) * (0.3 + 0.7 * frontal) * (0.3 + 0.7 * sharp);
  if (f.region === "small_keep") return q * 0.25;
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
 * Kantenlaenge des Gesichts in dem Bild, aus dem sein Merkmal stammt: Ein
 * direkt gefundenes Gesicht wird im verkleinerten Suchbild eingebettet
 * (`sizeScaled`), ein hochgerechnetes je nach FACE_NATIVE aus dem Original
 * oder dem Suchbild; dort gilt `size`. Fehlt `sizeScaled` (aelterer Dienst),
 * gilt `size`. Auf diese Groesse bezieht sich die Grenze von 64 px fuer das
 * Dazulernen der Galerie: Ein Gesicht mit 100 px auf einer 4K-Kamera hat im
 * Suchbild nur 50 px.
 */
export function embedSize(f: { size?: number; sizeScaled?: number; upscaled: boolean }): number | undefined {
  const ok = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!f.upscaled && ok(f.sizeScaled)) return f.sizeScaled;
  return ok(f.size) ? f.size : undefined;
}

/**
 * Was in ein gemitteltes Merkmal einging, gemessen am schwaechsten Bild:
 * `upscaled`, sobald ein hochgerechnetes Bild mitzaehlt; `size` die kleinste
 * Groesse im Bild des Merkmals (embedSize; fehlt, wenn ein Bild keine
 * Groesse hat).
 */
export interface SeriesQuality {
  upscaled: boolean;
  size?: number;
}

/**
 * Merkmale mehrerer Bilder mitteln, gewichtet nach Guete. Nur Bilder, die
 * dem besten Bild aehnlich genug sind (dieselbe Person), gehen ein; ein
 * zweites Gesicht im Bild verwaessert das Ergebnis sonst. `series` sagt, was
 * eingegangen ist: Steckt ein hochgerechnetes Bild im Merkmal, melden Hub
 * (Ereignis fuer den Waechter) und Sichtung (Galerie) die Serie als
 * hochgerechnet; die Schwelle des Abgleichs richtet sich nach dem besten Bild.
 */
export function fuseEmbeddings(
  shots: FaceShot[],
  sameMin = 0.4
): { embedding: number[]; used: number; series: SeriesQuality } | null {
  const i = bestShot(shots);
  if (i < 0) return null;
  const ref = shots[i].embedding;
  const dims = ref.length;
  const acc = new Array<number>(dims).fill(0);
  let used = 0;
  let upscaled = false;
  let size: number | undefined = Infinity;
  for (const s of shots) {
    if (s.embedding.length !== dims) continue;
    if (s !== shots[i] && cosine(ref, s.embedding) < sameMin) continue;
    const w = Math.max(0.05, faceQuality(s));
    const e = normalize(s.embedding);
    for (let k = 0; k < dims; k++) acc[k] += w * e[k];
    used++;
    upscaled ||= s.upscaled;
    const px = embedSize(s);
    size = size === undefined || px === undefined ? undefined : Math.min(size, px);
  }
  return { embedding: normalize(acc), used, series: { upscaled, size: size === Infinity ? undefined : size } };
}

/**
 * Dieselbe Serie fuer den zweiten Rechenweg mitteln (Mitmessen, FACE_NATIVE).
 * Der zweite Weg der Serie richtet sich nach der Stufe, nicht nach dem
 * ersten Bild: Verwendet auch nur ein Bild das Merkmal aus dem Original
 * (Weg "scaled", Stufe on), ist der zweite Weg der ueber das verkleinerte
 * Bild; sonst (Stufe shadow) der ueber das Original. Je Bild geht das
 * Merkmal dieses Wegs ein:
 *  - Bild mit diesem Weg als zweitem: dessen Merkmal; fand der Weg das
 *    Gesicht nicht, entfaellt das Bild.
 *  - Bild, dessen verwendetes Merkmal schon von diesem Weg stammt (Stufe on,
 *    Rueckfall auf das verkleinerte Bild): das verwendete.
 *  - Bild mit nur einem Rechenweg (direkt gefundenes Gesicht): sein Merkmal.
 * So steht in Stufe on die Serie, wie sie ist, neben der Serie, wie sie ohne
 * den Weg ueber das Original waere. undefined: Kein Bild hat einen zweiten Weg.
 */
export function fuseOther(shots: FaceShot[], sameMin = 0.4): OtherFace | undefined {
  if (!shots.some((s) => s.other)) return undefined;
  const way: OtherWay = shots.some((s) => s.other?.way === "scaled") ? "scaled" : "native";
  const alt: FaceShot[] = [];
  for (const s of shots) {
    if (s.other?.way !== way) alt.push(s);
    else if (s.other.embedding) alt.push({ ...s, embedding: s.other.embedding });
  }
  return { way, embedding: fuseEmbeddings(alt, sameMin)?.embedding ?? null };
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

/** Ergebnis eines Abgleichs gegen die Gallery, soweit der Vergleich der Rechenwege es braucht. */
export interface WayScore {
  match: Ranked | null;
  nearest: Ranked | null;
  /** Ueber der Schwelle, aber zu knapp vor der zweitbesten Person. */
  ambiguous?: boolean;
}

export type WayCounter = "native_same" | "native_new_only" | "native_old_only" | "native_other_person";

export interface WayVerdict {
  /** Welches Merkmal fuer die Sichtung gilt: immer das aus `embedding`. */
  uses: "bisher" | "neu";
  /** Zaehler `face.<counter>`. */
  counter: WayCounter;
  /** Log-Zeile, nur wenn sich die Ergebnisse unterscheiden. Ohne Namen. */
  line: string | null;
  /**
   * Nur gesetzt (true), wenn der Treffer des zweiten Wegs gilt: Stufe on und
   * nur das bisherige Merkmal trifft eine Person der Sperrliste. Im Zweifel
   * Alarm: Der Weg ueber das Original soll keinen Sperrlisten-Treffer
   * verlieren, den es ohne ihn gaebe. Hochgeladen wird weiter `embedding`.
   */
  applyOther?: true;
}

function wayBest(r: WayScore | null): string {
  if (!r) return "kein Gesicht";
  if (!r.nearest) return "ohne Wert";
  return r.nearest.score.toFixed(3) + (r.ambiguous ? " uneindeutig" : "");
}

/**
 * Mitmessen des zweiten Rechenwegs (FACE_NATIVE): Beide Merkmale desselben
 * Gesichts sind mit derselben Schwelle gegen die Gallery gewertet. Es gilt
 * immer das Ergebnis aus `embedding` (`used`); das zweite (`other`, null =
 * dort kein Gesicht) wird nur daneben gehalten:
 *  - gleiches Ergebnis (beide derselbe Treffer oder beide keiner): zaehlen,
 *    keine Zeile.
 *  - nur das Merkmal aus dem Original trifft / nur das aus dem verkleinerten
 *    Bild trifft / beide treffen verschiedene Personen: zaehlen und eine
 *    Zeile mit beiden Bestwerten, Schwelle und Listenart.
 * `way` sagt, welcher Weg der zweite ist: "native" = verwendet wird das
 * bisherige Merkmal (Stufe shadow, in on der Rueckfall), "scaled" = verwendet
 * wird das neue (Stufe on).
 * Ausnahme (`applyOther`): In Stufe on gilt der Treffer des bisherigen
 * Merkmals, wenn er eine Person der Sperrliste ist und das neue keine
 * Person der Sperrliste trifft (keinen Treffer oder eine andere Liste). So
 * loest Stufe on keinen Sperrlisten-Alarm weniger aus als der bisherige Weg.
 * In Stufe shadow gilt ohnehin das bisherige Merkmal.
 * Die Zeile nennt keine Person: Sie dient der Entscheidung ueber den
 * Rechenweg, nicht der Sichtung. `label` (Sorte und Groesse des Gesichts,
 * faceLabel()) wird angehaengt.
 */
export function compareWays(
  way: OtherWay,
  used: WayScore,
  other: WayScore | null,
  threshold: number,
  label?: string
): WayVerdict {
  const uses = way === "native" ? "bisher" : "neu";
  const old = way === "native" ? used : other;
  const neu = way === "native" ? other : used;
  const oldHit = old?.match ?? null;
  const newHit = neu?.match ?? null;
  const keepBlacklist = way === "scaled" && oldHit?.listType === "BLACKLIST" && newHit?.listType !== "BLACKLIST";
  const sort = label ? `; ${label}` : "";
  const applies = keepBlacklist
    ? `es gilt der Treffer der Sperrliste aus dem bisherigen Merkmal (im Zweifel Alarm)${sort}`
    : `es gilt das ${uses === "neu" ? "neue" : "bisherige"}${sort}`;
  const extra = keepBlacklist ? { applyOther: true as const } : {};
  const limit = `Schwelle ${threshold.toFixed(2)}`;
  if (newHit && oldHit) {
    if (newHit.listedPersonId === oldHit.listedPersonId) return { uses, counter: "native_same", line: null };
    return {
      uses,
      counter: "native_other_person",
      line:
        `Gesichts-Vergleich: die beiden Merkmale treffen verschiedene Personen ` +
        `(bisher ${wayBest(old)} ${oldHit.listType}, neu ${wayBest(neu)} ${newHit.listType}, ${limit}) – ${applies}`,
      ...extra,
    };
  }
  if (newHit) {
    return {
      uses,
      counter: "native_new_only",
      line:
        `Gesichts-Vergleich: nur das Merkmal aus dem Originalbild ${uses === "neu" ? "ist" : "wäre"} ein Treffer ` +
        `(neu ${wayBest(neu)}, bisher ${wayBest(old)}, ${limit}, ${newHit.listType}) – ${applies}`,
    };
  }
  if (oldHit) {
    return {
      uses,
      counter: "native_old_only",
      line:
        `Gesichts-Vergleich: nur das Merkmal aus dem verkleinerten Bild ${uses === "bisher" || keepBlacklist ? "ist" : "wäre"} ein Treffer ` +
        `(bisher ${wayBest(old)}, neu ${wayBest(neu)}, ${limit}, ${oldHit.listType}) – ${applies}`,
      ...extra,
    };
  }
  return { uses, counter: "native_same", line: null };
}

/**
 * Ein Bild, in dem nur einer der beiden Rechenwege ein Gesicht findet: Welcher
 * Zaehler (`face.native_face_old` = nur ueber das verkleinerte Bild,
 * `face.native_face_new` = nur ueber das Original). `foundBy` sagt, ob der
 * verwendete oder der zweite Weg es fand.
 */
export function oneWayFaceCounter(way: OtherWay, foundBy: "used" | "other"): "native_face_old" | "native_face_new" {
  const usedIsOld = way === "native";
  return (foundBy === "used") === usedIsOld ? "native_face_old" : "native_face_new";
}

/**
 * Nur der zweite Rechenweg fand in einem Bild ein Gesicht (der verwendete
 * keines). Das Gesicht wird nicht verwendet. Waere es ein Treffer, gibt es
 * einen eigenen Zaehler und eine Zeile ohne Namen; sonst bleibt es beim
 * Zaehler aus oneWayFaceCounter().
 */
export function otherOnlyVerdict(
  way: OtherWay,
  other: WayScore,
  threshold: number,
  label: string
): { counters: string[]; line: string | null } {
  const counter = oneWayFaceCounter(way, "other");
  if (!other.match) return { counters: [counter], line: null };
  const source = way === "native" ? "über das Originalbild" : "über das verkleinerte Bild";
  return {
    counters: [counter, `${counter}_match`],
    line:
      `Gesichts-Vergleich: nur ${source} ein Gesicht gefunden (${label}), es wäre ein Treffer ` +
      `(${wayBest(other)}, Schwelle ${threshold.toFixed(2)}, ${other.match.listType}) – verwendet wird es nicht`,
  };
}

/** Was faceLabel() von einem Gesicht wissen muss. */
export interface FaceSort {
  detScore: number;
  size?: number;
  /** Groesse im verkleinerten Suchbild (embedSize). */
  sizeScaled?: number;
  upscaled: boolean;
  region?: string;
  /** Aus einem vergroesserten Kopf-Ausschnitt: `size` zaehlt in dessen Pixeln. */
  headCrop?: boolean;
  /**
   * Gemittelte Serie (fuseEmbeddings): das schwaechste Bild, das ins Merkmal
   * einging. Nur fuer die Guete-Angaben an die Cloud; die Felder oben
   * beschreiben das beste Bild.
   */
  series?: SeriesQuality;
}

/**
 * Beschreibung eines Gesichts fuer Log-Zeilen: Sorte, Groesse im Kamerabild,
 * Detektor-Sicherheit. Ohne sie laesst sich ein Nicht-Treffer nicht
 * einordnen: Ein direkt gefundenes Gesicht mit 96 px ohne Treffer ist eine
 * unbekannte Person, ein hochskaliertes mit 15 px sagt wenig.
 */
export function faceLabel(f: FaceSort): string {
  const px = typeof f.size === "number" && Number.isFinite(f.size) ? `${Math.round(f.size)} px` : null;
  const det = `det ${f.detScore.toFixed(2)}`;
  const parts = (...p: Array<string | null>) => p.filter((x): x is string => !!x).join(", ");
  if (f.headCrop) return `Gesicht aus Kopf-Ausschnitt (${parts(px ? `dort ${px}` : null, det)})`;
  if (!f.upscaled) return `Gesicht (${parts("direkt", px, det)})`;
  const sort = f.region === "rescue_zoom" || f.region === "small_keep" || f.region?.startsWith("zoom_") ? f.region : "hochskaliert";
  return `Mini-Gesicht (${parts(sort, px, det)})`;
}

/**
 * Abstand des besten Galerie-Werts zur zweitbesten Person (rankGallery:
 * `nearest` und `second`, je Person der beste Wert). null ohne zweite Person
 * in der Galerie.
 */
export function galleryMargin(r: { nearest: { score: number } | null; second: { score: number } | null }): number | null {
  if (!r.nearest || !r.second) return null;
  const m = r.nearest.score - r.second.score;
  return Number.isFinite(m) ? Math.max(0, m) : null;
}

/**
 * Guete des Gesichts als Query-Parameter des Sichtungs-Uploads
 * (POST /api/hub/person-sightings, in der Cloud lib/face-quality.ts):
 *  - faceSize: Kantenlaenge in dem Bild, aus dem das Merkmal stammt
 *    (embedSize: direkt gefundene Gesichter im Suchbild bis 1920 px,
 *    hochgerechnete im Kamerabild); beim Kopf-Ausschnitt zaehlt `size` in
 *    dessen Pixeln und fehlt deshalb
 *  - faceUpscaled: 1 hochgerechnet, 0 direkt gefunden
 *  - faceDetScore: Sicherheit des Detektors
 *  - faceMargin: galleryMargin(); fehlt ohne zweite Person
 * Bei einer gemittelten Serie (`series`) gelten Groesse und hochgerechnet des
 * schwaechsten Bilds, das ins Merkmal einging: Die Cloud speichert und lernt
 * das gemittelte Merkmal. Die Cloud lernt daraus nur bei klaren, nicht
 * hochgerechneten Gesichtern dazu und waehlt bei der Zuordnung von Hand gute
 * Gesichter zuerst. Eine Cloud, die die Parameter nicht kennt, nimmt die
 * Sichtung wie bisher an.
 */
export function sightingQualityParams(f: FaceSort, margin: number | null): Record<string, string> {
  const upscaled = f.upscaled || f.series?.upscaled === true;
  const size = f.series ? f.series.size : embedSize(f);
  const out: Record<string, string> = { faceUpscaled: upscaled ? "1" : "0" };
  if (!f.headCrop && typeof size === "number" && Number.isFinite(size) && size > 0) {
    out.faceSize = String(Math.round(size * 10) / 10);
  }
  if (Number.isFinite(f.detScore) && f.detScore >= 0 && f.detScore <= 1) out.faceDetScore = f.detScore.toFixed(3);
  if (margin != null && Number.isFinite(margin) && margin >= 0) out.faceMargin = margin.toFixed(4);
  return out;
}

/** Kurzform der gesendeten Guete fuer die Upload-Zeile im Log, z. B. „96 px direkt, Abstand 0.153“. */
export function sightingQualityNote(p: Record<string, string>): string {
  const sort = p.faceUpscaled === "1" ? "hochgerechnet" : "direkt";
  return (
    (p.faceSize ? `${Math.round(Number(p.faceSize))} px ${sort}` : sort) +
    (p.faceMargin ? `, Abstand ${Number(p.faceMargin).toFixed(3)}` : ", ohne Abstand")
  );
}

/** Fenster und Mindestzahl fuer den Hinweis zu Beinahe-Treffern. */
export const NEAR_MISS_WINDOW_MS = 24 * 3_600_000;
export const NEAR_MISS_HINT_MIN = 5;

/** Zeitpunkte auf das Fenster kuerzen. */
export function recentTimes(times: number[], now: number, windowMs = NEAR_MISS_WINDOW_MS): number[] {
  return times.filter((t) => t <= now && now - t < windowMs);
}

/**
 * Hinweis zu Beinahe-Treffern (bester Wert bis 0,10 unter der Schwelle):
 * erst ab fuenf in 24 Stunden, und nur direkt gefundene Gesichter zaehlen.
 * Der Wert eines hochskalierten Mini-Gesichts schwankt zu stark, um aus
 * einem Beinahe-Treffer auf die Person zu schliessen, und ein einzelner sagt
 * auch bei einem direkt gefundenen Gesicht nichts. Der Hinweis raet zum
 * Blick auf die Sichtungen; die Schwelle bleibt, wie sie ist. Der Text nennt
 * keine laufende Zahl, damit er im Log nur beim Erscheinen steht.
 * `times`: Zeitpunkte der Beinahe-Treffer nicht hochskalierter Gesichter.
 */
export function nearMissHint(times: number[], now: number): string | null {
  if (recentTimes(times, now).length < NEAR_MISS_HINT_MIN) return null;
  return `Mindestens ${NEAR_MISS_HINT_MIN} Beinahe-Treffer direkt gefundener Gesichter in 24 h – Sichtungen ansehen und passende Bilder der Person zuordnen`;
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
