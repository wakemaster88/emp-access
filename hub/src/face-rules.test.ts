import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEAR_MISS_HINT_MIN,
  NEAR_MISS_WINDOW_MS,
  bestShot,
  compareWays,
  embedSize,
  faceLabel,
  faceQuality,
  fuseEmbeddings,
  fuseOther,
  galleryMargin,
  nearMissHint,
  oneWayFaceCounter,
  otherOnlyVerdict,
  rankGallery,
  recentTimes,
  cosine,
  healthFresh,
  isTimeout,
  sidecarLogLines,
  sightingQualityNote,
  sightingQualityParams,
  type FaceShot,
  type Ranked,
  type WayScore,
} from "./face-rules.js";

const shot = (embedding: number[], o: Partial<FaceShot> = {}): FaceShot => ({
  embedding,
  detScore: 0.8,
  size: 100,
  frontal: 1,
  sharp: 1,
  upscaled: false,
  ...o,
});

test("Gross, frontal und scharf schlaegt klein, gedreht oder unscharf", () => {
  const good = faceQuality(shot([1, 0]));
  assert.ok(good > faceQuality(shot([1, 0], { size: 30 })));
  assert.ok(good > faceQuality(shot([1, 0], { frontal: 0.1 })));
  assert.ok(good > faceQuality(shot([1, 0], { sharp: 0.1 })));
  assert.ok(good > faceQuality(shot([1, 0], { upscaled: true })));
  // Aelterer Face-Dienst ohne frontal/sharp: trotzdem eine Zahl.
  assert.ok(faceQuality({ embedding: [1], detScore: 0.7, upscaled: false }) > 0);
});

test("Bestes Bild der Serie", () => {
  assert.equal(bestShot([]), -1);
  assert.equal(bestShot([shot([1, 0], { sharp: 0.2 }), shot([1, 0]), shot([1, 0], { size: 20 })]), 1);
});

test("Fehlende Frontal- und Schaerfewerte zaehlen als Mitte, nicht als Bestwert", () => {
  const base = { embedding: [1], detScore: 0.8, size: 80, upscaled: false };
  const unknown = faceQuality(base);
  assert.ok(unknown < faceQuality({ ...base, frontal: 1, sharp: 1 }));
  assert.ok(unknown > faceQuality({ ...base, frontal: 0.1, sharp: 0.1 }));
  assert.equal(unknown, faceQuality({ ...base, frontal: 0.5, sharp: 0.5 }));
  // Nur einer der beiden Werte fehlt.
  assert.equal(faceQuality({ ...base, frontal: 0.9 }), faceQuality({ ...base, frontal: 0.9, sharp: 0.5 }));
});

test("Notloesung ohne zweite Suche (small_keep) verliert gegen vergroesserte und gegen direkt gefundene Gesichter", () => {
  const rescue: FaceShot = { embedding: [1], detScore: 0.6, size: 32, frontal: 0.7, sharp: 0.3, upscaled: true, region: "rescue_zoom" };
  const direct: FaceShot = { embedding: [1], detScore: 0.7, size: 60, frontal: 0.6, sharp: 0.3, upscaled: false, region: "full" };
  // Aelterer Dienst: ohne Frontal- und Schaerfewert.
  const keepOld: FaceShot = { embedding: [1], detScore: 0.8, size: 30, upscaled: true, region: "small_keep" };
  assert.ok(faceQuality(keepOld) < faceQuality(rescue));
  assert.ok(faceQuality(keepOld) < faceQuality(direct));
  // Dasselbe Gesicht in zwei Bildern einer Serie (Werte aus dem Laborlauf, 32 px
  // im Kamerabild): einmal fand der Rescue-Zoom es wieder, einmal nicht.
  const keep: FaceShot = { embedding: [1], detScore: 0.7, size: 33.2, frontal: 0.44, sharp: 0.041, upscaled: true, region: "small_keep" };
  const found: FaceShot = { embedding: [1], detScore: 0.82, size: 32.6, frontal: 0.447, sharp: 0.1, upscaled: true, region: "rescue_zoom" };
  assert.ok(faceQuality(keep) < faceQuality(found));
  assert.equal(bestShot([keep, found]), 1);
  // Bei gleichen Werten zaehlt small_keep halb so viel wie ein vergroessertes Gesicht.
  const same = { embedding: [1], detScore: 0.7, size: 40, frontal: 0.8, sharp: 0.2, upscaled: true };
  assert.ok(Math.abs(faceQuality({ ...same, region: "small_keep" }) * 2 - faceQuality({ ...same, region: "rescue_zoom" })) < 1e-12);
});

