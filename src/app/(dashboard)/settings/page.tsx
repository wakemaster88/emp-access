import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { IntegrationCard } from "@/components/settings/integration-card";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { Badge } from "@/components/ui/badge";
import { Plug, Key, Info, Wifi, Globe, MessageCircle, Sprout, Bell, Trash2, Smartphone } from "lucide-react";
import { ShellyCloudCard } from "@/components/settings/shelly-cloud-card";
import { GardenaCard } from "@/components/settings/gardena-card";
import { OwnApiCard } from "@/components/settings/own-api-card";
import { TelegramCard } from "@/components/settings/telegram-card";
import { PushCard } from "@/components/settings/push-card";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { DataRetentionCard } from "@/components/settings/data-retention-card";
import { parseDataRetention } from "@/lib/data-retention";

const PROVIDERS = ["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL", "NUKI", "LOQED"] as const;

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [apiConfigs, account, shellyDevices, gardenaDevices, telegramConfig] = await Promise.all([
    db.apiConfig.findMany({ where: { accountId: session.user.accountId } }),
    db.account.findUnique({
      where: { id: session.user.accountId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        apiToken: true,
        dataRetention: true,
      },
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId, type: "SHELLY", shellyId: { not: null } },
      select: { shellyId: true },
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId, type: "GARDENA_VALVE", gardenaServiceId: { not: null } },
      select: { gardenaServiceId: true, gardenaConfigId: true },
    }),
    db.telegramConfig.findFirst({
      where: { accountId: session.user.accountId },
      select: { id: true, chatId: true, isActive: true, dailyReport: true, dailyReportTime: true },
    }),
  ]);

  const dataRetention = parseDataRetention(account?.dataRetention);

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const shellyConfig = apiConfigs.find((c) => c.provider === "SHELLY");
  const existingShellyIds = shellyDevices.map((d) => d.shellyId!).filter(Boolean);
  const existingGardenaIds = gardenaDevices.map((d) => d.gardenaServiceId!).filter(Boolean);
  const maskGardenaKey = (k: string) => (k.length <= 6 ? k : `…${k.slice(-6)}`);
  const gardenaConnections = apiConfigs
    .filter((c) => c.provider === "GARDENA")
    .map((c) => ({
      id: c.id,
      name: c.name ?? "GARDENA",
      keyMasked: maskGardenaKey(c.token),
      deviceCount: gardenaDevices.filter((d) => d.gardenaConfigId === c.id).length,
    }));

  const configByProvider = Object.fromEntries(
    apiConfigs.map((c) => [c.provider, c])
  );

  return (
    <>
      <Header title="Einstellungen" accountName={session.user.accountName} />
      <div className="page-content space-y-8 max-w-3xl">

        {/* Account Info */}
        <section className="space-y-3">
          <SectionHeading icon={Key} title="Account" />
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Mandant</span>
                <span className="text-sm font-medium text-foreground">{account?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Subdomain</span>
                <Badge variant="secondary" className="font-mono text-xs">{account?.subdomain}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">API Token (Geräte)</span>
                <Badge variant="outline" className="font-mono text-xs max-w-[220px] truncate">
                  {account?.apiToken}
                </Badge>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 mt-2">
                <Info className="h-4 w-4 text-warning shrink-0" />
                <p className="text-xs text-warning">
                  Dieser Token wird von Raspberry Pi und Shelly-Geräten zur Authentifizierung verwendet.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Eigene API */}
        <section className="space-y-3">
          <SectionHeading icon={Globe} title="Eigene API" />
          <OwnApiCard
            baseUrl={baseUrl}
            apiToken={account?.apiToken ?? ""}
          />
        </section>

        {/* Shelly Cloud */}
        <section className="space-y-3">
          <SectionHeading icon={Wifi} title="Shelly Cloud" aside={shellyConfig && ( <Badge className="bg-success/12 text-success text-xs"> Verbunden · {existingShellyIds.length} Gerät{existingShellyIds.length !== 1 ? "e" : ""} importiert </Badge> )} />
          <ShellyCloudCard
            savedServer={shellyConfig?.baseUrl ?? null}
            savedAuthKey={shellyConfig?.token ?? null}
            existingDeviceIds={existingShellyIds}
          />
        </section>

        {/* GARDENA smart system */}
        <section className="space-y-3">
          <SectionHeading icon={Sprout} title="GARDENA smart system" aside={gardenaConnections.length > 0 && ( <Badge className="bg-success/12 text-success text-xs"> {gardenaConnections.length} Verbindung{gardenaConnections.length !== 1 ? "en" : ""} · {existingGardenaIds.length} Gerät{existingGardenaIds.length !== 1 ? "e" : ""} </Badge> )} />
          <GardenaCard
            connections={gardenaConnections}
            existingServiceIds={existingGardenaIds}
          />
        </section>

        {/* Löschfristen / Datenschutz */}
        <section className="space-y-3">
          <SectionHeading icon={Trash2} title="Datenschutz" />
          <DataRetentionCard initial={dataRetention} />
        </section>

        {/* App auf dem Handy */}
        <section className="space-y-3">
          <SectionHeading icon={Smartphone} title="App auf dem Handy" />
          <InstallPrompt variant="card" />
        </section>

        {/* Push-Benachrichtigungen */}
        <section className="space-y-3">
          <SectionHeading icon={Bell} title="Push-Benachrichtigungen" />
          <PushCard />
        </section>

        {/* Telegram Bot */}
        <section className="space-y-3">
          <SectionHeading icon={MessageCircle} title="Telegram Bot" aside={telegramConfig?.isActive && ( <Badge className="bg-success/12 text-success text-xs"> Verbunden </Badge> )} />
          <TelegramCard initialConfig={telegramConfig ?? null} />
        </section>

        {/* Integrations */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
