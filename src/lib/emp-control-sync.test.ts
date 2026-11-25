import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeSyncId, isInactiveMarker, isPresenceMarker, isSyncedEmployeeUuid, planFullSync, type FullSyncTicket } from "./emp-control-sync";

/** n gueltige Mitarbeiter-Tickets emp-1 … emp-n mit Ticket-ID 100+i. */
function tickets(n: number): FullSyncTicket[] {
  return Array.from({ length: n }, (_, i) => ({ id: 100 + i + 1, uuid: `emp-${i + 1}` }));
}
function list(...ids: (number | string)[]) {
  return ids.map((id) => ({ id }));
}
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

test("ID eines Eintrags", () => {
  assert.equal(employeeSyncId({ id: 5 }), "5");
  assert.equal(employeeSyncId({ id: "abc" }), "abc");
  assert.equal(employeeSyncId({ employeeId: 7 }), "7");
  assert.equal(employeeSyncId({ id: null, employeeId: 8 }), "8");
  assert.equal(employeeSyncId({ id: 0 }), "0");
  assert.equal(employeeSyncId({}), null);
  assert.equal(employeeSyncId({ id: "  " }), null);
  assert.equal(employeeSyncId({ id: Number.NaN }), null);
  assert.equal(employeeSyncId({ id: { x: 1 } }), null);
  assert.equal(employeeSyncId({ id: true }), null);
  assert.equal(employeeSyncId(null), null);
  assert.equal(employeeSyncId(5), null);
});

test("nichts zu tun: alle gemeldet", () => {
  const plan = planFullSync({ employees: list(1, 2, 3, 99), validTickets: tickets(3), force: false });
  assert.deepEqual(plan, { action: "deactivate", ticketIds: [], employeeIds: [] });
});

test("einige fallen weg", () => {
  const plan = planFullSync({ employees: list(...range(1, 30)), validTickets: tickets(32), force: false });
  assert.deepEqual(plan, { action: "deactivate", ticketIds: [131, 132], employeeIds: ["31", "32"] });
});

test("Texte und Zahlen als ID gelten gleich", () => {
  const plan = planFullSync({ employees: list("1", 2), validTickets: tickets(2), force: false });
  assert.deepEqual(plan, { action: "deactivate", ticketIds: [], employeeIds: [] });
});

test("nur Tickets mit uuid emp- werden gesperrt", () => {
  const plan = planFullSync({
    employees: list(1),
    validTickets: [{ id: 1, uuid: "emp-1" }, { id: 2, uuid: null }, { id: 3, uuid: "andere-3" }, { id: 4, uuid: "emp-4" }],
    force: false,
  });
  assert.deepEqual(plan, { action: "deactivate", ticketIds: [4], employeeIds: ["4"] });
});

test("genau 3 Tickets sind erlaubt, auch ueber 30 Prozent", () => {
  const plan = planFullSync({ employees: list(1), validTickets: tickets(4), force: false });
  assert.equal(plan.action, "deactivate");
  assert.deepEqual(plan.action === "deactivate" && plan.ticketIds, [102, 103, 104]);
});

test("genau 30 Prozent sind erlaubt, auch ueber 3 Tickets", () => {
  // 6 von 20 = 30 %
  const plan = planFullSync({ employees: list(...range(1, 14)), validTickets: tickets(20), force: false });
  assert.equal(plan.action, "deactivate");
  assert.equal(plan.action === "deactivate" && plan.ticketIds.length, 6);
});

test("mehr als 3 und mehr als 30 Prozent: abgelehnt", () => {
  // 7 von 20 = 35 %
  const plan = planFullSync({ employees: list(...range(1, 13)), validTickets: tickets(20), force: false });
  assert.equal(plan.action, "refuse");
  if (plan.action !== "refuse") return;
  assert.equal(plan.reason, "too-many");
  assert.equal(plan.wouldDeactivate, 7);
  assert.equal(plan.total, 20);
  assert.match(plan.error, /7 von 20/);
  // Die Ablehnung nennt, wen es getroffen haette (fuer die Anzeige beim Absender).
  assert.deepEqual(plan.employeeIds, ["14", "15", "16", "17", "18", "19", "20"]);
  assert.deepEqual(plan.ticketIds, [114, 115, 116, 117, 118, 119, 120]);
});

