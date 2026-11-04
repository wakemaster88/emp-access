"use client";

/**
 * Netzwerk eines Raums: Infrastruktur (Router, Switch, Access Point) oben als
 * Kacheln, Endgeraete darunter als Liste. Online heisst: vom Hub-Scan in den
 * letzten 30 Minuten gesehen.
 */

import {
  Camera,
  Cpu,
  HardDrive,
  Monitor,
  Network,
  Printer,
  Router,
  Server,
  Shield,
  Smartphone,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { NetworkItem } from "@/components/raeume/types";
import { fmtAgo } from "@/components/raeume/shared";
import { cn } from "@/lib/utils";

const ONLINE_MS = 30 * 60_000;

const ICONS: Record<string, LucideIcon> = {
  ROUTER: Router,
  SWITCH: Network,
  ACCESS_POINT: Wifi,
  FIREWALL: Shield,
  PRINTER: Printer,
  PC: Monitor,
  PHONE: Smartphone,
  MONITOR: Monitor,
  CAMERA: Camera,
  NAS: HardDrive,
  SERVER: Server,
  IOT: Cpu,
};

const TYPE_LABEL: Record<string, string> = {
  ROUTER: "Router",
  SWITCH: "Switch",
  ACCESS_POINT: "Access Point",
  FIREWALL: "Firewall",
  PRINTER: "Drucker",
  PC: "PC / Tablet",
  PHONE: "Telefon",
  MONITOR: "Bildschirm",
  CAMERA: "Kamera",
  NAS: "NAS",
  SERVER: "Server",
  IOT: "IoT",
  OTHER: "Gerät",
};

export const networkTypeLabel = (type: string) => TYPE_LABEL[type] ?? type;

function state(item: NetworkItem, nowMs: number): "online" | "offline" | "unknown" {
  if (!item.lastSeenAt) return "unknown";
  return nowMs - Date.parse(item.lastSeenAt) < ONLINE_MS ? "online" : "offline";
}

export function NetworkWidget({ items, nowMs }: { items: NetworkItem[]; nowMs: number }) {
  const infra = items.filter((i) => i.kind === "device");
  const clients = items.filter((i) => i.kind === "client");
  const online = items.filter((i) => state(i, nowMs) === "online").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{online}</span> von {items.length} online
        <span className="ml-auto flex h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <span
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500"
            style={{ width: `${items.length ? (online / items.length) * 100 : 0}%` }}
          />
        </span>
      </div>

      {infra.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {infra.map((item) => {
            const s = state(item, nowMs);
            const Icon = ICONS[item.type] ?? Network;
            return (
              <div
                key={item.key}
                className={cn(
                  "relative overflow-hidden rounded-tile border p-3",
                  s === "online" ? "border-emerald-400/35 bg-gradient-to-b from-emerald-500/10 to-transparent" : "glass-tile",
                )}
                title={item.inferred ? "Über Standort zugeordnet" : undefined}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full",
                      s === "online"
                        ? "bg-emerald-500 text-white shadow-[0_0_14px_rgba(16,185,129,0.5)]"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <StatusDot state={s} />
                </div>
                <p className="mt-2 break-words text-[13px] font-semibold leading-tight">{item.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {networkTypeLabel(item.type)}
                  {item.ipAddress && <span className="font-mono"> · {item.ipAddress}</span>}
                </p>
                {s !== "online" && (
                  <p className="text-[10px] text-muted-foreground">
                    {item.lastSeenAt ? `zuletzt ${fmtAgo(item.lastSeenAt, nowMs)}` : "nie gesehen"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {clients.length > 0 && (
        <div className="glass-tile divide-y divide-border/50 overflow-hidden">
          {clients.map((item) => {
            const s = state(item, nowMs);
            const Icon = ICONS[item.type] ?? Cpu;
            return (
              <div key={item.key} className="flex items-center gap-2.5 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {networkTypeLabel(item.type)}
                    {item.ipAddress && <span className="font-mono"> · {item.ipAddress}</span>}
                    {s !== "online" && (item.lastSeenAt ? ` · zuletzt ${fmtAgo(item.lastSeenAt, nowMs)}` : " · nie gesehen")}
                  </span>
                </span>
                <StatusDot state={s} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusDot({ state }: { state: "online" | "offline" | "unknown" }) {
  return (
    <span
      className={cn(
        "relative flex h-2 w-2 shrink-0 rounded-full",
        state === "online" ? "bg-emerald-500" : state === "offline" ? "bg-rose-400" : "bg-slate-300 dark:bg-slate-600",
      )}
      title={state === "online" ? "online" : state === "offline" ? "offline" : "unbekannt"}
    >
      {state === "online" && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-50" />}
    </span>
  );
}
