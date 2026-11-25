import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_RULES_OFF,
  ACCESS_RULE_CHANGES_KEPT,
  ACCESS_RULE_TEXTS,
  anyAccessRuleOn,
  decidePassback,
  deniesRedeemedAtHandscanner,
  deniesUnassignedReader,
  deniesUnassignedTicket,
  deniesVoucherArea,
  diffAccessRules,
  evaluatePassback,
  mergeAccessRulesPatch,
  parseAccessRuleChanges,
  parseAccessRules,
  readerHasArea,
  redeemedMessage,
  splitPassbackAreas,
  voucherAreaIds,
  type AccessRules,
} from "./access-rules";

const on = (patch: Partial<AccessRules>): AccessRules => ({ ...ACCESS_RULES_OFF, ...patch });

test("parseAccessRules: alles Fehlende oder Kaputte ist aus", () => {
  for (const raw of [null, undefined, "x", 3, [], [true], {}]) {
    assert.deepEqual(parseAccessRules(raw), ACCESS_RULES_OFF);
  }
  assert.deepEqual(
    parseAccessRules({
      readerNeedsArea: "true",
      ticketNeedsArea: 1,
      handscannerDenyRedeemed: null,
      voucherNeedsArea: {},
      passbackMinutes: "10",
    }),
    ACCESS_RULES_OFF,
  );
  for (const m of [0, -5, 0.5, 10.5, 121, 1000, NaN, Infinity]) {
    assert.equal(parseAccessRules({ passbackMinutes: m }).passbackMinutes, 0, String(m));
  }
  assert.equal(anyAccessRuleOn(parseAccessRules(null)), false);
});

test("parseAccessRules: gesetzte Regeln, unbekannte Schlüssel ignoriert", () => {
  const r = parseAccessRules({
    readerNeedsArea: true,
    ticketNeedsArea: false,
    handscannerDenyRedeemed: true,
    voucherNeedsArea: true,
    passbackMinutes: 10,
    changes: [],
    unbekannt: true,
  });
  assert.deepEqual(r, {
    readerNeedsArea: true,
    ticketNeedsArea: false,
    handscannerDenyRedeemed: true,
    voucherNeedsArea: true,
    passbackMinutes: 10,
  });
  assert.equal(parseAccessRules({ passbackMinutes: 1 }).passbackMinutes, 1);
  assert.equal(parseAccessRules({ passbackMinutes: 120 }).passbackMinutes, 120);
  assert.equal(anyAccessRuleOn(r), true);
  assert.equal(anyAccessRuleOn(on({ passbackMinutes: 5 })), true);
});

test("parseAccessRuleChanges: nur lesbare Einträge", () => {
  const changes = parseAccessRuleChanges({
    changes: [
      { at: "2026-11-24T10:00:00.000Z", adminId: "7", admin: "admin@example.invalid", key: "readerNeedsArea", from: false, to: true },
      { at: "2026-11-24T10:00:00.000Z", key: "passbackMinutes", from: 0, to: 10 },
      { at: "x", key: "gibtsnicht", from: false, to: true },
      { key: "readerNeedsArea", from: false, to: true },
      "kaputt",
    ],
  });
  assert.equal(changes.length, 2);
  assert.equal(changes[1].adminId, null);
  assert.deepEqual(parseAccessRuleChanges(null), []);
  assert.deepEqual(parseAccessRuleChanges({ changes: "x" }), []);
});

test("diffAccessRules nennt nur geänderte Regeln", () => {
  assert.deepEqual(diffAccessRules(ACCESS_RULES_OFF, ACCESS_RULES_OFF), []);
  assert.deepEqual(diffAccessRules(ACCESS_RULES_OFF, on({ readerNeedsArea: true, passbackMinutes: 10 })), [
    { key: "readerNeedsArea", from: false, to: true },
    { key: "passbackMinutes", from: 0, to: 10 },
  ]);
});