test("4 von 4 ohne Force: abgelehnt", () => {
  const plan = planFullSync({ employees: list(99), validTickets: tickets(4), force: false });
  assert.equal(plan.action, "refuse");
  assert.equal(plan.action === "refuse" && plan.reason, "too-many");
});

test("Force hebt nur die Mengengrenze auf", () => {
  const plan = planFullSync({ employees: list(...range(1, 13)), validTickets: tickets(20), force: true });
  assert.equal(plan.action, "deactivate");
  assert.equal(plan.action === "deactivate" && plan.ticketIds.length, 7);
});

test("leere Liste: immer abgelehnt, auch mit Force", () => {
  for (const force of [false, true]) {
    const plan = planFullSync({ employees: [], validTickets: tickets(5), force });
    assert.equal(plan.action, "refuse");
    if (plan.action !== "refuse") return;
    assert.equal(plan.reason, "empty");
    assert.equal(plan.wouldDeactivate, 5);
    assert.deepEqual(plan.employeeIds, ["1", "2", "3", "4", "5"]);
  }
  const none = planFullSync({ employees: [], validTickets: [], force: false });
  assert.equal(none.action === "refuse" && none.reason, "empty");
});

test("Eintrag ohne verwendbare ID: immer abgelehnt, auch mit Force", () => {
  for (const force of [false, true]) {
    const plan = planFullSync({ employees: [{ id: 1 }, { firstName: "Ohne" }, { id: 2 }], validTickets: tickets(3), force });
    assert.equal(plan.action, "refuse");
    if (plan.action !== "refuse") return;
    assert.equal(plan.reason, "missing-id");
    assert.equal(plan.wouldDeactivate, 1);
    assert.match(plan.error, /1 von 3/);
  }
});

test("uuid aus dem Webhook oder manuell angelegt", () => {
  assert.equal(isSyncedEmployeeUuid("emp-12"), true);
  assert.equal(isSyncedEmployeeUuid("emp-abc"), true);
  assert.equal(isSyncedEmployeeUuid("emp-manual-abc123"), false);
  assert.equal(isSyncedEmployeeUuid("andere-3"), false);
  assert.equal(isSyncedEmployeeUuid(null), false);
  assert.equal(isSyncedEmployeeUuid(undefined), false);
});

test("manuell angelegte Mitarbeiter bleiben gueltig und zaehlen nicht mit", () => {
  const manual = [{ id: 201, uuid: "emp-manual-abc123" }, { id: 202, uuid: "emp-manual-def456" }];
  const plan = planFullSync({ employees: list(...range(1, 32)), validTickets: [...tickets(32), ...manual], force: false });
  assert.deepEqual(plan, { action: "deactivate", ticketIds: [], employeeIds: [] });

  // 4 von 12 Webhook-Tickets fallen weg (33 Prozent): abgelehnt. Mit den
  // manuellen im Nenner waeren es 4 von 14 (28 Prozent).
  const refused = planFullSync({ employees: list(...range(1, 8)), validTickets: [...tickets(12), ...manual], force: false });
  assert.equal(refused.action, "refuse");
  if (refused.action !== "refuse") return;
  assert.equal(refused.wouldDeactivate, 4);
  assert.equal(refused.total, 12);
});

test("Nenner ist die Anzahl vor dem Aufruf, neu angelegte zaehlen nicht", () => {
  // 32 bisherige Tickets fehlen alle, die Liste hat 80 neue IDs, die im selben
  // Aufruf als gueltige Tickets angelegt wurden.
  const all = [...tickets(32), ...Array.from({ length: 80 }, (_, i) => ({ id: 1000 + i, uuid: `emp-${1000 + i}` }))];
  const employees = list(...range(1000, 1079));
  const plan = planFullSync({ employees, validTickets: all, validBefore: 32, force: false });
  assert.equal(plan.action, "refuse");
  if (plan.action !== "refuse") return;
  assert.equal(plan.reason, "too-many");
  assert.equal(plan.wouldDeactivate, 32);
  assert.equal(plan.total, 32);
  // Ohne validBefore wuerde der Nenner 112 die Grenze verfehlen.
  assert.equal(planFullSync({ employees, validTickets: all, force: false }).action, "deactivate");
});

