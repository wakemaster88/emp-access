"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Thermometer, Cpu, HardDrive, MemoryStick, Clock, Wifi,
  Server, AlertTriangle, Zap, Activity,
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
    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, sub, className }: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: string; className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 py-2", className)}>
      <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{value}</p>
      </div>
      {sub && <span className="text-xs text-slate-400 shrink-0">{sub}</span>}
    </div>
  );
}

function tempColor(temp: number): string {
  if (temp >= 80) return "text-rose-600";
  if (temp >= 70) return "text-amber-600";
  if (temp >= 60) return "text-yellow-600";
  return "text-emerald-600";
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-rose-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-indigo-500";
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
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Server className="h-4 w-4" />
            Raspberry Pi System
          </CardTitle>
          {lastUpdate && (
            <span className="text-xs text-slate-400">
              Letzter Bericht: {fmtDateTime(lastUpdate)}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Warnungen */}
        {throttle && (throttle.undervoltage_now || throttle.throttled_now) && (
          <div className="flex items-center gap-2 text-sm bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {throttle.undervoltage_now && <span>Unterspannung erkannt – Netzteil prüfen!</span>}
            {throttle.throttled_now && <span>CPU wird gedrosselt – Kühlung prüfen!</span>}
          </div>
        )}

        {/* Modell + Version */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0 divide-slate-100 dark:divide-slate-800">
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
                    <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 dark:border-emerald-800 dark:text-emerald-400">
                      aktuell
                    </Badge>
                  )}
                  {latestVersion && scannerVersion !== latestVersion && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:border-amber-800 dark:text-amber-400">
                      Update v{latestVersion}
                    </Badge>
                  )}
                </span>
              }
            />
          )}
        </div>

        {/* Temperatur + CPU */}
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {cpuTemp !== undefined && (
              <div className="text-center">
                <Thermometer className={cn("h-5 w-5 mx-auto mb-1", tempColor(cpuTemp))} />
                <p className={cn("text-2xl font-bold", tempColor(cpuTemp))}>{cpuTemp}°</p>
                <p className="text-xs text-slate-500">CPU Temp</p>
              </div>
            )}
            {gpuTemp !== undefined && (
              <div className="text-center">
                <Thermometer className={cn("h-5 w-5 mx-auto mb-1", tempColor(gpuTemp))} />
                <p className={cn("text-2xl font-bold", tempColor(gpuTemp))}>{gpuTemp}°</p>
                <p className="text-xs text-slate-500">GPU Temp</p>
              </div>
            )}
            {cpuUsage !== undefined && (
              <div className="text-center">
                <Cpu className="h-5 w-5 mx-auto mb-1 text-indigo-500" />
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{cpuUsage}%</p>
                <p className="text-xs text-slate-500">CPU Last</p>
              </div>
            )}
            {cpuFreq !== undefined && (
              <div className="text-center">
                <Zap className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{cpuFreq}</p>
                <p className="text-xs text-slate-500">MHz</p>
              </div>
            )}
          </div>
        </div>

        {/* Speicher */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {memory && (
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">RAM</span>
                </div>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{memory.percent}%</span>
              </div>
              <ProgressBar value={memory.percent} color={barColor(memory.percent)} />
              <p className="text-xs text-slate-500">
                {memory.used_mb} MB / {memory.total_mb} MB ({memory.available_mb} MB frei)
              </p>
            </div>
          )}

          {disk && (
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Speicher</span>
                </div>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{disk.percent}%</span>
              </div>
              <ProgressBar value={disk.percent} color={barColor(disk.percent)} />
              <p className="text-xs text-slate-500">
                {disk.used_gb} GB / {disk.total_gb} GB ({disk.free_gb} GB frei)
              </p>
            </div>
          )}
        </div>

        {/* Netzwerk + Uptime */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0 divide-slate-100 dark:divide-slate-800">
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
            <Badge variant="outline" className="text-xs text-slate-500">{osInfo.os}</Badge>
            <Badge variant="outline" className="text-xs text-slate-500">Kernel {osInfo.kernel}</Badge>
            <Badge variant="outline" className="text-xs text-slate-500">Python {osInfo.python}</Badge>
            <Badge variant="outline" className="text-xs text-slate-500">{osInfo.arch}</Badge>
          </div>
        )}

        {/* Throttle-Historie */}
        {throttle && (throttle.undervoltage_occurred || throttle.throttled_occurred) && !throttle.undervoltage_now && !throttle.throttled_now && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {throttle.undervoltage_occurred && "Unterspannung wurde erkannt (nicht aktuell). "}
            {throttle.throttled_occurred && "CPU-Drosselung wurde erkannt (nicht aktuell)."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
