import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { IntegrationCard } from "@/components/settings/integration-card";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Plug, Key, Info, Wifi, Globe, MessageCircle, Sprout, Bell, Trash2, Smartphone, Bot } from "lucide-react";
import { ShellyCloudCard } from "@/components/settings/shelly-cloud-card";
import { GardenaCard } from "@/components/settings/gardena-card";
import { OwnApiCard } from "@/components/settings/own-api-card";
import { McpCard } from "@/components/settings/mcp-card";
import { MCP_OFFERED_LEVELS } from "@/lib/mcp/protocol";
import { TelegramCard } from "@/components/settings/telegram-card";
import { PushCard } from "@/components/settings/push-card";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { DataRetentionCard } from "@/components/settings/data-retention-card";
import { parseDataRetention } from "@/lib/data-retention";
import { isTenantAdminRole } from "@/lib/api-auth";

const PROVIDERS = ["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL", "NUKI", "LOQED"] as const;

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  // Zugangsdaten (Account-Token, Schnittstellen, Telegram, Loeschfristen)
  // sehen und aendern nur Admins. Fuer die Rolle USER werden sie gar nicht
  // erst geladen - die zugehoerigen API-Routen lehnen sie ebenfalls ab.
  const isAdmin = isTenantAdminRole(session.user.role);

  const [apiConfigs, account, shellyDevices, gardenaDevices, telegramConfig, mcpTokens] = await Promise.all([
    isAdmin ? db.apiConfig.findMany({ where: { accountId: session.user.accountId } }) : [],
    db.account.findUnique({
      where: { id: session.user.accountId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        apiToken: isAdmin,
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
      select: { id: true, chatId: true, isActive: true, dailyReport: true, dailyReportTime: true, notifyNewDevices: true, notifyOutages: true },
    }),
    isAdmin
      ? db.mcpToken.findMany({
          where: { accountId: session.user.accountId, revokedAt: null },
          select: { id: true, name: true, hint: true, level: true, createdBy: true, lastUsedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
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
      <div className="page-content space-y-4 sm:space-y-5 max-w-3xl">

        {/* Account Info */}
        <section className="space-y-2">
          <SectionHeading icon={Key} title="Account" />
          <Card>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Mandant</span>
                <span className="text-sm font-medium text-foreground">{account?.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Subdomain</span>
                <Badge variant="mono">{account?.subdomain}</Badge>
              </div>
              {isAdmin && (<>
              <div className="flex items-center justify-between gap-3">
                {/* shrink-0: Die Beschriftung bleibt eine Zeile (auf dem Handy sonst drei Zeilen neben dem Token). */}
                <span className="shrink-0 text-sm text-muted-foreground">API Token (Geräte)</span>
                {/* Langer Token: Pille darf schrumpfen, der Text kürzt mit Auslassung. */}
                <Badge variant="mono" className="min-w-0 max-w-[220px] shrink">
                  <span className="truncate">{account?.apiToken}</span>
                </Badge>
              </div>
              <Notice tone="warning" compact icon={Info}>
                Dieser Token wird von Raspberry Pi und Shelly-Geräten zur Authentifizierung verwendet.
              </Notice>
              </>)}
              {!isAdmin && (
                <Notice tone="info" compact icon={Info}>
                  Zugangsdaten, Schnittstellen und Löschfristen verwaltet ein Admin-Zugang.
                </Notice>
              )}
            </CardContent>
          </Card>
        </section>

        {isAdmin && (<>
        {/* Eigene API */}
        <section className="space-y-2">
          <SectionHeading icon={Globe} title="Eigene API" />
          <OwnApiCard
            baseUrl={baseUrl}
            apiToken={account?.apiToken ?? ""}
          />
        </section>

        {/* MCP-Schnittstelle fuer KI-Assistenten */}
        <section className="space-y-2">
          <SectionHeading icon={Bot} title="MCP-Schnittstelle (KI-Assistenten)" />
          <McpCard
            endpoint={`${baseUrl.replace(/\/$/, "")}/api/mcp`}
            allowedLevels={[...MCP_OFFERED_LEVELS]}
            initialTokens={mcpTokens.map((t) => ({
              ...t,
              lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
              createdAt: t.createdAt.toISOString(),
            }))}
          />
        </section>

        {/* Shelly Cloud */}
        <section className="space-y-2">
          {/* Der Verbindungszustand steht in der Karte selbst; hier nur die Anzahl als neutrale Pille
              (docs/design-regeln.md, Abschnitt 1: jede Information genau einmal). */}
          <SectionHeading icon={Wifi} title="Shelly Cloud" aside={shellyConfig && ( <Badge variant="secondary" className="tabular-nums"> {existingShellyIds.length} Gerät{existingShellyIds.length !== 1 ? "e" : ""} importiert </Badge> )} />
          <ShellyCloudCard
            savedServer={shellyConfig?.baseUrl ?? null}
            savedAuthKey={shellyConfig?.token ?? null}
            existingDeviceIds={existingShellyIds}
          />
        </section>

        {/* GARDENA smart system */}
        <section className="space-y-2">
          {/* Wie bei Shelly: Anzahl als neutrale Pille, der Verbindungszustand (grün) steht in der Karte. */}
          {/* Handy: im Badge nur die Geräte – die Verbindungen nennt die Karte („1 verbunden“), so bleibt
              die Überschrift einzeilig. */}
          <SectionHeading icon={Sprout} title="GARDENA smart system" aside={gardenaConnections.length > 0 && ( <Badge variant="secondary" className="tabular-nums"> <span className="max-sm:hidden">{gardenaConnections.length} Verbindung{gardenaConnections.length !== 1 ? "en" : ""} · </span>{existingGardenaIds.length} Gerät{existingGardenaIds.length !== 1 ? "e" : ""} </Badge> )} />
          <GardenaCard
            connections={gardenaConnections}
            existingServiceIds={existingGardenaIds}
          />
        </section>

        {/* Löschfristen / Datenschutz */}
        <section className="space-y-2">
          <SectionHeading icon={Trash2} title="Datenschutz" />
          <DataRetentionCard initial={dataRetention} />
        </section>
        </>)}

        {/* App auf dem Handy */}
        <section className="space-y-2">
          <SectionHeading icon={Smartphone} title="App auf dem Handy" />
          <InstallPrompt variant="card" />
        </section>

        {/* Push-Benachrichtigungen */}
        <section className="space-y-2">
          <SectionHeading icon={Bell} title="Push-Benachrichtigungen" />
          <PushCard />
        </section>

        {isAdmin && (<>
        {/* Telegram Bot */}
        <section className="space-y-2">
          {/* „Verbunden“ zeigt die Karte selbst (Status) – und aktuell, auch nach dem Entfernen. */}
          <SectionHeading icon={MessageCircle} title="Telegram Bot" />
          <TelegramCard initialConfig={telegramConfig ?? null} />
        </section>

        {/* Integrations */}
        <section className="space-y-2">
          <SectionHeading
            icon={Plug}
            title="Schnittstellen"
            aside={(
              <Badge variant="secondary" className="tabular-nums">
                {PROVIDERS.filter((p) => configByProvider[p]).length} / {PROVIDERS.length} aktiv
              </Badge>
            )}
          />

          <div className="space-y-4 sm:space-y-5">
            {PROVIDERS.map((provider) => (
              <IntegrationCard
                key={provider}
                provider={provider}
                initialData={configByProvider[provider] ?? null}
              />
            ))}
          </div>
        </section>
        </>)}

      </div>
    </>
  );
}
