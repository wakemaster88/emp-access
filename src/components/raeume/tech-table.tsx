"use client";

/**
 * Reiter "Technik" eines Raums: eine Tabelle statt Kacheln. Je Zeile Gerät,
 * Anbindung (Hub im LAN, Shelly Cloud, Hue Bridge, Netzwerkgerät mit Adresse)
 * und letzte Antwort. Störungen stehen oben und sind rot. Der einzige Ort der
 * Raumkarte mit IP-Adressen. Mockup W13 im Räume-Konzept.
 */

import { Cpu, Network, TriangleAlert, type LucideIcon } from "lucide-react";
import type { DeviceStatus } from "@/components/raeume/status";
import type { NetworkItem, RoomDevice } from "@/components/raeume/types";
import { deviceTypeLabel, fmtAgo } from "@/components/raeume/shared";
import { networkTypeLabel } from "@/components/raeume/network-widget";
import { cn } from "@/lib/utils";

/** Netzwerkgeraet gilt als online, wenn der Hub-Scan es in dieser Zeit gesehen hat. */
const NETWORK_ONLINE_MS = 30 * 60_000;

type Reach = "online" | "offline" | "unknown";

interface Row {
  key: string;
  name: string;
  /** "Shelly · Hub im LAN", "Access Point · 192.168.1.5" */
  link: string;
  reach: Reach;
  answer: string;
  readings: string | null;
  Icon: LucideIcon;
}

function deviceRow(d: RoomDevice, status: DeviceStatus | undefined, nowMs: number): Row {
  const kind = deviceTypeLabel(d.type);
  let via: string;
  if (d.type === "HUE_LIGHT") via = "Hue Bridge";
  else if (d.type === "MAMMOTION_MOWER") via = "Mammotion Cloud";
  else if (d.type === "GARDENA_VALVE") via = "GARDENA Cloud";
  else if (status?.source === "local") via = "Hub im LAN";
  else if (status?.source === "cloud") via = "Shelly Cloud";
  else if (d.hasLocalAddress) via = "Hub im LAN";
  else via = "Cloud";
  const reach: Reach = status ? (status.online ? "online" : "offline") : "unknown";
  const answer = status
    ? status.online
      ? "antwortet"
      : d.lastUpdate
        ? `zuletzt ${fmtAgo(d.lastUpdate, nowMs)}`
        : "keine Antwort"
    : d.lastUpdate
      ? `zuletzt ${fmtAgo(d.lastUpdate, nowMs)}`
      : "–";
  const readings = status?.readings?.length ? status.readings.map((r) => `${r.label} ${r.value}`).join(" · ") : null;
  return { key: `d${d.id}`, name: d.name, link: `${kind} · ${via}`, reach, answer, readings, Icon: Cpu };
}

function networkRow(n: NetworkItem, nowMs: number): Row {
  const reach: Reach = !n.lastSeenAt ? "unknown" : nowMs - Date.parse(n.lastSeenAt) < NETWORK_ONLINE_MS ? "online" : "offline";
  return {
    key: n.key,
    name: n.name,
    link: `${networkTypeLabel(n.type)}${n.ipAddress ? ` · ${n.ipAddress}` : ""}${n.inferred ? " · über Standort" : ""}`,
    reach,
    answer: reach === "online" ? "online" : n.lastSeenAt ? `zuletzt ${fmtAgo(n.lastSeenAt, nowMs)}` : "nie gesehen",
    readings: null,
    Icon: Network,
  };
}

const DOT: Record<Reach, string> = {
  online: "bg-emerald-500",
  offline: "bg-destructive",
  unknown: "bg-muted-foreground/40",
};

export function TechTable({
  devices,
  statuses,
  network,
  nowMs,
}: {
  devices: RoomDevice[];
  statuses: Map<number, DeviceStatus>;
  network: NetworkItem[];
  nowMs: number;
}) {
  const rows = [...devices.map((d) => deviceRow(d, statuses.get(d.id), nowMs)), ...network.map((n) => networkRow(n, nowMs))];
  const trouble = rows.filter((r) => r.reach === "offline");
  const fine = rows.filter((r) => r.reach !== "offline");
  const online = rows.filter((r) => r.reach === "online").length;

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{online}</span> von {rows.length} antworten
        <span className="ml-auto flex h-1.5 w-24 overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn("h-full rounded-full", trouble.length > 0 ? "bg-destructive" : "bg-emerald-500")}
            style={{ width: `${(online / rows.length) * 100}%` }}
          />
        </span>
      </div>

      {trouble.length > 0 && (
        <div className="overflow-hidden rounded-tile border border-destructive/40 bg-destructive/5">
          {trouble.map((r, i) => (
            <div key={r.key} className={cn("flex items-center gap-3 px-3 py-2", i > 0 && "border-t border-destructive/15")}>
              <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-destructive">{r.name} antwortet nicht</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {r.answer} · {r.link}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {fine.length > 0 && (
        <div className="glass-tile overflow-hidden">
          <div className="hidden grid-cols-[1fr_auto] gap-3 px-3 pb-1 pt-2 text-label sm:grid">
            <span>Gerät · Anbindung</span>
            <span>Antwort</span>
          </div>
          {fine.map((r, i) => (
            <div key={r.key} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2", i > 0 && "border-t border-border/50")}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/8 text-muted-foreground">
                <r.Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{r.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{r.link}</span>
                {r.readings && <span className="block truncate text-[11px] text-muted-foreground">{r.readings}</span>}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", DOT[r.reach])} />
                {r.answer}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
