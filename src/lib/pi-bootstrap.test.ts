import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { piBootstrapScript } from "./pi-bootstrap";

for (const kind of ["scanner", "audio"] as const) {
  test(`Bootstrap-Skript (${kind}) ist gueltiges Bash`, () => {
    // bash -n: nur Syntax pruefen, nichts ausfuehren.
    execFileSync("bash", ["-n"], { input: piBootstrapScript(kind) });
  });
}

test("Bootstrap startet den passenden Installer", () => {
  assert.match(piBootstrapScript("scanner"), /INSTALL_DIR="\/opt\/emp-scanner"/);
  assert.match(piBootstrapScript("scanner"), /raspberry-pi\/install\.sh" < \/dev\/tty/);
  assert.match(piBootstrapScript("audio"), /INSTALL_DIR="\/opt\/emp-audio"/);
  assert.match(piBootstrapScript("audio"), /raspberry-pi\/install-audio\.sh" < \/dev\/tty/);
});

test("Bootstrap nutzt dieselben Pfade und Host-Schluessel wie der Pi-Updater", () => {
  const s = piBootstrapScript("scanner");
  assert.match(s, /KEY="\$KEY_DIR\/github_deploy_ed25519"/);
  assert.match(s, /KEY_DIR="\/etc\/emp-access"/);
  assert.match(s, /AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl/);
  assert.match(s, /ssh:\/\/git@ssh\.github\.com:443\//);
});

test("Bootstrap holt bei bestehender Installation den aktuellen Stand ueber den erreichbaren Zugang", () => {
  const s = piBootstrapScript("scanner");
  // Pi mit altem Stand (HTTPS-Remote, Repo privat): erst Remote umstellen, dann holen, dann Installer.
  const setUrl = s.indexOf('remote set-url origin "$URL"');
  const reset = s.indexOf("reset --hard origin/main");
  const installer = s.indexOf("exec bash");
  assert.ok(setUrl > 0 && reset > setUrl && installer > reset);
});