test("Mitteln nur mit Bildern derselben Person", () => {
  const a = shot([1, 0.1, 0]);
  const b = shot([0.9, 0.2, 0], { sharp: 0.6 });
  const other = shot([0, 0, 1], { sharp: 0.5 });
  const fused = fuseEmbeddings([a, b, other])!;
  assert.equal(fused.used, 2);
  assert.ok(cosine(fused.embedding, [0, 0, 1]) < 0.01);
  assert.ok(Math.abs(Math.hypot(...fused.embedding) - 1) < 1e-9);
  assert.equal(fuseEmbeddings([]), null);
});

test("Gemittelte Merkmale liegen naeher an der Person als ein verrauschtes Einzelbild", () => {
  const person = [1, 0, 0, 0];
  const n1 = shot([1, 0.6, 0, 0]);
  const n2 = shot([1, -0.5, 0.1, 0]);
  const fused = fuseEmbeddings([n1, n2])!;
  assert.ok(cosine(fused.embedding, person) > cosine(n1.embedding, person));
});

test("Zweiter Rechenweg: Serie wird mit denselben Bildern gemittelt, soweit der Weg das Gesicht fand", () => {
  // Kein Bild mit zweitem Weg (alle direkt gefunden): nichts zu vergleichen.
  assert.equal(fuseOther([shot([1, 0, 0]), shot([0.9, 0.1, 0])]), undefined);

  const a = shot([1, 0.1, 0], { upscaled: true, region: "rescue_zoom", other: { way: "native", embedding: [0, 1, 0.1] } });
  const b = shot([0.9, 0.2, 0], { upscaled: true, region: "rescue_zoom", other: { way: "native", embedding: [0, 0.9, 0.2] } });
  // Der zweite Weg fand dieses Gesicht nicht: Das Bild entfaellt dort.
  const lost = shot([1, 0, 0], { upscaled: true, region: "small_keep", other: { way: "native", embedding: null } });
  const fused = fuseOther([a, b, lost])!;
  assert.equal(fused.way, "native");
  assert.ok(cosine(fused.embedding!, [0, 1, 0.15]) > 0.99);
  assert.ok(cosine(fused.embedding!, [1, 0, 0]) < 0.01);

  // Ein direkt gefundenes Bild hat nur ein Merkmal und geht damit ein.
  const direct = shot([0, 1, 0]);
  const mixed = fuseOther([direct, a])!;
  assert.ok(cosine(mixed.embedding!, [0, 1, 0]) > 0.99);

  // Der zweite Weg fand in keinem Bild ein Gesicht.
  assert.deepEqual(fuseOther([lost]), { way: "native", embedding: null });
});

