import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { AssetsView, CreateAssetButton, type AssetData } from "@/components/warenwirtschaft/assets-view";
import { ASSET_GROUPS, assetYears, defaultAssetYear } from "@/lib/warenwirtschaft";
import { WawiImportButton } from "@/components/warenwirtschaft/import-button";
import { wawiPageSession } from "../wawi-page";
import { CountLinkCard } from "@/components/warenwirtschaft/count-link-card";

export default async function InventarPage({ searchParams }: { searchParams: Promise<{ blatt?: string }> }) {
  const { session, accountId, db } = await wawiPageSession();
  const groupRows = await db.inventoryAsset.groupBy({ by: ["group"], where: { accountId }, _count: { _all: true } });
  const counts = new Map(groupRows.map((g) => [g.group, g._count._all]));
  const groups = [...ASSET_GROUPS, ...[...counts.keys()].filter((g) => !(ASSET_GROUPS as readonly string[]).includes(g)).sort()];
  const requested = (await searchParams).blatt;
  const group = requested && groups.includes(requested) ? requested : groups[0];

  const rows = await db.inventoryAsset.findMany({
    where: { accountId, group },
    include: { counts: { select: { year: true, quantity: true } } },
    orderBy: [{ location: "asc" }, { name: "asc" }],
  });
  const assets: AssetData[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    group: a.group,
    location: a.location,
    deviceNumber: a.deviceNumber,
    lastInspection: a.lastInspection?.toISOString() ?? null,
    note: a.note,
    image: a.image,
    counts: Object.fromEntries(a.counts.map((c) => [c.year, c.quantity])),
  }));
  const year = defaultAssetYear();
  const link = await db.inventoryCountLink.findFirst({ where: { accountId, group }, select: { token: true, expiresAt: true, year: true } });
  const locations = [...new Set(assets.map((a) => a.location).filter((l): l is string => !!l))];

  return (
    <>
      <Header title="Inventar" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <SegmentedLinks
          aria-label="Blatt"
          value={group}
          options={groups.map((g) => ({ value: g, label: g, count: counts.get(g) ?? 0, href: `/warenwirtschaft/inventar?blatt=${encodeURIComponent(g)}` }))}
        />
        <CountLinkCard
          key={`link-${group}`}
          title={`Zählen am Handy · ${group}`}
          token={link?.token ?? null}
          expiresAt={link?.expiresAt.toISOString() ?? null}
          path="/zaehlen/inventar/"
          createUrl="/api/warenwirtschaft/inventory-links"
          createBody={{ group, year }}
          revokeUrl={`/api/warenwirtschaft/inventory-links?group=${encodeURIComponent(group)}`}
          description={`Eigener Link für das Blatt ${group}: Mitarbeiter zählen ohne Anmeldung die Mengen für ${link?.year ?? year}, sehen das Vorjahr und können fehlende Posten und Fotos ergänzen.`}
        />
        <Card flush>
          <CardHeader>
            <CardTitle>{group}&nbsp;({assets.length})</CardTitle>
            <CardDescription>Inventarverzeichnis: Geräte und Ausstattung mit Menge je Inventurjahr, wie in der Excel-Vorlage.</CardDescription>
            <CardAction>
              <CreateAssetButton group={group} groups={groups} locations={locations} years={assetYears(assets, year)} />
            </CardAction>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <div className="px-4 pb-4 sm:px-[18px]">
              <WawiImportButton hint="Inventarliste mit Blättern je Bereich und Spalten „Gerätenummer“, „Bereich“, „Menge 2025“." />
            </div>
            <AssetsView key={group} assets={assets} group={group} groups={groups} defaultYear={year} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