test("readerHasArea: 0 und null zählen als kein Bereich", () => {
  assert.equal(readerHasArea({ accessIn: null, accessOut: null }), false);
  assert.equal(readerHasArea({ accessIn: 0, accessOut: null }), false);
  assert.equal(readerHasArea({ accessIn: 3, accessOut: null }), true);
  assert.equal(readerHasArea({ accessIn: null, accessOut: 3 }), true);
});

test("Leser ohne Bereich: nur mit Schalter und ohne Direkt-Zuweisung", () => {
  const rules = on({ readerNeedsArea: true });
  assert.equal(deniesUnassignedReader(ACCESS_RULES_OFF, { readerHasArea: false, hasDirectDeviceMatch: false }), false);
  assert.equal(deniesUnassignedReader(rules, { readerHasArea: false, hasDirectDeviceMatch: false }), true);
  assert.equal(deniesUnassignedReader(rules, { readerHasArea: false, hasDirectDeviceMatch: true }), false);
  assert.equal(deniesUnassignedReader(rules, { readerHasArea: true, hasDirectDeviceMatch: false }), false);
  // Andere Schalter ändern nichts.
  const others = on({ ticketNeedsArea: true, handscannerDenyRedeemed: true, voucherNeedsArea: true, passbackMinutes: 10 });
  assert.equal(deniesUnassignedReader(others, { readerHasArea: false, hasDirectDeviceMatch: false }), false);
});

test("Tickets ohne Bereich: nur an freigegebenen Bereichen", () => {
  const rules = on({ ticketNeedsArea: true });
  const base = { ticketAreaCount: 0, isVereinMember: false, deviceAreaIds: [1], openAreaIds: [] as number[] };
  assert.equal(deniesUnassignedTicket(ACCESS_RULES_OFF, base), false);
  assert.equal(deniesUnassignedTicket(rules, base), true);
  assert.equal(deniesUnassignedTicket(rules, { ...base, openAreaIds: [1] }), false);
  assert.equal(deniesUnassignedTicket(rules, { ...base, deviceAreaIds: [1, 2], openAreaIds: [2] }), false);
  assert.equal(deniesUnassignedTicket(rules, { ...base, ticketAreaCount: 1 }), false);
  assert.equal(deniesUnassignedTicket(rules, { ...base, isVereinMember: true }), false);
  // Hauptressource des Service: dort bleibt das Ticket gültig, anderswo nicht.
  assert.equal(deniesUnassignedTicket(rules, { ...base, mainAreaId: 1 }), false);
  assert.equal(deniesUnassignedTicket(rules, { ...base, deviceAreaIds: [2], mainAreaId: 1 }), true);
  assert.equal(deniesUnassignedTicket(ACCESS_RULES_OFF, { ...base, deviceAreaIds: [2], mainAreaId: 1 }), false);
  // Ausgang: wer drin ist, darf raus.
  assert.equal(deniesUnassignedTicket(rules, { ...base, isExit: true }), false);
  assert.equal(deniesUnassignedTicket(rules, { ...base, isExit: false }), true);
  // Leser ohne Bereich: dafür ist die Regel „Leser ohne Bereich“ zuständig.
  assert.equal(deniesUnassignedTicket(rules, { ...base, deviceAreaIds: [] }), false);
  const others = on({ readerNeedsArea: true, handscannerDenyRedeemed: true, voucherNeedsArea: true, passbackMinutes: 10 });
  assert.equal(deniesUnassignedTicket(others, base), false);
});

