/**
 * Gespeicherte Zugangsdaten (Schnittstellen-Token, Webhook-Geheimnisse) für
 * den Browser maskieren und beim Speichern wieder einsetzen.
 *
 * Maske: „••••“ plus die letzten 4 Zeichen, bei Werten unter 8 Zeichen nur
 * „••••“. Ein Wert, der mit „••••“ beginnt, gilt beim Speichern als
 * „unverändert“ – auch wenn ein noch offener alter Einstellungs-Tab die
 * maskierten Werte aus GET unverändert zurückschickt.
 *
 * Ohne Server-Abhängigkeiten, damit die Einstellungskarten es auch nutzen.
 */

export const SECRET_MASK = "••••";

/**
 * Geheime Angaben in `ApiConfig.extraConfig`. `webhookUrl` legt der
 * Nuki-Abgleich mit dem Secret in der Adresse ab.
 */
export const EXTRA_CONFIG_SECRET_KEYS = ["webhookSecret", "monitorUrl", "webhookUrl"] as const;

export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length < 8) return SECRET_MASK;
  return `${SECRET_MASK}${value.slice(-4)}`;
}

export function isMaskedSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SECRET_MASK);
}

/** Meldung, wenn jemand in die Maske hinein- oder davor getippt hat. */
export const MASK_EDIT_ERROR =
  "Bitte die Maske „••••“ vollständig löschen und den neuen Wert eingeben (oder die Seite neu laden).";

/**
 * Enthält der gesendete Wert die Maske, ohne genau die Maske des gespeicherten
 * Werts (oder nur „••••“) zu sein? Dann wurde in die Maske hinein, davor oder
 * dahinter getippt – das wird mit `MASK_EDIT_ERROR` abgelehnt, statt
 * stillschweigend die Maske zu speichern oder die Eingabe zu verwerfen.
 */
export function isEditedMask(posted: unknown, stored: string | null | undefined): boolean {
  if (typeof posted !== "string" || !posted.includes(SECRET_MASK)) return false;
  return posted !== SECRET_MASK && posted !== maskSecret(stored);
}

/** Gesendeten Wert übernehmen, außer er ist die Maske – dann der gespeicherte. */
export function keepStoredIfMasked(posted: string, stored: string | null | undefined): string {
  return isMaskedSecret(posted) ? stored ?? "" : posted;
}

function readJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `extraConfig` mit maskierten geheimen Angaben; anderes bleibt wie gespeichert. */
export function maskExtraConfig(raw: string | null | undefined): string | null {
  const extra = readJsonObject(raw);
  if (!extra) return raw ?? null;
  let changed = false;
  for (const key of EXTRA_CONFIG_SECRET_KEYS) {
    if (typeof extra[key] === "string" && extra[key]) {
      extra[key] = maskSecret(extra[key] as string);
      changed = true;
    }
  }
  return changed ? JSON.stringify(extra) : raw ?? null;
}

/**
 * Maskierte geheime Angaben im gesendeten `extraConfig` durch die
 * gespeicherten ersetzen. Fehlende Angaben ergänzt `prepareExtraConfig` in
 * der Route wie bisher; unlesbares JSON bleibt, wie es ist.
 */
export function restoreMaskedExtraConfig(
  posted: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  const extra = readJsonObject(posted);
  if (!extra) return posted ?? null;
  const saved = readJsonObject(stored) ?? {};
  let changed = false;
  for (const key of EXTRA_CONFIG_SECRET_KEYS) {
    if (isMaskedSecret(extra[key])) {
      if (saved[key] !== undefined) extra[key] = saved[key];
      else delete extra[key];
      changed = true;
    }
  }
  return changed ? JSON.stringify(extra) : posted ?? null;
}

/** Wie `isEditedMask`, für die geheimen Angaben im gesendeten `extraConfig`. */
export function hasEditedMaskInExtraConfig(
  posted: string | null | undefined,
  stored: string | null | undefined,
): boolean {
  const extra = readJsonObject(posted);
  if (!extra) return false;
  const saved = readJsonObject(stored) ?? {};
  return EXTRA_CONFIG_SECRET_KEYS.some((key) =>
    isEditedMask(extra[key], typeof saved[key] === "string" ? (saved[key] as string) : null),
  );
}

/** Anbieter, bei denen `extraConfig` selbst ein Geheimnis ist (GARDENA: Application Secret). */
const EXTRA_CONFIG_IS_SECRET = new Set(["GARDENA"]);

/** Datensatz für den Browser: Token und Geheimnisse maskiert, dazu je ein „gespeichert“-Kennzeichen. */
export function maskApiConfig<T extends { token: string; extraConfig: string | null; provider?: string }>(
  config: T,
): T & { tokenStored: boolean; secretsStored: Record<string, boolean> } {
  if (config.provider && EXTRA_CONFIG_IS_SECRET.has(config.provider)) {
    return {
      ...config,
      token: maskSecret(config.token),
      extraConfig: config.extraConfig ? maskSecret(config.extraConfig) : config.extraConfig,
      tokenStored: !!config.token,
      secretsStored: { extraConfig: !!config.extraConfig },
    };
  }
  const extra = readJsonObject(config.extraConfig) ?? {};
  const secretsStored: Record<string, boolean> = {};
  for (const key of EXTRA_CONFIG_SECRET_KEYS) {
    secretsStored[key] = typeof extra[key] === "string" && !!extra[key];
  }
  return {
    ...config,
    token: maskSecret(config.token),
    extraConfig: maskExtraConfig(config.extraConfig),
    tokenStored: !!config.token,
    secretsStored,
  };
}

/**
 * Eingabe in ein Feld, das gerade die Maske zeigt: Wer hinter der Maske
 * weitertippt, meint einen neuen Wert – die Maske fällt dann weg.
 */
export function typedOverMask(previous: string, next: string): string {
  if (isMaskedSecret(previous) && next.startsWith(previous)) return next.slice(previous.length);
  return next;
}
