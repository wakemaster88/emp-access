/**
 * One-off Import: Legt den Verein "Tristar Oelde" fuer einen Account an und
 * fuegt alle Mitglieder aus der ODS-Mitgliederliste als Mitglieds-Tickets
 * hinzu (ohne RFID/QR/Barcode, ohne Tickettyp).
 *
 * Quelle: /Users/aaronarmborst/Downloads/Mitgliederliste-2026-Tutti.ods
 * (Spalten: M/W | Name (Nachname) | Vorname)
 *
 * Idempotent: erneutes Ausfuehren erzeugt keine Duplikate – existierende
 * Tickets (matched per accountId + firstName + lastName) werden nur dem
 * Verein zugeordnet.
 *
 * Run:  npx tsx scripts/import-tristar-members.ts
 *       npx tsx scripts/import-tristar-members.ts --account=1
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import "dotenv/config";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const VEREIN_NAME = "Tristar Oelde";

/** Mitgliederliste aus der ODS (Spalten Anrede, Nachname, Vorname). */
const MEMBERS: Array<{ salutation: string; lastName: string; firstName: string }> = [
  { salutation: "Frau", lastName: "Baxheinrich", firstName: "Andrea" },
  { salutation: "Frau", lastName: "Baumeister", firstName: "Anna" },
  { salutation: "Frau", lastName: "Baumeister", firstName: "Anne" },
  { salutation: "Frau", lastName: "Knubel", firstName: "Annette" },
  { salutation: "Frau", lastName: "Hartman", firstName: "Annik" },
  { salutation: "Frau", lastName: "Wiegard", firstName: "Annika" },
  { salutation: "Frau", lastName: "Brormann", firstName: "Ayleen" },
  { salutation: "Frau", lastName: "Kalläne", firstName: "Bettina" },
  { salutation: "Frau", lastName: "Huster", firstName: "Birgit" },
  { salutation: "Frau", lastName: "Bredenhöller", firstName: "Carolin" },
  { salutation: "Frau", lastName: "Köning", firstName: "Christiane" },
  { salutation: "Frau", lastName: "Schmidtke", firstName: "Christiane" },
  { salutation: "Frau", lastName: "Brand", firstName: "Daniela" },
  { salutation: "Frau", lastName: "Schalkamp", firstName: "Elke" },
  { salutation: "Frau", lastName: "Günnewig", firstName: "Ines" },
  { salutation: "Frau", lastName: "Kingma", firstName: "Jana" },
  { salutation: "Frau", lastName: "Frankrone", firstName: "Josefine" },
  { salutation: "Frau", lastName: "Kallenbach", firstName: "Julia" },
  { salutation: "Frau", lastName: "Kallenbach", firstName: "Jutta" },
  { salutation: "Frau", lastName: "Voss", firstName: "Katharina" },
  { salutation: "Frau", lastName: "Disselkamp", firstName: "Kira" },
  { salutation: "Frau", lastName: "Karwinkel", firstName: "Laura" },
  { salutation: "Frau", lastName: "Huber", firstName: "Lisa" },
  { salutation: "Frau", lastName: "Bentler", firstName: "Malou" },
  { salutation: "Frau", lastName: "Bunne", firstName: "Marei" },
  { salutation: "Frau", lastName: "Schramm", firstName: "Marion" },
  { salutation: "Frau", lastName: "Köhne-Volland", firstName: "Mathilde Johanna" },
  { salutation: "Frau", lastName: "Laackmann", firstName: "Melina" },
  { salutation: "Frau", lastName: "Driesen", firstName: "Nike Josefine" },
  { salutation: "Frau", lastName: "Essel", firstName: "Pia" },
  { salutation: "Frau", lastName: "Hahne", firstName: "Ruth" },
  { salutation: "Frau", lastName: "Gerkmann", firstName: "Sabrina" },
  { salutation: "Frau", lastName: "Dierkes", firstName: "Sandra" },
  { salutation: "Frau", lastName: "Horstmann", firstName: "Sara" },
  { salutation: "Frau", lastName: "Pinke", firstName: "Silke" },
  { salutation: "Frau", lastName: "Bluhm", firstName: "Silvana" },
  { salutation: "Frau", lastName: "Burwinkel", firstName: "Simone" },
  { salutation: "Frau", lastName: "Reimann", firstName: "Thekla" },
  { salutation: "Frau", lastName: "Landwehrjohann", firstName: "Ulrike" },
  { salutation: "Frau", lastName: "Lücke", firstName: "Verena" },
  { salutation: "Frau", lastName: "Rickfelder", firstName: "Yvonne" },
  { salutation: "Herr", lastName: "Hakenholt", firstName: "Achim" },
  { salutation: "Herr", lastName: "Niemann", firstName: "Albert" },
  { salutation: "Herr", lastName: "Boehm", firstName: "Alexander" },
  { salutation: "Herr", lastName: "Nordhoff", firstName: "Alexander" },
  { salutation: "Herr", lastName: "Knaup", firstName: "Andreas" },
  { salutation: "Herr", lastName: "Labianca", firstName: "Andreas" },
  { salutation: "Herr", lastName: "Sumkötter", firstName: "Andreas" },
  { salutation: "Herr", lastName: "Müller", firstName: "Axel" },
  { salutation: "Herr", lastName: "Runschke", firstName: "Axel" },
  { salutation: "Herr", lastName: "Althoff", firstName: "Ben" },
  { salutation: "Herr", lastName: "Bittner", firstName: "Bernhard" },
  { salutation: "Herr", lastName: "Graw", firstName: "Burkhard" },
  { salutation: "Herr", lastName: "Huster", firstName: "Christian" },
  { salutation: "Herr", lastName: "Koch", firstName: "Christian" },
  { salutation: "Herr", lastName: "Krämer", firstName: "Christian" },
  { salutation: "Herr", lastName: "Predeick", firstName: "Christian" },
  { salutation: "Herr", lastName: "Brünenkamp", firstName: "Christoph" },
  { salutation: "Herr", lastName: "Hentschel", firstName: "Christopher" },
  { salutation: "Herr", lastName: "Meyer-Bothling", firstName: "Claus-Peter" },
  { salutation: "Herr", lastName: "Hellmann", firstName: "Daniel" },
  { salutation: "Herr", lastName: "Pernak", firstName: "Daniel" },
  { salutation: "Herr", lastName: "Bushuven", firstName: "Dennis" },
  { salutation: "Herr", lastName: "Vrajolli", firstName: "Enis" },
  { salutation: "Herr", lastName: "Kühn", firstName: "Florian" },
  { salutation: "Herr", lastName: "Kaasmann", firstName: "Frank" },
  { salutation: "Herr", lastName: "Pietschke", firstName: "Frank" },
  { salutation: "Herr", lastName: "Landwehrjohann", firstName: "Fynn" },
  { salutation: "Herr", lastName: "Conrad", firstName: "Hannes" },
  { salutation: "Herr", lastName: "Karwinkel", firstName: "Helmut" },
  { salutation: "Herr", lastName: "Simm", firstName: "Hendrik" },
  { salutation: "Herr", lastName: "Katiela", firstName: "Hussam" },
  { salutation: "Herr", lastName: "Gerke", firstName: "Jacob" },
  { salutation: "Herr", lastName: "Burwinkel", firstName: "Jan" },
  { salutation: "Herr", lastName: "Stefan", firstName: "Jannis" },
  { salutation: "Herr", lastName: "Coulthard", firstName: "Jason" },
  { salutation: "Herr", lastName: "Brodka", firstName: "Jens" },
  { salutation: "Herr", lastName: "Conrad", firstName: "Jens" },
  { salutation: "Herr", lastName: "Kruse", firstName: "Johan Frederik" },
  { salutation: "Herr", lastName: "Levermann", firstName: "Jonas" },
  { salutation: "Herr", lastName: "Lütsch", firstName: "Karsten" },
  { salutation: "Herr", lastName: "Henning", firstName: "Kjell Malte" },
  { salutation: "Herr", lastName: "Langerbein", firstName: "Lennard" },
  { salutation: "Herr", lastName: "Friebe", firstName: "Leon" },
  { salutation: "Herr", lastName: "Schwab", firstName: "Lucas" },
  { salutation: "Herr", lastName: "Ganstein", firstName: "Maik" },
  { salutation: "Herr", lastName: "Baehr", firstName: "Malte" },
  { salutation: "Herr", lastName: "Ratering", firstName: "Marcel" },
  { salutation: "Herr", lastName: "Dieckmann", firstName: "Marco" },
  { salutation: "Herr", lastName: "Landwehrjohann", firstName: "Marie" },
  { salutation: "Herr", lastName: "Landwehrjohann", firstName: "Markus" },
  { salutation: "Herr", lastName: "Lütke Föller", firstName: "Markus" },
  { salutation: "Herr", lastName: "Volpert", firstName: "Markus Johannes" },
  { salutation: "Herr", lastName: "Fust", firstName: "Martin" },
  { salutation: "Herr", lastName: "Häßler", firstName: "Max Luca" },
  { salutation: "Herr", lastName: "Rudnick", firstName: "Maximilian" },
  { salutation: "Herr", lastName: "Holtrup", firstName: "Moritz" },
  { salutation: "Herr", lastName: "Schorr", firstName: "Moritz" },
  { salutation: "Herr", lastName: "Hille", firstName: "Niko" },
  { salutation: "Herr", lastName: "Brückner", firstName: "Oscar" },
  { salutation: "Herr", lastName: "Maciosek", firstName: "Patrick" },
  { salutation: "Herr", lastName: "Häßler", firstName: "Peter" },
  { salutation: "Herr", lastName: "Schramm", firstName: "Philpp" },
  { salutation: "Herr", lastName: "Grundkötter", firstName: "Ralf" },
  { salutation: "Herr", lastName: "Schumacher", firstName: "Ralf" },
  { salutation: "Herr", lastName: "Findling", firstName: "Rene" },
  { salutation: "Herr", lastName: "Gottwald", firstName: "Roger" },
  { salutation: "Herr", lastName: "Disselkamp", firstName: "Roman" },
  { salutation: "Herr", lastName: "Baxheinrich", firstName: "Sebastian" },
  { salutation: "Herr", lastName: "Brentrup", firstName: "Sebastian" },
  { salutation: "Herr", lastName: "Nottelmann", firstName: "Sören" },
  { salutation: "Herr", lastName: "Raulf", firstName: "Stefan" },
  { salutation: "Herr", lastName: "Baum", firstName: "Stephan" },
  { salutation: "Herr", lastName: "Brahmst", firstName: "Stephan" },
  { salutation: "Herr", lastName: "Kalläne", firstName: "Sven" },
  { salutation: "Herr", lastName: "Meyer-Bothing", firstName: "Swantje" },
  { salutation: "Herr", lastName: "Hartmann", firstName: "Thomas" },
  { salutation: "Herr", lastName: "Hömberg", firstName: "Tim" },
  { salutation: "Herr", lastName: "Schröder", firstName: "Tim" },
  { salutation: "Herr", lastName: "Hahne", firstName: "Volker" },
  { salutation: "Herr", lastName: "Freitag", firstName: "Wolfgang" },
  { salutation: "Herr", lastName: "Vrajolli", firstName: "Zenel" },
];

