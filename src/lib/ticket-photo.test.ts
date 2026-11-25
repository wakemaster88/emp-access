import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketPhotoResponse } from "./ticket-photo";

const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const jpeg = `data:image/jpeg;base64,${bytes.toString("base64")}`;

test("ticketPhotoResponse: JPEG als Bytes, mit Version dauerhaft cachebar", async () => {
  const res = ticketPhotoResponse(jpeg, true);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...bytes]);
});

test("ticketPhotoResponse: ohne Version nicht dauerhaft gecacht", () => {
  const res = ticketPhotoResponse(jpeg.replace("image/jpeg", "image/png"), false);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("cache-control"), "private, no-cache");
});

test("ticketPhotoResponse: GIF, SVG, leer und fremde Links ergeben 404", () => {
  assert.equal(ticketPhotoResponse(jpeg.replace("image/jpeg", "image/gif"), true).status, 404);
  assert.equal(ticketPhotoResponse("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", true).status, 404);
  assert.equal(ticketPhotoResponse(null, true).status, 404);
  assert.equal(ticketPhotoResponse("", true).status, 404);
  assert.equal(ticketPhotoResponse("https://example.com/a.jpg", true).status, 404);
});

test("ticketPhotoResponse: bekannter Foto-Host wird weitergeleitet", () => {
  const res = ticketPhotoResponse("https://konto.wakesys.com/bild.jpg", true);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://konto.wakesys.com/bild.jpg");
});

// Nachbildung von `db.$queryRaw` fuer die ID-Abfrage: Anfang des Wertes
// (left 256) und ganzer Wert nur, wenn er kurz ist (octet_length < 2048).
function fakeDb(rows: { id: number; profileImage: string | null }[]) {
  return {
    $queryRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      const ids = new Set(values.flatMap((v) => (v && typeof v === "object" && "values" in v ? (v as { values: number[] }).values : [])));
      return rows
        .filter((r) => ids.has(r.id) && r.profileImage !== null && r.profileImage !== "")
        .map((r) => ({
          id: r.id,
          head: r.profileImage!.slice(0, 256),
          full: Buffer.byteLength(r.profileImage!) < 2048 ? r.profileImage : null,
        }));
    },
  };
}

// Grosses JPEG wie in der Produktion (Anfang allein entscheidet).
const bigJpeg = `data:image/jpeg;base64,${Buffer.alloc(100_000, 1).toString("base64")}`;
const variants: { id: number; profileImage: string | null }[] = [
  { id: 1, profileImage: jpeg },
  { id: 2, profileImage: null },
  { id: 3, profileImage: "" },
  { id: 4, profileImage: jpeg.replace("image/jpeg", "image/gif") },
  { id: 5, profileImage: "https://konto.wakesys.com/bild.jpg" },
  { id: 6, profileImage: "http://konto.wakesys.com/bild.jpg" },
  { id: 7, profileImage: "https://example.com/a.jpg" },
  { id: 8, profileImage: jpeg.replace("image/jpeg", "image/WEBP") },
  { id: 9, profileImage: "https://example.org/.wakesys.com/a.jpg" },
  { id: 10, profileImage: ` ${jpeg}` },
  { id: 11, profileImage: ` ${bigJpeg}` },
  { id: 12, profileImage: jpeg.replace("image/jpeg;", "image/jpeg;charset=utf-8;") },
  { id: 13, profileImage: bigJpeg.replace("image/jpeg;", "image/jpeg;charset=utf-8;") },
  { id: 14, profileImage: "   " },
  { id: 15, profileImage: bigJpeg },
  { id: 16, profileImage: bigJpeg.replace("image/jpeg", "image/gif") },
  { id: 17, profileImage: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
  { id: 18, profileImage: `${jpeg.slice(0, 23)}\n${jpeg.slice(23)}` },
];

test("ticketIdsWithPhoto: hasPhoto wie !!profileImage, servable genau dann, wenn die Route ausliefert", async () => {
  const { ticketIdsWithPhoto } = await import("./ticket-photo");
  const ids = await ticketIdsWithPhoto(fakeDb(variants) as never, [...variants.map((r) => r.id), 1]);
  assert.deepEqual([...ids].sort((a, b) => a - b), variants.filter((r) => !!r.profileImage).map((r) => r.id));
  assert.deepEqual([...(ids.servable ?? [])].sort((a, b) => a - b), [1, 5, 8, 10, 11, 15, 18]);
  for (const r of variants) {
    const served = ticketPhotoResponse(r.profileImage, true).status !== 404;
    assert.equal(ids.servable?.has(r.id) ?? false, served, `Ticket ${r.id}`);
  }
});

test("ticketIdsWithPhoto: Check-in-Typen schliessen GIF ein", async () => {
  const { ticketIdsWithPhoto, CHECKIN_PHOTO_TYPES } = await import("./ticket-photo");
  const ids = await ticketIdsWithPhoto(fakeDb(variants) as never, [4, 16, 17], CHECKIN_PHOTO_TYPES);
  assert.deepEqual([...(ids.servable ?? [])].sort((a, b) => a - b), [4, 16]);
});

test("ticketIdsWithPhoto: leere Liste ohne Abfrage", async () => {
  const { ticketIdsWithPhoto } = await import("./ticket-photo");
  const db = { $queryRaw: async () => { throw new Error("keine Abfrage erwartet"); } };
  const ids = await ticketIdsWithPhoto(db as never, []);
  assert.equal(ids.size, 0);
});

test("storedPhotoServable: kurzer Wert wie die Route, langer nach dem Anfang", async () => {
  const { storedPhotoServable } = await import("./ticket-photo");
  assert.equal(storedPhotoServable("https://example.org/.wakesys.com/a.jpg", "https://example.org/.wakesys.com/a.jpg"), false);
  assert.equal(storedPhotoServable("https://konto.wakesys.com/a.jpg", "https://konto.wakesys.com/a.jpg"), true);
  // Langer Link: ganzer Wert nicht gelesen, gilt als nicht auslieferbar.
  assert.equal(storedPhotoServable("https://konto.wakesys.com/", null), false);
  assert.equal(storedPhotoServable("  data:image/png;base64,iVBOR", null), true);
  assert.equal(storedPhotoServable("data:image/gif;base64,R0lG", null), false);
  assert.equal(storedPhotoServable(null, null), false);
});
