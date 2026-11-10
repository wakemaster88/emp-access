import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Lesezugang zum GitHub-Repository per Deploy-Key (fuer ein privates Repo).
 * Gleiches Verfahren wie auf den Pis (raspberry-pi/emp_scanner/repo_access.py):
 *
 * 1. Der Hub erzeugt einen eigenen SSH-Schluessel
 *    (~/.config/emp-access/github_deploy_ed25519) und meldet den oeffentlichen
 *    Teil im Heartbeat an die Cloud (Einstellungen -> „Update-Zugang der Geraete“).
 * 2. Der Admin traegt ihn bei GitHub als Deploy-Key ein (nur Lesen).
 * 3. Vor jedem Update-Check prueft der Hub per `git ls-remote` ueber SSH, ob
 *    GitHub den Schluessel annimmt, und stellt dann `origin` auf SSH um
 *    (inkl. `core.sshCommand`, damit auch hub/install/update.sh funktioniert).
 *
 * Bis dahin bleibt alles beim alten (HTTPS). Fehler hier blockieren nie das Update.
 */

export const DEFAULT_KEY_DIR = path.join(os.homedir(), ".config", "emp-access");
const SSH_HOST = "ssh.github.com";
const SSH_PORT = 443;
/** Oeffentlicher ed25519-Host-Schluessel von github.com (SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU). */
const GITHUB_ED25519 =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

export type RepoAccessStatus = {
  mode: "ssh" | "https";
  publicKey?: string;
  error?: string;
  checkedAt: string;
};

export function isSshUrl(url: string): boolean {
  return url.startsWith("ssh://") || /^[\w.-]+@[\w.-]+:/.test(url);
}

/** https://github.com/owner/repo(.git) -> ssh://git@ssh.github.com:443/owner/repo.git */
export function sshUrlFor(url: string): string | null {
  const m = url.trim().match(/^https:\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `ssh://git@${SSH_HOST}:${SSH_PORT}/${m[1]}/${m[2]}.git` : null;
}

function paths(keyDir: string) {
  return {
    key: path.join(keyDir, "github_deploy_ed25519"),
    knownHosts: path.join(keyDir, "github_known_hosts"),
  };
}

export function sshCommand(keyDir: string): string {
  const p = paths(keyDir);
  return (
    `ssh -i ${p.key} -o IdentitiesOnly=yes -o BatchMode=yes` +
    ` -o UserKnownHostsFile=${p.knownHosts} -o StrictHostKeyChecking=yes -o ConnectTimeout=15`
  );
}

/** Schluessel + known_hosts anlegen (falls noetig); liefert den oeffentlichen Schluessel. */
export async function ensureKey(keyDir: string, onCreate?: (pub: string) => void): Promise<string | null> {
  const p = paths(keyDir);
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  writeFileSync(p.knownHosts, `github.com ${GITHUB_ED25519}\n[${SSH_HOST}]:${SSH_PORT} ${GITHUB_ED25519}\n`);
  let created = false;
  if (!existsSync(p.key)) {
    await execFileAsync(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", `emp-access ${os.hostname()}`, "-f", p.key],
      { timeout: 30_000 }
    );
    chmodSync(p.key, 0o600);
    created = true;
  }
  const pub = existsSync(`${p.key}.pub`) ? readFileSync(`${p.key}.pub`, "utf8").trim() : "";
  if (created && pub) onCreate?.(pub);
  return pub || null;
}

type Git = (args: string[], env?: NodeJS.ProcessEnv) => Promise<string>;

function gitIn(repoDir: string): Git {
  return async (args, env) => {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoDir,
      timeout: 40_000,
      env: env ?? process.env,
    });
    return stdout.trim();
  };
}

export async function ensureRepoAccess(
  repoDir: string,
  opts: { keyDir?: string; log?: (msg: string) => void; git?: Git } = {}
): Promise<RepoAccessStatus> {
  const keyDir = opts.keyDir ?? DEFAULT_KEY_DIR;
  const git = opts.git ?? gitIn(repoDir);
  const status: RepoAccessStatus = { mode: "https", checkedAt: new Date().toISOString() };
  try {
    const pub = await ensureKey(keyDir, (k) =>
      opts.log?.(`Deploy-Key fuer GitHub erzeugt (in den Cloud-Einstellungen sichtbar): ${k}`)
    );
    if (pub) status.publicKey = pub;
    const url = await git(["remote", "get-url", "origin"]);
    const cmd = sshCommand(keyDir);
    if (isSshUrl(url)) {
      await git(["config", "core.sshCommand", cmd]);
      status.mode = "ssh";
      return status;
    }
    const target = sshUrlFor(url);
    if (!target) {
      status.error = "Remote ist kein GitHub-Repository";
      return status;
    }
    try {
      await git(["ls-remote", target, "HEAD"], { ...process.env, GIT_SSH_COMMAND: cmd });
    } catch (e) {
      // Normalfall, bis der Schluessel bei GitHub eingetragen ist.
      const stderr = (e as { stderr?: string }).stderr?.trim().split("\n").pop();
      status.error = (stderr || (e instanceof Error ? e.message : String(e))).slice(0, 200);
      return status;
    }
    await git(["config", "core.sshCommand", cmd]);
    await git(["remote", "set-url", "origin", target]);
    status.mode = "ssh";
    opts.log?.(`Repo-Zugang auf SSH (Deploy-Key) umgestellt: ${target}`);
  } catch (e) {
    status.error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }
  return status;
}
