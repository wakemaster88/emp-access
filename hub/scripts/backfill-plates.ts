/**
 * Plate-OCR über alle VehicleSighting-Snapshots in der Cloud-DB.
 *
 *   DATABASE_URL=... npx tsx scripts/backfill-plates.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-plates.ts --force
 */
import { config } from "dotenv";
config({ path: ".env" });
import pg from "pg";
import { readPlateFromJpeg, setVehicleWhitelist } from "../src/plate.js";

function normalizePlate(plate: string): string {
  return plate
    .trim()
    .toUpperCase()
    .replace(/[Ä]/g, "AE")
    .replace(/[Ö]/g, "OE")
    .replace(/[Ü]/g, "UE")
    .replace(/ß/g, "SS")
    .replace(/[^A-Z0-9]/g, "");
}

async function main() {
  const force = process.argv.includes("--force");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL fehlt");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const wlRes = await client.query<{
    id: number;
    name: string;
    plate: string;
    plateNormalized: string;
  }>(
    `SELECT id, name, plate, "plateNormalized" FROM "AllowedVehicle" WHERE "isActive" = true`
  );
  setVehicleWhitelist(wlRes.rows);
  const whitelist = new Map(
    wlRes.rows.map((r) => [r.plateNormalized, { id: r.id, plate: r.plate }])
  );
  console.log(`Whitelist: ${whitelist.size} Fahrzeuge`);

  // OCR-Fehltreffer bereinigen (zu kurz, 1-Buchstaben-Kreis, bekannte Artefakte).
  // Manuelle Zuordnungen bleiben unangetastet.
  const cleaned = await client.query(
    `UPDATE "VehicleSighting"
     SET plate = NULL, "plateNormalized" = NULL, "allowedVehicleId" = NULL,
         matched = false, source = 'CAMERA_VEHICLE'
     WHERE source = 'CAMERA_PLATE'
       AND (
         length(regexp_replace(coalesce("plateNormalized", ''), '[^0-9]', '', 'g')) < 3
         OR plate ~ '^[A-Z]-'
         OR plate IN ('AI-VA 21', 'H-S 601', 'H-S 9011', 'UN-BR 2041')
         OR (
           matched = true
           AND "plateNormalized" IN ('DOHM338E', 'BOQC626E')
         )
       )
     RETURNING id, plate`
  );
  if (cleaned.rows.length) {
    console.log(
      `Bereinigt ${cleaned.rows.length} Fehltreffer:`,
      cleaned.rows.map((r: { id: number }) => `#${r.id}`).join(", ")
    );
  }

  const list = await client.query<{
    id: number;
    plate: string | null;
    source: string | null;
  }>(
    `SELECT id, plate, source FROM "VehicleSighting"
     WHERE snapshot IS NOT NULL
     ${
       force
         ? ""
         : `AND (plate IS NULL OR plate = '')
            AND coalesce(source, '') <> 'MANUAL'`
     }
     ORDER BY id ASC`
  );
  console.log(`Zu prüfen: ${list.rows.length} Sightings${force ? " (--force)" : ""}`);

  let updated = 0;
  let skipped = 0;

  for (const row of list.rows) {
    const snap = await client.query<{ snapshot: Buffer }>(
      `SELECT snapshot FROM "VehicleSighting" WHERE id = $1`,
      [row.id]
    );
    const buf = snap.rows[0]?.snapshot;
    if (!buf?.length) {
      console.log(`#${row.id}: kein Snapshot`);
      skipped++;
      continue;
    }

    const plate = await readPlateFromJpeg(Buffer.from(buf));
    if (!plate) {
      console.log(`#${row.id}: —`);
      skipped++;
      continue;
    }

    const plateNormalized = normalizePlate(plate);
    const match = whitelist.get(plateNormalized) ?? null;

    if (!force && row.plate && normalizePlate(row.plate) === plateNormalized) {
      skipped++;
      continue;
    }

    await client.query(
      `UPDATE "VehicleSighting"
       SET plate = $2,
           "plateNormalized" = $3,
           "allowedVehicleId" = $4,
           matched = $5,
           source = 'CAMERA_PLATE'
       WHERE id = $1`,
      [row.id, plate, plateNormalized, match?.id ?? null, !!match]
    );
    updated++;
    console.log(
      `#${row.id}: ${row.plate ?? "null"} → ${plate}` +
        (match ? ` (Whitelist #${match.id})` : "")
    );
  }

  const stats = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE plate IS NOT NULL AND plate <> '') AS with_plate,
       COUNT(*) FILTER (WHERE plate IS NULL OR plate = '') AS without_plate,
       COUNT(*) FILTER (WHERE matched) AS matched
     FROM "VehicleSighting" WHERE snapshot IS NOT NULL`
  );
  console.log(`\nFertig: ${updated} aktualisiert, ${skipped} ohne neuen Treffer`);
  console.log("Stand:", stats.rows[0]);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
