/**
 * Prueft die Faelligkeitslogik der Audio-Zeitplaene
 * (`isScheduleDue` in src/lib/audio-constants.ts).
 *
 * Die beiden entscheidenden Zusicherungen:
 *   1. Eine Durchsage laeuft pro Tag genau einmal – auch wenn Vercel mehrere
 *      Cron-Ticks im Nachholfenster ausfuehrt.
 *   2. Sie fallt nicht aus, wenn Ticks verloren gehen; das Fenster holt sie nach.
 * Beides laesst sich nur in der Zeitrechnung pruefen, nicht am laufenden System:
 * ein Fehler faellt dort erst auf, wenn eine Ansage stumm bleibt.
 *
 * Ausfuehren: npx tsx scripts/audio-schedule-check.ts
 */

import { SCHEDULE_WINDOW_MINUTES, isScheduleDue } from "../src/lib/audio-constants";

const TZ = "Europe/Berlin";
const DAILY = 127;
const MONDAY = 1;
const WEEKEND = 96;

let failed = 0;

function check(label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FEHL "} ${label}`);
  if (!ok) console.log(`        erwartet: ${expected}, war: ${actual}`);
}

// 1) Fenster und Wochentage. Berlin liegt Ende Juli auf UTC+2, 08:00 Uhr UTC
//    ist also 10:00 Uhr Ortszeit an einem Freitag.
const cases: Array<[string, string, number, string, string | null, boolean]> = [
  ["genau zur Minute", "10:00", DAILY, "2026-07-31T08:00:00Z", null, true],
  ["eine Minute spaeter (Tick verzoegert)", "10:00", DAILY, "2026-07-31T08:01:00Z", null, true],
  ["vier Minuten spaeter (Ticks ausgefallen)", "10:00", DAILY, "2026-07-31T08:04:00Z", null, true],
  ["fuenf Minuten spaeter: Fenster zu", "10:00", DAILY, "2026-07-31T08:05:00Z", null, false],
  ["eine Minute zu frueh", "10:00", DAILY, "2026-07-31T07:59:00Z", null, false],
  ["heute schon gelaufen", "10:00", DAILY, "2026-07-31T08:02:00Z", "2026-07-31T08:00:00Z", false],
  ["gestern gelaufen: heute wieder", "10:00", DAILY, "2026-07-31T08:00:00Z", "2026-07-30T08:00:00Z", true],
  ["nur Montag, heute Freitag", "10:00", MONDAY, "2026-07-31T08:00:00Z", null, false],
  ["nur Wochenende, Samstag", "10:00", WEEKEND, "2026-08-01T08:00:00Z", null, true],
  ["Mitternacht", "00:00", DAILY, "2026-07-30T22:00:00Z", null, true],
  // Uhrzeit nachtraeglich nach hinten verschoben: der Lauf von heute Morgen
  // darf den neuen Termin nicht blockieren.
  ["heute frueher gelaufen, neuer Termin", "12:00", DAILY, "2026-07-31T10:00:00Z", "2026-07-31T08:00:00Z", true],
];

for (const [label, timeOfDay, daysOfWeek, nowIso, lastIso, expected] of cases) {
  const actual = isScheduleDue(
    { timeOfDay, daysOfWeek, lastRunAt: lastIso ? new Date(lastIso) : null },
    new Date(nowIso),
    TZ
  );
  check(label, actual, expected);
}

// 2) Sommer-/Winterzeit. "10:00" muss Ortszeit bleiben, sonst wandert jede
//    Durchsage im Herbst um eine Stunde.
console.log("");
const dst: Array<[string, string, boolean]> = [
  ["Winterzeit: 09:00 UTC ist 10:00 in Berlin", "2026-01-30T09:00:00Z", true],
  ["Winterzeit: 08:00 UTC ist erst 09:00", "2026-01-30T08:00:00Z", false],
  ["Sommerzeit: 08:00 UTC ist 10:00 in Berlin", "2026-07-31T08:00:00Z", true],
  ["Sommerzeit: 09:00 UTC ist schon 11:00", "2026-07-31T09:00:00Z", false],
];
for (const [label, nowIso, expected] of dst) {
  const actual = isScheduleDue(
    { timeOfDay: "10:00", daysOfWeek: DAILY, lastRunAt: null },
    new Date(nowIso),
    TZ
  );
  check(label, actual, expected);
}

// 3) Ein ganzer Tag im Minutentakt. Das ist die Probe auf die Praxis: der Cron
//    ruft 1440-mal auf, ausloesen darf genau ein Aufruf.
console.log("");

/** Simuliert einen Tag und gibt zurueck, wann ausgeloest wurde. */
function simulateDay(dropRate: number, seed: number): string[] {
  // Deterministischer Pseudozufall, damit ein Fehlschlag reproduzierbar ist.
  let state = seed;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  const dayStart = Date.UTC(2026, 6, 30, 22, 0, 0); // 31.07.2026, 00:00 Berlin
  let lastRunAt: Date | null = null;
  const fired: string[] = [];

  for (let minute = 0; minute < 1440; minute++) {
    if (random() < dropRate) continue; // Tick ausgefallen
    const now = new Date(dayStart + minute * 60_000);
    if (isScheduleDue({ timeOfDay: "18:30", daysOfWeek: DAILY, lastRunAt }, now, TZ)) {
      lastRunAt = now;
      fired.push(
        new Intl.DateTimeFormat("de-DE", {
          timeZone: TZ,
          hour: "2-digit",
          minute: "2-digit",
        }).format(now)
      );
    }
  }
  return fired;
}

const scenarios: Array<[string, number, number]> = [
  ["alle Ticks laufen", 0, 1],
  ["ein Drittel der Ticks faellt aus", 0.34, 7],
  ["zwei Drittel der Ticks fallen aus", 0.67, 23],
];

for (const [label, dropRate, seed] of scenarios) {
  const fired = simulateDay(dropRate, seed);
  const ok = fired.length === 1;
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FEHL "} ${label}: ${fired.length}x ausgeloest${
      fired.length > 0 ? ` (${fired.join(", ")})` : ""
    }`
  );
  if (!ok) console.log("        erwartet: genau 1x");
}

// Bei einem Ausfall von 4 aufeinanderfolgenden Ticks ist das Fenster zu. Das
// ist die bewusste Grenze: eine Durchsage soll nicht beliebig spaet kommen.
console.log(`\nNachholfenster: ${SCHEDULE_WINDOW_MINUTES} Minuten`);

console.log(failed === 0 ? "\nAlle Pruefungen bestanden." : `\n${failed} Pruefung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
