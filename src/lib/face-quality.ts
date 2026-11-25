/**
 * Güte des Gesichts einer Kamera-Sichtung, wie der Hub sie mit dem Upload
 * schickt (POST /api/hub/person-sightings, Query-Parameter):
 *  - faceSize: Kantenlänge des Gesichts in dem Bild, aus dem sein Merkmal
 *    stammt (direkt gefundene Gesichter: Suchbild bis 1920 px; hochgerechnete:
 *    Kamerabild)
 *  - faceUpscaled: 1 = für die Erkennung hochgerechnet (Mini-Gesicht,
 *    Kopf-Ausschnitt), 0 = direkt gefunden
 *  - faceDetScore: Sicherheit des Gesichts-Detektors 0..1
 *  - faceMargin: Abstand des besten Galerie-Werts zur zweitbesten Person
 *
 * Jede Angabe wird für sich geprüft; außerhalb des Bereichs oder fehlend
 * gilt null. Ein älterer Hub schickt keine davon: Die Sichtung wird wie
 * bisher gespeichert, die Spalten bleiben null.
 *
 * Reine Logik ohne Prisma.
 */

export interface SightingFaceQuality {
  faceSize: number | null;
  faceUpscaled: boolean | null;
  faceDetScore: number | null;
  faceMargin: number | null;
}

/** Ohne Güte-Angaben (älterer Hub, Sichtung von Hand). */
export const NO_FACE_QUALITY: SightingFaceQuality = {
  faceSize: null,
  faceUpscaled: null,
  faceDetScore: null,
  faceMargin: null,
};

/** Größer ist kein Gesicht in einem Kamerabild (8K-Panorama: 7680 px Breite). */
const MAX_FACE_SIZE = 8000;

/** Nur einfache Dezimalzahlen, wie der Hub sie schickt (kein 0x40, 1e2, Leerzeichen). */
const DECIMAL = /^\d+(\.\d+)?$/;

function numberIn(raw: string | null, min: number, max: number): number | null {
  if (raw == null || !DECIMAL.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function flag(raw: string | null): boolean | null {
  const v = raw?.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return null;
}

/** Güte-Angaben aus den Query-Parametern des Uploads lesen. */
export function parseFaceQuality(q: URLSearchParams): SightingFaceQuality {
  return {
    faceSize: numberIn(q.get("faceSize"), 1, MAX_FACE_SIZE),
    faceUpscaled: flag(q.get("faceUpscaled")),
    faceDetScore: numberIn(q.get("faceDetScore"), 0, 1),
    // Kosinus-Differenz: der beste Wert liegt nie unter dem zweitbesten.
    faceMargin: numberIn(q.get("faceMargin"), 0, 2),
  };
}
