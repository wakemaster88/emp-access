import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureRepoAccess, gitErrorLine, isSshUrl, sshUrlFor } from "./repo-access";

test("HTTPS-URL wird zur SSH-URL ueber Port 443", () => {
  for (const url of [
    "https://github.com/wakemaster88/emp-access.git",
    "https://github.com/wakemaster88/emp-access",
  ]) {
    assert.equal(sshUrlFor(url), "ssh://git@ssh.github.com:443/wakemaster88/emp-access.git");
  }
  assert.equal(sshUrlFor("https://gitlab.com/a/b.git"), null);
  assert.ok(isSshUrl("ssh://git@ssh.github.com:443/a/b.git"));
  assert.ok(isSshUrl("git@github.com:a/b.git"));
  assert.ok(!isSshUrl("https://github.com/a/b.git"));
});

const hasTools = (() => {
  try {
    execFileSync("ssh-keygen", ["-?"], { stdio: "ignore" });
  } catch (e) {
    // ssh-keygen -? endet mit Exit-Code != 0, ENOENT heisst: fehlt.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
  }
  return true;
})();

test("Schluessel entsteht, Umstellung auf SSH erst wenn GitHub ihn annimmt", { skip: !hasTools }, async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "repo-access-"));
  try {
    const repo = path.join(tmp, "repo");
    const keyDir = path.join(tmp, "keys");
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/o/r.git"]);
    let accepted = false;
    const git = async (args: string[]) => {
      if (args[0] === "ls-remote") {
        if (!accepted) throw Object.assign(new Error("fail"), { stderr: "Permission denied (publickey)." });
        return "";
      }
      return execFileSync("git", ["-C", repo, ...args]).toString().trim();
    };
    const logs: string[] = [];

    const first = await ensureRepoAccess(repo, { keyDir, git, log: (m) => logs.push(m) });
    assert.equal(first.mode, "https");
    assert.match(first.publicKey ?? "", /^ssh-ed25519 /);
    assert.match(first.error ?? "", /publickey/);
    assert.equal(statSync(path.join(keyDir, "github_deploy_ed25519")).mode & 0o777, 0o600);
    assert.equal(await git(["remote", "get-url", "origin"]), "https://github.com/o/r.git");

    accepted = true;
    const second = await ensureRepoAccess(repo, { keyDir, git, log: (m) => logs.push(m) });
    assert.equal(second.mode, "ssh");
    assert.equal(second.publicKey, first.publicKey);
    assert.equal(await git(["remote", "get-url", "origin"]), "ssh://git@ssh.github.com:443/o/r.git");
    assert.match(await git(["config", "core.sshCommand"]), /github_deploy_ed25519/);
    assert.ok(existsSync(path.join(keyDir, "github_known_hosts")));
    assert.match(readFileSync(path.join(keyDir, "github_known_hosts"), "utf8"), /\[ssh\.github\.com\]:443 ssh-ed25519/);
    assert.equal(logs.length, 2); // einmal erzeugt, einmal umgestellt
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Fehlermeldung von git: die Ursache, nicht der Schluss des Hinweistexts", () => {
  const stderr = [
    "git@ssh.github.com: Permission denied (publickey).",
    "fatal: Could not read from remote repository.",
    "",
    "Please make sure you have the correct access rights",
    "and the repository exists.",
  ].join("\n");
  assert.equal(gitErrorLine(stderr), "git@ssh.github.com: Permission denied (publickey).");
  assert.equal(gitErrorLine("fatal: unable to access\nmehr Text"), "fatal: unable to access");
  assert.equal(gitErrorLine("irgendwas\nanderes"), "irgendwas");
  assert.equal(gitErrorLine("  \n"), null);
  assert.equal(gitErrorLine(undefined), null);
  // Der Nachsatz von git ueber SSH ist nie die Ursache.
  const tail = "fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.";
  assert.equal(
    gitErrorLine(`ssh: connect to host ssh.github.com port 443: Network is unreachable\n${tail}`),
    "ssh: connect to host ssh.github.com port 443: Network is unreachable"
  );
  assert.equal(
    gitErrorLine(`ssh: connect to host ssh.github.com port 443: No route to host\n${tail}`),
    "ssh: connect to host ssh.github.com port 443: No route to host"
  );
  assert.equal(gitErrorLine(`kex_exchange_identification: unbekannter Fehler\n${tail}`), "kex_exchange_identification: unbekannter Fehler");
  assert.equal(
    gitErrorLine(
      `@@@@@@@@@@@\n@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\n@@@@@@@@@@@\nIt is also possible that a host key has just been changed.\nHost key verification failed.\n${tail}`
    ),
    "Host key verification failed."
  );
  // Zeilenenden mit CR aendern nichts.
  assert.equal(
    gitErrorLine(`git@ssh.github.com: Permission denied (publickey).\n${tail}`.replace(/\n/g, "\r\n")),
    "git@ssh.github.com: Permission denied (publickey)."
  );
});

test("Fehlermeldung von git: steht nur der Nachsatz da, zaehlt seine erste Zeile", () => {
  // So schreibt git ihn, wenn ssh ohne eigene Meldung endet: immer alle drei Zeilen.
  const tail = [
    "fatal: Could not read from remote repository.",
    "",
    "Please make sure you have the correct access rights",
    "and the repository exists.",
  ].join("\n");
  assert.equal(gitErrorLine(tail), "fatal: Could not read from remote repository.");
  assert.equal(gitErrorLine(tail.replace(/\n/g, "\r\n")), "fatal: Could not read from remote repository.");
  // Auch hinter einem Warnblock ohne weiteren Text.
  assert.equal(
    gitErrorLine(`@@@@@@@@@@@\n@ WARNING: UNPROTECTED PRIVATE KEY FILE! @\n@@@@@@@@@@@\n${tail}`),
    "fatal: Could not read from remote repository."
  );
  // Ohne den Nachsatz bleibt es bei der ersten Zeile.
  assert.equal(gitErrorLine("@@@@@@@@@@@\n@ WARNING: UNPROTECTED PRIVATE KEY FILE! @\n@@@@@@@@@@@"), "@@@@@@@@@@@");
});
