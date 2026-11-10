import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { CONFIG, gitHubCodeRevision, gitVersion, log } from "./config.js";
import {
  PREFLIGHT_ENV,
  PREFLIGHT_OK,
  installCommand,
  retryBlocked,
  signatureCheckEnabled,
  type RejectedUpdate,
} from "./updater-rules.js";

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: CONFIG.repoDir,
    timeout: 60_000,
  });
  return stdout.trim();
}

/**
 * Selbst-Update ueber GitHub: Hub-Maschinen sind reine Deployment-Targets und
 * sollen exakt origin/main fahren. Lokale Aenderungen (z. B. Webcam-IP in
 * go2rtc.yaml ohne erfolgreichen Push) duerfen Updates nicht blockieren.
 *
 * Ablauf: fetch → bei Abweichung reset --hard. Neu gestartet wird nur, wenn
 * sich unter hub/ etwas geaendert hat – ein Commit, der allein die Cloud
 * betrifft, laesst den Hub weiterlaufen (frueher startete jeder Push alle
 * Hubs neu). Der Checkout wird trotzdem nachgezogen, damit der Heartbeat den
 * aktuellen Stand meldet.
 *
 * Vor dem Neustart: Abhaengigkeiten installieren (nur wenn sie sich geaendert
 * haben) und Pre-Flight – der neue Stand wird in einem Kindprozess einmal
 * geladen, ohne etwas zu starten. Scheitert eins von beiden, geht der
 * Checkout zurueck auf den vorherigen Commit und der Hub laeuft mit dem alten
 * Code weiter; auf kaputten Code wird nie neu gestartet.
 *
 * Alles laeuft async mit Zeitlimit, damit Tasks, DoorBird-Monitor und
 * Offenhalte-Impulse waehrend der Installation nicht einfrieren.
 *
 * Optional (HUB_UPDATE_VERIFY_SIGNATURE=1): nur Commits einspielen, fuer die
 * `git verify-commit` gelingt. Der Signaturschluessel muss dafuer vorher auf
 * dem Hub-Rechner installiert sein (siehe hub/README.md).
 */
/**
 * Fehlgeschlagene Update-Pruefungen gedrosselt loggen: DNS-Aussetzer am
 * Standort („Could not resolve host: github.com“) kamen sonst alle fuenf
 * Minuten als eigene Zeile. Erste Meldung sofort, danach einmal pro Stunde
 * mit Zaehler, und eine Zeile, wenn es wieder geht.
 */
const ERROR_LOG_EVERY_MS = 60 * 60_000;
let failStreak = 0;
let failSince = 0;
let failLastLoggedAt = 0;

function noteFetchError(message: string): void {
  failStreak++;
  const now = Date.now();
  if (failStreak === 1) {
    failSince = now;
    failLastLoggedAt = now;
    log(`Update-Check fehlgeschlagen: ${message}`);
    return;
  }
  if (now - failLastLoggedAt >= ERROR_LOG_EVERY_MS) {
    failLastLoggedAt = now;
    log(
      `Update-Check weiterhin fehlgeschlagen (${failStreak}× seit ${new Date(failSince).toLocaleTimeString("de-DE")}): ${message}`
    );
  }
}

function noteFetchOk(): void {
  if (failStreak > 0) {
    log(
      `Update-Check wieder erfolgreich nach ${failStreak} Fehlversuch(en) seit ${new Date(failSince).toLocaleTimeString("de-DE")}.`
    );
  }
  failStreak = 0;
  failSince = 0;
}

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const PREFLIGHT_TIMEOUT_MS = 2 * 60_000;
/** Abgelehnten Stand fruehestens nach 30 min erneut probieren (oder beim naechsten Commit). */
const RETRY_REJECTED_AFTER_MS = 30 * 60_000;

/** Installation und Pre-Flight koennen laenger dauern als das Pruef-Intervall. */
let running = false;
let rejected: RejectedUpdate | null = null;
/** node_modules passt evtl. nicht mehr zum Checkout (Installation abgebrochen/zurueckgerollt). */
let depsDirty = false;

const short = (rev: string) => rev.slice(0, 7);

/**
 * Kindprozess mit Zeitlimit, ohne den Event-Loop zu blockieren. Eigene
 * Prozessgruppe: Beim Zeitlimit wird die ganze Gruppe beendet (npm und npx
 * starten selbst Kinder, die sonst weiterliefen).
 */
