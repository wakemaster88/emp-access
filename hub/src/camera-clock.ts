/**
 * Uhrzeit der Kameras gegen den Hub (rein, testbar).
 *
 * Reolink meldet in GetTime die Wanduhr, die auch im Bild eingeblendet ist
 * (Jahr … Sekunde). Verglichen wird mit der Berliner Wanduhr des Hubs, so
 * faellt ein falscher Zeitzonen- oder Sommerzeit-Eintrag als ±3600 s auf.
 */
export interface ReolinkTime {
  year: number;
  mon: number;
  day: number;
  hour: number;
  min: number;
  sec: number;
}

/** Komponenten einer Zeit als Berliner Wanduhr. */
export function berlinWall(at: Date): ReolinkTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: n("year"), mon: n("month"), day: n("day"), hour: n("hour"), min: n("minute"), sec: n("second") };
}

function wallMs(t: ReolinkTime): number {
  return Date.UTC(t.year, t.mon - 1, t.day, t.hour, t.min, t.sec);
}

/** Abweichung der Kamera-Uhr in Sekunden (positiv = Kamera geht vor). */
export function clockOffsetSeconds(camera: ReolinkTime, hubNow: Date): number {
  return Math.round((wallMs(camera) - wallMs(berlinWall(hubNow))) / 1000);
}

/** Ab dieser Abweichung zeigt die Zentrale einen Hinweis. */
export const CLOCK_WARN_S = 3;
