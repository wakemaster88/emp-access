import { z } from "zod";

export const REOLINK_MODELS = [
  "E1 Pro",
  "RLC-510A",
  "RLC-810A",
  "RLC-811A",
  "RLC-823A",
  "RLC-823A 16X",
  "RLC-823S1",
  "GO PT Ultra",
  "Duo 3",
] as const;

export const ReolinkModelSchema = z.enum(REOLINK_MODELS);
export type ReolinkModel = z.infer<typeof ReolinkModelSchema>;

export interface ReolinkCapabilities {
  ptz: boolean;
  zoom: "none" | "digital" | "optical";
  spotlight: boolean;
  siren: boolean;
  audio2way: boolean;
  battery: boolean;
  /**
   * Dual-Lens-Panorama (~32:9, doppelte Breite eines normalen 16:9-Bilds).
   * Kacheln rendern dann `object-contain` statt `object-cover` (sonst wird
   * die Hälfte des Bilds weggecroppt) und das Auto-Grid gibt doppelte Breite.
   */
  wide?: boolean;
}

export const REOLINK_CAPS: Record<ReolinkModel, ReolinkCapabilities> = {
  "E1 Pro": {
    ptz: true,
    zoom: "digital",
    spotlight: false,
    siren: false,
    audio2way: true,
    battery: false,
  },
  "RLC-510A": {
    ptz: false,
    zoom: "digital",
    spotlight: false,
    siren: false,
    audio2way: false,
    battery: false,
  },
  "RLC-810A": {
    ptz: false,
    zoom: "digital",
    spotlight: false,
    siren: false,
    audio2way: false,
    battery: false,
  },
  "RLC-811A": {
    ptz: false,
    zoom: "optical",
    spotlight: true,
    siren: false,
    audio2way: false,
    battery: false,
  },
  "RLC-823A": {
    ptz: true,
    zoom: "optical",
    spotlight: true,
    siren: true,
    audio2way: true,
    battery: false,
  },
  "RLC-823A 16X": {
    ptz: true,
    zoom: "optical",
    spotlight: true,
    siren: true,
    audio2way: true,
    battery: false,
  },
  "RLC-823S1": {
    ptz: true,
    zoom: "optical",
    spotlight: true,
    siren: true,
    audio2way: true,
    battery: false,
  },
  "GO PT Ultra": {
    ptz: true,
    zoom: "digital",
    spotlight: true,
    siren: true,
    audio2way: true,
    battery: true,
  },
  // Duo 3 (PoE/WiFi): zwei 16:9-Sensoren, gestitchtes 180°-Panorama (~32:9).
  // KEIN motorisierter Zoom (Fixfokus, Zpos=-1) — die Kamera nimmt
  // Zoom-Befehle zwar an, ignoriert sie aber. Der „Zoom" der Reolink-App
  // ist digital; im Dashboard übernimmt das der Digital-Zoom im Fokus-Modus.
  "Duo 3": {
    ptz: false,
    zoom: "digital",
    spotlight: true,
    siren: true,
    audio2way: true,
    battery: false,
    wide: true,
  },
};

const LayoutPosSchema = z.object({
  x: z.number().int().min(0).default(0),
  y: z.number().int().min(0).default(0),
  w: z.number().int().min(1).default(3),
  h: z.number().int().min(1).default(3),
});

const BaseWidget = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  enabled: z.boolean().default(true),
  layout: LayoutPosSchema.optional(),
  reloadMin: z.number().int().min(0).max(1440).optional(),
  showTitleBar: z.boolean().default(true),
});

/**
 * Fest fixierter Bildausschnitt (Digital-Zoom) für eine Kachel.
 * `fx`/`fy` sind der Pan-Offset als Bruchteil der Kachelgröße (−1..1),
 * `scale` die Zoomstufe. Wird im Fokus-Modus eingestellt und gepinnt.
 */
export const WidgetViewSchema = z.object({
  scale: z.number().min(1).max(8),
  fx: z.number().min(-1).max(1).default(0),
  fy: z.number().min(-1).max(1).default(0),
});

export type WidgetView = z.infer<typeof WidgetViewSchema>;

export const ReolinkWidgetSchema = BaseWidget.extend({
  type: z.literal("reolink"),
  camId: z.string().min(1),
  /** Fixierter Ausschnitt in der Übersicht (und Start-Ausschnitt im Fokus). */
  view: WidgetViewSchema.optional(),
});