test("Anwesenheitsmeldung: nur ID und active, sonst ein normaler Eintrag", () => {
  assert.equal(isPresenceMarker({ id: 5 }), true);
  assert.equal(isPresenceMarker({ id: "cabc123" }), true);
  assert.equal(isPresenceMarker({ employeeId: 7, active: false }), true);
  assert.equal(isPresenceMarker({ id: 5, active: true }), true);
  // Felder mit undefined zaehlen nicht (JSON kennt sie ohnehin nicht).
  assert.equal(isPresenceMarker({ id: 5, firstName: undefined }), true);
  // Jedes weitere Feld macht den Eintrag zu einem normalen Eintrag, auch mit null.
  assert.equal(isPresenceMarker({ id: 5, firstName: "A" }), false);
  assert.equal(isPresenceMarker({ id: 5, rfidCode: null }), false);
  assert.equal(isPresenceMarker({ id: 5, areaIds: [] }), false);
  assert.equal(isPresenceMarker({ id: 5, contractEnd: null }), false);
  // Ohne verwendbare ID keine Meldung (der Voll-Abgleich lehnt solche Eintraege ab).
  assert.equal(isPresenceMarker({ active: false }), false);
  assert.equal(isPresenceMarker({ id: "  " }), false);
  assert.equal(isPresenceMarker(null), false);
  assert.equal(isPresenceMarker([{ id: 1 }]), false);
  assert.equal(isPresenceMarker("5"), false);
});

test("Anwesenheitsmeldung mit active false zaehlt als nicht mehr gemeldet", () => {
  assert.equal(isInactiveMarker({ id: 2, active: false }), true);
  assert.equal(isInactiveMarker({ id: 2, active: true }), false);
  assert.equal(isInactiveMarker({ id: 2 }), false);
  // Ein normaler Eintrag mit active false ist keine Meldung (er wird oben verarbeitet).
  assert.equal(isInactiveMarker({ id: 2, firstName: "A", active: false }), false);

  // 10 gueltige Tickets, alle gemeldet, zwei davon inaktiv: genau diese zwei werden gesperrt.
  const markers = range(1, 10).map((id) => ({ id, active: id !== 4 && id !== 7 }));
  const plan = planFullSync({ employees: markers, validTickets: tickets(10), force: false });
  assert.equal(plan.action, "deactivate");
  if (plan.action === "deactivate") assert.deepEqual(plan.employeeIds, ["4", "7"]);

  // Inaktive und fehlende zaehlen zusammen: 2 inaktiv + 2 fehlen = 4 von 10 -> abgelehnt.
  const mixed = range(1, 8).map((id) => ({ id, active: id > 2 }));
  const refused = planFullSync({ employees: mixed, validTickets: tickets(10), force: false });
  assert.equal(refused.action, "refuse");
  if (refused.action === "refuse") {
    assert.equal(refused.reason, "too-many");
    assert.equal(refused.wouldDeactivate, 4);
  }
  const forced = planFullSync({ employees: mixed, validTickets: tickets(10), force: true });
  assert.equal(forced.action, "deactivate");
  if (forced.action === "deactivate") assert.deepEqual(forced.employeeIds, ["1", "2", "9", "10"]);

  // Eine Liste nur aus inaktiven Meldungen ist nicht "leer", faellt aber unter die Prozent-Regel.
  const allInactive = range(1, 10).map((id) => ({ id, active: false }));
  const all = planFullSync({ employees: allInactive, validTickets: tickets(10), force: false });
  assert.equal(all.action, "refuse");
});