test("Zweiter Rechenweg, Stufe on mit Rueckfall in einem Bild: Vergleich mit der Serie aus dem verkleinerten Bild", () => {
  // Merkmale aus dem verkleinerten Bild liegen um [1, 0, 0], das aus dem Original bei [0, 1, 0].
  const old1 = [1, 0, 0.1];
  const old2 = [1, 0, -0.1];
  const new2 = [0, 1, 0];
  // Bild mit Rueckfall: Der Weg ueber das Original fand nichts, verwendet wird das bisherige Merkmal.
  const fallback = shot(old1, { upscaled: true, region: "rescue_zoom", other: { way: "native", embedding: null } });
  // Normales Bild in Stufe on: verwendet wird das neue Merkmal, das bisherige kommt mit.
  const normal = shot(new2, { upscaled: true, region: "rescue_zoom", other: { way: "scaled", embedding: old2 } });
  for (const series of [
    [fallback, normal],
    [normal, fallback],
  ]) {
    const other = fuseOther(series, 0)!;
    // Der zweite Weg ist der ueber das verkleinerte Bild: Es gilt das neue.
    assert.equal(other.way, "scaled");
    // Beide Bilder gehen mit ihrem bisherigen Merkmal ein, keines mit dem neuen.
    assert.ok(cosine(other.embedding!, [1, 0, 0]) > 0.999);
    assert.ok(Math.abs(cosine(other.embedding!, new2)) < 1e-9);
  }
  // Ein direkt gefundenes Bild geht auch hier mit seinem einen Merkmal ein.
  const direct = shot([1, 0, 0.1], { size: 112 });
  const withDirect = fuseOther([direct, normal], 0)!;
  assert.equal(withDirect.way, "scaled");
  assert.ok(Math.abs(cosine(withDirect.embedding!, new2)) < 1e-9);
  assert.ok(cosine(withDirect.embedding!, [1, 0, 0]) > 0.99);
});

const person = (id: number, score: number, listType = "WHITELIST"): Ranked => ({
  listedPersonId: id,
  name: `Person ${id}`,
  score,
  listType,
});
const hit = (id: number, score: number, listType?: string): WayScore => ({
  match: person(id, score, listType),
  nearest: person(id, score, listType),
});
const miss = (id: number, score: number, o: Partial<WayScore> = {}): WayScore => ({
  match: null,
  nearest: person(id, score),
  ...o,
});

test("Vergleich der Rechenwege, Stufe shadow: das bisherige Merkmal gilt, Abweichungen werden gezaehlt und geloggt", () => {
  // Gleiches Ergebnis: zaehlen, keine Zeile.
  assert.deepEqual(compareWays("native", hit(1, 0.61), hit(1, 0.7), 0.55), { uses: "bisher", counter: "native_same", line: null });
  assert.deepEqual(compareWays("native", miss(1, 0.31), miss(2, 0.4), 0.55), { uses: "bisher", counter: "native_same", line: null });

  // Nur das neue Merkmal waere ein Treffer.
  const gain = compareWays("native", miss(1, 0.481), hit(1, 0.612), 0.55);
  assert.equal(gain.uses, "bisher");
  assert.equal(gain.counter, "native_new_only");
  assert.equal(
    gain.line,
    "Gesichts-Vergleich: nur das Merkmal aus dem Originalbild wäre ein Treffer (neu 0.612, bisher 0.481, Schwelle 0.55, WHITELIST) – es gilt das bisherige"
  );

  // Nur das bisherige ist ein Treffer.
  const loss = compareWays("native", hit(3, 0.571, "BLACKLIST"), miss(3, 0.402), 0.55);
  assert.equal(loss.counter, "native_old_only");
  assert.equal(
    loss.line,
    "Gesichts-Vergleich: nur das Merkmal aus dem verkleinerten Bild ist ein Treffer (bisher 0.571, neu 0.402, Schwelle 0.55, BLACKLIST) – es gilt das bisherige"
  );
});

test("Vergleich der Rechenwege, Stufe on: dieselbe Auswertung mit vertauschten Rollen", () => {
  // `used` ist jetzt das neue Merkmal, `other` das bisherige.
  const gain = compareWays("scaled", hit(1, 0.612), miss(1, 0.481), 0.55);
  assert.equal(gain.uses, "neu");
  assert.equal(gain.counter, "native_new_only");
  assert.equal(
    gain.line,
    "Gesichts-Vergleich: nur das Merkmal aus dem Originalbild ist ein Treffer (neu 0.612, bisher 0.481, Schwelle 0.55, WHITELIST) – es gilt das neue"
  );
  const loss = compareWays("scaled", miss(1, 0.402), hit(1, 0.571), 0.55);
  assert.equal(loss.counter, "native_old_only");
  assert.ok(loss.line!.includes("nur das Merkmal aus dem verkleinerten Bild wäre ein Treffer (bisher 0.571, neu 0.402"));
  assert.ok(loss.line!.endsWith("es gilt das neue"));
  assert.equal(compareWays("scaled", hit(1, 0.7), hit(1, 0.61), 0.55).counter, "native_same");
});

