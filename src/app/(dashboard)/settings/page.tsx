import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { IntegrationCard } from "@/components/settings/integration-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plug, Key, Info, MapPin, ChevronRight, Plus, MonitorPlay, Wifi } from "lucide-react";
import { MonitorManager } from "@/components/settings/monitor-manager";
import { ShellyCloudCard } from "@/components/settings/shelly-cloud-card";

const PROVIDERS = ["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL"] as const;

export default async function SettingsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [apiConfigs, account, areas, monitors, devices, shellyDevices] = await Promise.all([
    db.apiConfig.findMany({ where: { accountId: session.user.accountId } }),
    db.account.findUnique({ where: { id: session.user.accountId } }),
    db.accessArea.findMany({
      where: { accountId: session.user.accountId },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
      include: { parent: true },
      take: 5,
    }),
    db.monitorConfig.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { createdAt: "desc" },
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId },
      select: { id: true, name: true, type: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId, type: "SHELLY", shellyId: { not: null } },
      select: { shellyId: true },
    }),
  ]);

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const shellyConfig = apiConfigs.find((c) => c.provider === "SHELLY");
  const existingShellyIds = shellyDevices.map((d) => d.shellyId!).filter(Boolean);

  const configByProvider = Object.fromEntries(
    apiConfigs.map((c) => [c.provider, c])
  );

  return (
    <>
      <Header title="Einstellungen" accountName={session.user.accountName} />
      <div className="p-6 space-y-8 max-w-3xl">

        {/* Account Info */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Account
            </h2>
          </div>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Mandant</span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{account?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Subdomain</span>
                <Badge variant="secondary" className="font-mono text-xs">{account?.subdomain}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">API Token (Geräte)</span>
                <Badge variant="outline" className="font-mono text-xs max-w-[220px] truncate">
                  {account?.apiToken}
                </Badge>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 mt-2">
                <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Dieser Token wird von Raspberry Pi und Shelly-Geräten zur Authentifizierung verwendet.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Shelly Cloud */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Shelly Cloud
            </h2>
            {shellyConfig && (
              <Badge className="ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                Verbunden · {existingShellyIds.length} Gerät{existingShellyIds.length !== 1 ? "e" : ""} importiert
              </Badge>
            )}
          </div>
          <ShellyCloudCard
            savedServer={shellyConfig?.baseUrl ?? null}
            savedAuthKey={shellyConfig?.token ?? null}
            existingDeviceIds={existingShellyIds}
          />
        </section>

        {/* Live Monitore */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-5 w-5 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Live Monitore
            </h2>
            <Badge variant="secondary" className="ml-auto text-xs">
              {monitors.length} Monitor{monitors.length !== 1 ? "e" : ""}
            </Badge>
          </div>
          <MonitorManager
            monitors={monitors.map((m) => ({
              ...m,
              deviceIds: m.deviceIds as number[],
              createdAt: m.createdAt.toISOString(),
            }))}
            devices={devices}
            baseUrl={baseUrl}
          />
        </section>

        {/* Bereiche */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Resourcen
            </h2>
            <Badge variant="secondary" className="ml-auto text-xs">
              {areas.length} Resourcen
            </Badge>
          </div>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="pt-4 pb-4 space-y-1">
              {areas.length === 0 && (
                <p className="text-sm text-slate-500 py-2">Noch keine Resourcen angelegt.</p>
              )}
              {areas.map((area) => (
                <div key={area.id} className="flex items-center justify-between py-1.5">
                  <div>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{area.name}</span>
                    {area.parent && (
                      <span className="text-xs text-slate-400 ml-2">in {area.parent.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {area.personLimit && (
                      <Badge variant="secondary" className="text-xs">{area.personLimit} Pers.</Badge>
                    )}
                    <Badge className={
                      area.allowReentry
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 text-xs"
                    }>
                      {area.allowReentry ? "Wiedereinlass" : "Einmalig"}
                    </Badge>
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <Link href="/areas">
                    <ChevronRight className="h-4 w-4 mr-1.5" />
                    Alle Resourcen verwalten
                  </Link>
                </Button>
                <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                  <Link href="/areas">
                    <Plus className="h-4 w-4 mr-1.5" />
                    Neue Resource
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Integrations */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Schnittstellen
            </h2>
            <Badge variant="secondary" className="ml-auto text-xs">
              {apiConfigs.length} / {PROVIDERS.length} aktiv
            </Badge>
          </div>

          <div className="space-y-3">
            {PROVIDERS.map((provider) => (
              <IntegrationCard
                key={provider}
                provider={provider}
                initialData={configByProvider[provider] ?? null}
              />
            ))}
          </div>
        </section>

      </div>
    </>
  );
}