function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<{ ok: boolean; output: string; error: string | null }> {
  return new Promise((resolve) => {
    let output = "";
    let done = false;
    const finish = (ok: boolean, error: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, output, error });
    };
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const collect = (d: Buffer) => {
      // Nur das Ende aufheben – reicht fuer die Fehlermeldung.
      output = (output + d.toString("utf8")).slice(-4000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish(false, `Zeitlimit (${Math.round(opts.timeoutMs / 1000)} s) ueberschritten`);
    }, opts.timeoutMs);
    child.on("error", (e) => finish(false, e.message));
    child.on("close", (code, signal) => {
      if (code === 0) finish(true, null);
      else finish(false, signal ? `Signal ${signal}` : `Exit-Code ${code}`);
    });
  });
}

/** Kurzfassung der Ausgabe fuers Log: Fehlerzeilen, sonst die letzten Zeilen. */
function tail(output: string): string {
  const all = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const errors = all.filter((l) => /error|ERR!|cannot find|not found/i.test(l) && !l.startsWith("at "));
  const lines = (errors.length ? errors.slice(0, 4) : all.slice(-6)).join(" | ");
  return lines ? ` – ${lines.slice(0, 600)}` : "";
}

/** Haben sich Manifest oder Lockfile seit dem laufenden Stand geaendert? */
async function depsChanged(): Promise<boolean> {
  if (depsDirty) return true;
  if (CONFIG.hubCodeRevision === "unknown") return true;
  if (!existsSync(path.join(CONFIG.hubDir, "node_modules"))) return true;
  try {
    // --quiet: Exit-Code 1 bei Unterschieden (execFile wirft dann).
    await git([
      "diff",
      "--quiet",
      CONFIG.hubCodeRevision,
      "HEAD",
      "--",
      "hub/package.json",
      "hub/package-lock.json",
    ]);
    return false;
  } catch {
    // Unterschied oder Vergleich nicht moeglich: sicherheitshalber installieren.
    return true;
  }
}

async function installDeps(): Promise<string | null> {
  const { args, label } = installCommand(
    existsSync(path.join(CONFIG.hubDir, "package-lock.json"))
  );
  log(`Update: ${label} …`);
  const r = await run("npm", args, { cwd: CONFIG.hubDir, timeoutMs: INSTALL_TIMEOUT_MS });
  return r.ok ? null : `${label} fehlgeschlagen (${r.error})${tail(r.output)}`;
}

/**
 * Laedt den neuen Stand einmal in einem Kindprozess – genau der Befehl, mit
 * dem launchd den Hub startet. index.ts beendet sich bei HUB_PREFLIGHT=1
 * direkt nach dem Laden aller Module (siehe updater-rules.ts).
 */
async function preflight(): Promise<string | null> {
  const r = await run("npx", ["tsx", "src/index.ts"], {
    cwd: CONFIG.hubDir,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
    env: { ...process.env, [PREFLIGHT_ENV]: "1" },
  });
  if (r.ok && r.output.includes(PREFLIGHT_OK)) return null;
  return `Pre-Flight fehlgeschlagen (${r.error ?? "keine Bestaetigung vom neuen Stand"})${tail(r.output)}`;
}

/**
 * Neuer Stand taugt nicht: Checkout zurueck auf den vorherigen Commit (nur
 * wenn dieser Lauf ihn selbst geaendert hat) – und KEIN Neustart.
 */
async function rollback(resetFrom: string | null, failedRev: string, why: string, depsTouched: boolean): Promise<void> {
  rejected = { rev: failedRev, at: Date.now() };
  const retry = `Naechster Versuch in ${Math.round(RETRY_REJECTED_AFTER_MS / 60_000)} min oder mit dem naechsten Commit.`;
  if (!resetFrom) {
    log(
      `Update ABGEBROCHEN: ${why}. Der Checkout (${short(failedRev)}) wurde nicht von diesem Lauf geaendert – kein Rollback, KEIN Neustart; der Hub laeuft mit dem bisherigen Code weiter. ${retry}`
    );
    return;
  }
  try {
    await git(["reset", "--hard", resetFrom]);
    CONFIG.version = gitVersion();
    log(
      `Update ABGEBROCHEN: ${why}. Rollback ${short(failedRev)} -> ${short(resetFrom)}, KEIN Neustart; der Hub laeuft mit dem bisherigen Code weiter. ${retry}`
    );
  } catch (e) {
    log(
      `Update ABGEBROCHEN: ${why}. ROLLBACK FEHLGESCHLAGEN (${e instanceof Error ? e.message : e}) – der Checkout steht auf dem ungeprueften Stand ${short(failedRev)}. KEIN Neustart; bitte pruefen (hub/install/update.sh).`
    );
    return;
  }
  if (depsTouched) {
    // Die Installation hat node_modules evtl. schon auf den neuen Stand gebracht.
    const problem = await installDeps();
    if (problem) {
      log(`Update: Abhaengigkeiten des bisherigen Stands nicht wiederhergestellt: ${problem}. Wird beim naechsten Update erneut installiert.`);
    } else {
      depsDirty = false;
    }
  }
}