export const IframeWidgetSchema = BaseWidget.extend({
  type: z.literal("iframe"),
  url: z.url(),
  zoom: z.number().min(0.25).max(3).default(1),
  sandbox: z.string().default("allow-scripts allow-same-origin allow-forms"),
  /**
   * Server-seitiger Proxy: Lädt die URL über `/api/embed/<id>/...` und
   * strippt X-Frame-Options/CSP. Nötig für Seiten, die kein Embedding
   * erlauben.
   */
  proxy: z.boolean().default(false),
});

export const ImageRefreshWidgetSchema = BaseWidget.extend({
  type: z.literal("image-refresh"),
  url: z.url(),
  intervalMs: z.number().int().min(500).default(2000),
});

export const ClockWidgetSchema = BaseWidget.extend({
  type: z.literal("clock"),
  format: z.enum(["24h", "12h"]).default("24h"),
  showSeconds: z.boolean().default(false),
  showDate: z.boolean().default(true),
});

export const DoorbirdWidgetSchema = BaseWidget.extend({
  type: z.literal("doorbird"),
  /** Snapshot-Intervall im Grid (Live-Stream im Focus). */
  snapshotIntervalMs: z.number().int().min(500).max(60000).default(3000),
});

export const ScansWidgetSchema = BaseWidget.extend({
  type: z.literal("scans"),
  /** Wie viele Scans die Kachel maximal listet. */
  limit: z.number().int().min(3).max(50).default(12),
  /** Nur diese emp-access-Geräte-IDs zeigen. Leer = alle Geräte. */
  deviceIds: z.array(z.number().int().positive()).default([]),
  intervalMs: z.number().int().min(1000).max(60000).default(3000),
  /** Nur abgelehnte/geschützte Scans zeigen — für eine Störungs-Kachel. */
  deniedOnly: z.boolean().default(false),
});

/** Zählerstand und Alarme der Drehkreuz-Kontrolle, siehe `lib/tailgate.ts`. */
export const TailgateWidgetSchema = BaseWidget.extend({
  type: z.literal("tailgate"),
  /** Auf diese Kamera schauen. Leer = erste Kamera mit aktiver Kontrolle. */
  camId: z.string().default(""),
  intervalMs: z.number().int().min(2000).max(60000).default(10000),
});

/** Live-Status der lokalen Dienste (Hub, Tracker, go2rtc, Cloud, …). */
export const ServicesWidgetSchema = BaseWidget.extend({
  type: z.literal("services"),
  intervalMs: z.number().int().min(2000).max(60000).default(5000),
});

export const WidgetSchema = z.discriminatedUnion("type", [
  ReolinkWidgetSchema,
  IframeWidgetSchema,
  ImageRefreshWidgetSchema,
  ClockWidgetSchema,
  DoorbirdWidgetSchema,
  ScansWidgetSchema,
  TailgateWidgetSchema,
  ServicesWidgetSchema,
]);

export type Widget = z.infer<typeof WidgetSchema>;
export type ReolinkWidget = z.infer<typeof ReolinkWidgetSchema>;
export type IframeWidget = z.infer<typeof IframeWidgetSchema>;
export type ImageRefreshWidget = z.infer<typeof ImageRefreshWidgetSchema>;
export type ClockWidget = z.infer<typeof ClockWidgetSchema>;
export type DoorbirdWidget = z.infer<typeof DoorbirdWidgetSchema>;
export type ScansWidget = z.infer<typeof ScansWidgetSchema>;
export type TailgateWidget = z.infer<typeof TailgateWidgetSchema>;
export type ServicesWidget = z.infer<typeof ServicesWidgetSchema>;

/**
 * Normalisierte 2D-Koordinate, 0..1, Origin oben-links.
 * Wir speichern Linien-Punkte normiert, damit die Linie auch nach
 * Auflösungsänderungen (Substream-Profil-Wechsel) sinnvoll bleibt.
 */
const NormPointSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const PeopleCounterSchema = z.object({
  enabled: z.boolean().default(false),
  intervalSec: z.number().int().min(15).max(3600).default(60),
  /**
   * "presence" – Snapshot an den YOLO-Tracker, zählt sichtbare Personen.
   * "crossing" – YOLO + ByteTrack im Python-Sidecar; Personen die eine
   * Linie überqueren werden je nach Richtung als „rein" oder „raus" gezählt.
   * "zone" – YOLO + ByteTrack; Personen deren Fußpunkt in einem Polygon
   * liegt, zählen als aktuell anwesend (z. B. Aquapark-Belegung).
   */
  mode: z.enum(["presence", "crossing", "zone"]).default("presence"),
  /** Linie für `mode: "crossing"`, zwei Punkte in normierten Koordinaten. */
  line: z.tuple([NormPointSchema, NormPointSchema]).nullable().default(null),
  /**
   * Fläche für `mode: "zone"`, mindestens drei Punkte, normiert 0..1.
   * Nur Personen innerhalb der Fläche zählen.
   */
  zone: z
    .union([z.array(NormPointSchema).min(3).max(24), z.null()])
    .default(null),
  /**
   * Pfeilrichtung: definiert welche Seite der Linie als „rein" zählt.
   * "ab" = Bewegung von Punkt A nach B = +1 (rein), B→A = −1 (raus).
   * "ba" = umgekehrt.
   */
  direction: z.enum(["ab", "ba"]).default("ab"),
});

export type PeopleCounterConfig = z.infer<typeof PeopleCounterSchema>;

/**
 * Drehkreuz-Kontrolle: gleicht gezählte Durchgänge gegen gültige Scans in
 * emp-access ab und schlägt an, wenn mehr Leute durchgehen als berechtigt.
 *
 * Setzt `peopleCounter.mode == "crossing"` voraus — ohne Zähllinie gibt es
 * nichts abzugleichen.
 *
 * Verglichen wird bewusst über ein gleitendes Fenster statt Person für
 * Person: eine Kamerazählung liegt in der Praxis ein paar Prozent daneben,
 * und zwischen Scan und Durchgang vergehen je nach Andrang mal zwei, mal
 * zwanzig Sekunden. Erst eine anhaltende Differenz ist ein echtes Signal.
 */
export const TailgateSchema = z.object({
  enabled: z.boolean().default(false),
  /** Geräte, deren gültige Scans einen Durchgang an dieser Kamera decken. */
  deviceIds: z.array(z.number().int().positive()).default([]),
  /** Welche Zählrichtung geprüft wird — an einem Eingang üblicherweise „rein". */
  countDirection: z.enum(["in", "out"]).default("in"),
  /** Länge des gleitenden Vergleichsfensters in Sekunden. */
  windowSec: z.number().int().min(60).max(3600).default(600),
  /** Alarm erst ab so vielen ungedeckten Durchgängen im Fenster. */
  tolerance: z.number().int().min(1).max(50).default(3),
  /** Sperrfrist nach einem Alarm, damit eine Störung nicht dauerfeuert. */
  cooldownSec: z.number().int().min(60).max(7200).default(900),
  /**
   * Weitere Kameras, von denen bei jedem Durchgang ein Bild mitgezogen wird.
   *
   * Die Zählkamera steht meist so, dass man die Linie gut sieht — aber nicht
   * unbedingt das Gesicht. Ein zweiter Blickwinkel aus derselben Sekunde
   * macht aus dem Zählwert einen brauchbaren Beleg.
   */
  contextCamIds: z.array(z.string()).default([]),
  /**
   * Sofortmeldung bei einem einzelnen Durchgang ohne passenden Scan.
   *
   * Der Fenster-Alarm oben schlägt erst bei anhaltender Differenz an — gut
   * gegen Fehlalarme, aber zu träge, um jemanden noch anzusprechen. Diese
   * Meldung kommt nach wenigen Sekunden und ist dafür naturgemäß
   * fehleranfälliger; wenn es am Abend zu oft piept, hier abschalten.
   */
  instantAlert: z.boolean().default(true),
  /** Zusätzlich ein Popup auf dem Kassen-Monitor in emp-access. */
  notifyShopMonitor: z.boolean().default(true),
});

export type TailgateConfig = z.infer<typeof TailgateSchema>;

/**
 * Ausfahrt-Assist: YOLO erkennt Fahrzeuge in einer Fläche (z. B. direkt vor
 * dem Schiebetor). Beim Übergang 0 → ≥1 öffnet die DoorBird und/oder ein
 * emp-access-Gerät. Parkende Autos außerhalb der Fläche zählen nicht.
 */
