/**
 * Geburtstag in der Kunden-App: reine Rechenlogik ohne Datenbank, damit
 * Client-Komponenten (Verwaltung, Audio) und Tests sie nutzen dürfen.
 *
 * Das Geburtsdatum steht am Profil (`RiderProfile.birthDate`, UTC-Mitternacht,
 * die Person pflegt es selbst unter Profil). Wer am 29. Februar geboren ist,
 * feiert in Jahren ohne Schalttag am 28. Februar.
 */
import { isTestTitle, type AnnounceText } from "./rider-announce-rules";

export const BIRTHDAY_DEFAULT_TITLE = "Alles Gute zum Geburtstag";
export const BIRTHDAY_DEFAULT_ANNOUNCE =
  "Herzlichen Glückwunsch zum Geburtstag, {vorname}! Das ganze Team wünscht dir einen tollen Tag auf dem Wasser.";
export const BIRTHDAY_ANNOUNCE_MAX = 300;

const pad = (n: number) => String(n).padStart(2, "0");

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Der Geburtstag im Jahr `year` als „YYYY-MM-DD“. */
export function birthdayInYear(birthDate: Date, year: number): string {
  const m = birthDate.getUTCMonth() + 1;
  let d = birthDate.getUTCDate();
  if (m === 2 && d === 29 && !isLeapYear(year)) d = 28;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/** Hat die Person am Tag `ymd` („YYYY-MM-DD“, Berlin) Geburtstag? */
export function isBirthdayOn(birthDate: Date | null | undefined, ymd: string): boolean {
  if (!birthDate || Number.isNaN(birthDate.getTime())) return false;
  const year = Number(ymd.slice(0, 4));
  // Nicht am Tag der Geburt selbst und nie für Daten in der Zukunft.
  if (birthDate.getUTCFullYear() >= year) return false;
  return birthdayInYear(birthDate, year) === ymd;
}

/** Alter, das die Person am Tag `ymd` wird (am Geburtstag selbst). */
export function ageOn(birthDate: Date, ymd: string): number {
  return Number(ymd.slice(0, 4)) - birthDate.getUTCFullYear();
}

/** Überschrift in der App: „Alles Gute zum Geburtstag, Mia“. */
export function birthdayTitle(title: string | null | undefined, firstName: string | null | undefined): string {
  const base = title?.trim() || BIRTHDAY_DEFAULT_TITLE;
  const name = firstName?.trim();
  return name && !/\{vorname\}/i.test(base) ? `${base}, ${name}` : fillName(base, name ?? null);
}

/**
 * `{vorname}` im Text ersetzen. Ohne Namen (abgeschaltet oder unbekannt)
 * fällt der Platzhalter samt Komma davor weg: „…zum Geburtstag, {vorname}!“
 * wird zu „…zum Geburtstag!“.
 */
export function fillName(text: string, firstName: string | null): string {
  const name = firstName?.trim();
  if (name) return text.replace(/\{\s*vorname\s*\}/gi, name);
  return text
    .replace(/,?\s*\{\s*vorname\s*\}/gi, "")
    .replace(/\s+([!?.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Text der Geburtstags-Durchsage für eine Person. */
export function birthdayAnnounceText(
  s: { announceText: string | null; announceName: boolean },
  firstName: string | null,
): string {
  const template = s.announceText?.trim() || BIRTHDAY_DEFAULT_ANNOUNCE;
  return fillName(template, s.announceName ? firstName : null).slice(0, BIRTHDAY_ANNOUNCE_MAX);
}

function sentence(t: string): string {
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export interface BirthdayPushSettings {
  title: string | null;
  text: string | null;
  voucherLabel: string | null;
}

/**
 * Push am Geburtstag. `forOther`: Das Geburtstagskind ist ein Kind der
 * Familie ohne eigenes Gerät, die Nachricht geht an die Eltern.
 */
export function birthdayPushText(s: BirthdayPushSettings, firstName: string | null, forOther = false): AnnounceText {
  const name = firstName?.trim() || null;
  const gift = s.voucherLabel?.trim() ? `In der App wartet ein Geschenk: ${sentence(s.voucherLabel.trim())}` : "";
  if (forOther && name) {
    return { title: `Heute hat ${name} Geburtstag`, body: gift || "Wir gratulieren herzlich." };
  }
  const text = s.text?.trim() ? sentence(fillName(s.text.trim(), name)) : "";
  return {
    title: birthdayTitle(s.title, name),
    body: [text, gift].filter(Boolean).join(" ") || "Wir wünschen dir einen tollen Tag.",
  };
}

/** Warum der Geburtstags-Push gerade nicht geht; null = senden. */
export function birthdayPushBlock(
  s: { active: boolean; pushPlanned: boolean; title: string | null },
): "not-planned" | "off" | "test" | null {
  if (!s.pushPlanned) return "not-planned";
  if (!s.active) return "off";
  if (s.title && isTestTitle(s.title)) return "test";
  return null;
}

/** Zonen-IDs aus dem JSON-Feld, nur positive ganze Zahlen. */
export function parseBirthdayZoneIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is number => Number.isInteger(v) && v > 0))];
}