test("Gutscheine: Bereiche aus Gutschein und Service, ohne Bereich überall", () => {
  assert.deepEqual(voucherAreaIds({ accessAreaId: null }, []), []);
  assert.deepEqual(voucherAreaIds({ accessAreaId: 2 }, [2, 3]), [2, 3]);
  // Hauptressource des Service (von der Route mitgegeben) zählt als Bereich.
  assert.deepEqual(voucherAreaIds({ accessAreaId: null }, [4]), [4]);
  const rules = on({ voucherNeedsArea: true });
  assert.equal(deniesVoucherArea(ACCESS_RULES_OFF, { voucherAreaIds: [2], deviceAreaIds: [1] }), false);
  assert.equal(deniesVoucherArea(rules, { voucherAreaIds: [2], deviceAreaIds: [1] }), true);
  assert.equal(deniesVoucherArea(rules, { voucherAreaIds: [2, 3], deviceAreaIds: [3] }), false);
  assert.equal(deniesVoucherArea(rules, { voucherAreaIds: [], deviceAreaIds: [1] }), false);
  assert.equal(deniesVoucherArea(rules, { voucherAreaIds: [2], deviceAreaIds: [] }), false);
  const others = on({ readerNeedsArea: true, ticketNeedsArea: true, handscannerDenyRedeemed: true, passbackMinutes: 10 });
  assert.equal(deniesVoucherArea(others, { voucherAreaIds: [2], deviceAreaIds: [1] }), false);
});

test("Handscanner: eingelöstes Einzelticket nur mit Schalter abgelehnt", () => {
  const t = {
    status: "REDEEMED",
    subscriptionId: null,
    vereinId: null,
    isEmployee: false,
    serviceAllowsReentry: false,
    deviceAllowsReentry: false,
    durationStillRunning: false,
    isExit: false,
    hitsMainResource: true,
  };
  const rules = on({ handscannerDenyRedeemed: true });
  assert.equal(deniesRedeemedAtHandscanner(ACCESS_RULES_OFF, t), false);
  assert.equal(deniesRedeemedAtHandscanner(rules, t), true);
  for (const patch of [
    { status: "VALID" },
    { subscriptionId: 1 },
    { vereinId: 1 },
    { isEmployee: true },
    { serviceAllowsReentry: true },
    { deviceAllowsReentry: true },
    { durationStillRunning: true },
    { isExit: true },
    { hitsMainResource: false },
  ]) {
    assert.equal(deniesRedeemedAtHandscanner(rules, { ...t, ...patch }), false, JSON.stringify(patch));
  }
  const others = on({ readerNeedsArea: true, ticketNeedsArea: true, voucherNeedsArea: true, passbackMinutes: 10 });
  assert.equal(deniesRedeemedAtHandscanner(others, t), false);
});

test("redeemedMessage nennt die Zeit des ersten Scans (Berlin)", () => {
  const now = new Date("2026-08-25T14:00:00.000Z");
  assert.equal(redeemedMessage(null, now), "Ticket bereits eingelöst");
  assert.equal(
    redeemedMessage(new Date("2026-08-25T09:05:00.000Z"), now),
    "Ticket bereits eingelöst (erster Scan 11:05 Uhr)",
  );
  assert.equal(
    redeemedMessage(new Date("2026-08-23T09:05:00.000Z"), now),
    "Ticket bereits eingelöst (erster Scan 23.08., 11:05 Uhr)",
  );
});

