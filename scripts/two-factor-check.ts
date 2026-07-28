/**
 * Prueft die Zwei-Faktor-Bausteine ohne Datenbank und ohne Browser.
 *
 * Kern der Sache sind die Testvektoren aus RFC 6238: waeren sie falsch,
 * wuerden die Codes aus Google Authenticator & Co. nie passen. Dazu kommen
 * die sicherheitsrelevanten Zusagen der Anmeldung – kein Code zweimal, Sperre
 * nach fuenf Fehlversuchen, Wiederherstellungscode genau einmal.
 *
 * Ausfuehren: npx tsx scripts/two-factor-check.ts
 */

// Nur der Typ – wird beim Uebersetzen entfernt und laedt das Modul nicht.
import type { TwoFactorFields } from "../src/lib/two-factor";

// Muss vor dem Laden der Module stehen (daher dynamische Importe unten):
// secret-box leitet seinen Schluessel aus AUTH_SECRET ab, und src/lib/prisma
// verlangt eine DATABASE_URL, auch wenn hier nie eine Abfrage laeuft.
process.env.AUTH_SECRET ||= "test-secret-nur-fuer-dieses-skript";
process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/testdb";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(` FEHL  ${label}${detail ? ` – ${detail}` : ""}`);
  }
}

async function main() {
  const totp = await import("../src/lib/totp");
  const box = await import("../src/lib/secret-box");
  const tf = await import("../src/lib/two-factor");

  // ---------------------------------------------------------------- RFC 6238
  // Seed "12345678901234567890" (ASCII) als Base32, SHA-1.
  const rfcSecret = totp.base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const vectors: Array<[number, string]> = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  console.log("RFC 6238 Testvektoren");
  for (const [seconds, expected] of vectors) {
    const step = Math.floor(seconds / 30);
    const actual = totp.totpCodeForStep(rfcSecret, step);
    check(`T=${seconds} -> ${expected}`, actual === expected, `erhalten ${actual}`);
  }

  console.log("\nBase32");
  const roundtrip = totp.base32Decode(rfcSecret).toString("ascii");
  check("encode/decode ist verlustfrei", roundtrip === "12345678901234567890", roundtrip);
  check("Trennzeichen werden ignoriert", totp.base32Decode(totp.formatSecretForDisplay(rfcSecret)).equals(totp.base32Decode(rfcSecret)));

  // -------------------------------------------------------------- Zeitfenster
  console.log("\nZeitfenster");
  const secret = totp.generateTotpSecret();
  const now = 1_800_000_000_000;
  const step = totp.currentTotpStep(now);
  check("aktueller Code passt", totp.verifyTotp(secret, totp.totpCodeForStep(secret, step), { atMs: now }) === step);
  check(
    "ein Schritt Drift wird toleriert",
    totp.verifyTotp(secret, totp.totpCodeForStep(secret, step - 1), { atMs: now }) === step - 1
  );
  check(
    "zwei Schritte Drift werden abgelehnt",
    totp.verifyTotp(secret, totp.totpCodeForStep(secret, step - 2), { atMs: now }) === null
  );
  check("fremder Code wird abgelehnt", totp.verifyTotp(secret, "000000", { atMs: now }) === null || totp.totpCodeForStep(secret, step) === "000000");

  // ------------------------------------------------------------- Verschluesselung
  console.log("\nSecret-Ablage");
  const sealed = box.sealSecret(secret);
  check("Secret steht nicht im Klartext", !sealed.includes(secret));
  check("Entschluesseln liefert das Original", box.openSecret(sealed) === secret);
  check("zwei Durchlaeufe erzeugen verschiedene Chiffrate", box.sealSecret(secret) !== sealed);
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A");
  check("manipuliertes Chiffrat wird erkannt", box.openSecret(tampered) === null);
  check("Muell wird nicht akzeptiert", box.openSecret("nope") === null);

  // ----------------------------------------------------------------- Anmeldung
  console.log("\nAnmeldung mit zweitem Faktor");

  const RECOVERY = "ABCDE-FGHJK";
  const otherRecovery = "MNPQR-STUVW";

  function makeAdmin(): TwoFactorFields {
    return {
      id: 1,
      twoFactorSecret: box.sealSecret(secret),
      twoFactorEnabledAt: new Date(now - 86_400_000),
      twoFactorRecoveryCodes: [RECOVERY, otherRecovery].map((c) =>
        box.keyedFingerprint("admin-recovery-code", c.replace(/-/g, ""))
      ),
      twoFactorLastStep: null,
      twoFactorFailures: 0,
      twoFactorLockedUntil: null,
    };
  }

  // Die Attrappe schreibt in denselben Datensatz zurueck, damit
  // aufeinanderfolgende Versuche denselben Zustand sehen wie in der Datenbank.
  function makeDb(admin: TwoFactorFields) {
    return {
      admin: {
        async update({ data }: { where: { id: number }; data: Record<string, unknown> }) {
          Object.assign(admin, data);
          return {};
        },
      },
    };
  }

  {
    const admin = makeAdmin();
    const db = makeDb(admin);
    const at = new Date(now);
    const code = totp.totpCodeForStep(secret, step);

    const first = await tf.verifySecondFactor(admin, code, { db, now: at });
    check("gueltiger Code wird angenommen", first.ok === true);
    check("verbrauchter Zeitschritt wird gemerkt", admin.twoFactorLastStep === step);

    const replay = await tf.verifySecondFactor(admin, code, { db, now: at });
    check("derselbe Code ein zweites Mal wird abgelehnt", !replay.ok && replay.reason === "invalid");
    check("Wiederverwendung zaehlt als Fehlversuch", admin.twoFactorFailures === 1);
  }

  {
    const admin = makeAdmin();
    const db = makeDb(admin);
    const at = new Date(now);
    let last: Awaited<ReturnType<typeof tf.verifySecondFactor>> | null = null;
    for (let i = 0; i < 5; i++) {
      last = await tf.verifySecondFactor(admin, "000001", { db, now: at });
    }
    check("nach fuenf Fehlversuchen wird gesperrt", !last!.ok && last!.reason === "locked");
    check("Sperrzeitpunkt ist gesetzt", admin.twoFactorLockedUntil !== null && admin.twoFactorLockedUntil > at);

    const whileLocked = await tf.verifySecondFactor(admin, totp.totpCodeForStep(secret, step), { db, now: at });
    check("waehrend der Sperre hilft auch der richtige Code nicht", !whileLocked.ok && whileLocked.reason === "locked");

    const later = new Date(now + 16 * 60_000);
    const laterStep = totp.currentTotpStep(later.getTime());
    const afterLock = await tf.verifySecondFactor(admin, totp.totpCodeForStep(secret, laterStep), { db, now: later });
    check("nach Ablauf der Sperre geht es weiter", afterLock.ok === true);
    check("Zaehler ist zurueckgesetzt", admin.twoFactorFailures === 0 && admin.twoFactorLockedUntil === null);
  }

  {
    const admin = makeAdmin();
    const db = makeDb(admin);
    const at = new Date(now);

    const used = await tf.verifySecondFactor(admin, "abcde fghjk", { db, now: at });
    check(
      "Wiederherstellungscode wird unabhaengig von Schreibweise erkannt",
      used.ok === true && used.usedRecoveryCode === true
    );
    check("verbrauchter Code verschwindet aus der Liste", admin.twoFactorRecoveryCodes.length === 1);

    const again = await tf.verifySecondFactor(admin, RECOVERY, { db, now: at });
    check("derselbe Wiederherstellungscode ein zweites Mal scheitert", !again.ok && again.reason === "invalid");

    const unknown = await tf.verifySecondFactor(admin, "ZZZZZ-ZZZZZ", { db, now: at });
    check("unbekannter Wiederherstellungscode scheitert", !unknown.ok && unknown.reason === "invalid");
  }

  {
    const admin = makeAdmin();
    const db = makeDb(admin);
    const at = new Date(now);

    const empty = await tf.verifySecondFactor(admin, "", { db, now: at });
    check("leere Eingabe meldet 'missing'", !empty.ok && empty.reason === "missing");
    check("leere Eingabe zaehlt nicht als Fehlversuch", admin.twoFactorFailures === 0);

    const broken = { ...makeAdmin(), twoFactorSecret: "v1.kaputt.kaputt.kaputt" };
    const unreadable = await tf.verifySecondFactor(broken, "123456", { db: makeDb(broken), now: at });
    check("unlesbares Secret meldet 'unreadable'", !unreadable.ok && unreadable.reason === "unreadable");
  }

  console.log("\nWiederherstellungscodes");
  const codes = totp.generateRecoveryCodes();
  check("zehn Stueck", codes.length === 10);
  check("alle verschieden", new Set(codes).size === codes.length);
  check("Format XXXXX-XXXXX", codes.every((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c)));
  check("keine verwechselbaren Zeichen", codes.every((c) => !/[O0I1L]/.test(c)));
  check("werden nicht mit einem TOTP verwechselt", codes.every((c) => totp.looksLikeRecoveryCode(c)));
  check("ein sechsstelliger Code gilt nicht als Wiederherstellungscode", !totp.looksLikeRecoveryCode("123456"));

  console.log("\notpauth-URL");
  const url = totp.otpauthUrl({ secret, account: "admin@example.de", issuer: tf.ISSUER });
  check("Schema stimmt", url.startsWith("otpauth://totp/"));
  check("Secret ist enthalten", url.includes(`secret=${secret}`));
  check("Konto ist enthalten", url.includes(encodeURIComponent("admin@example.de")));

  console.log(failed === 0 ? "\nAlles in Ordnung." : `\n${failed} Pruefung(en) fehlgeschlagen.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
