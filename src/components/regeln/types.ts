/** Datenformen des Regelmoduls, so wie sie die API liefert. */

export type RuleTrigger =
  | "TIME"
  | "OPENING"
  | "CLOSING"
  | "SUNRISE"
  | "SUNSET"
  | "MOTION"
  | "DEVICE_SWITCHED"
  | "SCAN"
  | "IDLE";

export type RuleActionKind = "DEVICE" | "NOTIFY" | "AUDIO";
export type RuleOperating = "ANY" | "OPEN" | "CLOSED";
export type RuleNotifyChannel = "TELEGRAM" | "PUSH" | "BOTH";

interface Named {
  id: number;
  name: string;
}

export interface RuleAction {
  id: number;
  sortOrder: number;
  kind: RuleActionKind;
  deviceId: number | null;
  device: { id: number; name: string; type: string } | null;
  deviceAction: string | null;
  timerSeconds: number | null;
  channel: RuleNotifyChannel | null;
  message: string | null;
  audioZoneId: number | null;
  audioZone: Named | null;
  audioAnnouncementId: number | null;
  audioAnnouncement: Named | null;
  audioPlaylistId: number | null;
  audioPlaylist: Named | null;
}

export interface Rule {
  id: number;
  name: string;
  description: string | null;
  roomId: number | null;
  room: Named | null;
  isActive: boolean;
  sortOrder: number;

  trigger: RuleTrigger;
  daysOfWeek: number;
  timeOfDay: string | null;
  offsetMinutes: number;

  cameraId: number | null;
  camera: Named | null;
  eventType: string | null;

  triggerDeviceId: number | null;
  triggerDevice: Named | null;
  triggerAction: string | null;

  areaId: number | null;
  area: Named | null;
  scanDirection: string | null;

  idleMinutes: number | null;

  operating: RuleOperating;
  operatingScheduleId: number | null;
  operatingSchedule: Named | null;
  windowStart: string | null;
  windowEnd: string | null;
  onlyWhenDark: boolean;
  cooldownSeconds: number;

  lastRunAt: string | null;
  actions: RuleAction[];
}

export interface RuleRun {
  id: number;
  ruleId: number | null;
  ruleName: string;
  roomId: number | null;
  triggeredAt: string;
  triggerKind: string;
  success: boolean;
  durationMs: number | null;
  errorMessage: string | null;
}

/** Auswahllisten für den Regel-Dialog. */
export interface RuleOptions {
  rooms: Named[];
  devices: Array<{ id: number; name: string; type: string; category: string | null }>;
  cameras: Named[];
  areas: Named[];
  schedules: Named[];
  audioZones: Named[];
  announcements: Named[];
  playlists: Named[];
}

export interface RegelnData {
  rules: Rule[];
  runs: RuleRun[];
  options: RuleOptions;
  timezone: string;
  readonly: boolean;
  renderedAt: string;
}