test("Vergleich der Rechenwege: fehlendes Gesicht, verschiedene Personen, knapper Abstand", () => {
  // Der zweite Weg fand das Gesicht nicht: zaehlt dort als kein Treffer.
  const lost = compareWays("native", hit(1, 0.6), null, 0.55);
  assert.equal(lost.counter, "native_old_only");
  assert.ok(lost.line!.includes("neu kein Gesicht"));
  assert.equal(compareWays("native", miss(1, 0.3), null, 0.55).counter, "native_same");

  // Beide treffen, aber verschiedene Personen: eigene Zaehlung, beide Listenarten.
  const other = compareWays("native", hit(1, 0.58), hit(2, 0.61, "BLACKLIST"), 0.55);
  assert.equal(other.counter, "native_other_person");
  assert.ok(other.line!.includes("bisher 0.580 WHITELIST, neu 0.610 BLACKLIST, Schwelle 0.55"));

  // Ueber der Schwelle, aber zu knapp vor der zweitbesten Person: kein Treffer.
  const tight = compareWays("native", miss(1, 0.56, { ambiguous: true }), hit(1, 0.63), 0.55);
  assert.equal(tight.counter, "native_new_only");
  assert.ok(tight.line!.includes("bisher 0.560 uneindeutig"));

  // Leere Gallery: kein Wert, kein Treffer.
  assert.deepEqual(compareWays("native", { match: null, nearest: null }, { match: null, nearest: null }, 0.45).line, null);
});

test("Vergleich der Rechenwege: die Zeile nennt Sorte und Groesse, aber nie eine Person", () => {
  const label = faceLabel({ detScore: 0.66, size: 32, upscaled: true, region: "rescue_zoom" });
  for (const v of [
    compareWays("native", miss(1, 0.48), hit(1, 0.61), 0.55, label),
    compareWays("native", hit(1, 0.6), miss(1, 0.4), 0.55, label),
    compareWays("scaled", hit(1, 0.6), hit(2, 0.62), 0.55, label),
  ]) {
    assert.ok(v.line);
    assert.ok(!v.line.includes("Person 1") && !v.line.includes("Person 2"), v.line);
    assert.ok(v.line.endsWith("; Mini-Gesicht (rescue_zoom, 32 px, det 0.66)"), v.line);
  }
});

test("Gesicht nur auf einem der beiden Rechenwege: Zaehler nach Weg, Zeile nur bei moeglichem Treffer", () => {
  // Stufe shadow: verwendet wird der Weg ueber das verkleinerte Bild. Ebenso
  // Stufe on in einem Bild, in dem der Weg ueber das Original nichts fand
  // (der Dienst meldet dann "native" ohne zweites Merkmal).
  assert.equal(oneWayFaceCounter("native", "used"), "native_face_old");
  assert.equal(oneWayFaceCounter("native", "other"), "native_face_new");
  const fallback = compareWays("native", hit(1, 0.58), null, 0.55);
  assert.equal(fallback.counter, "native_old_only");
  assert.ok(fallback.line!.includes("(bisher 0.580, neu kein Gesicht, Schwelle 0.55, WHITELIST) – es gilt das bisherige"), fallback.line!);
  // Stufe on: verwendet wird der Weg ueber das Original.
  assert.equal(oneWayFaceCounter("scaled", "used"), "native_face_new");
  assert.equal(oneWayFaceCounter("scaled", "other"), "native_face_old");

  const label = "Mini-Gesicht (rescue_zoom, 24 px, det 0.62)";
  assert.deepEqual(otherOnlyVerdict("native", miss(1, 0.3), 0.55, label), { counters: ["native_face_new"], line: null });
  const would = otherOnlyVerdict("native", hit(1, 0.602), 0.55, label);
  assert.deepEqual(would.counters, ["native_face_new", "native_face_new_match"]);
  assert.equal(
    would.line,
    "Gesichts-Vergleich: nur über das Originalbild ein Gesicht gefunden (Mini-Gesicht (rescue_zoom, 24 px, det 0.62)), es wäre ein Treffer (0.602, Schwelle 0.55, WHITELIST) – verwendet wird es nicht"
  );
  assert.ok(!would.line!.includes("Person 1"));
  assert.deepEqual(otherOnlyVerdict("scaled", hit(1, 0.6), 0.55, label).counters, ["native_face_old", "native_face_old_match"]);
});