export const VehicleGateSchema = z.object({
  enabled: z.boolean().default(false),
  /** Fläche vor dem Tor, mindestens drei Punkte, normiert 0..1. */
  zone: z
    .union([z.array(NormPointSchema).min(3).max(24), z.null()])
    .default(null),
  /** Physisches Tor über die DoorBird (gleicher Relais wie Einfahrt-ALPR). */
  openDoorbird: z.boolean().default(true),
  /** Zusätzliche emp-access-Geräte (Shelly/Rolltor), optional. */
  deviceIds: z.array(z.number().int().positive()).default([]),
  /** Mindestabstand zwischen zwei Öffnungen, während das Auto in der Fläche steht. */
  cooldownSec: z.number().int().min(10).max(600).default(45),
});

export type VehicleGateConfig = z.infer<typeof VehicleGateSchema>;

/**
 * PTZ-Auto-Pilot pro Cam. Drei Modi (plus Off):
 *
 *   - "patrol"        Reine Preset-Tour: Cam fährt im Kreis durch Presets.
 *   - "follow"        Bewegt sich, um das größte Target im Bild zentriert zu halten.
 *                     Wenn kein Target mehr da ist und `homePresetId` gesetzt, fährt sie
 *                     nach `returnHomeAfterSec` zurück.
 *   - "patrol+follow" Patrol läuft, sobald Target erkannt wird übernimmt Follow,
 *                     nach Target-Verlust + Hysterese wird Patrol fortgesetzt.
 *
 * Wichtig: Reolink-Consumer-Cams haben keine absolute Position-API — der Sidecar
 * bewegt mit kurzen Pulses (Left/Stop, Right/Stop, …). Die `deadbandPct` ist die
 * Toleranz vom Frame-Mittelpunkt, ab der überhaupt nachgesteuert wird, sonst
 * oszilliert die Cam wegen Stream-Latenz.
 */
const PtzScheduleSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM").optional(),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM").optional(),
});

export const PtzPatrolSchema = z.object({
  /** Reolink-Preset-IDs in der Reihenfolge der Tour. */
  presetIds: z.array(z.number().int().min(0).max(63)).default([]),
  /** Standzeit pro Preset in Sekunden. */
  dwellSec: z.number().int().min(2).max(3600).default(20),
  /** Optional zeitlich begrenzen (z.B. nur tagsüber, nur Werktag). */
  schedule: PtzScheduleSchema.optional(),
});

export const PtzFollowSchema = z.object({
  /** Welche Klassen die Cam anvisiert. "any" = Person + Auto + Tier. */
  targetClass: z.enum(["person", "car", "any"]).default("person"),
  /**
   * Steuerungs-Strategie:
   *   "continuous"  Reolink-Move startet, Speed ist proportional zum Offset,
   *                 Stop nur wenn Target im inneren Deadband ist. Glatt.
   *   "pulse"       Klassisches Stoß-Stop-Verfahren. Robust, aber ruckelig.
   */
  controlMode: z.enum(["continuous", "pulse"]).default("continuous"),
  /**
   * Inneres Deadband (% Halb-Achse). Sobald das Target hier landet → Stop.
   * Sobald es ↗︎ outerDeadbandPct verlässt, wird wieder gefolgt → Hysterese
   * gegen "Pumpen" am Rand.
   */
  deadbandPct: z.number().min(0.01).max(0.4).default(0.06),
  outerDeadbandPct: z.number().min(0.02).max(0.5).default(0.10),
  /** Pulse-Länge (nur "pulse"-Mode). */
  maxPulseMs: z.number().int().min(50).max(800).default(200),
  /**
   * Geschwindigkeitsfenster (Reolink 1–64). Im continuous-Mode wird linear
   * zwischen Min und Max interpoliert je nach Offset zur Mitte.
   */
  speedMin: z.number().int().min(1).max(64).default(6),
  speedMax: z.number().int().min(1).max(64).default(40),
  /**
   * Exponentieller Glättungsfaktor für die Target-Position (0..1).
   * 0 = keine Glättung (jitter direkt in die Cam),
   * 1 = unendlich träge.
   * 0.4–0.5 ist meistens gut.
   */
  smoothingAlpha: z.number().min(0).max(1).default(0.45),
  /**
   * Latenz-Kompensation in Millisekunden: Sidecar schätzt die Target-Position
   * um diesen Wert in die Zukunft anhand der gemessenen Velocity.
   * RTSP-Latenz ist meist 250–500 ms — daher Default 300.
   */
  latencyCompMs: z.number().int().min(0).max(1000).default(300),
  /** Wenn das Target länger als das weg ist, Cam pausiert/fährt heim. */
  returnHomeAfterSec: z.number().int().min(2).max(600).default(15),
  /** Optional: Heim-Preset für Follow-Modus (falls kein Patrol). */
  homePresetId: z.number().int().min(0).max(63).nullable().default(null),
  /** Optisch zoomen, um das Target auf eine Ziel-Höhe (Anteil Frame) zu halten. */
  zoomEnabled: z.boolean().default(false),
  zoomTargetRatio: z.number().min(0.1).max(0.9).default(0.4),
});