test("decidePassback: Eintritt im Fenster sperrt, Ausgang gibt frei", () => {
  const now = new Date("2026-08-25T10:00:00.000Z");
  const area = 5;
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const opts = { minutes: 10, areaId: area, now, areaHasExitReader: true };
  assert.equal(decidePassback(opts, null), null);
  const entry = decidePassback(opts, { scanTime: ago(3), device: { accessIn: area, accessOut: null } });
  assert.ok(entry);
  assert.equal(entry.message, "Bereits drin – Wiedereintritt nach Ausgang oder in 7 Minuten");
  // Bidirektionaler Leser des Bereichs zählt als Eintritt.
  assert.ok(decidePassback(opts, { scanTime: ago(3), device: { accessIn: area, accessOut: area } }));
  // Ausgang des Bereichs (auch Übergang in einen anderen Bereich) gibt frei.
  assert.equal(decidePassback(opts, { scanTime: ago(1), device: { accessIn: null, accessOut: area } }), null);
  assert.equal(decidePassback(opts, { scanTime: ago(1), device: { accessIn: 9, accessOut: area } }), null);
  // Wartezeit vorbei.
  assert.equal(decidePassback(opts, { scanTime: ago(10), device: { accessIn: area, accessOut: null } }), null);
  // Regel aus.
  assert.equal(decidePassback({ ...opts, minutes: 0 }, { scanTime: ago(1), device: { accessIn: area, accessOut: null } }), null);
  // Gerät gelöscht (SetNull): kein Bereich erkennbar, frei.
  assert.equal(decidePassback(opts, { scanTime: ago(1), device: null }), null);
  // Scan-Zeit knapp nach `now` (Datenbank-Uhr): höchstens die Wartezeit.
  const future = decidePassback(opts, { scanTime: new Date(now.getTime() + 5_000), device: { accessIn: area, accessOut: null } });
  assert.equal(future?.remainingMs, 10 * 60_000);
  assert.equal(future?.message, "Bereits drin – Wiedereintritt nach Ausgang oder in 10 Minuten");
  const oneMinute = decidePassback(opts, { scanTime: ago(9.5), device: { accessIn: area, accessOut: null } });
  assert.equal(oneMinute?.message, "Bereits drin – Wiedereintritt nach Ausgang oder in 1 Minute");
});

test("evaluatePassback: ohne Wartezeit keine Abfrage, sonst Index-taugliche Abfrage", async () => {
  const calls: Record<string, unknown>[] = [];
  const now = new Date("2026-08-25T10:00:00.000Z");
  const db = {
    scan: {
      async findFirst(args: { where: Record<string, unknown> }) {
        calls.push(args.where);
        return { scanTime: new Date(now.getTime() - 60_000), device: { accessIn: 5, accessOut: null } };
      },
    },
  };
  const areaHasExitReader = async () => true;
  assert.equal(await evaluatePassback(db, { accountId: 1, areaId: 5, ticketId: 9, minutes: 0, now, areaHasExitReader }), null);
  assert.equal(await evaluatePassback(db, { accountId: 1, areaId: null, ticketId: 9, minutes: 10, now, areaHasExitReader }), null);
  assert.equal(calls.length, 0);
  const denial = await evaluatePassback(db, { accountId: 1, areaId: 5, ticketId: 9, minutes: 10, now, areaHasExitReader });
  assert.ok(denial);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ticketId, 9);
  assert.equal(calls[0].accountId, 1);
  assert.equal(calls[0].result, "GRANTED");
  assert.deepEqual(calls[0].scanTime, { gte: new Date(now.getTime() - 10 * 60_000) });
});

test("decidePassback: ohne Ausgangs-Leser im Bereich nie abgelehnt", () => {
  const now = new Date("2026-08-25T10:00:00.000Z");
  const area = 5;
  const opts = { minutes: 10, areaId: area, now, areaHasExitReader: false };
  for (const min of [0, 0.5, 3, 9.9]) {
    const scanTime = new Date(now.getTime() - min * 60_000);
    assert.equal(decidePassback(opts, { scanTime, device: { accessIn: area, accessOut: null } }), null, String(min));
    assert.equal(decidePassback(opts, { scanTime, device: { accessIn: area, accessOut: area } }), null, String(min));
  }
  // Gleicher Scan mit Ausgangs-Leser: gesperrt.
  assert.ok(
    decidePassback({ ...opts, areaHasExitReader: true }, {
      scanTime: new Date(now.getTime() - 60_000),
      device: { accessIn: area, accessOut: null },
    }),
  );
});