test("Beschreibung eines Gesichts fuers Log: Sorte, Groesse im Kamerabild, Sicherheit", () => {
  assert.equal(faceLabel({ detScore: 0.71, size: 96.4, upscaled: false, region: "full" }), "Gesicht (direkt, 96 px, det 0.71)");
  assert.equal(faceLabel({ detScore: 0.71, size: 96.4, upscaled: false, region: "left" }), "Gesicht (direkt, 96 px, det 0.71)");
  assert.equal(faceLabel({ detScore: 0.66, size: 31.9, upscaled: true, region: "rescue_zoom" }), "Mini-Gesicht (rescue_zoom, 32 px, det 0.66)");
  assert.equal(faceLabel({ detScore: 0.67, size: 15, upscaled: true, region: "small_keep" }), "Mini-Gesicht (small_keep, 15 px, det 0.67)");
  assert.equal(faceLabel({ detScore: 0.55, size: 12.2, upscaled: true, region: "zoom_center" }), "Mini-Gesicht (zoom_center, 12 px, det 0.55)");
  // Kopf-Ausschnitt: Die Groesse zaehlt im vergroesserten Ausschnitt, nicht im Kamerabild.
  assert.equal(
    faceLabel({ detScore: 0.8, size: 150, upscaled: true, region: "full", headCrop: true }),
    "Gesicht aus Kopf-Ausschnitt (dort 150 px, det 0.80)"
  );
  // Aelterer Dienst ohne Sorte und Groesse.
  assert.equal(faceLabel({ detScore: 0.6, upscaled: true }), "Mini-Gesicht (hochskaliert, det 0.60)");
  assert.equal(faceLabel({ detScore: 0.9, upscaled: false }), "Gesicht (direkt, det 0.90)");
});

test("Hinweis zu Beinahe-Treffern: erst ab fuenf in 24 Stunden und ohne Rat zur Schwelle", () => {
  const now = 1_800_000_000_000;
  const h = 3_600_000;
  assert.equal(nearMissHint([], now), null);
  assert.equal(nearMissHint([now - 1 * h, now - 2 * h, now - 3 * h, now - 4 * h], now), null);
  const five = [now - 1 * h, now - 2 * h, now - 3 * h, now - 4 * h, now - 5 * h];
  const hint = nearMissHint(five, now);
  assert.ok(hint);
  assert.ok(!/schwelle|threshold/i.test(hint), hint);
  // Dieselben fuenf, aber einer liegt laenger als 24 Stunden zurueck.
  assert.equal(nearMissHint([...five.slice(0, 4), now - 25 * h], now), null);
  assert.equal(NEAR_MISS_HINT_MIN, 5);
  assert.equal(NEAR_MISS_WINDOW_MS, 24 * h);
  // Der Text aendert sich nicht mit jeder weiteren Sichtung (sonst je Aenderung eine Log-Zeile).
  assert.equal(nearMissHint([...five, now - 6 * h, now - 7 * h], now), hint);
});

test("Zeitfenster: aeltere Eintraege und solche aus der Zukunft (Uhr verstellt) fallen heraus", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(recentTimes([now - 10, now - NEAR_MISS_WINDOW_MS, now + 5_000, now], now), [now - 10, now]);
});

