/**
 * Face-Matching am Hub: spricht den lokalen InsightFace-Sidecar an,
 * haelt die Embedding-Gallery und matched per Cosine-Similarity.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { CONFIG, api, log } from "./config.js";
import { improve } from "./improve-log.js";
import { STATE } from "./state.js";
import { rankGallery } from "./face-rules.js";

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
  /** Kantenlaenge in Originalpixeln, Frontal-/Schaerfewert 0..1 (neuer Face-Dienst). */
  size?: number;
  frontal?: number;
  sharp?: number;
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
let sidecarProc: ChildProcess | null = null;
let sidecarStarting: Promise<void> | null = null;

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(`${FACE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Startet den Python-Sidecar falls noetig (venv unter hub/face/.venv). */
export async function ensureFaceSidecar(): Promise<boolean> {
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
    sidecarProc.stdout?.on("data", (d) => {
      const line = String(d).trim();
      if (line) log(`[face] ${line}`);
    });
    sidecarProc.stderr?.on("data", (d) => {
      const line = String(d).trim();
      if (line) log(`[face] ${line}`);
    });
    sidecarProc.on("exit", (code) => {
      log(`Face-Sidecar beendet (code ${code})`);
      sidecarProc = null;
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
    const res = await fetch(`${FACE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(jpeg),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log(`Face-Embed HTTP ${res.status}: ${errText.slice(0, 160) || "ohne Details"}`);
      improve("face", "error", { http: res.status });
      return null;
    }
    const data = (await res.json()) as {
      ok?: boolean;
      model?: string;
      faces?: { embedding: number[]; det_score: number; bbox: number[]; size?: number; frontal?: number; sharp?: number }[];
      rejected?: { det_score: number; size: number; need: number }[];
      image?: { w?: number; h?: number; min_side?: number };
      upscaled?: boolean;
      region?: string;
    };
    const best = data.faces?.[0];
    if (!best?.embedding?.length) {
      const r = data.rejected?.[0];
      if (r) {
        log(
          `Face verworfen: det=${r.det_score.toFixed(2)} size=${r.size}px (min ${r.need}px)`
        );
        improve("face", "rejected", { det: r.det_score, size: r.size, need: r.need });
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
    return {
      embedding: best.embedding,
      detScore: best.det_score,
      bbox: best.bbox,
      model: data.model ?? "buffalo_l",
      upscaled: Boolean(data.upscaled),
      size: typeof best.size === "number" ? best.size : undefined,
      frontal: typeof best.frontal === "number" ? best.frontal : undefined,
      sharp: typeof best.sharp === "number" ? best.sharp : undefined,
    };
  } catch (e) {
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
    log(`Face-Gallery: ${gallery.length} Embeddings`);
  } catch (e) {
    log(`Face-Gallery Abruf fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
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