test("evaluatePassback: Ausgangs-Leser nur bei eingeschalteter Regel gefragt", async () => {
  const now = new Date("2026-08-25T10:00:00.000Z");
  let scanQueries = 0;
  const exitQueries: number[] = [];
  const db = {
    scan: {
      async findFirst() {
        scanQueries++;
        return { scanTime: new Date(now.getTime() - 60_000), device: { accessIn: 5, accessOut: null } };
      },
    },
  };
  const hasExit = (value: boolean) => async (areaId: number) => {
    exitQueries.push(areaId);
    return value;
  };
  const base = { accountId: 1, areaId: 5, ticketId: 9, now };

  // Regel aus: weder Ausgangs-Leser noch Scan gefragt.
  assert.equal(await evaluatePassback(db, { ...base, minutes: 0, areaHasExitReader: hasExit(true) }), null);
  assert.equal(await evaluatePassback(db, { ...base, areaId: null, minutes: 10, areaHasExitReader: hasExit(true) }), null);
  assert.deepEqual(exitQueries, []);
  assert.equal(scanQueries, 0);

  // Bereich ohne Ausgangs-Leser: frei, ohne Scan-Abfrage.
  for (let i = 0; i < 10; i++) {
    assert.equal(await evaluatePassback(db, { ...base, minutes: 10, areaHasExitReader: hasExit(false) }), null);
  }
  assert.equal(scanQueries, 0);
  assert.deepEqual(exitQueries, Array(10).fill(5));

  // Bereich mit Ausgangs-Leser: wie bisher gesperrt.
  assert.ok(await evaluatePassback(db, { ...base, minutes: 10, areaHasExitReader: hasExit(true) }));
  assert.equal(scanQueries, 1);

  // Frage nach dem Ausgangs-Leser schlägt fehl: nicht abgelehnt, kein Fehler.
  const origError = console.error;
  console.error = () => {};
  try {
    const failing = async () => {
      throw new Error("db down");
    };
    assert.equal(await evaluatePassback(db, { ...base, minutes: 10, areaHasExitReader: failing }), null);
  } finally {
    console.error = origError;
  }
  assert.equal(scanQueries, 1);
});

test("evaluatePassback: Abfrage des letzten Scans schlägt fehl, nicht abgelehnt und kein Fehler", async () => {
  const now = new Date("2026-08-25T10:00:00.000Z");
  let scanQueries = 0;
  const db = {
    scan: {
      async findFirst(): Promise<null> {
        scanQueries++;
        throw new Error("db down");
      },
    },
  };
  const logged: unknown[][] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const result = await evaluatePassback(db, {
      accountId: 1,
      areaId: 5,
      ticketId: 9,
      minutes: 10,
      now,
      areaHasExitReader: async () => true,
    });
    assert.equal(result, null);
  } finally {
    console.error = origError;
  }
  assert.equal(scanQueries, 1);
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /^\[einlass-regeln\] /);
});