function parseAccountId(): number {
  const arg = process.argv.find((a) => a.startsWith("--account="));
  if (arg) {
    const id = Number(arg.split("=")[1]);
    if (!Number.isFinite(id)) throw new Error("--account muss eine Zahl sein");
    return id;
  }
  return 1; // Default: einziger Account "Tuttenbrocksee"
}

async function main() {
  const accountId = parseAccountId();
  console.log(`Importiere Verein "${VEREIN_NAME}" fuer accountId=${accountId}`);

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`Account ${accountId} nicht gefunden`);
  console.log(`Account: ${account.name} (subdomain=${account.subdomain})`);

  // Verein anlegen oder bestehenden wiederverwenden.
  const verein = await prisma.verein.upsert({
    where: { accountId_name: { accountId, name: VEREIN_NAME } },
    update: {},
    create: { name: VEREIN_NAME, accountId },
  });
  console.log(`Verein-ID: ${verein.id}`);

  let created = 0;
  let linked = 0;
  let alreadyLinked = 0;
  let skippedConflict = 0;

  for (const m of MEMBERS) {
    const fullName = `${m.firstName} ${m.lastName}`;

    // Existierende Tickets mit exakt diesem Vor- und Nachnamen suchen.
    // case-insensitive matching, um typische Tippvarianten abzudecken.
    const existing = await prisma.ticket.findMany({
      where: {
        accountId,
        firstName: { equals: m.firstName, mode: "insensitive" },
        lastName: { equals: m.lastName, mode: "insensitive" },
      },
      select: { id: true, vereinId: true, ticketTypeName: true },
    });

    if (existing.length === 0) {
      await prisma.ticket.create({
        data: {
          accountId,
          name: fullName,
          firstName: m.firstName,
          lastName: m.lastName,
          status: "VALID",
          validityType: "DATE_RANGE",
          vereinId: verein.id,
        },
      });
      created++;
      console.log(`  + erstellt: ${fullName}`);
      continue;
    }

    // Bevorzugt ein Ticket, das schon zu DIESEM Verein gehoert; sonst eines,
    // das ueberhaupt keinem Verein zugeordnet ist; sonst Konflikt-Warnung.
    const inThisVerein = existing.find((t) => t.vereinId === verein.id);
    if (inThisVerein) {
      alreadyLinked++;
      continue;
    }
    const free = existing.find((t) => t.vereinId === null);
    if (free) {
      await prisma.ticket.update({
        where: { id: free.id },
        data: { vereinId: verein.id },
      });
      linked++;
      console.log(`  ~ verknuepft: ${fullName} (Ticket #${free.id})`);
      continue;
    }
    // Bereits in einem anderen Verein – konservativ NICHT verschieben.
    skippedConflict++;
    console.warn(
      `  ! ${fullName}: Ticket(s) bereits einem anderen Verein zugeordnet ` +
        `(IDs: ${existing.map((t) => `${t.id}@verein=${t.vereinId}`).join(", ")}) – uebersprungen`,
    );
  }

  const memberCount = await prisma.ticket.count({ where: { vereinId: verein.id } });
  console.log("\nFertig:");
  console.log(`  neu angelegt:       ${created}`);
  console.log(`  bestehend verknuepft: ${linked}`);
  console.log(`  bereits im Verein:  ${alreadyLinked}`);
  console.log(`  Konflikte (skipped): ${skippedConflict}`);
  console.log(`  Mitglieder im Verein insgesamt: ${memberCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