export const PtzAutoSchema = z.object({
  mode: z.enum(["off", "patrol", "follow", "patrol+follow"]).default("off"),
  patrol: PtzPatrolSchema.default({
    presetIds: [],
    dwellSec: 20,
  }),
  follow: PtzFollowSchema.default({
    targetClass: "person",
    controlMode: "continuous",
    deadbandPct: 0.06,
    outerDeadbandPct: 0.10,
    maxPulseMs: 200,
    speedMin: 6,
    speedMax: 40,
    smoothingAlpha: 0.45,
    latencyCompMs: 300,
    returnHomeAfterSec: 15,
    homePresetId: null,
    zoomEnabled: false,
    zoomTargetRatio: 0.4,
  }),
});

export type PtzAutoConfig = z.infer<typeof PtzAutoSchema>;

export const CamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    model: ReolinkModelSchema,
    ip: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(80),
    rtspPort: z.number().int().min(1).max(65535).default(554),
    username: z.string().min(1),
    password: z.string().default(""),
    channel: z.number().int().min(0).max(31).default(0),
    streamMain: z.string().default("h264Preview_01_main"),
    streamSub: z.string().default("h264Preview_01_sub"),
    enabled: z.boolean().default(true),
    peopleCounter: PeopleCounterSchema.default({
      enabled: false,
      intervalSec: 60,
      mode: "zone",
      line: null,
      zone: null,
      direction: "ab",
    }),
    ptzAuto: PtzAutoSchema.default({
      mode: "off",
      patrol: { presetIds: [], dwellSec: 20 },
      follow: {
        targetClass: "person",
        controlMode: "continuous",
        deadbandPct: 0.06,
        outerDeadbandPct: 0.10,
        maxPulseMs: 200,
        speedMin: 6,
        speedMax: 40,
        smoothingAlpha: 0.45,
        latencyCompMs: 300,
        returnHomeAfterSec: 15,
        homePresetId: null,
        zoomEnabled: false,
        zoomTargetRatio: 0.4,
      },
    }),
    /** emp-access.de: eine oder mehrere Geräte-IDs, deren Statusänderungen bei dieser Cam erscheinen. */
    empAccess: z
      .object({
        enabled: z.boolean().default(false),
        deviceIds: z.array(z.number().int().positive()).default([]),
      })
      .default({ enabled: false, deviceIds: [] }),
    /** Abgleich Durchgänge ↔ gültige Scans, siehe `TailgateSchema`. */
    tailgate: TailgateSchema.default(TailgateSchema.parse({})),
    /**
     * Kennzeichenerkennung auf dieser Cam. Whitelist, Intervall und Cooldown
     * kommen von Doorbird → ALPR; bei Treffer kann die Doorbird-Tür aufgehen.
     */
    alpr: z
      .object({
        enabled: z.boolean().default(false),
        /** Ausführung liegt beim Hub; Kiosk-ALPR öffnet die Tür nicht mehr standardmäßig. */
        openDoorbird: z.boolean().default(false),
      })
      .default({ enabled: false, openDoorbird: false }),
    /** Fahrzeug in Fläche vor dem Tor → Tor öffnen (Ausfahrt). */
    vehicleGate: VehicleGateSchema.default(VehicleGateSchema.parse({})),
  })
  .superRefine((cam, ctx) => {
    // Crossing/Zone vertragen sich nicht mit PTZ-Auto: Linie und Fläche
    // sind in Frame-Koordinaten gespeichert.
    const crossing =
      cam.peopleCounter.enabled && cam.peopleCounter.mode === "crossing";
    const zone =
      cam.peopleCounter.enabled && cam.peopleCounter.mode === "zone";
    const ptzActive = cam.ptzAuto.mode !== "off";
    if (crossing && ptzActive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ptzAuto", "mode"],
        message:
          "PTZ-Auto und Crossing-Counter schließen sich aus. Ein Pan ändert die Linie.",
      });
    }
    if (zone && ptzActive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ptzAuto", "mode"],
        message:
          "PTZ-Auto und Zonen-Zähler schließen sich aus. Ein Pan ändert die Fläche.",
      });
    }
    if (zone && (!cam.peopleCounter.zone || cam.peopleCounter.zone.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["peopleCounter", "zone"],
        message: "Mindestens drei Punkte für die Zählfläche setzen.",
      });
    }
    if (cam.tailgate.enabled && !crossing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tailgate", "enabled"],
        message:
          "Drehkreuz-Kontrolle braucht den Crossing-Counter mit gesetzter Zähllinie.",
      });
    }
    if (cam.tailgate.enabled && cam.tailgate.deviceIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tailgate", "deviceIds"],
        message: "Mindestens ein emp-access-Gerät angeben, sonst gilt jeder Durchgang als ungedeckt.",
      });
    }
    const vehicleGate = cam.vehicleGate.enabled;
    if (vehicleGate && ptzActive) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ptzAuto", "mode"],
        message:
          "PTZ-Auto und Ausfahrt-Zone schließen sich aus. Ein Pan ändert die Fläche.",
      });
    }
    if (vehicleGate && zone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vehicleGate", "enabled"],
        message:
          "Personen-Zone und Ausfahrt-Zone brauchen denselben Stream. Nur eines aktivieren.",
      });
    }
    if (vehicleGate && (!cam.vehicleGate.zone || cam.vehicleGate.zone.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vehicleGate", "zone"],
        message: "Mindestens drei Punkte für die Fläche vor dem Tor setzen.",
      });
    }
    if (
      vehicleGate &&
      !cam.vehicleGate.openDoorbird &&
      cam.vehicleGate.deviceIds.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vehicleGate", "openDoorbird"],
        message: "DoorBird oder mindestens ein emp-access-Gerät zum Öffnen angeben.",
      });
    }
  });

