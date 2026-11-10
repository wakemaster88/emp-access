import type { Config, Settings } from "./types";

/**
 * Secrets maskieren, bevor Config an einen Browser geht — und beim
 * Speichern wieder einsetzen.
 *
 * Konvention (wie schon bei Cam-/Doorbird-Passwort): ein gesetztes Secret
 * wird als `"***"` ausgeliefert, ein leeres bleibt `""`. Kommt `"***"` beim
 * Speichern zurück, heißt das „unverändert" und der gespeicherte Wert
 * bleibt stehen — der Platzhalter darf nie ein echtes Secret überschreiben.
 *
 * Reine Funktionen ohne FS/HTTP, damit sie testbar sind.
 */

export const SECRET_MASK = "***";

// Hinweis: `ConfigSchema.parse({})` liefert für fehlende Blöcke `settings: {}`
// bzw. `doorbird: {}` (Zod parst `.default()`-Werte nicht erneut). Die
// Funktionen hier dürfen an so einer Minimal-Config nicht scheitern, sonst
// fällt das Dashboard ohne config.json um — daher `?.` trotz der Typen.

function mask(value: string | undefined): string {
  return value ? SECRET_MASK : "";
}

function restore(incoming: string | undefined, current: string | undefined): string {
  return (incoming === SECRET_MASK ? current : incoming) ?? "";
}

export function maskSettingsSecrets(settings: Settings): Settings {
  const safe: Settings = { ...settings, adminPin: mask(settings.adminPin) };
  if (settings.telegram) {
    safe.telegram = {
      ...settings.telegram,
      botToken: mask(settings.telegram.botToken),
      webhookSecret: mask(settings.telegram.webhookSecret),
    };
  }
  if (settings.empAccess) {
    safe.empAccess = {
      ...settings.empAccess,
      apiToken: mask(settings.empAccess.apiToken),
      webhookSecret: mask(settings.empAccess.webhookSecret),
    };
  }
  return safe;
}

/** Gegenstück zu `maskSettingsSecrets`: `"***"` → gespeicherter Wert. */
export function restoreSettingsSecrets(incoming: Settings, current: Settings): Settings {
  const next: Settings = {
    ...incoming,
    adminPin: restore(incoming.adminPin, current.adminPin),
  };
  if (incoming.telegram) {
    next.telegram = {
      ...incoming.telegram,
      botToken: restore(incoming.telegram.botToken, current.telegram?.botToken),
      webhookSecret: restore(
        incoming.telegram.webhookSecret,
        current.telegram?.webhookSecret,
      ),
    };
  }
  if (incoming.empAccess) {
    next.empAccess = {
      ...incoming.empAccess,
      apiToken: restore(incoming.empAccess.apiToken, current.empAccess?.apiToken),
      webhookSecret: restore(
        incoming.empAccess.webhookSecret,
        current.empAccess?.webhookSecret,
      ),
    };
  }
  return next;
}

/** Komplette Config ohne Secrets — für Dashboard-Browser (`/api/config`, `/`). */
export function maskConfigSecrets(config: Config): Config {
  return {
    ...config,
    cams: config.cams.map((c) => ({ ...c, password: mask(c.password) })),
    doorbird: {
      ...config.doorbird,
      password: mask(config.doorbird.password),
      webhookSecret: mask(config.doorbird.webhookSecret),
    },
    settings: maskSettingsSecrets(config.settings),
    // Rein intern (Next ↔ Sidecar) — nicht einmal als Platzhalter ausliefern.
    internalToken: "",
  };
}

/**
 * Gegenstück zu `maskConfigSecrets` für `PUT /api/config`: maskierte Werte
 * aus der gespeicherten Config zurückholen. Das interne Token ist über die
 * API nie änderbar und kommt immer aus der gespeicherten Config.
 */
export function restoreConfigSecrets(incoming: Config, current: Config): Config {
  return {
    ...incoming,
    cams: incoming.cams.map((c) => {
      if (c.password !== SECRET_MASK) return c;
      const prev = current.cams.find((p) => p.id === c.id);
      return prev ? { ...c, password: prev.password } : c;
    }),
    doorbird: {
      ...incoming.doorbird,
      password: restore(incoming.doorbird.password, current.doorbird.password),
      webhookSecret: restore(
        incoming.doorbird.webhookSecret,
        current.doorbird.webhookSecret,
      ),
    },
    settings: restoreSettingsSecrets(incoming.settings, current.settings),
    internalToken: current.internalToken,
  };
}
