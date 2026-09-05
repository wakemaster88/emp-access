/**
 * Zieht Bilder und PDFs aus den BYTEA-Spalten in den Vercel-Blob-Speicher.
 *
 * Laeuft in Haeppchen und ist jederzeit abbrechbar: Jede Zeile wird erst nach
 * erfolgreichem Upload umgehaengt (Pfad gesetzt, Bytes auf NULL). Ein
 * erneuter Aufruf macht dort weiter, wo noch Bytes liegen.
 *
 * Aufruf: DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... npx tsx scripts/migrate-images-to-blob.ts [--limit 500]
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { blobConfigured, storeBlob } from "../src/lib/blob-store";

const BATCH = 25;
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) || Infinity : Infinity;

let moved = 0;

async function migrateScanSnapshots() {
  for (;;) {
    if (moved >= LIMIT) return;
    const rows = await prisma.scanSnapshot.findMany({
      where: { blobPathname: null, image: { not: null } },
      select: { id: true, accountId: true, image: true },
      take: BATCH,
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) return;
    for (const r of rows) {
      const path = await storeBlob("scan-snapshots", r.accountId, r.image!, "image/jpeg", "jpg");
      if (!path) throw new Error(`Upload fehlgeschlagen: ScanSnapshot ${r.id}`);
      await prisma.scanSnapshot.update({ where: { id: r.id }, data: { blobPathname: path, image: null } });
      moved += 1;
    }
    console.log(`ScanSnapshot: ${moved} umgezogen …`);
  }
}

async function migratePersonSightings() {
  for (;;) {
    if (moved >= LIMIT) return;
    const rows = await prisma.personSighting.findMany({
      where: { snapshotBlob: null, snapshot: { not: null } },
      select: { id: true, accountId: true, snapshot: true },
      take: BATCH,
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) return;
    for (const r of rows) {
      const path = await storeBlob("person-sightings", r.accountId, r.snapshot!, "image/jpeg", "jpg");
      if (!path) throw new Error(`Upload fehlgeschlagen: PersonSighting ${r.id}`);
      await prisma.personSighting.update({ where: { id: r.id }, data: { snapshotBlob: path, snapshot: null } });
      moved += 1;
    }
    console.log(`PersonSighting: ${moved} umgezogen …`);
  }
}

async function migrateVehicleSightings() {
  for (;;) {
    if (moved >= LIMIT) return;
    const rows = await prisma.vehicleSighting.findMany({
      where: { snapshotBlob: null, snapshot: { not: null } },
      select: { id: true, accountId: true, snapshot: true },
      take: BATCH,
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) return;
    for (const r of rows) {
      const path = await storeBlob("vehicle-sightings", r.accountId, r.snapshot!, "image/jpeg", "jpg");
      if (!path) throw new Error(`Upload fehlgeschlagen: VehicleSighting ${r.id}`);
      await prisma.vehicleSighting.update({ where: { id: r.id }, data: { snapshotBlob: path, snapshot: null } });
      moved += 1;
    }
    console.log(`VehicleSighting: ${moved} umgezogen …`);
  }
}

async function migrateAlertImages() {
  for (;;) {
    if (moved >= LIMIT) return;
    const rows = await prisma.monitorAlertImage.findMany({
      where: { blobPathname: null, image: { not: null } },
      select: { id: true, image: true, alert: { select: { accountId: true } } },
      take: BATCH,
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) return;
    for (const r of rows) {
      const path = await storeBlob("alert-images", r.alert.accountId, r.image!, "image/jpeg", "jpg");
      if (!path) throw new Error(`Upload fehlgeschlagen: MonitorAlertImage ${r.id}`);
      await prisma.monitorAlertImage.update({ where: { id: r.id }, data: { blobPathname: path, image: null } });
      moved += 1;
    }
    console.log(`MonitorAlertImage: ${moved} umgezogen …`);
  }
}

async function migrateKeyPdfs() {
  for (;;) {
    if (moved >= LIMIT) return;
    const rows = await prisma.keySignature.findMany({
      where: { pdfBlob: null, pdf: { not: null } },
      select: { id: true, accountId: true, pdf: true },
      take: BATCH,
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) return;
    for (const r of rows) {
      const path = await storeBlob("key-pdfs", r.accountId, r.pdf!, "application/pdf", "pdf");
      if (!path) throw new Error(`Upload fehlgeschlagen: KeySignature ${r.id}`);
      await prisma.keySignature.update({ where: { id: r.id }, data: { pdfBlob: path, pdf: null } });
      moved += 1;
    }
    console.log(`KeySignature: ${moved} umgezogen …`);
  }
}

async function main() {
  if (!blobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN fehlt");
  await migrateScanSnapshots();
  await migratePersonSightings();
  await migrateVehicleSightings();
  await migrateAlertImages();
  await migrateKeyPdfs();
  console.log(`Fertig: ${moved} Dateien umgezogen.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
