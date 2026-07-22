import Link from "next/link";
import { loadConfig } from "@/lib/config";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, LayoutGrid, Bell, ListChecks } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const config = await loadConfig();
  const enabledCams = config.cams.filter((c) => c.enabled).length;
  const enabledWidgets = config.widgets.filter((w) => w.enabled).length;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Übersicht</h1>
        <p className="mt-1 text-foreground/60">
          Verwalte Cams, Widgets, Layouts und Doorbird-Integration.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          href="/admin/cams"
          icon={<Camera className="size-5" />}
          label="Kameras"
          value={`${enabledCams} / ${config.cams.length}`}
          hint="aktiv / gesamt"
        />
        <StatTile
          href="/admin/widgets"
          icon={<LayoutGrid className="size-5" />}
          label="Widgets"
          value={`${enabledWidgets} / ${config.widgets.length}`}
          hint="aktiv / gesamt"
        />
        <StatTile
          href="/admin/layouts"
          icon={<ListChecks className="size-5" />}
          label="Layouts"
          value={`${config.layouts.length}`}
          hint={config.activeLayoutId ? `aktiv: ${config.activeLayoutId}` : "Auto-Grid aktiv"}
        />
        <StatTile
          href="/admin/doorbird"
          icon={<Bell className="size-5" />}
          label="Doorbird"
          value={config.doorbird.enabled ? "an" : "aus"}
          hint={config.doorbird.ip || "nicht konfiguriert"}
          status={config.doorbird.enabled ? "success" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Schnellstart</CardTitle>
            <CardDescription>
              Lege als erstes deine Kameras an. Sobald sie konfiguriert sind, generiert
              das System die go2rtc-Konfiguration und du kannst Widgets ins Layout ziehen.
            </CardDescription>
          </div>
        </CardHeader>
        <ol className="space-y-3 text-sm text-foreground/80">
          <li className="flex items-start gap-3">
            <span className="rounded-full bg-tile-accent px-2 py-0.5 text-xs ring-1 ring-border">1</span>
            <span>
              <Link href="/admin/cams" className="text-focus hover:underline">Kameras</Link>{" "}
              hinzufügen – manuell oder per LAN-Scan.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="rounded-full bg-tile-accent px-2 py-0.5 text-xs ring-1 ring-border">2</span>
            <span>
              go2rtc-Konfiguration unter{" "}
              <Link href="/admin/settings" className="text-focus hover:underline">Einstellungen</Link>{" "}
              generieren und neu laden lassen.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="rounded-full bg-tile-accent px-2 py-0.5 text-xs ring-1 ring-border">3</span>
            <span>
              <Link href="/admin/widgets" className="text-focus hover:underline">Widgets</Link>{" "}
              für Cams, Zeiterfassung etc. anlegen.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="rounded-full bg-tile-accent px-2 py-0.5 text-xs ring-1 ring-border">4</span>
            <span>
              Optional <Link href="/admin/layouts" className="text-focus hover:underline">Layout</Link>{" "}
              mit Drag&amp;Drop einrichten oder Auto-Grid nutzen.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className="rounded-full bg-tile-accent px-2 py-0.5 text-xs ring-1 ring-border">5</span>
            <span>
              <Link href="/admin/doorbird" className="text-focus hover:underline">Doorbird</Link>{" "}
              einrichten (Phase 4).
            </span>
          </li>
        </ol>
      </Card>
    </div>
  );
}

function StatTile({
  href,
  icon,
  label,
  value,
  hint,
  status,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  status?: "success" | "default";
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-tile p-5 ring-1 ring-border transition hover:ring-border-strong"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-foreground/60">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        {status && <Badge variant={status === "success" ? "success" : "default"}>{value}</Badge>}
      </div>
      <div className="text-3xl font-light tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-foreground/50">{hint}</div>}
    </Link>
  );
}
