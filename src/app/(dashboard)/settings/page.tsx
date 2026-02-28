import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { IntegrationCard } from "@/components/settings/integration-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plug, Key, Info, MonitorPlay, Wifi, Globe } from "lucide-react";
import { MonitorManager } from "@/components/settings/monitor-manager";
import { ShellyCloudCard } from "@/components/settings/shelly-cloud-card";
import { OwnApiCard } from "@/components/settings/own-api-card";

const PROVIDERS = ["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL"] as const;

export default async function SettingsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [apiConfigs, account, monitors, devices, shellyDevices] = await Promise.all([
    db.apiConfig.findMany({ where: { accountId: session.user.accountId } }),
    db.account.findUnique({ where: { id: session.user.accountId } }),
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

        {/* Eigene API */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Eigene API
            </h2>
          </div>
          <OwnApiCard
            baseUrl={baseUrl}
            apiToken={account?.apiToken ?? ""}
          />
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
