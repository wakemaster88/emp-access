import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDayPreview, formatStaff, previewHints, type DayPreviewData } from "./day-preview-format.js";

const data: DayPreviewData = {
  date: "2026-07-10",
  bookings: {
    guests: 24,
    slottedGuests: 12,
    byService: [
      { label: "Aquapark Tageskarte", guests: 12 },
      { label: "Anfängerkurs", guests: 12 },
    ],
    slots: [{ time: "14:00", end: "16:00", label: "Anfängerkurs", guests: 12 }],
    peaks: [{ from: "14:00", to: "16:00", guests: 12 }],
    groups: [{ name: "Müller", guests: 12, label: "Anfängerkurs", time: "14:00" }],
    rentals: [{ name: "Neoprenanzug", quantity: 5 }],
  },
  weather: {
    summary: "Regenschauer",
    tempMin: 14.2,
    tempMax: 26.1,
    precipSumMm: 1.5,
    precipProbPct: 70,
    windMaxKmh: 22,
    gustMaxKmh: 55,
    sunrise: "04:58",
    sunset: "21:30",
    rainWindows: [{ from: "15:00", to: "17:00", maxProbPct: 70, mm: 1.5 }],
  },
};

test("Vorschau enthaelt Wetter, Buchungen, Gruppen und Hinweise", () => {
  const text = formatDayPreview(data, null);
  assert.match(text, /^Tagesvorschau Freitag, 10\. Juli/);
  assert.match(text, /Wetter: Regenschauer, 14 bis 26 °C, Wind bis 22 km\/h \(Böen 55\)/);
  assert.match(text, /Regen: 15–17 Uhr \(70 %, 1,5 mm\)/);
  assert.match(text, /Buchungen: 24 Gäste/);
  assert.match(text, /• 14:00–16:00 Anfängerkurs: 12/);
  assert.match(text, /Stoßzeit: 14–16 Uhr \(12 gleichzeitig\)/);
  assert.match(text, /• Müller: 12 Gäste, Anfängerkurs ab 14:00/);
  assert.match(text, /Verleih: 5× Neoprenanzug/);
  assert.doesNotMatch(text, /Personal/);
  const hints = previewHints(data, null);
  assert.equal(hints.length, 3);
  assert.match(hints[1], /Regen fällt in die Stoßzeit 14–16 Uhr/);
});

test("Ohne Wetter und Buchungen bleibt die Vorschau lesbar", () => {
  const text = formatDayPreview(
    { date: "2026-11-05", bookings: { ...data.bookings, guests: 0, byService: [], slots: [], peaks: [], groups: [], rentals: [] }, weather: null },
    null,
  );
  assert.match(text, /Wetter: keine Vorhersage abrufbar\./);
  assert.match(text, /Buchungen: keine\./);
  assert.doesNotMatch(text, /Hinweis/);
});

test("Personal: nicht eingerichtet, Schichten, alter Stand", () => {
  assert.deepEqual(formatStaff({ configured: false, dataAgeMin: null, error: null, working: [], shifts: [] }), [
    "Personal: emp-control-Monitor-Link fehlt noch in den Einstellungen.",
  ]);
  const lines = formatStaff({
    configured: true,
    dataAgeMin: 30,
    error: "Zeitüberschreitung",
    working: [{ name: "Anna", department: "Shop", plannedDepartment: "Shop" }],
    shifts: [{ department: "Lift", start: "2026-07-10T07:00:00.000Z", end: "18:00", pending: ["Ben", "Cem"], totalAssigned: 2, clockedIn: 0 }],
  });
  assert.deepEqual(lines, [
    "Personal:",
    "• Lift 09:00–18:00, 2 eingeplant: Ben, Cem",
    "Eingestempelt: Anna",
    "(Stand vor 30 min, Zeitüberschreitung)",
  ]);
});
