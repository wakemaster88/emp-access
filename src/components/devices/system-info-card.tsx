"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import {
  Thermometer, Cpu, HardDrive, MemoryStick, Clock, Wifi,
  Server, AlertTriangle, Zap, Activity,
  type LucideIcon,
} from "lucide-react";
import { cn, fmtDateTime } from "@/lib/utils";

interface SystemInfoCardProps {
  systemInfo: Record<string, unknown>;
  lastUpdate: string | null;
  latestVersion?: string;
}

function ProgressBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2 w-full rounded-full bg-foreground/10 overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function InfoRow({ icon, label, value, sub, className }: {
  icon: LucideIcon; label: string; value: React.ReactNode; sub?: string; className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <IconChip icon={icon} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground/90 truncate">{value}</p>
      </div>
      {sub && <span className="text-xs text-muted-foreground tabular-nums shrink-0">{sub}</span>}
    </div>
  );
}

// Ab 60 °C Hinweis (warning), ab 80 °C Störung; darunter keine Zustandsfarbe (null),
// dann gelten die ruhigen Farben der übrigen Werte.
function tempColor(temp: number): string | null {
  if (temp >= 80) return "text-destructive";
  if (temp >= 60) return "text-warning";
  return null;
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 75) return "bg-warning";
  return "bg-primary";
}

export function SystemInfoCard({ systemInfo, lastUpdate, latestVersion }: SystemInfoCardProps) {
  const info = systemInfo;

  const cpuTemp = info.cpu_temp as number | undefined;
  const gpuTemp = info.gpu_temp as number | undefined;
  const cpuUsage = info.cpu_usage as number | undefined;
  const cpuFreq = info.cpu_freq_mhz as number | undefined;
  const memory = info.memory as { total_mb: number; used_mb: number; available_mb: number; percent: number } | undefined;
  const disk = info.disk as { total_gb: number; used_gb: number; free_gb: number; percent: number } | undefined;
  const uptime = info.uptime as { seconds: number; formatted: string } | undefined;
  const network = info.network as { hostname: string; ip: string; wifi_signal_dbm: number | null } | undefined;
  const model = info.model as string | undefined;
  const osInfo = info.os as { os: string; kernel: string; python: string; arch: string } | undefined;
  const throttle = info.throttle as { undervoltage_now: boolean; throttled_now: boolean; undervoltage_occurred: boolean; throttled_occurred: boolean } | undefined;
  const scannerVersion = info.scanner_version as string | undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            Raspberry Pi System
          </CardTitle>
          {lastUpdate && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Letzter Bericht: {fmtDateTime(lastUpdate)}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Warnungen */}
        {throttle && (throttle.undervoltage_now || throttle.throttled_now) && (
          <Notice
            tone="danger"
            compact
            role="status"
            icon={AlertTriangle}
            title={
              <>
                {throttle.undervoltage_now && <span className="block">Unterspannung erkannt – Netzteil prüfen!</span>}
                {throttle.throttled_now && <span className="block">CPU wird gedrosselt – Kühlung prüfen!</span>}
              </>
            }
          />
        )}

        {/* Modell + Version */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0 divide-border/60">
          {model && (
            <InfoRow icon={Server} label="Modell" value={model} />
          )}
          {scannerVersion && (
            <InfoRow
              icon={Activity}
              label="Scanner-Version"
              value={
                <span className="flex items-center gap-2">
                  v{scannerVersion}
                  {latestVersion && scannerVersion === latestVersion && (
                    <Badge variant="success" className="text-xs">
                      aktuell
                    </Badge>
                  )}
                  {latestVersion && scannerVersion !== latestVersion && (
                    <Badge variant="warning" className="text-xs">
                      Update v{latestVersion}
                    </Badge>
                  )}
                </span>
              }
            />
          )}
        </div>

        {/* Temperatur + CPU: Kachel in der Karte */}
        <div className="glass-tile p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {cpuTemp !== undefined && (
              <div className="text-center">
                <Thermometer className={cn("h-5 w-5 mx-auto mb-1", tempColor(cpuTemp) ?? "text-muted-foreground")} />
                <p className={cn("text-2xl font-bold tabular-nums", tempColor(cpuTemp) ?? "text-foreground/90")}>{cpuTemp}°</p>
                <p className="text-xs text-muted-foreground">CPU Temp</p>
              </div>
            )}
            {gpuTemp !== undefined && (
              <div className="text-center">
                <Thermometer className={cn("h-5 w-5 mx-auto mb-1", tempColor(gpuTemp) ?? "text-muted-foreground")} />
                <p className={cn("text-2xl font-bold tabular-nums", tempColor(gpuTemp) ?? "text-foreground/90")}>{gpuTemp}°</p>
                <p className="text-xs text-muted-foreground">GPU Temp</p>
              </div>
            )}
            {cpuUsage !== undefined && (
              <div className="text-center">
                <Cpu className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold text-foreground/90 tabular-nums">{cpuUsage}%</p>
                <p className="text-xs text-muted-foreground">CPU Last</p>
              </div>
            )}
            {cpuFreq !== undefined && (
              <div className="text-center">
                <Zap className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold text-foreground/90 tabular-nums">{cpuFreq}</p>
                <p className="text-xs text-muted-foreground">MHz</p>
              </div>
            )}
          </div>
        </div>

        {/* Speicher */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {memory && (
            <div className="glass-tile p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground/80">RAM</span>
                </div>
                <span className="text-sm font-bold text-foreground/90 tabular-nums">{memory.percent}%</span>
              </div>
              <ProgressBar value={memory.percent} color={barColor(memory.percent)} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {memory.used_mb} MB / {memory.total_mb} MB ({memory.available_mb} MB frei)
              </p>
            </div>
          )}

          {disk && (
            <div className="glass-tile p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground/80">Speicher</span>
                </div>
                <span className="text-sm font-bold text-foreground/90 tabular-nums">{disk.percent}%</span>
              </div>
              <ProgressBar value={disk.percent} color={barColor(disk.percent)} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {disk.used_gb} GB / {disk.total_gb} GB ({disk.free_gb} GB frei)
              </p>
            </div>
          )}
        </div>

        {/* Netzwerk + Uptime */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0 divide-border/60">
          {network && (
            <>
              <InfoRow icon={Wifi} label="Netzwerk" value={network.ip ?? "–"}
                sub={network.wifi_signal_dbm != null ? `${network.wifi_signal_dbm} dBm` : undefined} />
              <InfoRow icon={Server} label="Hostname" value={network.hostname ?? "–"} />
            </>
          )}
          {uptime && (
            <InfoRow icon={Clock} label="Uptime" value={uptime.formatted} />
          )}
        </div>

        {/* OS Info */}
        {osInfo && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="text-xs text-muted-foreground">{osInfo.os}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">Kernel {osInfo.kernel}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">Python {osInfo.python}</Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">{osInfo.arch}</Badge>
          </div>
        )}

        {/* Throttle-Historie */}
        {throttle && (throttle.undervoltage_occurred || throttle.throttled_occurred) && !throttle.undervoltage_now && !throttle.throttled_now && (
          <Notice
            tone="warning"
            compact
            icon={AlertTriangle}
            title={
              <>
                {throttle.undervoltage_occurred && "Unterspannung wurde erkannt (nicht aktuell). "}
                {throttle.throttled_occurred && "CPU-Drosselung wurde erkannt (nicht aktuell)."}
              </>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
