#!/usr/bin/env node
/**
 * Build-Schritt fuer Vercel.
 *
 * `prisma migrate deploy` lief frueher bei JEDEM Build, auch fuer Preview-
 * Deployments. Ohne eigene Neon-Branch pro Preview haette ein Feature-Branch
 * damit die Produktionsdatenbank migriert. Jetzt:
 *
 *   - Production-Build (VERCEL_ENV=production) und lokaler Build: migrieren
 *   - Preview-Build: nur mit PREVIEW_MIGRATE=1 (setzen, wenn die Neon-
 *     Integration pro Preview eine eigene Branch anlegt)
 */
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
const migrate = !env || env === "production" || process.env.PREVIEW_MIGRATE === "1";

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

if (migrate) {
  run("npx prisma migrate deploy");
} else {
  console.log(`\n[build] VERCEL_ENV=${env}: prisma migrate deploy uebersprungen (PREVIEW_MIGRATE=1 setzt es fuer Preview-Branches frei).`);
}
run("npx prisma generate");
run("next build");
