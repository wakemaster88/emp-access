/**
 * Regel-Version eines Kontos fuer den Plan des Hubs.
 *
 * Der Hub haelt einen Plan fuer den Notbetrieb (`GET /api/hub/rules`, 48 h).
 * Statt ihn alle 15 Minuten neu zu holen, vergleicht er die Version aus dem
 * Lebenszeichen (`POST /api/hub/heartbeat`, `ruleVersion`) mit der Version
 * seines Plans und holt ihn sofort, wenn sie sich unterscheiden, sonst alle
 * 6 Stunden (hub/src/rule-plan-rules.ts, `planRefreshDue`).
 *
 * Die Version haengt nur von dem ab, was den Plan bestimmt: Anzahl und letzte
 * Aenderung der Regeln (`configChangedAt`, nicht `updatedAt`, das jeder Lauf
 * setzt), der Raeume (Betriebszeit des Raums) und der Betriebszeiten. Wer
 * eine Betriebszeit oder einen Raum bearbeitet, setzt deren `updatedAt`;
 * Saisons und Ausnahmetage werden nur zusammen mit ihrem Profil gespeichert.
 * Loeschen aendert die Anzahl.
 *
 * Dazu die Felder anderer Tabellen, die `buildHubRulePlan` liest: Raum und
 * Aktiv von Kameras (Kameras einer Bewegungs-Regel), Typ, Kategorie, IP,
 * Hue-Lampe, Aktiv und Raum von Geraeten (ob der Hub eine Regel selbst
 * ausfuehrt) sowie Zeitzone und Standort des Kontos (Termine, Dunkelheit).
 * `updatedAt` taugt dort nicht, weil Lebenszeichen und Status es laufend
 * setzen; die Abfrage bildet stattdessen einen Fingerabdruck genau dieser
 * Felder.
 *
 * Regeln, die gebuchte Termine mitnehmen (`BOOKED_SUBPROFILES`), haengen an
 * Buchungen, die laufend dazukommen. Solange es eine aktive gibt, wechselt die
 * Version alle 15 Minuten: Der Plan bleibt so frisch wie mit dem festen Takt.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/** Takt fuer Konten mit Regeln zu gebuchten Terminen, wie der fruehere feste Takt. */
export const BOOKED_PLAN_REFRESH_MS = 15 * 60_000;

/** Was die Version bestimmt, je Konto. */
export interface RuleVersionInput {
  accountId: number;
  rules: number;
  /** Spaeteste Aenderung einer Regel (`configChangedAt`, sonst `createdAt`). */
  rulesAt: Date | null;
  /** Aktive Regeln, die gebuchte Termine mitnehmen. */
  booked: number;
  rooms: number;
  roomsAt: Date | null;
  schedules: number;
  schedulesAt: Date | null;
  /** Fingerabdruck von Raum und Aktiv aller Kameras des Kontos. */
  camerasSig: string | null;
  /** Fingerabdruck von Typ, Kategorie, IP, Hue-Lampe, Aktiv und Raum aller Geraete des Kontos. */
  devicesSig: string | null;
  /** Zeitzone und Standort des Kontos. */
  accountSig: string | null;
}

function ms(at: Date | null): number {
  return at ? at.getTime() : 0;
}

/** Version als kurze Zeichenkette; gleiche Eingaben ergeben dieselbe Version. */
export function ruleVersion(input: RuleVersionInput, now: Date): string {
  const parts = [
    input.accountId,
    input.rules,
    ms(input.rulesAt),
    input.rooms,
    ms(input.roomsAt),
    input.schedules,
    ms(input.schedulesAt),
    input.booked > 0 ? Math.floor(now.getTime() / BOOKED_PLAN_REFRESH_MS) : 0,
    input.camerasSig ?? "",
    input.devicesSig ?? "",
    input.accountSig ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * Eine Abfrage fuer alle Teile der Version; Zaehler als ganze Zahlen,
 * Fingerabdruecke als md5 der Felder je Zeile (nach ID geordnet,
 * `json_build_array` haelt leere Felder auseinander).
 */
export async function loadRuleVersion(db: PrismaClient, accountId: number, now: Date = new Date()): Promise<string> {
  const rows = await db.$queryRaw<Array<Omit<RuleVersionInput, "accountId">>>`
    SELECT
      (SELECT count(*)::int FROM "RoomRule" WHERE "accountId" = ${accountId}) AS "rules",
      (SELECT max(COALESCE("configChangedAt", "createdAt")) FROM "RoomRule" WHERE "accountId" = ${accountId}) AS "rulesAt",
      (SELECT count(*)::int FROM "RoomRule"
        WHERE "accountId" = ${accountId} AND "isActive" AND "operatingExtent" = 'BOOKED_SUBPROFILES') AS "booked",
      (SELECT count(*)::int FROM "KeyRoom" WHERE "accountId" = ${accountId}) AS "rooms",
      (SELECT max("updatedAt") FROM "KeyRoom" WHERE "accountId" = ${accountId}) AS "roomsAt",
      (SELECT count(*)::int FROM "OperatingSchedule" WHERE "accountId" = ${accountId}) AS "schedules",
      (SELECT max("updatedAt") FROM "OperatingSchedule" WHERE "accountId" = ${accountId}) AS "schedulesAt",
      (SELECT md5(string_agg(json_build_array("id", "keyRoomId", "enabled")::text, ',' ORDER BY "id"))
        FROM "Camera" WHERE "accountId" = ${accountId}) AS "camerasSig",
      (SELECT md5(string_agg(
          json_build_array("id", "type", "category", "ipAddress", "hueBridgeId", "hueLightId", "isActive", "keyRoomId")::text,
          ',' ORDER BY "id"))
        FROM "Device" WHERE "accountId" = ${accountId}) AS "devicesSig",
      (SELECT json_build_array("timezone", "latitude", "longitude")::text
        FROM "Account" WHERE "id" = ${accountId}) AS "accountSig"
  `;
  const row = rows[0];
  return ruleVersion(
    {
      accountId,
      rules: Number(row?.rules ?? 0),
      rulesAt: row?.rulesAt ?? null,
      booked: Number(row?.booked ?? 0),
      rooms: Number(row?.rooms ?? 0),
      roomsAt: row?.roomsAt ?? null,
      schedules: Number(row?.schedules ?? 0),
      schedulesAt: row?.schedulesAt ?? null,
      camerasSig: row?.camerasSig ?? null,
      devicesSig: row?.devicesSig ?? null,
      accountSig: row?.accountSig ?? null,
    },
    now,
  );
}