test("mergeAccessRulesPatch: legt die Änderung über den gelesenen Stand und ergänzt den Verlauf", () => {
  const who = { at: "2026-11-25T10:00:00.000Z", adminId: "7", admin: "a@example.org" };
  // Noch nie gespeichert.
  const first = mergeAccessRulesPatch(null, { readerNeedsArea: true }, who);
  assert.deepEqual(first.rules, on({ readerNeedsArea: true }));
  assert.deepEqual(first.newChanges, [{ ...who, key: "readerNeedsArea", from: false, to: true }]);
  assert.deepEqual(first.changes, first.newChanges);

  // Zweite Änderung auf dem gespeicherten Stand: die erste bleibt erhalten.
  const stored = { ...first.rules, changes: first.changes };
  const second = mergeAccessRulesPatch(stored, { voucherNeedsArea: true, readerNeedsArea: true }, { ...who, at: "2026-11-25T10:01:00.000Z" });
  assert.deepEqual(second.rules, on({ readerNeedsArea: true, voucherNeedsArea: true }));
  assert.deepEqual(second.newChanges.map((c) => c.key), ["voucherNeedsArea"]);
  assert.deepEqual(second.changes.map((c) => c.key), ["voucherNeedsArea", "readerNeedsArea"]);

  // Mehrere Änderungen auf einmal: neueste vorn, in umgekehrter Reihenfolge von ACCESS_RULE_KEYS.
  const multi = mergeAccessRulesPatch(null, { readerNeedsArea: true, passbackMinutes: 10 }, who);
  assert.deepEqual(multi.newChanges.map((c) => c.key), ["readerNeedsArea", "passbackMinutes"]);
  assert.deepEqual(multi.changes.map((c) => c.key), ["passbackMinutes", "readerNeedsArea"]);

  // Ohne Änderung nichts Neues, Verlauf unverändert.
  const same = mergeAccessRulesPatch(stored, { readerNeedsArea: true }, who);
  assert.deepEqual(same.newChanges, []);
  assert.deepEqual(same.changes, first.changes);

  // Verlauf auf ACCESS_RULE_CHANGES_KEPT gekürzt.
  const long = Array.from({ length: ACCESS_RULE_CHANGES_KEPT }, () => ({ ...who, key: "readerNeedsArea", from: false, to: true }));
  const cut = mergeAccessRulesPatch({ changes: long }, { ticketNeedsArea: true }, who);
  assert.equal(cut.changes.length, ACCESS_RULE_CHANGES_KEPT);
  assert.equal(cut.changes[0].key, "ticketNeedsArea");
});

test("Texte: Gutschein-Zuordnung über den Ticket-Typ und Kombi-Leser als Eingang", () => {
  const voucher = ACCESS_RULE_TEXTS.voucherNeedsArea.effect;
  assert.match(voucher, /Ticket-Typ/);
  assert.match(voucher, /ohne jede Zuordnung gelten weiter überall/);
  assert.doesNotMatch(voucher, /Gutscheine ohne Bereich gelten/);
  const ticket = ACCESS_RULE_TEXTS.ticketNeedsArea.confirm ?? "";
  assert.match(ticket, /als Eingang eines Bereichs eingetragen/);
  assert.match(ticket, /auch wenn er zugleich als Ausgang eingetragen ist/);
  assert.match(ticket, /zählt als Eingang/);
  assert.match(ticket, /solange die Regel aus ist/);
});

test("splitPassbackAreas: Einlass-Bereiche mit und ohne Ausgangs-Leser", () => {
  const { applies, exempt } = splitPassbackAreas([
    // Bereich 1: Ein- und Ausgang (z. B. Badebereich)
    { accessIn: 1, accessOut: null },
    { accessIn: null, accessOut: 1 },
    // Bereich 2: nur Einlass-Leser (z. B. Lift)
    { accessIn: 2, accessOut: null },
    { accessIn: 2, accessOut: null },
    // Bereich 3: nur ein Leser mit Bereich 3 als Ein- und Ausgang: seine
    // Scans gelten als Eintritt, also kein Ausgangs-Leser
    { accessIn: 3, accessOut: 3 },
    // Bereich 5: Kombi-Leser und ein eigener Ausgangs-Leser
    { accessIn: 5, accessOut: 5 },
    { accessIn: null, accessOut: 5 },
    // Bereich 6: Durchgang aus Bereich 7 nach 6 zählt als Ausgang aus 6
    { accessIn: 6, accessOut: null },
    { accessIn: 7, accessOut: 6 },
    // Bereich 4: nur Ausgang, ohne Einlass: kommt nicht vor
    { accessIn: null, accessOut: 4 },
    // 0 zählt als „kein Bereich“
    { accessIn: 0, accessOut: 0 },
    { accessIn: null, accessOut: null },
  ]);
  assert.deepEqual(applies.sort(), [1, 5, 6]);
  assert.deepEqual(exempt.sort(), [2, 3, 7]);
  assert.deepEqual(splitPassbackAreas([]), { applies: [], exempt: [] });
});
