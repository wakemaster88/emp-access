import React from "react";
import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DeviceActions } from "@/components/devices/device-actions";
import { DeviceQr } from "@/components/devices/device-qr";
import { EditDeviceDialog } from "@/components/devices/edit-device-dialog";
import {
  Wifi, WifiOff, Cpu, QrCode, CreditCard, ArrowLeft,
  Ticket, ScanLine, CheckCircle2, XCircle, AlertTriangle,
  GitMerge, DoorOpen, Activity, ToggleRight, Lightbulb,
} from "lucide-react";
import { fmtDateTime } from "@/lib/utils";
import { DeviceDetailClient } from "@/components/devices/device-detail-client";
import { ScheduleCard } from "@/components/devices/schedule-card";
import { SystemInfoCard } from "@/components/devices/system-info-card";
import { LATEST_PI_VERSION } from "@/lib/pi-version";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DeviceDetailPage({ params }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/devices");

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) notFound();

  const db = tenantClient(session.user.accountId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [device, scanStats, areas, account] = await Promise.all([
    db.device.findFirst({
      where: { id: deviceId, accountId: session.user.accountId },
      include: { _count: { select: { scans: true } } },
    }),
    db.scan.groupBy({
      by: ["result"],
      where: { deviceId, accountId: session.user.accountId },
      _count: true,
    }),
    db.accessArea.findMany({
      where: { accountId: session.user.accountId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.account.findUnique({
      where: { id: session.user.accountId },
      select: { apiToken: true },
    }),
  ]);

  if (!device) notFound();

  const ticketCount = await db.ticket.count({
    where: { accountId: session.user.accountId, status: "VALID" },
  });

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const isOnline = !!device.lastUpdate && device.lastUpdate > fiveMinAgo;

  const granted = scanStats.find((s) => s.result === "GRANTED")?._count ?? 0;
  const denied = scanStats.find((s) => s.result === "DENIED")?._count ?? 0;
  const totalScans = device._count.scans;

  // QR config value for Pi devices: JSON with API token + device ID
  const serverUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.AUTH_URL ?? "http://localhost:3000";
  const configUrl = JSON.stringify({
    url: serverUrl,
    token: account?.apiToken ?? "",
    id: device.id,
  });

  const categoryMeta: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    DREHKREUZ:   { label: "Drehkreuz",  icon: GitMerge,    color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
    TUER:        { label: "Tür",        icon: DoorOpen,    color: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" },
    SENSOR:      { label: "Sensor",     icon: Activity,    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    SCHALTER:    { label: "Schalter",   icon: ToggleRight, color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    BELEUCHTUNG: { label: "Beleuchtung",icon: Lightbulb,   color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  };

  const taskLabel: Record<number, string> = {
    0: "Idle",
    1: "Öffne einmal",
    2: "NOT-AUF aktiv",
    3: "Deaktiviert",
  };

  return (
    <>
      <Header title="Gerätedetails" accountName={session.user.accountName} />
      <div className="p-6 space-y-6 max-w-4xl">

        {/* Back */}
        <Link href="/devices" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Zurück zu Geräte
        </Link>

        {/* Main Card */}
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-6">

              {/* QR Code – nur für Raspberry Pi */}
              {device.type === "RASPBERRY_PI" && (
                <div className="shrink-0 flex flex-col items-center gap-2">
                  <DeviceQr value={configUrl} size={110} />
                  <p className="text-xs text-slate-400 text-center">Konfigurations-QR</p>
                </div>
              )}

              {/* Info */}
              <div className="flex-1 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{device.name}</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {device.type === "RASPBERRY_PI" ? "Raspberry Pi – Drehkreuz/Tür" : "Shelly – Relais"}
                    </p>
                    {device.ipAddress && (
                      <p className="text-xs text-slate-400 font-mono mt-1">{device.ipAddress}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {device.category && categoryMeta[device.category] && (() => {
                      const meta = categoryMeta[device.category!];
                      const Icon = meta.icon;
                      return (
                        <Badge className={`gap-1 ${meta.color}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </Badge>
                      );
                    })()}

                    {/* Pi: static online badge based on lastUpdate */}
                    {device.type !== "SHELLY" && (
                      isOnline ? (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1">
                          <Wifi className="h-3 w-3" /> Online
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <WifiOff className="h-3 w-3" /> Offline
                        </Badge>
                      )
                    )}

                    <Badge variant={device.isActive ? "default" : "destructive"} className={device.isActive ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" : ""}>
                      {device.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    {/* Task-Badge nur für Pi-Zugangsgeräte */}
                    {device.type !== "SHELLY" && device.task > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        {taskLabel[device.task] ?? `Task ${device.task}`}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Code Types + Firmware – nur für Raspberry Pi */}
                {device.type === "RASPBERRY_PI" && (
                  <div className="flex gap-3">
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <QrCode className="h-4 w-4" /> QR
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <CreditCard className="h-4 w-4" /> RFID
                    </span>
                    {device.firmware && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Cpu className="h-4 w-4" /> FW {device.firmware}
                      </span>
                    )}
                  </div>
                )}

                <Separator className="dark:bg-slate-800" />

                {/* Actions */}
                <DeviceDetailClient
                  areas={areas}
                  device={{
                    id: device.id,
                    name: device.name,
                    type: device.type,
                    category: device.category ?? null,
                    ipAddress: device.ipAddress,
                    shellyId: device.shellyId,
                    shellyAuthKey: device.shellyAuthKey,
                    isActive: device.isActive,
                    accessIn: device.accessIn,
                    accessOut: device.accessOut,
                    allowReentry: device.allowReentry,
                    firmware: device.firmware,
                    schedule: device.schedule ?? null,
                    task: device.task,
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Zeitsteuerung – eigene Card für Schalter & Beleuchtung */}
        {(device.category === "SCHALTER" || device.category === "BELEUCHTUNG") && (
          <ScheduleCard deviceId={device.id} initialSchedule={device.schedule} />
        )}

        {/* Raspberry Pi System-Info */}
        {device.type === "RASPBERRY_PI" && device.systemInfo && typeof device.systemInfo === "object" && (
          <SystemInfoCard
            systemInfo={device.systemInfo as Record<string, unknown>}
            lastUpdate={device.lastUpdate?.toISOString() ?? null}
            latestVersion={LATEST_PI_VERSION}
          />
        )}

        {/* Stats – nur für Zugangsgeräte (Drehkreuz, Tür) und ungekategorisierte Pi-Geräte */}
        {(() => {
          const hasScans = !device.category || ["DREHKREUZ", "TUER"].includes(device.category);
          if (!hasScans) return null;

          const stats = [
            { label: "Tickets",        value: ticketCount,             icon: Ticket,        color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/30",  href: "/tickets" },
            { label: "Scans gesamt",   value: totalScans,              icon: ScanLine,      color: "text-slate-600 dark:text-slate-400",   bg: "bg-slate-50 dark:bg-slate-900",        href: `/scans?device=${device.id}` },
            { label: "Gültige Scans",  value: granted,                 icon: CheckCircle2,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", href: `/scans?device=${device.id}&result=GRANTED` },
            { label: "Ungültige Scans",value: denied,                  icon: XCircle,       color: "text-rose-600 dark:text-rose-400",     bg: "bg-rose-50 dark:bg-rose-950/30",       href: `/scans?device=${device.id}&result=DENIED` },
            ...(device.category === "DREHKREUZ" ? [
              { label: "NOT-AUF", value: device.task === 2 ? 1 : 0, icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", href: `/scans?device=${device.id}` },
            ] : []),
          ];

          return (
            <div className={`grid grid-cols-2 gap-3 ${stats.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <Link key={stat.label} href={stat.href}>
                    <Card className="border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors cursor-pointer">
                      <CardContent className="pt-4 pb-4">
                        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${stat.bg} mb-2`}>
                          <Icon className={`h-5 w-5 ${stat.color}`} />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stat.value}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
                        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1 font-medium">Ansehen →</p>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          );
        })()}

        {/* Last update – nur wenn keine SystemInfo-Card angezeigt wird */}
        {device.lastUpdate && !(device.type === "RASPBERRY_PI" && device.systemInfo) && (
          <p className="text-xs text-slate-400 text-right">
            Letztes Update: {fmtDateTime(device.lastUpdate)}
          </p>
        )}

      </div>
    </>
  );
}
