#!/usr/bin/env node
/**
 * Erzeugt src/lib/tenant-models.ts aus prisma/schema.prisma: die Liste aller
 * Modelle mit einem `accountId`-Feld. Der Mandanten-Client (src/lib/prisma.ts)
 * haengt bei genau diesen Modellen den Account-Filter an jede Query.
 *
 * Aufruf: node scripts/gen-tenant-models.mjs
 * Der Test src/lib/tenant-models.test.ts schlaegt fehl, wenn die Liste nicht
 * mehr zum Schema passt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function tenantModelsFromSchema(schema) {
  const out = [];
  let current = null;
  for (const line of schema.split("\n")) {
    const m = line.match(/^model\s+(\w+)\s*\{/);
    if (m) { current = m[1]; continue; }
    if (line.startsWith("}")) { current = null; continue; }
    if (current && /^\s+accountId\s+Int\b/.test(line)) out.push(current);
  }
  return [...new Set(out)].sort();
}

const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const models = tenantModelsFromSchema(schema);
const body = `// GENERIERT von scripts/gen-tenant-models.mjs – nicht von Hand bearbeiten.
// Modelle mit einem accountId-Feld. Der Mandanten-Client in src/lib/prisma.ts
// erzwingt bei diesen Modellen den Account-Filter auf jeder Query.
export const TENANT_MODELS = new Set<string>([
${models.map((m) => `  "${m}",`).join("\n")}
]);
`;
if (process.argv.includes("--check")) {
  const existing = readFileSync(path.join(root, "src/lib/tenant-models.ts"), "utf8");
  if (existing !== body) {
    console.error("src/lib/tenant-models.ts ist veraltet – bitte `node scripts/gen-tenant-models.mjs` ausfuehren.");
    process.exit(1);
  }
  console.log(`tenant-models.ts aktuell (${models.length} Modelle)`);
} else {
  writeFileSync(path.join(root, "src/lib/tenant-models.ts"), body);
  console.log(`src/lib/tenant-models.ts geschrieben (${models.length} Modelle)`);
}