export type Cam = z.infer<typeof CamSchema>;

/**
 * Eintrag in der ALPR-Whitelist. `plate` wird nur normalisiert verglichen
 * (Großbuchstaben, ohne Leerzeichen/Bindestrich), aber für die Anzeige
 * behalten wir die Schreibweise.
 *
 * Optionales Zeitfenster: wenn `weekdays`/`from`/`to` gesetzt sind, gilt
 * das Schild nur in diesem Slot. Default = immer gültig.
 */
const TimeHHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24h");

export const AlprWhitelistEntrySchema = z.object({
  plate: z.string().min(2),
  owner: z.string().default(""),
  enabled: z.boolean().default(true),
  /** 0 = Sonntag, 1 = Montag, … 6 = Samstag (JS-Konvention). Leer = jeder Tag. */
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  from: TimeHHMM.optional(),
  to: TimeHHMM.optional(),
  notes: z.string().default(""),
});

export type AlprWhitelistEntry = z.infer<typeof AlprWhitelistEntrySchema>;

export const AlprConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Polling-Intervall der Doorbird-Snapshots in Millisekunden. */
  intervalMs: z.number().int().min(500).max(10_000).default(1500),
  /** Min. OCR-Confidence (0..1) damit ein Plate überhaupt berücksichtigt wird. */
  minConfidence: z.number().min(0).max(1).default(0.85),
  /** Wie viele aufeinanderfolgende Frames denselben Plate sehen müssen. */
  confirmFrames: z.number().int().min(1).max(10).default(3),
  /** Cooldown pro Schild in Sekunden, damit nicht im Sekundentakt geöffnet wird. */
  cooldownSec: z.number().int().min(10).max(86_400).default(300),
  /**
   * Aufbewahrungsdauer der gespeicherten Snapshots in Tagen. JSONL-Events
   * bleiben (sind winzig), Bilder älter als das werden vom Sidecar
   * automatisch aufgeräumt. 0 = unbegrenzt.
   */
  retentionDays: z.number().int().min(0).max(3650).default(60),
  /** Türöffnung durch den Kiosk-Tracker. Standard aus: Ausführung liegt beim Hub. */
  openDoorbird: z.boolean().default(false),
  whitelist: z.array(AlprWhitelistEntrySchema).default([]),
});

