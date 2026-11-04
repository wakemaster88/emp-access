/**
 * Unbekannte Gesichter gruppieren (reine Funktionen, ohne DB).
 *
 * Embeddings sind ArcFace/buffalo_l-Vektoren. Gleiche Person liegt bei
 * Kamera-Schnappschuessen typischerweise bei Cosine 0,45–0,8, fremde
 * Personen meist unter 0,3. Zum Gruppieren nehmen wir eher streng (lieber
 * zwei Gruppen derselben Person als eine gemischte), der Vorschlag gegen
 * bekannte Personen ist großzügiger, weil er nur angeboten wird.
 */

/** Ab dieser Aehnlichkeit zum Gruppen-Mittelwert gehoert ein Gesicht dazu. */
export const CLUSTER_THRESHOLD = 0.5;
/** Ab hier wird eine bekannte Person als „Ist das …?“ vorgeschlagen. */
export const SUGGEST_THRESHOLD = 0.3;

export function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (!(n > 0)) return v.map(() => 0);
  return v.map((x) => x / n);
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

export interface FaceItem {
  id: number;
  embedding: number[];
}

export interface FaceCluster {
  /** IDs der Gesichter, das typischste zuerst. */
  ids: number[];
  /** Normierter Mittelwert. */
  centroid: number[];
  /** Mittlere Aehnlichkeit der Mitglieder zum Mittelwert (0..1). */
  cohesion: number;
}

function meanOf(vectors: number[][]): number[] {
  const dims = vectors[0]?.length ?? 0;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) sum[i] += v[i] ?? 0;
  return normalize(sum);
}

/**
 * Gruppiert Gesichter: erst gierig an den naechsten Mittelwert anhaengen,
 * dann Gruppen verschmelzen, deren Mittelwerte sich aehnlich sind, und
 * zum Schluss jedes Gesicht noch einmal der besten Gruppe zuweisen.
 * Reihenfolge-stabil, O(n·k) – fuer einige hundert Sichtungen schnell genug.
 */
