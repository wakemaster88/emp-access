/**
 * Face-Matching am Hub: spricht den lokalen InsightFace-Sidecar an,
 * haelt die Embedding-Gallery und matched per Cosine-Similarity.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { CONFIG, api, log } from "./config.js";
import { improve, improveCount } from "./improve-log.js";
import { STATE } from "./state.js";
import {
  compareWays,
  faceLabel,
  healthFresh,
  isTimeout,
  oneWayFaceCounter,
  otherOnlyVerdict,
  rankGallery,
  sidecarLogLines,
  type OtherFace,
  type OtherWay,
  type SeriesQuality,
} from "./face-rules.js";
import { ChangeLog } from "./change-log.js";

const FACE_URL = process.env.FACE_URL || "http://127.0.0.1:8790";
const FACE_PORT = Number(process.env.FACE_PORT || 8790);
/** Cosine-Schwellwert fuer Identity-Match (buffalo_l / ArcFace). */
export const FACE_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.45);
/** Hochskalierte Mini-Gesichter: strenger, weniger Fehlzuordnungen. */
export const FACE_UPSCALED_THRESHOLD = Number(process.env.FACE_UPSCALED_THRESHOLD || 0.55);
/**
 * Mindestabstand zur zweitbesten Person. Liegen zwei Personen fast
 * gleichauf, gilt der Treffer als unsicher statt die falsche zu nennen.
 */
export const FACE_MATCH_MARGIN = Number(process.env.FACE_MATCH_MARGIN || 0.04);
// 5 min: Gallery aendert sich selten; bei FACE_ENROLL wird sie invalidiert.
const GALLERY_TTL_MS = 300_000;

export interface FaceEmbedResult {
  embedding: number[];
  detScore: number;
  bbox: number[];
  model: string;
  upscaled: boolean;
  /**
   * Kantenlaenge in Pixeln des eingebetteten Bildes vor dem Verkleinern im
   * Dienst (jede Sorte), Frontal-/Schaerfewert 0..1 (neuer Face-Dienst).
   */
  size?: number;
  /** Groesse im verkleinerten Suchbild (bis 1920 px), dort entsteht das Merkmal eines direkt gefundenen Gesichts. */
  sizeScaled?: number;
  frontal?: number;
  sharp?: number;
  /** Sorte laut Dienst: full … right (direkt), rescue_zoom, small_keep, zoom_upper, zoom_center. */
  region?: string;
  /** Aus einem vergroesserten Kopf-Ausschnitt (person-crop.ts): `size` zaehlt in dessen Pixeln. */
  headCrop?: boolean;
  /**
   * Zweites Merkmal desselben Gesichts vom anderen Rechenweg (FACE_NATIVE
   * shadow oder on). Verwendet wird immer `embedding`; das zweite dient nur
   * dem Mitmessen (noteOtherWay). Fehlt bei direkt gefundenen Gesichtern.
   */
  other?: OtherFace;
  /**
   * Gemittelte Serie (pickBestFace): das schwaechste Bild, das ins Merkmal
   * einging; fuer die Guete-Angaben der Sichtung (sightingQualityParams).
   * Schwelle und Log richten sich weiter nach dem besten Bild.
   */
  series?: SeriesQuality;
  /** Groesse des eingebetteten Bildes (Bezug fuer `bbox`). */
  imageW?: number;
  imageH?: number;
}

/** Ein Gesicht in der Antwort des Dienstes. */
interface SidecarFace {
  embedding: number[];
  det_score: number;
  bbox: number[];
  size?: number;
  /** Groesse im verkleinerten Suchbild. */
  size_scaled?: number;
  frontal?: number;
  sharp?: number;
  /** compared "native": Merkmal aus dem Originalbild neben dem bisherigen. */
  embedding_native?: number[];
  /** compared "scaled": bisheriges Merkmal neben dem aus dem Originalbild. */
  embedding_scaled?: number[];
}

interface GalleryEntry {
  id: number;
  listedPersonId: number;
  name: string;
  listType: string;
  embedding: number[];
}

let gallery: GalleryEntry[] = [];
let galleryLoadedAt = 0;
/** Geladener Bestand (welche Merkmale, nicht nur wie viele); null = noch nie geladen. */
let gallerySignature: string | null = null;
/** Der letzte Abruf ist gescheitert: Der naechste Erfolg wird gemeldet. */
let galleryFailed = false;
/*
 * Scheitert der Abruf, gilt der letzte Bestand weiter, und jeder Aufruf
 * versucht es neu (je Personen-Lauf, je Klingeln, alle 15 min). Im Log steht
 * das einmal, bei anderem Grund und dann alle 30 min, nicht bei jedem Versuch.
 */