export type AlprConfig = z.infer<typeof AlprConfigSchema>;

export const DoorbirdSchema = z.object({
  enabled: z.boolean().default(false),
  ip: z.string().default(""),
  username: z.string().default(""),
  password: z.string().default(""),
  webhookSecret: z.string().default(""),
  ringWindowSec: z.number().int().min(10).max(600).default(90),
  /**
   * Tür öffnen nur innerhalb des Ring-Fensters zulassen (serverseitig
   * erzwungen). ALPR-Auto-Open ist davon ausgenommen (eigene Whitelist +
   * Cooldown-Logik). Abschaltbar für „Tür jederzeit öffnen"-Setups.
   */
  enforceRingWindow: z.boolean().default(true),
  autoHideSec: z.number().int().min(5).max(600).default(60),
  relayId: z.string().default("1"),
  ringSoundUrl: z.string().default(""),
  /** Snapshot-JPEG bei Klingeln und Tür öffnen lokal unter logs/doorbird-events/. */
  eventSnapshots: z
    .object({
      enabled: z.boolean().default(true),
      retentionDays: z.number().int().min(0).max(3650).default(90),
    })
    .default({ enabled: true, retentionDays: 90 }),
  // Fully-formed default — Zod's `.default()` re-parsed das Objekt nicht
  // automatisch durch das Schema, daher müssen alle Felder explizit drin
  // sein, sonst landet `alpr` für Bestand-Configs als `{}` im Speicher.
  alpr: AlprConfigSchema.default({
    enabled: false,
    intervalMs: 1500,
    minConfidence: 0.85,
    confirmFrames: 3,
    cooldownSec: 300,
    retentionDays: 60,
    openDoorbird: false,
    whitelist: [],
  }),
});

export type DoorbirdConfig = z.infer<typeof DoorbirdSchema>;

/**
 * Telegram-Bot-Konfig. Nutzt einen einzigen Bot, schickt an beliebig viele
 * Chat-IDs (User, Gruppen, Channels). Pro Event-Typ gibt es einen Toggle —
 * was nicht angeklickt ist, schickt nichts.
 */
export const TelegramEventTogglesSchema = z.object({
  /** Tür wurde geöffnet (UI-Klick oder ALPR). Snapshot vom Doorbird mit. */
  doorOpen: z.boolean().default(true),
  /** Es hat geklingelt. Snapshot vom Doorbird mit. */
  doorRing: z.boolean().default(true),
  /** ALPR: Plate auf Whitelist & Tür geöffnet. (Doppelt zu doorOpen, optional). */
  alprMatched: z.boolean().default(false),
  /** ALPR: Plate erkannt, aber NICHT auf Whitelist. */
  alprUnauthorized: z.boolean().default(false),
  /** ALPR: Plate auf Whitelist, aber Cooldown verhindert Öffnen. */
  alprCooldown: z.boolean().default(false),
  /** Drehkreuz: mehr Durchgänge gezählt als gültige Scans vorliegen. */
  tailgate: z.boolean().default(true),
});

