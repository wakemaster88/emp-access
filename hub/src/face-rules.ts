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