test("Abgleich je Person mit Abstand zum Zweitbesten", () => {
  const gallery = [
    { listedPersonId: 1, name: "A", listType: "WHITELIST", embedding: [1, 0, 0] },
    { listedPersonId: 1, name: "A", listType: "WHITELIST", embedding: [0.9, 0.1, 0] },
    { listedPersonId: 2, name: "B", listType: "WHITELIST", embedding: [0, 1, 0] },
  ];
  const clear = rankGallery([1, 0.05, 0], gallery, 0.45, 0.05);
  assert.equal(clear.match?.name, "A");
  assert.equal(clear.second?.name, "B");
  assert.equal(clear.ambiguous, false);

  // Zwischen A und B: beide ueber der Schwelle, aber fast gleichauf.
  const tie = rankGallery([1, 1.1, 0], gallery, 0.45, 0.05);
  assert.equal(tie.match, null);
  assert.equal(tie.ambiguous, true);
  assert.ok(tie.nearest);

  // Mehrere Merkmale derselben Person sind kein Zweitbester.
  const one = rankGallery([1, 0, 0], gallery.slice(0, 2), 0.45, 0.05);
  assert.equal(one.match?.name, "A");
  assert.equal(one.second, null);

  assert.equal(rankGallery([1, 0, 0], [], 0.45, 0.05).nearest, null);
});

test("Abstand zur zweitbesten Person aus dem Abgleich mit der Galerie", () => {
  const gallery = [
    { listedPersonId: 1, name: "A", listType: "WHITELIST", embedding: [1, 0, 0] },
    { listedPersonId: 1, name: "A", listType: "WHITELIST", embedding: [0.9, 0.1, 0] },
    { listedPersonId: 2, name: "B", listType: "BLACKLIST", embedding: [0, 1, 0] },
  ];
  const r = rankGallery([1, 0.2, 0], gallery, 0.45, 0.04);
  const m = galleryMargin(r);
  assert.ok(m != null && Math.abs(m - (r.nearest!.score - r.second!.score)) < 1e-12);
  assert.ok(m! > 0.7);
  // Fast gleichauf: kleiner Abstand (unter den 0,10, ab denen die Cloud lernt).
  const tie = galleryMargin(rankGallery([1, 1.05, 0], gallery, 0.45, 0.04));
  assert.ok(tie != null && tie > 0 && tie < 0.1);
  // Mehrere Merkmale derselben Person sind keine zweite Person: kein Abstand.
  assert.equal(galleryMargin(rankGallery([1, 0, 0], gallery.slice(0, 2), 0.45, 0.04)), null);
  assert.equal(galleryMargin(rankGallery([1, 0, 0], [], 0.45, 0.04)), null);
  assert.equal(galleryMargin({ nearest: { score: 0.6 }, second: { score: 0.45 } })?.toFixed(2), "0.15");
  assert.equal(galleryMargin({ nearest: { score: NaN }, second: { score: 0.45 } }), null);
});

test("Guete des Gesichts fuer den Sichtungs-Upload", () => {
  const direct = { detScore: 0.7123, size: 96.44, upscaled: false, region: "full" };
  assert.deepEqual(sightingQualityParams(direct, 0.15349), {
    faceUpscaled: "0",
    faceSize: "96.4",
    faceDetScore: "0.712",
    faceMargin: "0.1535",
  });
  assert.equal(sightingQualityNote(sightingQualityParams(direct, 0.15349)), "96 px direkt, Abstand 0.153");
  // Mini-Gesicht: Groesse im Kamerabild, hochgerechnet.
  const mini = sightingQualityParams({ detScore: 0.66, size: 31.85, upscaled: true, region: "rescue_zoom" }, 0.02);
  assert.equal(mini.faceUpscaled, "1");
  assert.equal(mini.faceSize, "31.9");
  assert.equal(sightingQualityNote(mini), "32 px hochgerechnet, Abstand 0.020");
  // Kopf-Ausschnitt: Groesse zaehlt im Ausschnitt und fehlt, hochgerechnet bleibt.
  const head = sightingQualityParams({ detScore: 0.8, size: 149, upscaled: true, headCrop: true }, null);
  assert.deepEqual(head, { faceUpscaled: "1", faceDetScore: "0.800" });
  assert.equal(sightingQualityNote(head), "hochgerechnet, ohne Abstand");
  // Ohne zweite Person in der Galerie und ohne Groesse: nur, was bekannt ist.
  assert.deepEqual(sightingQualityParams({ detScore: 0.9, upscaled: false }, null), { faceUpscaled: "0", faceDetScore: "0.900" });
  // Unbrauchbare Werte gehen nicht mit.
  assert.deepEqual(sightingQualityParams({ detScore: NaN, size: 0, upscaled: false }, -0.1), { faceUpscaled: "0" });
  // Die Cloud liest dieselben Namen (src/lib/face-quality.ts).
  const qs = new URLSearchParams({ cameraId: "3", sentinel: "1" });
  for (const [k, v] of Object.entries(sightingQualityParams(direct, 0.15))) qs.set(k, v);
  assert.equal(qs.toString(), "cameraId=3&sentinel=1&faceUpscaled=0&faceSize=96.4&faceDetScore=0.712&faceMargin=0.1500");
});