export function clusterFaces(
  items: FaceItem[],
  threshold = CLUSTER_THRESHOLD
): FaceCluster[] {
  const faces = items
    .filter((f) => f.embedding.length > 0)
    .map((f) => ({ id: f.id, v: normalize(f.embedding) }));

  type Group = { members: { id: number; v: number[] }[]; centroid: number[]; sum: number[] };
  let groups: Group[] = [];

  // 1) Gierig zuordnen.
  for (const f of faces) {
    let best: Group | null = null;
    let bestScore = -1;
    for (const g of groups) {
      const s = cosine(f.v, g.centroid);
      if (s > bestScore) {
        bestScore = s;
        best = g;
      }
    }
    if (best && bestScore >= threshold) {
      best.members.push(f);
      // Laufende Summe statt Neuberechnung: bleibt auch bei grossen Gruppen schnell.
      for (let i = 0; i < f.v.length; i++) best.sum[i] += f.v[i];
      best.centroid = normalize(best.sum);
    } else {
      groups.push({ members: [f], centroid: f.v, sum: [...f.v] });
    }
  }

  // 2) Aehnliche Gruppen verschmelzen (z. B. erst getrennt entstanden).
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (cosine(groups[i].centroid, groups[j].centroid) >= threshold) {
          const members = [...groups[i].members, ...groups[j].members];
          const sum = groups[i].sum.map((x, k) => x + (groups[j].sum[k] ?? 0));
          groups[i] = { members, centroid: normalize(sum), sum };
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // 3) Jedes Gesicht zur besten Gruppe (korrigiert fruehe Fehlgriffe).
  if (groups.length > 1) {
    const centroids = groups.map((g) => g.centroid);
    const next: Group[] = centroids.map((c) => ({ members: [], centroid: c, sum: [] }));
    for (const f of faces) {
      let bi = 0;
      let bs = -1;
      centroids.forEach((c, i) => {
        const s = cosine(f.v, c);
        if (s > bs) {
          bs = s;
          bi = i;
        }
      });
      if (bs >= threshold) next[bi].members.push(f);
      else next.push({ members: [f], centroid: f.v, sum: [] });
    }
    groups = next
      .filter((g) => g.members.length > 0)
      .map((g) => ({ members: g.members, centroid: meanOf(g.members.map((m) => m.v)), sum: [] }));
  }

  return groups
    .map((g) => {
      const scored = g.members
        .map((m) => ({ id: m.id, s: cosine(m.v, g.centroid) }))
        .sort((a, b) => b.s - a.s);
      const cohesion = scored.reduce((acc, x) => acc + x.s, 0) / scored.length;
      return { ids: scored.map((x) => x.id), centroid: g.centroid, cohesion };
    })
    .sort((a, b) => b.ids.length - a.ids.length);
}

export interface KnownFace {
  listedPersonId: number;
  embedding: number[];
}

export interface PersonSuggestion {
  listedPersonId: number;
  score: number;
}

/**
 * Bekannte Personen nach Aehnlichkeit zum Gruppen-Mittelwert, bestes zuerst.
 * Pro Person zaehlt das beste Sample (wie beim Matching am Hub).
 */
export function rankKnownPersons(
  centroid: number[],
  known: KnownFace[],
  min = SUGGEST_THRESHOLD
): PersonSuggestion[] {
  const best = new Map<number, number>();
  for (const k of known) {
    const s = cosine(centroid, k.embedding);
    if (s > (best.get(k.listedPersonId) ?? -1)) best.set(k.listedPersonId, s);
  }
  return [...best.entries()]
    .filter(([, s]) => s >= min)
    .map(([listedPersonId, score]) => ({ listedPersonId, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Bis zu `max` moeglichst verschiedene Gesichter einer Gruppe als Samples:
 * das typischste zuerst, danach jeweils das, das sich am meisten von den
 * schon gewaehlten unterscheidet (andere Kamera, anderer Winkel).
 */
export function pickDiverseSamples(items: FaceItem[], max = 5): number[] {
  const faces = items
    .filter((f) => f.embedding.length > 0)
    .map((f) => ({ id: f.id, v: normalize(f.embedding) }));
  if (faces.length <= max) return faces.map((f) => f.id);
  const centroid = meanOf(faces.map((f) => f.v));
  const chosen = [faces.reduce((a, b) => (cosine(a.v, centroid) >= cosine(b.v, centroid) ? a : b))];
  while (chosen.length < max) {
    let pick: (typeof faces)[number] | null = null;
    let pickScore = Infinity;
    for (const f of faces) {
      if (chosen.includes(f)) continue;
      const nearest = Math.max(...chosen.map((c) => cosine(f.v, c.v)));
      if (nearest < pickScore) {
        pickScore = nearest;
        pick = f;
      }
    }
    if (!pick) break;
    chosen.push(pick);
  }
  return chosen.map((c) => c.id);
}

/** Unter dieser Aehnlichkeit zum Personen-Mittel gilt ein Sample als Fehlgriff. */
export const OUTLIER_THRESHOLD = 0.3;

/**
 * Erkennungsprofil einer Person aus allen Kandidaten (bisherige Samples +
 * zugeordnete Sichtungen) neu waehlen: offensichtliche Fehlgriffe raus,
 * dann bis zu `max` moeglichst verschiedene Gesichter behalten.
 */
export function chooseProfile(
  items: FaceItem[],
  max = 12,
  outlier = OUTLIER_THRESHOLD
): { keep: number[]; outliers: number[] } {
  const faces = items.filter((f) => f.embedding.length > 0);
  if (faces.length < 3) return { keep: faces.map((f) => f.id), outliers: [] };
  const centroid = meanOf(faces.map((f) => normalize(f.embedding)));
  const outliers = faces.filter((f) => cosine(f.embedding, centroid) < outlier).map((f) => f.id);
  const rest = faces.filter((f) => !outliers.includes(f.id));
  return { keep: pickDiverseSamples(rest, max), outliers };
}

/**
 * Neues Sample nach sicherem Auto-Match lernen? Nur wenn der Match deutlich
 * ist (kein Grenzfall, der falsch sein koennte) und das Gesicht den
 * vorhandenen Samples noch nicht stark gleicht (neuer Winkel / neues Licht).
 */
export function shouldAutoLearn(opts: {
  embedding: number[];
  samples: number[][];
  matchScore: number;
  maxSamples?: number;
  minScore?: number;
  maxSimilarity?: number;
}): boolean {
  const { embedding, samples, matchScore } = opts;
  if (embedding.length < 64) return false;
  if (matchScore < (opts.minScore ?? 0.5)) return false;
  if (samples.length >= (opts.maxSamples ?? 20)) return false;
  const nearest = samples.reduce((m, s) => Math.max(m, cosine(embedding, s)), -1);
  return nearest < (opts.maxSimilarity ?? 0.8);
}
