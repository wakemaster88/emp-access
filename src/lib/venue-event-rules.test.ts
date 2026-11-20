import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeChanges,
  eventInputSchema,
  eventTimes,
  extrasKey,
  extrasTotalCents,
  overlapsWithBuffer,
  partnerEditState,
} from "./venue-event-rules";
import { looksLikePdf, safePdfName } from "./venue-documents";

test("eventTimes: Berlin-Zeit, Ende nach Mitternacht am Folgetag", () => {
  const summer = eventTimes("2027-06-12", "18:00", "02:00")!;
  assert.equal(summer.startDate.toISOString(), "2027-06-12T16:00:00.000Z");
  assert.equal(summer.endDate.toISOString(), "2027-06-13T00:00:00.000Z");
  const winter = eventTimes("2026-12-05", "10:00", "14:30")!;
  assert.equal(winter.startDate.toISOString(), "2026-12-05T09:00:00.000Z");
  assert.equal(winter.endDate.getTime() - winter.startDate.getTime(), 4.5 * 3_600_000);
  assert.equal(eventTimes("2026-12-05", "25:00", "14:00"), null);
  assert.equal(eventTimes("05.12.2026", "10:00", "14:00"), null);
});

test("overlapsWithBuffer: Puffer für Auf- und Abbau zählt mit", () => {
  const a = eventTimes("2027-06-12", "12:00", "16:00")!;
  const b = eventTimes("2027-06-12", "16:30", "20:00")!;
  assert.equal(overlapsWithBuffer(a, b, 0), false);
  assert.equal(overlapsWithBuffer(a, b, 30), false, "genau 30 Min. dazwischen reicht");
  assert.equal(overlapsWithBuffer(a, b, 60), true);
  assert.equal(overlapsWithBuffer(b, a, 60), true, "symmetrisch");
  const night = eventTimes("2027-06-12", "20:00", "03:00")!;
  const nextNoon = eventTimes("2027-06-13", "02:00", "05:00")!;
  assert.equal(overlapsWithBuffer(night, nextNoon, 0), true, "über Mitternacht");
});

test("extrasTotalCents: pauschal, je Person, je Stück", () => {
  const lines = [
    { unit: "FLAT" as const, unitPriceCents: 15000, quantity: 1 },
    { unit: "PER_PERSON" as const, unitPriceCents: 450, quantity: 1 },
    { unit: "PER_PIECE" as const, unitPriceCents: 3500, quantity: 3 },
  ];
  assert.equal(extrasTotalCents(lines, 40), 15000 + 40 * 450 + 3 * 3500);
  assert.equal(extrasTotalCents([], 40), 0);
});

test("partnerEditState: Frist, Personen melden bis zur Schlussrechnung", () => {
  const now = new Date("2027-06-10T12:00:00Z");
  const start = new Date("2027-06-12T16:00:00Z");
  const base = { status: "RESERVED" as const, startDate: start, billedAt: null, hasFinalInvoice: false };
  assert.deepEqual(
    { ...partnerEditState(base, 48, now), reason: null },
    { canEdit: true, canReportGuests: true, reason: null },
  );
  const late = partnerEditState(base, 72, now);
  assert.equal(late.canEdit, false);
  assert.equal(late.canReportGuests, true);
  const billed = partnerEditState({ ...base, hasFinalInvoice: true }, 0, now);
  assert.equal(billed.canEdit, false);
  assert.equal(billed.canReportGuests, false);
  const canceled = partnerEditState({ ...base, status: "CANCELED" }, 0, now);
  assert.equal(canceled.canEdit || canceled.canReportGuests, false);
});

test("eventInputSchema: säubert Eingaben", () => {
  const ok = eventInputSchema.parse({
    areaId: "3", title: "  Firmenfeier ", hostName: "", date: "2027-06-12", startTime: "18:00", endTime: "23:00",
    guestCount: "80", extras: [{ extraId: 2 }],
  });
  assert.equal(ok.title, "Firmenfeier");
  assert.equal(ok.hostName, null);
  assert.equal(ok.guestCount, 80);
  assert.deepEqual(ok.extras, [{ extraId: 2, quantity: 1 }]);
  assert.equal(eventInputSchema.safeParse({ ...ok, guestCount: 0 }).success, false);
  assert.equal(eventInputSchema.safeParse({ ...ok, startTime: "8 Uhr" }).success, false);
});

test("describeChanges: nennt Zeit, Personen und Zusatzleistungen", () => {
  const before = { title: "Feier", date: "2027-06-12", startTime: "18:00", endTime: "23:00", guestCount: 80, extrasKey: extrasKey([{ extraId: 1, quantity: 1 }]) };
  assert.deepEqual(describeChanges(before, { ...before }), []);
  const after = { ...before, guestCount: 95, startTime: "19:00", extrasKey: extrasKey([{ extraId: 1, quantity: 1 }, { extraId: 2, quantity: 2 }]) };
  const out = describeChanges(before, after);
  assert.equal(out.length, 3);
  assert.ok(out.some((s) => s.includes("80 → 95")));
});

test("PDF-Prüfung und sicherer Dateiname", () => {
  assert.equal(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n...")), true);
  assert.equal(looksLikePdf(new TextEncoder().encode("<html>")), false);
  assert.equal(safePdfName("RE 2026/0142 \"Kunde\".PDF"), "RE 2026_0142 _Kunde_.pdf");
  assert.equal(safePdfName(""), "dokument.pdf");
});
