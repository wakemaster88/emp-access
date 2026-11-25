import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { build } from "esbuild";

// Prueft die statische Import-Kette der Geraete-Routen: die Token-Pruefung
// soll ohne Anmelde- und Push-Bibliotheken auskommen. Dynamische Importe
// (await import()) zaehlen nicht mit.
const ROOT = join(__dirname, "..", "..");
const FERN = ["next-auth", "bcryptjs", "@simplewebauthn/server", "web-push"];
const ROUTEN = ["src/app/api/devices/pi/scan/route.ts", "src/app/api/devices/pi/route.ts"];

async function statischErreichbarePakete(entry: string): Promise<Set<string>> {
  const r = await build({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
    tsconfig: join(ROOT, "tsconfig.json"),
    absWorkingDir: ROOT,
  });
  const inputs = r.metafile.inputs;
  const start = Object.keys(inputs).find((k) => k === entry || k.endsWith(`/${entry}`));
  assert.ok(start, `Einstieg nicht gefunden: ${entry}`);
  const gesehen = new Set<string>();
  const pakete = new Set<string>();
  const offen = [start];
  while (offen.length > 0) {
    const datei = offen.shift()!;
    if (gesehen.has(datei)) continue;
    gesehen.add(datei);
    for (const imp of inputs[datei]?.imports ?? []) {
      if (imp.kind === "dynamic-import") continue;
      if (imp.external) pakete.add(imp.path);
      else offen.push(imp.path);
    }
  }
  return pakete;
}

for (const route of ROUTEN) {
  test(`${route} zieht statisch keine Anmelde- oder Push-Bibliothek`, async () => {
    const erreichbar = [...(await statischErreichbarePakete(route))];
    for (const lib of FERN) {
      const treffer = erreichbar.filter((p) => p === lib || p.startsWith(`${lib}/`));
      assert.deepEqual(treffer, [], `${lib} ist statisch erreichbar`);
    }
  });
}