test("Gemittelte Serie: Guete des schwaechsten Bilds, das ins Merkmal einging", () => {
  // Bestes Bild direkt mit 100 px, dazu zwei hochgerechnete Bilder derselben Person.
  const best = shot([1, 0.1, 0], { detScore: 0.8, size: 100, frontal: 0.8, sharp: 0.5, region: "full" });
  const mini = (e: number[]) => shot(e, { detScore: 0.7, size: 80, frontal: 0.8, sharp: 0.5, upscaled: true, region: "rescue_zoom" });
  const fused = fuseEmbeddings([best, mini([0.9, 0.2, 0]), mini([1, 0, 0.1])])!;
  assert.equal(fused.used, 3);
  assert.deepEqual(fused.series, { upscaled: true, size: 80 });
  const face = { ...best, embedding: fused.embedding, series: fused.series };
  // Hochgerechnete Bilder stecken im gemittelten Merkmal: hochgerechnet, kleinste Groesse.
  const p = sightingQualityParams(face, 0.2);
  assert.equal(p.faceUpscaled, "1");
  assert.equal(p.faceSize, "80");
  assert.equal(p.faceDetScore, "0.800");
  assert.equal(sightingQualityNote(p), "80 px hochgerechnet, Abstand 0.200");
  // Das Label im Log beschreibt weiter das beste Bild.
  assert.equal(faceLabel(face), "Gesicht (direkt, 100 px, det 0.80)");

  // Ein hochgerechnetes Bild einer anderen Person geht nicht ein: direkt.
  const stranger = mini([0, 0, 1]);
  const own = fuseEmbeddings([best, stranger])!;
  assert.equal(own.used, 1);
  assert.deepEqual(own.series, { upscaled: false, size: 100 });
  assert.equal(sightingQualityParams({ ...best, series: own.series }, 0.2).faceUpscaled, "0");

  // Zwei direkte Bilder: die kleinere Groesse zaehlt (Grenze 64 px der Cloud).
  const small = shot([0.95, 0.15, 0], { size: 52, region: "full" });
  const both = fuseEmbeddings([best, small])!;
  assert.deepEqual(both.series, { upscaled: false, size: 52 });
  assert.equal(sightingQualityParams({ ...best, series: both.series }, 0.2).faceSize, "52");
  // Ein Bild ohne Groesse (aelterer Dienst): Groesse fehlt.
  const noSize = fuseEmbeddings([best, shot([0.95, 0.15, 0], { size: undefined })])!;
  assert.equal(noSize.series.size, undefined);
  assert.equal(sightingQualityParams({ ...best, series: noSize.series }, 0.2).faceSize, undefined);
});

