/**
 * Startseite der Kunden-App: Werte, die für alle Kunden eines Betriebs gleich
 * sind (Öffnungszeiten, Auslastung Lift und Strandbad, News und Angebote,
 * Luft und Wasser), 30 s im Speicher je Instanz. Wie `configCache` in
 * gamification-service: jeder Schlüssel enthält den Mandanten. Persönliche
 * Werte (eigene Statistik, Gutscheine, Stimmen, Platz) gehören nicht hierher.
 */
import { createTtlCache } from "./ttl-cache";
import { loadRiderOccupancy, type RiderOccupancy } from "./rider-occupancy";
import { loadBeachOpening, loadRiderOpening, type RiderOpening } from "./rider-opening";
import { loadBeachOccupancy, type BeachOccupancy } from "./beach-occupancy";
import { loadRiderOffers, type RiderOfferView } from "./rider-challenges";
import { loadWaterNow } from "./gamification-service";
import { loadAirNow } from "./weather-history";
import type { PassKind } from "./rider-pass";

const HOME_TTL_MS = 30_000;
const opts = { maxEntries: 50 };

const occupancyCache = createTtlCache<RiderOccupancy | null>(HOME_TTL_MS, opts);
const openingCache = createTtlCache<RiderOpening | null>(HOME_TTL_MS, opts);
const beachOpeningCache = createTtlCache<(RiderOpening & { scheduleName: string }) | null>(HOME_TTL_MS, opts);
const beachCache = createTtlCache<BeachOccupancy | null>(HOME_TTL_MS, opts);
const offersCache = createTtlCache<RiderOfferView[]>(HOME_TTL_MS, opts);
const tempCache = createTtlCache<number | null>(HOME_TTL_MS, opts);

export function homeOccupancy(accountId: number): Promise<RiderOccupancy | null> {
  return occupancyCache.get(String(accountId), () => loadRiderOccupancy(accountId));
}

export function homeOpening(accountId: number): Promise<RiderOpening | null> {
  return openingCache.get(String(accountId), () => loadRiderOpening(accountId));
}

export function homeBeachOpening(accountId: number): Promise<(RiderOpening & { scheduleName: string }) | null> {
  return beachOpeningCache.get(String(accountId), () => loadBeachOpening(accountId));
}

export function homeBeachOccupancy(accountId: number): Promise<BeachOccupancy | null> {
  return beachCache.get(String(accountId), () => loadBeachOccupancy(accountId));
}

/** News oder Angebote für einen Pass. */
export function homeOffers(accountId: number, pass: PassKind, kind: "OFFER" | "NEWS"): Promise<RiderOfferView[]> {
  return offersCache.get(`${accountId}:${pass}:${kind}`, () => loadRiderOffers(accountId, pass, undefined, kind));
}

export function homeAir(accountId: number): Promise<number | null> {
  return tempCache.get(`air:${accountId}`, () => loadAirNow(accountId));
}

export function homeWater(accountId: number): Promise<number | null> {
  return tempCache.get(`water:${accountId}`, () => loadWaterNow(accountId));
}
