import { describe, expect, it } from "vitest";
import {
  SECRET_MASK,
  maskConfigSecrets,
  maskSettingsSecrets,
  restoreConfigSecrets,
  restoreSettingsSecrets,
} from "@/lib/config-secrets";
import { ConfigSchema, type Config } from "@/lib/types";

const SECRETS = [
  "cam-pw",
  "door-pw",
  "door-hook",
  "4711",
  "123456:BOT-TOKEN",
  "tg-hook",
  "emp-api-token",
  "emp-hook",
  "internal-token-value",
];

function fullConfig(): Config {
  return ConfigSchema.parse({
    cams: [
      {
        id: "cam-eingang",
        name: "Eingang",
        model: "RLC-811A",
        ip: "192.168.1.51",
        username: "admin",
        password: "cam-pw",
      },
    ],
    doorbird: {
      enabled: true,
      ip: "192.168.1.30",
      username: "api",
      password: "door-pw",
      webhookSecret: "door-hook",
    },
    settings: {
      adminPin: "4711",
      telegram: { botToken: "123456:BOT-TOKEN", webhookSecret: "tg-hook" },
      empAccess: { apiToken: "emp-api-token", webhookSecret: "emp-hook" },
    },
    internalToken: "internal-token-value",
  });
}

describe("maskConfigSecrets", () => {
  it("liefert kein einziges Secret im Klartext aus", () => {
    const json = JSON.stringify(maskConfigSecrets(fullConfig()));
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it("maskiert gesetzte Secrets mit dem Platzhalter", () => {
    const safe = maskConfigSecrets(fullConfig());
    expect(safe.cams[0].password).toBe(SECRET_MASK);
    expect(safe.doorbird.password).toBe(SECRET_MASK);
    expect(safe.doorbird.webhookSecret).toBe(SECRET_MASK);
    expect(safe.settings.adminPin).toBe(SECRET_MASK);
    expect(safe.settings.telegram.botToken).toBe(SECRET_MASK);
    expect(safe.settings.telegram.webhookSecret).toBe(SECRET_MASK);
    expect(safe.settings.empAccess.apiToken).toBe(SECRET_MASK);
    expect(safe.settings.empAccess.webhookSecret).toBe(SECRET_MASK);
  });

  it("gibt das interne Token nicht einmal als Platzhalter heraus", () => {
    expect(maskConfigSecrets(fullConfig()).internalToken).toBe("");
  });

  it("lässt leere Secrets leer (UI erkennt daran „nicht gesetzt“)", () => {
    const safe = maskConfigSecrets(ConfigSchema.parse({ settings: {}, doorbird: {} }));
    expect(safe.settings.adminPin).toBe("");
    expect(safe.settings.telegram.botToken).toBe("");
    expect(safe.settings.empAccess.apiToken).toBe("");
    expect(safe.doorbird.password).toBe("");
  });

  it("kommt mit der Minimal-Config ohne config.json zurecht", () => {
    // ConfigSchema.parse({}) liefert settings/doorbird als leere Objekte.
    const empty = ConfigSchema.parse({});
    const safe = maskConfigSecrets(empty);
    expect(safe.settings.adminPin).toBe("");
    expect(safe.doorbird.password).toBe("");
    expect(() => restoreConfigSecrets(empty, empty)).not.toThrow();
    expect(() => restoreConfigSecrets(fullConfig(), empty)).not.toThrow();
    expect(restoreConfigSecrets(empty, fullConfig()).internalToken).toBe(
      "internal-token-value",
    );
  });

  it("verändert die Original-Config nicht und behält Nicht-Secrets", () => {
    const config = fullConfig();
    const safe = maskConfigSecrets(config);
    expect(config.settings.adminPin).toBe("4711");
    expect(config.cams[0].password).toBe("cam-pw");
    expect(safe.cams[0].ip).toBe("192.168.1.51");
    expect(safe.settings.go2rtcUrl).toBe(config.settings.go2rtcUrl);
    expect(safe.doorbird.ringWindowSec).toBe(config.doorbird.ringWindowSec);
  });
});

describe("restoreConfigSecrets (Speichern nach Round-Trip)", () => {
  it("maskierte Config zurückgespeichert ändert kein Secret", () => {
    const current = fullConfig();
    // Genau das, was ein Client nach GET /api/config zurückschicken würde.
    const roundTripped = ConfigSchema.parse(
      JSON.parse(JSON.stringify(maskConfigSecrets(current))),
    );
    expect(restoreConfigSecrets(roundTripped, current)).toEqual(current);
  });

  it("übernimmt neu eingegebene Secrets", () => {
    const current = fullConfig();
    const incoming = maskConfigSecrets(current);
    incoming.settings.adminPin = "9999";
    incoming.settings.telegram.botToken = "654321:NEW";
    incoming.cams[0].password = "new-cam-pw";
    incoming.doorbird.password = "new-door-pw";
    const next = restoreConfigSecrets(incoming, current);
    expect(next.settings.adminPin).toBe("9999");
    expect(next.settings.telegram.botToken).toBe("654321:NEW");
    expect(next.cams[0].password).toBe("new-cam-pw");
    expect(next.doorbird.password).toBe("new-door-pw");
    // Unberührte bleiben beim gespeicherten Wert.
    expect(next.settings.empAccess.apiToken).toBe("emp-api-token");
    expect(next.doorbird.webhookSecret).toBe("door-hook");
  });

  it("erlaubt das bewusste Leeren eines Secrets", () => {
    const current = fullConfig();
    const incoming = maskConfigSecrets(current);
    incoming.settings.adminPin = "";
    expect(restoreConfigSecrets(incoming, current).settings.adminPin).toBe("");
  });

  it("lässt das interne Token nie von außen setzen oder löschen", () => {
    const current = fullConfig();
    const incoming = maskConfigSecrets(current);
    incoming.internalToken = "vom-client";
    expect(restoreConfigSecrets(incoming, current).internalToken).toBe(
      "internal-token-value",
    );
    incoming.internalToken = "";
    expect(restoreConfigSecrets(incoming, current).internalToken).toBe(
      "internal-token-value",
    );
  });
});

describe("Settings-Round-Trip (/api/settings)", () => {
  it("maskiert und stellt beim Speichern wieder her", () => {
    const current = fullConfig().settings;
    const masked = maskSettingsSecrets(current);
    expect(JSON.stringify(masked)).not.toContain("4711");
    expect(JSON.stringify(masked)).not.toContain("BOT-TOKEN");
    expect(restoreSettingsSecrets(masked, current)).toEqual(current);
  });

  it("übernimmt geänderte Nicht-Secrets zusammen mit maskierten Secrets", () => {
    const current = fullConfig().settings;
    const incoming = { ...maskSettingsSecrets(current), sirenCooldownSec: 120 };
    const next = restoreSettingsSecrets(incoming, current);
    expect(next.sirenCooldownSec).toBe(120);
    expect(next.adminPin).toBe("4711");
    expect(next.telegram.webhookSecret).toBe("tg-hook");
    expect(next.empAccess.webhookSecret).toBe("emp-hook");
  });
});