test("Groesse fuer die Galerie: direkt gefundene Gesichter zaehlen im Suchbild, aus dem ihr Merkmal stammt", () => {
  // 4K-Kamera: 100 px im Kamerabild sind 50 px im Suchbild (1920 px).
  const direct4k = shot([1, 0, 0], { size: 100, sizeScaled: 50, region: "full" });
  assert.equal(embedSize(direct4k), 50);
  assert.equal(sightingQualityParams(direct4k, 0.2).faceSize, "50");
  // Hochgerechnet: Groesse im Kamerabild (in Stufe on stammt das Merkmal aus dem Original).
  assert.equal(embedSize(shot([1, 0, 0], { size: 32, sizeScaled: 16, upscaled: true, region: "rescue_zoom" })), 32);
  // Aelterer Dienst ohne size_scaled: size.
  assert.equal(embedSize(shot([1, 0, 0], { size: 90 })), 90);
  assert.equal(embedSize({ upscaled: false }), undefined);
  // In der Serie gilt die kleinste Groesse im Bild des Merkmals.
  const fused = fuseEmbeddings([direct4k, shot([0.95, 0.1, 0], { size: 140, sizeScaled: 70, region: "full" })])!;
  assert.deepEqual(fused.series, { upscaled: false, size: 50 });
});

test("Stufe on: ein Sperrlisten-Treffer nur des bisherigen Merkmals gilt (im Zweifel Alarm)", () => {
  // Nur das bisherige Merkmal trifft eine gesperrte Person.
  const kept = compareWays("scaled", miss(3, 0.49), hit(3, 0.58, "BLACKLIST"), 0.55);
  assert.equal(kept.counter, "native_old_only");
  assert.equal(kept.applyOther, true);
  assert.match(kept.line!, /es gilt der Treffer der Sperrliste/);
  assert.match(kept.line!, /verkleinerten Bild ist ein Treffer/);
  // Das neue trifft eine andere Person der Whitelist, das bisherige eine gesperrte.
  const other = compareWays("scaled", hit(1, 0.72), hit(3, 0.6, "BLACKLIST"), 0.55);
  assert.equal(other.counter, "native_other_person");
  assert.equal(other.applyOther, true);
  // Beide treffen gesperrte Personen: Es gilt das neue, Alarm gibt es ohnehin.
  assert.equal(compareWays("scaled", hit(4, 0.7, "BLACKLIST"), hit(3, 0.6, "BLACKLIST"), 0.55).applyOther, undefined);
  // Das bisherige trifft eine Person der Whitelist: Es gilt das neue wie bisher.
  assert.equal(compareWays("scaled", miss(1, 0.49), hit(1, 0.58), 0.55).applyOther, undefined);
  // Stufe shadow: Es gilt ohnehin das bisherige Merkmal, ein Treffer nur des neuen gilt nicht.
  assert.equal(compareWays("native", miss(3, 0.49), hit(3, 0.58, "BLACKLIST"), 0.55).applyOther, undefined);
  assert.equal(compareWays("native", hit(3, 0.58, "BLACKLIST"), miss(3, 0.49), 0.55).applyOther, undefined);
});

test("Gesichts-Dienst: frische Antwort spart die Health-Abfrage, alte oder fehlende nicht", () => {
  assert.equal(healthFresh(0, 1_000_000), false);
  assert.equal(healthFresh(1_000_000, 1_000_000 + 5_000), true);
  assert.equal(healthFresh(1_000_000, 1_000_000 + 20_000), false);
  // Uhr zurueckgestellt: lieber neu pruefen.
  assert.equal(healthFresh(1_000_000, 999_000), false);
});

test("Zeitlimit wird von einem Verbindungsfehler unterschieden", () => {
  assert.equal(isTimeout(Object.assign(new Error("x"), { name: "TimeoutError" })), true);
  assert.equal(isTimeout(Object.assign(new Error("x"), { name: "AbortError" })), true);
  assert.equal(isTimeout(new TypeError("fetch failed")), false);
  assert.equal(isTimeout(null), false);
});

test("Ausgabe des Gesichts-Dienstes: je Zeile ein Eintrag, kein doppeltes Praefix", () => {
  assert.deepEqual(sidecarLogLines("[face] zoom miss 9.6px\nkeep small 14px det=0.61\n\n"), [
    "[face] zoom miss 9.6px",
    "[face] keep small 14px det=0.61",
  ]);
  assert.deepEqual(sidecarLogLines("   \r\n"), []);
});