const galleryFailLog = new ChangeLog(30 * 60_000);
let sidecarProc: ChildProcess | null = null;
let sidecarStarting: Promise<void> | null = null;
/**
 * Letzte erfolgreiche Antwort des Dienstes. Solange sie frisch ist, entfaellt
 * die /health-Abfrage vor jedem Bild (vorher eine je Einbettung, rund 1.000
 * am Tag). Faellt der Dienst dazwischen aus, merkt es der naechste Aufruf am
 * Verbindungsfehler und stellt ihn wie bisher neu sicher.
 */
let healthyAt = 0;

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(`${FACE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) healthyAt = Date.now();
    return res.ok;
  } catch {
    return false;
  }
}

/** Ausgabe des Dienstes zeilenweise ins Hub-Log, ohne doppeltes „[face]“. */
function relaySidecarOutput(chunk: unknown): void {
  for (const line of sidecarLogLines(String(chunk))) log(line);
}

/** Startet den Python-Sidecar falls noetig (venv unter hub/face/.venv). */
export async function ensureFaceSidecar(): Promise<boolean> {
  if (healthFresh(healthyAt, Date.now())) return true;
  if (await healthOk()) return true;
  if (sidecarStarting) {
    await sidecarStarting;
    return healthOk();
  }

  const faceDir = path.join(CONFIG.hubDir, "face");
  const venvPython = path.join(faceDir, ".venv", "bin", "python");
  const serverPy = path.join(faceDir, "server.py");
  if (!existsSync(venvPython) || !existsSync(serverPy)) {
    log("Face-Sidecar: venv fehlt – bitte hub/face/install.sh ausführen");
    return false;
  }

  sidecarStarting = new Promise<void>((resolve) => {
    if (sidecarProc && !sidecarProc.killed) {
      resolve();
      return;
    }
    log(`Face-Sidecar startet auf Port ${FACE_PORT} …`);
    sidecarProc = spawn(venvPython, [serverPy], {
      cwd: faceDir,
      env: {
        ...process.env,
        FACE_HOST: "127.0.0.1",
        FACE_PORT: String(FACE_PORT),
        FACE_MODEL_ROOT: path.join(faceDir, ".models"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    sidecarProc.stdout?.on("data", relaySidecarOutput);
    sidecarProc.stderr?.on("data", relaySidecarOutput);
    sidecarProc.on("exit", (code) => {
      log(`Face-Sidecar beendet (code ${code})`);
      sidecarProc = null;
      healthyAt = 0;
    });
    // Startfehler (z. B. zu viele Prozesse): ohne Abnehmer wuerfe Node hier
    // eine unbehandelte Ausnahme und der Hub beendete sich.
    const spawned = sidecarProc;
    spawned.on("error", (e) => {
      log(`Face-Sidecar: ${e.message}`);
      // Kam der Prozess gar nicht zustande, folgt kein "exit": hier aufraeumen.
      if (spawned.pid === undefined && sidecarProc === spawned) {
        sidecarProc = null;
        healthyAt = 0;
      }
    });
    // Warmup abwarten.
    const started = Date.now();
    const wait = async () => {
      while (Date.now() - started < 120_000) {
        if (await healthOk()) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      resolve();
    };
    void wait();
  });

  await sidecarStarting;
  sidecarStarting = null;
  return healthOk();
}

/** Bestes Gesicht aus JPEG extrahieren (oder null). */
export async function embedJpeg(jpeg: Buffer): Promise<FaceEmbedResult | null> {
  if (!(await ensureFaceSidecar())) return null;
  try {
    const post = () =>
      fetch(`${FACE_URL}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(jpeg),
        signal: AbortSignal.timeout(30_000),
      });
    let res: Response;
    try {
      res = await post();
    } catch (e) {
      // Dienst seit der letzten Pruefung weg (kein Zeitlimit, sondern keine
      // Verbindung): einmal neu sicherstellen und dasselbe Bild wiederholen.
      if (isTimeout(e)) throw e;
      healthyAt = 0;
      if (!(await ensureFaceSidecar())) throw e;
      // Sichtbar machen, auch wenn der zweite Versuch gelingt: Sonst bliebe
      // ein Dienst, der immer wieder abbricht, in der Diagnose unbemerkt.
      const cause = e instanceof Error ? ((e.cause as { code?: string } | undefined)?.code ?? e.message) : String(e);
      log(`Face-Embed: Verbindung zum Gesichts-Dienst verloren (${cause}), Bild wird wiederholt`);
      improveCount("face", "retry");
      res = await post();
    }
    healthyAt = Date.now();
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log(`Face-Embed HTTP ${res.status}: ${errText.slice(0, 160) || "ohne Details"}`);
      improve("face", "error", { http: res.status });
      return null;
    }
    const data = (await res.json()) as {
      ok?: boolean;
      model?: string;
      faces?: SidecarFace[];
      /** `size` im Originalbild, `size_scaled` und `need` im verkleinerten Suchbild (aelterer Dienst: nur `size`, dort verkleinert). */
      rejected?: { det_score: number; size: number; size_scaled?: number; need: number }[];
      image?: { w?: number; h?: number; min_side?: number };
      upscaled?: boolean;
      region?: string;
      /** Der Dienst hat fuer dieses Bild beide Rechenwege gerechnet; Wert = der zweite Weg. */
      compared?: string;
      /** Sorte, die der zweite Weg fand (null = dort kein Gesicht). */
      other_region?: string | null;
      /** Gesichter, die nur der zweite Weg fand (dann ist `faces` leer). */
      faces_native?: SidecarFace[];
      faces_scaled?: SidecarFace[];
      /** Der Weg ueber das Originalbild ist gescheitert: Es gilt der bisherige, ohne Vergleich. */
      native_error?: boolean;
    };
    // Je Bild; die Ursache steht in der Zeile „[face] Weg über das Originalbild fehlgeschlagen: …“.
    if (data.native_error === true) improveCount("face", "native_error");
    const otherWay: OtherWay | undefined =
      data.compared === "native" || data.compared === "scaled" ? data.compared : undefined;
    const best = data.faces?.[0];
    if (!best?.embedding?.length) {
      if (otherWay) {
        noteOtherOnlyFace(otherWay, (otherWay === "native" ? data.faces_native : data.faces_scaled)?.[0], data.other_region);
      }
      const r = data.rejected?.[0];
      if (r) {
        log(
          `Face verworfen: det=${r.det_score.toFixed(2)} size=${r.size}px` +
            (r.size_scaled != null ? ` (verkleinert ${r.size_scaled}px, min ${r.need}px)` : ` (min ${r.need}px)`)
        );
        improve("face", "rejected", { det: r.det_score, size: r.size, scaled: r.size_scaled, need: r.need });
      } else {
        const img = data.image;
        const nRej = data.rejected?.length ?? 0;
        log(
          `Face: keine Detektion` +
            (img?.w ? ` (${img.w}x${img.h}, min ${img.min_side ?? "?" }px)` : "") +
            (nRej ? `, ${nRej} verworfen` : "")
        );
        improve("face", "none", { w: img?.w, h: img?.h, rejected: nRej });
      }
      return null;
    }
    if (data.upscaled) {
      log(
        `Face-Zoom: det=${best.det_score.toFixed(2)} region=${data.region ?? "zoom"}` +
          (best.size != null ? ` size≈${best.size}px` : "")
      );
      improve("face", data.region === "small_keep" ? "keep" : "zoom", {
        det: best.det_score,
        region: data.region,
        size: best.size,
      });
    } else {
      improve("face", "ok", { det: best.det_score, size: best.size, region: data.region });
    }
    let other: OtherFace | undefined;
    if (otherWay) {
      const second = otherWay === "native" ? best.embedding_native : best.embedding_scaled;
      other = { way: otherWay, embedding: second?.length ? second : null };
      // Dieses Gesicht fand nur der verwendete Weg.
      if (!other.embedding) improveCount("face", oneWayFaceCounter(otherWay, "used"));
    }
    return {
      embedding: best.embedding,
      detScore: best.det_score,
      bbox: best.bbox,
      model: data.model ?? "buffalo_l",
      upscaled: Boolean(data.upscaled),
      size: typeof best.size === "number" ? best.size : undefined,
      sizeScaled: typeof best.size_scaled === "number" ? best.size_scaled : undefined,
      frontal: typeof best.frontal === "number" ? best.frontal : undefined,
      sharp: typeof best.sharp === "number" ? best.sharp : undefined,
      region: typeof data.region === "string" ? data.region : undefined,
      other,
      imageW: typeof data.image?.w === "number" ? data.image.w : undefined,
      imageH: typeof data.image?.h === "number" ? data.image.h : undefined,
    };
  } catch (e) {
    healthyAt = 0;
    log(`Face-Embed fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    improve("face", "error", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function refreshGallery(force = false): Promise<void> {
  if (!force && Date.now() - galleryLoadedAt < GALLERY_TTL_MS) return;
  try {
    const res = await api("/api/hub/person-embeddings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings?: GalleryEntry[] };
    gallery = Array.isArray(data.embeddings) ? data.embeddings : [];
    galleryLoadedAt = Date.now();
    STATE.face.gallery = gallery.length;
    // Nur melden, wenn sich der Bestand aendert (vorher alle 5 Minuten dieselbe
    // Zeile) oder der Abruf davor gescheitert war.
    const signature = gallery.map((e) => `${e.id}:${e.listType}:${e.name}`).join("|");
    if (signature !== gallerySignature || galleryFailed) {
      log(`Face-Gallery: ${gallery.length} Embeddings${galleryFailed ? " (Abruf klappt wieder)" : ""}`);
    }
    gallerySignature = signature;
    if (galleryFailed) {
      galleryFailed = false;
      // Derselbe Grund soll nach einer Erholung wieder im Log stehen.
      galleryFailLog.shouldLog("fetch", "", Date.now());
    }
  } catch (e) {
    galleryFailed = true;
    const reason = e instanceof Error ? e.message : String(e);
    if (galleryFailLog.shouldLog("fetch", reason, Date.now())) log(`Face-Gallery Abruf fehlgeschlagen: ${reason}`);
  }
}

export function gallerySize(): number {
  return gallery.length;
}

export function scoreGallery(
  embedding: number[],
  opts?: { upscaled?: boolean }
): {
  match: { listedPersonId: number; name: string; score: number; listType: string } | null;
  nearest: { listedPersonId: number; name: string; score: number; listType: string } | null;
  /** Zweitbeste Person (nicht nur zweitbestes Merkmal). */
  second: { listedPersonId: number; name: string; score: number; listType: string } | null;
  /** Ueber der Schwelle, aber zu knapp vor der zweitbesten Person. */
  ambiguous: boolean;
  threshold: number;
  gallery: number;
} {
  const threshold = opts?.upscaled ? FACE_UPSCALED_THRESHOLD : FACE_MATCH_THRESHOLD;
  const r = rankGallery(embedding, gallery, threshold, FACE_MATCH_MARGIN);
  return { ...r, threshold, gallery: gallery.length };
}

export function matchEmbedding(
  embedding: number[],
  opts?: { upscaled?: boolean }
): { listedPersonId: number; name: string; score: number } | null {
  return scoreGallery(embedding, opts).match;
}

/**
 * Mitmessen des zweiten Rechenwegs (FACE_NATIVE shadow oder on): Das zweite
 * Merkmal des Gesichts mit derselben Schwelle gegen die Gallery werten und
 * neben das Ergebnis halten, das fuer die Sichtung gilt (`used`, aus
 * `face.embedding`). Gezaehlt wird jede Sichtung (`face.native_*`), ins Log
 * kommt nur eine Abweichung. Zurueck kommt, was fuer die Sichtung gilt:
 * Ergebnis und Merkmal des verwendeten Wegs, ausser in Stufe on trifft nur
 * das bisherige Merkmal eine Person der Sperrliste (compareWays
 * `applyOther`, Zaehler `face.native_blacklist_kept`); dann Ergebnis und
 * Merkmal des bisherigen Wegs, damit Person, Score und hochgeladenes
 * Merkmal zusammenpassen.
 */
export function noteOtherWay(
  where: string,
  face: FaceEmbedResult,
  used: ReturnType<typeof scoreGallery>
): AppliedScore {
  if (!face.other) return { scored: used, embedding: face.embedding };
  const other = face.other.embedding ? scoreGallery(face.other.embedding, { upscaled: face.upscaled }) : null;
  const verdict = compareWays(face.other.way, used, other, used.threshold, faceLabel(face));
  improveCount("face", verdict.counter);
  if (verdict.line) log(`${where}: ${verdict.line}`);
  if (verdict.applyOther && other && face.other.embedding) {
    improveCount("face", "native_blacklist_kept");
    return { scored: other, embedding: face.other.embedding };
  }
  return { scored: used, embedding: face.embedding };
}

/** Was fuer ein Gesicht gilt: Ergebnis des Abgleichs und das Merkmal dazu. */
export interface AppliedScore {
  scored: ReturnType<typeof scoreGallery>;
  embedding: number[];
}

/**
 * Dieselbe Regel wie noteOtherWay, ohne Zaehler und Log: fuer Pruefungen vor
 * der eigentlichen Sichtung (Treffer vor dem Zoom, Nahaufnahme). So zaehlt
 * auch dort ein Sperrlisten-Treffer, den in Stufe on nur das bisherige
 * Merkmal liefert.
 */
export function appliedScore(face: FaceEmbedResult): AppliedScore {
  const used = scoreGallery(face.embedding, { upscaled: face.upscaled });
  if (!face.other?.embedding) return { scored: used, embedding: face.embedding };
  const other = scoreGallery(face.other.embedding, { upscaled: face.upscaled });
  return compareWays(face.other.way, used, other, used.threshold).applyOther
    ? { scored: other, embedding: face.other.embedding }
    : { scored: used, embedding: face.embedding };
}

/**
 * Ein Bild, in dem nur der zweite Rechenweg ein Gesicht fand. Der Hub
 * verwendet es nicht: Fuer die Pipeline bleibt das Bild ohne Gesicht.
 */
function noteOtherOnlyFace(way: OtherWay, f: SidecarFace | undefined, region?: string | null): void {
  if (!f?.embedding?.length) return;
  const scored = scoreGallery(f.embedding, { upscaled: true });
  const label = faceLabel({ detScore: f.det_score, size: f.size, upscaled: true, region: region ?? undefined });
  const verdict = otherOnlyVerdict(way, scored, scored.threshold, label);
  for (const c of verdict.counters) improveCount("face", c);
  if (verdict.line) log(verdict.line);
}

/** Sighting-JPEG vom Cloud laden, embedden, Embedding speichern. */
export async function enrollFromSighting(
  sightingId: number,
  listedPersonId: number
): Promise<{ ok: boolean; error?: string; dims?: number }> {
  if (!(await ensureFaceSidecar())) {
    return { ok: false, error: "Face-Sidecar nicht erreichbar" };
  }
  const snap = await api(`/api/hub/person-sightings/${sightingId}/snapshot`);
  if (!snap.ok) return { ok: false, error: `Snapshot HTTP ${snap.status}` };
  const jpeg = Buffer.from(await snap.arrayBuffer());
  const face = await embedJpeg(jpeg);
  if (!face) return { ok: false, error: "Kein Gesicht im Schnappschuss" };

  const upload = await api("/api/hub/person-embeddings", {
    method: "POST",
    body: JSON.stringify({
      listedPersonId,
      embedding: face.embedding,
      model: face.model,
      sourceSightingId: sightingId,
    }),
  });
  if (!upload.ok) return { ok: false, error: `Upload HTTP ${upload.status}` };

  // Gallery invalidieren.
  galleryLoadedAt = 0;
  return { ok: true, dims: face.embedding.length };
}

/** Embedding als Header-Wert (Base64, Float32 LE) fuer den Sichtungs-Upload. */
export function embeddingHeader(embedding: number[]): string {
  const buf = Buffer.alloc(embedding.length * 4);
  embedding.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf.toString("base64");
}

/**
 * Unbekannte Sichtungen nachtraeglich analysieren (Task FACE_ANALYZE):
 * Bild holen, Gesicht embedden, Embedding (oder „kein Gesicht“) zurueckmelden.
 * Damit kann die Cloud aehnliche Gesichter gruppieren.
 */
export async function analyzeSightings(
  sightingIds: number[]
): Promise<{ ok: boolean; error?: string; analyzed: number; faces: number; failed: number }> {
  if (!(await ensureFaceSidecar())) {
    return { ok: false, error: "Face-Sidecar nicht erreichbar", analyzed: 0, faces: 0, failed: 0 };
  }
  let analyzed = 0;
  let faces = 0;
  let failed = 0;
  for (const id of sightingIds) {
    try {
      const snap = await api(`/api/hub/person-sightings/${id}/snapshot`);
      if (!snap.ok && snap.status !== 404) {
        failed++;
        continue;
      }
      // 404 = Bild weg (Aufbewahrung): als „kein Gesicht“ melden, sonst kaeme
      // die Sichtung in jedem Analyse-Stapel wieder.
      const face = snap.ok ? await embedJpeg(Buffer.from(await snap.arrayBuffer())) : null;
      const res = await api(`/api/hub/person-sightings/${id}/embedding`, {
        method: "POST",
        body: JSON.stringify({ embedding: face?.embedding ?? null }),
      });
      if (!res.ok) {
        failed++;
        continue;
      }
      analyzed++;
      if (face) faces++;
    } catch {
      failed++;
    }
  }
  log(`Face-Analyse: ${analyzed} Sichtungen, ${faces} mit Gesicht, ${failed} Fehler`);
  return { ok: true, analyzed, faces, failed };
}