export type TelegramEventToggles = z.infer<typeof TelegramEventTogglesSchema>;

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Bot-Token von BotFather (sieht aus wie "123456:ABC-DEF1234..."). Sensitiv. */
  botToken: z.string().default(""),
  /**
   * Geheimer Token für eingehende Webhooks (`X-Telegram-Bot-Api-Secret-Token`).
   * Wird beim Klick auf „Webhook eintragen“ ggf. automatisch erzeugt.
   */
  webhookSecret: z.string().default(""),
  /**
   * Empfänger-IDs. Können numerisch sein (User/Gruppe) oder mit @ beginnen
   * für public Channels. Negative IDs sind Gruppen.
   */
  chatIds: z.array(z.string().min(1)).default([]),
  /** Pro Event ein/aus. */
  events: TelegramEventTogglesSchema.default({
    doorOpen: true,
    doorRing: true,
    alprMatched: false,
    alprUnauthorized: false,
    alprCooldown: false,
    tailgate: true,
  }),
  /** Bilder mitschicken (Doorbird-Snapshot bzw. ALPR-Snapshot). */
  includeSnapshot: z.boolean().default(true),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const SettingsSchema = z.object({
  go2rtcUrl: z.string().default("http://127.0.0.1:1984"),
  adminPin: z.string().default(""),
  autoRotate: z.object({
    enabled: z.boolean().default(false),
    intervalSec: z.number().int().min(5).max(3600).default(30),
    order: z.enum(["sequential", "random"]).default("sequential"),
  }).default({ enabled: false, intervalSec: 30, order: "sequential" }),
  /**
   * Voller Page-Reload alle N Minuten als Memory-Leak-Schutz für den
   * 24/7-Kiosk (Safari). 0 = aus. Default 6 h — bestehende Configs mit
   * explizitem Wert bleiben unberührt.
   */
  reloadIntervalMin: z.number().int().min(0).max(1440).default(360),
  /**
   * Streams (WebRTC) periodisch frisch verbinden, um Silent-Freezes nach langer
   * Laufzeit zu vermeiden. 0 = aus; sinnvoll: 30–120 min.
   * Frame-Stall-Watchdog reagiert ohnehin automatisch innerhalb von ~10 s.
   */
  streamRefreshMin: z.number().int().min(0).max(1440).default(60),
  sirenCooldownSec: z.number().int().min(10).max(600).default(60),
  sirenMaxDurationSec: z.number().int().min(1).max(60).default(30),
  /** Telegram-Benachrichtigungen für Tür-/ALPR-Events. */
  telegram: TelegramConfigSchema.default({
    enabled: false,
    botToken: "",
    webhookSecret: "",
    chatIds: [],
    events: {
      doorOpen: true,
      doorRing: true,
      alprMatched: false,
      alprUnauthorized: false,
      alprCooldown: false,
      tailgate: true,
    },
    includeSnapshot: true,
  }),
  /**
   * Python-Sidecar für gerichtetes Personenzählen (rein/raus) und ALPR.
   * Läuft als eigener Prozess (siehe `tracker/`), wird per HTTP gepollt.
   *
   * `appUrl` ist die Adresse, unter der der Sidecar selbst die Next-App
   * erreichen kann — für ALPR-getriggertes Tür-Öffnen ruft der Sidecar
   * `${appUrl}/api/doorbird/open` auf (Loopback, kein Auth nötig).
   */
  tracker: z.object({
    url: z.string().default("http://127.0.0.1:8088"),
    appUrl: z.string().default("http://127.0.0.1:3000"),
  }).default({
    url: "http://127.0.0.1:8088",
    appUrl: "http://127.0.0.1:3000",
  }),
  /**
   * emp-access.de — API-Zugang zu Zugangsbereichen/Geräten (Bearer-Token).
   * Pro Kamera können unter `cam.empAccess` Geräte-IDs gemappt werden.
   */
  empAccess: z
    .object({
      enabled: z.boolean().default(false),
      baseUrl: z.string().min(1).default("https://emp-access.de"),
      apiToken: z.string().default(""),
      /**
       * Server pollt die emp-access API höchstens so oft. Für Live-Anzeige am
       * Drehkreuz: 3–5 s. Niedrige Werte = mehr API-Last bei emp-access.
       */
      pollIntervalSec: z.number().int().min(3).max(600).default(5),
      /**
       * Secret für eingehende Push-Webhooks von emp-access (falls die
       * Plattform sie an unsere `/api/emp-access/webhook` schickt). Wird
       * automatisch generiert, sobald aktiviert.
       */
      webhookSecret: z.string().default(""),
    })
    .default({
      enabled: false,
      baseUrl: "https://emp-access.de",
      apiToken: "",
      pollIntervalSec: 5,
      webhookSecret: "",
    }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const LayoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cols: z.number().int().min(1).max(24).default(12),
  rows: z.number().int().min(1).max(24).default(8),
  focusWidgetId: z.string().nullable().default(null),
  positions: z.record(
    z.string(),
    LayoutPosSchema,
  ).default({}),
});

export type Layout = z.infer<typeof LayoutSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  cams: z.array(CamSchema).default([]),
  widgets: z.array(WidgetSchema).default([]),
  layouts: z.array(LayoutSchema).default([]),
  activeLayoutId: z.string().nullable().default(null),
  doorbird: DoorbirdSchema.default({} as DoorbirdConfig),
  settings: SettingsSchema.default({} as Settings),
});

export type Config = z.infer<typeof ConfigSchema>;
