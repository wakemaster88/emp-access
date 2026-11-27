/**
 * Regeln fuer das KI-Protokoll der Zentrale (ohne Ein-/Ausgabe, testbar).
 *
 * Telegram-Texte bekommen ihre Art aus dem ersten Zeichen bzw. Wort – so
 * muessen Waechter, Energie, Belegung usw. nichts Eigenes melden.
 */

export type ActivityKind =
  /** Waechter hat ein Bild angesehen, nichts Auffaelliges. */
  | "watch"
  /** Erkennung: Person, Fahrzeug, Mitarbeiter, Kennzeichen. */
  | "detect"
  | "alert"
  | "warn"
  /** Wieder in Ordnung. */
  | "ok"
  /** Vorschlag oder Rueckfrage mit Knopf. */
  | "suggest"
  /** Ausgefuehrte Aktion. */
  | "action"
  /** Werkzeug, das sich das Modell gerade ansieht. */
  | "tool"
  /** Nachricht von Aaron an den Bot. */
  | "user"
  /** Bericht, Tagesvorschau, Antwort. */
  | "message"
  | "error";

export interface ActivityEntry {
  id: number;
  at: string;
  kind: ActivityKind;
  text: string;
  /** Kamera bzw. Quelle, wenn bekannt. */
  where?: string;
  /** Telegram-Nachricht (gesendet oder empfangen). */
  telegram?: boolean;
  /** Bild-ID fuer /api/agent/activity/img/<id>. */
  img?: number;
  /** Kamera, von der das Bild stammt (Name), wenn `where` sie nicht nennt (Telegram-Bilder). */
  camera?: string;
  /** Nur in der Antwort an die Zentrale: Bild erst auf Tippen zeigen. */
  imgTap?: boolean;
}

/** Einstellung „Livebild und Vorschau“ der Kamera eines Eintrags (live-mode-rules.ts). */
export type ImageCameraMode = "auto" | "click" | "off";

/**
 * Wie zeigt die Zentrale das Bild eines Eintrags? Nach der Einstellung
 * „Livebild und Vorschau“ seiner Kamera: "show" wie bisher, "tap" erst nach
 * einem Tippen auf den Eintrag („nur auf Tippen“), "hide" gar nicht („aus“).
 * Der Text bleibt immer. Die Kamera steht in `camera` oder, ausser bei
 * Nachrichten von Personen, in `where` (Waechter, Alarme). Ohne Kamera oder
 * bei unbekanntem Namen entscheidet `modeOf("")` bzw. `modeOf(name)`: aus
 * imageModeByName heisst das „nur auf Tippen“, sobald eine Kamera nicht auf
 * automatisch steht (aeltere Eintraege ohne Kamera, umbenannte Kameras),
 * sonst wie bisher. Bilder in Nachrichten von Personen ohne Kamera bleiben.
 */
export function activityImageView(
  e: Pick<ActivityEntry, "kind" | "where" | "camera">,
  modeOf: (camera: string) => ImageCameraMode | null
): "show" | "tap" | "hide" {
  const cam = e.camera ?? (e.kind === "user" ? undefined : e.where);
  if (!cam && e.kind === "user") return "show";
  const mode = modeOf(cam ?? "");
  if (mode === "off") return "hide";
  if (mode === "click") return "tap";
  return "show";
}

/**
 * Einstellung je Kameraname fuer activityImageView. Tragen mehrere Kameras
 * denselben Namen, gilt die strengste („aus“ vor „nur auf Tippen“). Ein
 * leerer oder unbekannter Name gilt als „nur auf Tippen“, sobald irgendeine
 * Kamera nicht auf automatisch steht: Die Kamera eines solchen Eintrags ist
 * nicht sicher bekannt.
 */
export function imageModeByName(
  cameras: Array<{ name: string; mode: ImageCameraMode }>
): (camera: string) => ImageCameraMode | null {
  const rank: Record<ImageCameraMode, number> = { auto: 0, click: 1, off: 2 };
  const byName = new Map<string, ImageCameraMode>();
  for (const c of cameras) {
    const key = c.name.trim();
    const prev = byName.get(key);
    if (!prev || rank[c.mode] > rank[prev]) byName.set(key, c.mode);
  }
  const restricted = [...byName.values()].some((m) => m !== "auto");
  return (camera) => byName.get(camera.trim()) ?? (restricted ? "click" : null);
}

/** Art einer ausgehenden Telegram-Nachricht aus ihrem Anfang ableiten. */
export function classifyText(text: string, hasButtons = false): ActivityKind {
  const t = text.trim();
  if (/^‼️/.test(t)) return "alert";
  if (/^⚠️/.test(t)) return "warn";
  if (/^✅/.test(t) || /^Wieder in Ordnung/i.test(t)) return "ok";
  if (/^Erledigt\b/.test(t)) return "action";
  if (/^(Fehlgeschlagen|Da ist etwas schiefgegangen)/.test(t)) return "error";
  if (/^Soll ich\b/.test(t) || /^💡/.test(t)) return "suggest";
  if (/^(🚗|🚙|🔎|👤)/.test(t)) return "detect";
  if (hasButtons) return "suggest";
  return "message";
}

/** Kurzfassung fuer die Kachel: lange Berichte nicht ganz zeigen. */
export function clipText(text: string, max = 600): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf("\n", max);
  return `${t.slice(0, cut > max / 2 ? cut : max).trimEnd()} …`;
}

/**
 * Dieselbe Nachricht geht an mehrere gekoppelte Chats: nur einmal
 * eintragen, wenn sie innerhalb von `windowMs` schon da ist.
 */
export function isDuplicate(recent: ActivityEntry[], kind: ActivityKind, text: string, nowMs: number, windowMs = 15_000): boolean {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 20; i--) {
    const e = recent[i];
    if (nowMs - Date.parse(e.at) > windowMs) break;
    if (e.kind === kind && e.text === text) return true;
  }
  return false;
}

/** Werkzeugnamen fuer Menschen. */
const TOOL_LABEL: Record<string, string> = {
  hub_status: "Lage des Hubs",
  list_events: "letzte Ereignisse",
  look_at_camera: "Kamerabild",
  camera_snapshot: "Kamerabild",
  occupancy: "Belegung",
  weather_forecast: "Wetter",
  energy_plan: "Energieplan",
  early_warnings: "Früherkennung",
  improve_report: "Verbesserungsprotokoll",
  day_preview: "Tagesvorschau",
};

export function toolLabel(name: string, args: Record<string, unknown> = {}): string {
  const base = TOOL_LABEL[name] ?? name.replace(/_/g, " ");
  const cam = typeof args.camera === "string" || typeof args.camera === "number" ? String(args.camera) : "";
  return cam && /kamera/i.test(base) ? `${base} ${cam}` : base;
}