async function runUpdateCheck(): Promise<void> {
  await git(["fetch", "origin", "main", "--quiet"]);
  noteFetchOk();
  const head = await git(["rev-parse", "HEAD"]);
  const remote = await git(["rev-parse", "origin/main"]);

  // Kuerzlich abgelehnter Stand (Signatur, Installation, Pre-Flight): nicht
  // alle fuenf Minuten erneut einspielen und zurueckrollen.
  const blocked = retryBlocked(rejected, remote, Date.now(), RETRY_REJECTED_AFTER_MS);

  /** Vorheriger Commit, falls dieser Lauf den Checkout aendert (fuer den Rollback). */
  let resetFrom: string | null = null;
  if (head !== remote) {
    if (blocked) return;

    if (signatureCheckEnabled(process.env.HUB_UPDATE_VERIFY_SIGNATURE)) {
      try {
        await git(["verify-commit", remote]);
      } catch (e) {
        rejected = { rev: remote, at: Date.now() };
        const detail = (e as { stderr?: string }).stderr?.trim().split("\n").slice(-2).join(" | ") || (e instanceof Error ? e.message : String(e));
        log(
          `Update ABGELEHNT: Commit ${short(remote)} ist nicht gueltig signiert (HUB_UPDATE_VERIFY_SIGNATURE) – der Hub bleibt auf ${short(head)}. ${detail.slice(-300)}`
        );
        return;
      }
    }

    const dirty = await git(["status", "--porcelain", "--untracked-files=no"]);
    if (dirty) {
      log(`Update: lokale Aenderungen werden verworfen:\n${dirty}`);
    }
    log(`Update gefunden: ${short(head)} -> ${short(remote)}. reset --hard …`);
    // Auf genau den (ggf. signaturgeprueften) Commit, nicht auf den Zweignamen.
    await git(["reset", "--hard", remote]);
    resetFrom = head;
    CONFIG.version = gitVersion();
  }

  // Neustart nur, wenn der laufende Prozess einen anderen hub/-Stand hat
  // als der Checkout – egal ob durch dieses Update oder ein manuelles pull.
  const hubRev = gitHubCodeRevision();
  if (hubRev === "unknown" || hubRev === CONFIG.hubCodeRevision) {
    if (head !== remote) log("Update betrifft nur die Cloud – Hub laeuft ohne Neustart weiter.");
    return;
  }
  // Derselbe Stand ist gerade erst gescheitert (ohne Rollback): abwarten.
  if (blocked) return;

  log(
    `Hub-Code geaendert (${short(CONFIG.hubCodeRevision)} -> ${short(hubRev)}): Abhaengigkeiten pruefen, Pre-Flight, dann Neustart …`
  );
  let depsTouched = false;
  let problem: string | null = null;
  if (await depsChanged()) {
    depsTouched = true;
    depsDirty = true;
    problem = await installDeps();
    if (!problem) depsDirty = false;
  } else {
    log("Update: Abhaengigkeiten unveraendert – keine Installation noetig.");
  }
  if (!problem) problem = await preflight();
  if (problem) {
    if (depsTouched) depsDirty = true;
    await rollback(resetFrom, remote, problem, depsTouched);
    return;
  }

  log("Neuer Stand installiert und geprueft – Prozess wird beendet (launchd startet neu).");
  process.exit(0);
}

export async function checkForUpdate(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runUpdateCheck();
  } catch (e) {
    noteFetchError(e instanceof Error ? e.message : String(e));
  } finally {
    running = false;
  }
}
