"use client";

import Link from "next/link";
import { Activity, Car, Cctv, ParkingSquare, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { type DashboardLive, fmtAgo } from "@/components/dashboard/live-section";

const LINK_CLASS =
  "rounded-[10px] text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";
const LIST_CLASS = "divide-y divide-border/60 px-2 sm:px-2.5";
const ROW_CLASS = "flex min-h-11 items-center gap-2 px-2 py-2";

function parts(...items: (string | false | null | undefined)[]): string {
  return items.filter(Boolean).join(" · ");
}

/**
 * Zweiter Block des Dashboards: was die Kameras heute erkannt haben
 * (Personen, Fahrzeuge) und wo sich in der letzten Stunde etwas bewegt hat.
 * Ohne Bilder – die stehen auf den Detailseiten.
 */
export function TrackingSection({ live, now }: { live: DashboardLive; now: number }) {
  const { persons, vehicles, movement, parking } = live.tracking;
  const busiest = movement.cameras[0];

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          href="/personen"
          label="Personen heute"
          icon={UserRound}
          tone={persons.blocked > 0 ? "danger" : "info"}
          value={persons.today}
          suffix="Sichtungen"
          hint={
            persons.today === 0
              ? "noch niemand erkannt"
              : parts(
                  persons.blocked > 0 && `${persons.blocked} gesperrt`,
                  `${persons.known} bekannt`,
                  `${persons.unknown} unbekannt`,
                )
          }
        />
        <StatCard
          href="/fahrzeuge"
          label="Fahrzeuge heute"
          icon={Car}
          tone={vehicles.unmatched > 0 ? "warning" : "info"}
          value={vehicles.today}
          suffix="Sichtungen"
          hint={
            vehicles.today === 0
              ? "noch kein Fahrzeug"
              : parts(
                  `${vehicles.matched} zugeordnet`,
                  `${vehicles.unmatched} offen`,
                  vehicles.delivery > 0 && `${vehicles.delivery} Lieferdienst`,
                )
          }
        />
        <StatCard
          href="/cameras"
          label="Bewegungen"
          icon={Activity}
          tone={movement.last60 > 0 ? "live" : "neutral"}
          value={movement.last60}
          suffix="in 60 Min."
          hint={busiest ? `zuletzt ${busiest.name}, ${fmtAgo(busiest.lastAt, now)}` : "nichts in der letzten Stunde"}
        />
        {parking ? (
          <StatCard
            href="/fahrzeuge"
            label="Parkplatz"
            icon={ParkingSquare}
            tone={parking.trackerOnline ? "info" : "warning"}
            value={parking.total}
            suffix="belegt"
            hint={
              parking.trackerOnline
                ? parking.lots.map((l) => `${l.name}: ${l.count}`).join(" · ")
                : "Zählung steht, letzter Stand"
            }
          />
        ) : (
          <StatCard
            href="/cameras"
            label="Aktive Kameras"
            icon={Cctv}
            tone="neutral"
            value={movement.cameras.length}
            suffix="mit Bewegung"
            hint={
              movement.cameras.length > 0
                ? movement.cameras
                    .slice(0, 3)
                    .map((c) => c.name)
                    .join(" · ")
                : "alle ruhig"
            }
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Personen
            </CardTitle>
            <CardAction>
              <Link href="/personen" className={LINK_CLASS}>
                Alle
              </Link>
            </CardAction>
          </CardHeader>
          <div className={LIST_CLASS}>
            {persons.latest.length === 0 ? (
              <EmptyState compact icon={UserRound} title="Heute noch keine Person erkannt" />
            ) : (
              persons.latest.map((p) => (
                <div key={p.id} className={ROW_CLASS}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground/90">{p.name || "Unbekannte Person"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {parts(p.cameraName || "Kamera unbekannt", fmtAgo(p.seenAt, now))}
                    </p>
                  </div>
                  {p.listType === "BLACKLIST" ? (
                    <Badge variant="danger">Gesperrt</Badge>
                  ) : p.name ? (
                    <Badge variant="success">Bekannt</Badge>
                  ) : (
                    <Badge variant="neutral">Unbekannt</Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Fahrzeuge
            </CardTitle>
            <CardAction>
              <Link href="/fahrzeuge" className={LINK_CLASS}>
                Alle
              </Link>
            </CardAction>
          </CardHeader>
          <div className={LIST_CLASS}>
            {vehicles.latest.length === 0 ? (
              <EmptyState compact icon={Car} title="Heute noch kein Fahrzeug erkannt" />
            ) : (
              vehicles.latest.map((v) => (
                <div key={v.id} className={ROW_CLASS}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground/90">
                      {v.name || v.deliveryBrand || (v.plate ? "" : "Ohne Kennzeichen")}
                      {v.plate && (
                        <span className={v.name || v.deliveryBrand ? "ml-1.5 font-mono text-muted-foreground" : "font-mono"}>
                          {v.plate}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {parts(v.cameraName || "Kamera unbekannt", fmtAgo(v.seenAt, now), v.opened && "Tor geöffnet")}
                    </p>
                  </div>
                  {v.noParking ? (
                    <Badge variant="danger">Halteverbot</Badge>
                  ) : v.deliveryBrand ? (
                    <Badge variant="info">Lieferdienst</Badge>
                  ) : v.matched ? (
                    <Badge variant="success">Zugeordnet</Badge>
                  ) : (
                    <Badge variant="warning">Offen</Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Cctv className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Bewegung an den Kameras
            </CardTitle>
            <CardAction>
              <Link href="/cameras" className={LINK_CLASS}>
                Alle
              </Link>
            </CardAction>
          </CardHeader>
          <div className={LIST_CLASS}>
            {movement.cameras.length === 0 ? (
              <EmptyState compact icon={Cctv} title="Keine Bewegung in der letzten Stunde" />
            ) : (
              movement.cameras.map((c) => (
                <div key={c.id} className={ROW_CLASS}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground/90">{c.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {parts(
                        c.person > 0 && `${c.person} ${c.person === 1 ? "Person" : "Personen"}`,
                        c.vehicle > 0 && `${c.vehicle} ${c.vehicle === 1 ? "Fahrzeug" : "Fahrzeuge"}`,
                        c.other > 0 && `${c.other} sonstige`,
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {fmtAgo(c.lastAt, now)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
