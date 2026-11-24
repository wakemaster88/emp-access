/**
 * Persönliche Daten in der Kunden-App: Vorname, Nachname, Geburtsdatum und
 * Profilbild. Sie gehören der Person (`RiderProfile`), nicht dem Abo. Kasse,
 * Scanner und Backend zeigen sie über `riderView`; die Rohdaten am Ticket
 * (bei anny die des Kontoinhabers) bleiben, wie sie sind.
 */
import { prisma } from "./prisma";
import { aboNamesRider, isKidsSubscriptionName } from "./customer-person";
import { PROFILE_PHOTO_MAX_CHARS, profilePhotoError } from "./photo-url";

/** Größtes Profilbild als Data-URL. Die App verkleinert vorher auf 320 px (ca. 30 KB). */
export const PHOTO_MAX_CHARS = PROFILE_PHOTO_MAX_CHARS;
/** Ältestes Geburtsjahr, das die App annimmt. */
export const BIRTH_YEAR_MIN = 1900;
const NAME_MAX = 60;

/** Ohne `firstName` (undefined) ändert sich nur das Profilbild. */
export interface PersonInput {
  firstName?: string;
  lastName?: string;
  /** `YYYY-MM-DD` oder leer. */
  birthDate?: string | null;
  /** Data-URL; `null` entfernt das Bild, fehlt das Feld, bleibt es. */
  photo?: string | null;
}

export interface PersonData {
  firstName?: string;
  lastName?: string;
  birthDate?: Date | null;
  photo?: string | null;
}

function cleanName(v: string): string {
  return v.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
}

/** Eingabe prüfen; liefert die zu speichernden Werte oder einen Satz für den Kunden. */
export function parsePersonInput(input: PersonInput, now: Date = new Date()): { data: PersonData } | { error: string } {
  const data: PersonData = {};
  if (input.firstName !== undefined || input.lastName !== undefined || input.birthDate !== undefined) {
    const person = parseNames(input, now);
    if ("error" in person) return person;
    Object.assign(data, person);
  }
  if (input.photo !== undefined) {
    if (input.photo === null || input.photo === "") {
      data.photo = null;
    } else {
      const photoError = profilePhotoError(input.photo);
      if (photoError) return { error: photoError };
      data.photo = input.photo.trim();
    }
  }
  if (Object.keys(data).length === 0) return { error: "Nichts zu speichern." };
  return { data };
}

function parseNames(input: PersonInput, now: Date): { firstName: string; lastName: string; birthDate: Date | null } | { error: string } {
  const firstName = cleanName(input.firstName ?? "");
  const lastName = cleanName(input.lastName ?? "");
  if (!firstName || !lastName) return { error: "Bitte Vor- und Nachnamen eintragen." };

  let birthDate: Date | null = null;
  const raw = input.birthDate?.trim();
  if (raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    // 2026-02-31 würde sonst still zum 3. März.
    if (!date || isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return { error: "Das Geburtsdatum stimmt nicht." };
    if (date.getUTCFullYear() < BIRTH_YEAR_MIN || date.getTime() > now.getTime()) return { error: "Das Geburtsdatum stimmt nicht." };
    birthDate = date;
  }
  return { firstName, lastName, birthDate };
}

/** Initialen für das runde Bild ohne Foto. */
export function initials(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const a = firstName?.trim().charAt(0) ?? "";
  const b = lastName?.trim().charAt(0) ?? "";
  return (a + b).toUpperCase() || "?";
}

/** Adresse des Profilbilds; `v` ändert sich mit jeder Änderung am Profil (Cache-Schlüssel). */
export function riderPhotoUrl(token: string, updatedAt: Date): string {
  return `/api/rider/${encodeURIComponent(token)}/person/photo?v=${updatedAt.getTime()}`;
}

export interface RiderPersonView {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD` oder null. */
  birthDate: string | null;
  /** Adresse des Profilbilds (`riderPhotoUrl`); null ohne Bild. */
  photoUrl: string | null;
  email: string | null;
  /** Die Daten stehen noch nicht an der Person, sondern kommen vom Abo. */
  fromAbo: boolean;
}

/**
 * Daten der Person für das Profil. Hat die Person noch keine eigenen, gelten
 * die des jüngsten Abos, das den Fahrer nennt (nicht ein Kids-Abo mit den
 * Daten der Eltern).
 */
export async function loadRiderPerson(token: string, now: Date = new Date()): Promise<RiderPersonView | null> {
  // Das Bild selbst (Data-URL) bleibt in der Datenbank; die Seite bekommt nur seine Adresse.
  const [p, withPhoto] = await Promise.all([
    prisma.riderProfile.findUnique({
      where: { token },
      select: {
        firstName: true,
        lastName: true,
        birthDate: true,
        updatedAt: true,
        email: true,
        customer: { select: { email: true } },
        tickets: {
          select: { firstName: true, lastName: true, birthDate: true, startDate: true, email: true, subscription: { select: { name: true } } },
          orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { id: "desc" }],
          take: 20,
        },
      },
    }),
    prisma.riderProfile.count({ where: { token, AND: [{ photo: { not: null } }, { photo: { not: "" } }] } }),
  ]);
  if (!p) return null;
  const own = !!(p.firstName?.trim() || p.lastName?.trim());
  const abo = own
    ? null
    : p.tickets.find((t) => (t.firstName?.trim() || t.lastName?.trim()) && aboNamesRider({ ...t, kids: isKidsSubscriptionName(t.subscription?.name) }, now));
  const src = own ? p : abo;
  return {
    firstName: src?.firstName?.trim() ?? "",
    lastName: src?.lastName?.trim() ?? "",
    birthDate: src?.birthDate ? src.birthDate.toISOString().slice(0, 10) : null,
    photoUrl: withPhoto > 0 ? riderPhotoUrl(token, p.updatedAt) : null,
    email: p.email ?? p.customer?.email ?? p.tickets.find((t) => t.email)?.email?.trim().toLowerCase() ?? null,
    fromAbo: !own && !!abo,
  };
}
