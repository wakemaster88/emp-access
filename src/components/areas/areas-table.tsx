"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconChip } from "@/components/ui/icon-chip";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { buildAreaTree, filterAreaTree, formatScanLock } from "@/lib/area-tree";
import { AreaDialog, type AreaData, type AreaDevice, type AreaDialogTab } from "./area-dialog";
import {
  Cpu,
  Eye,
  Layers,
  LogIn,
  LogOut,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Ticket,
  Trash2,
} from "lucide-react";

interface DeviceRef {
  id: number;
  name: string;
}

export interface AreaRow extends AreaData {
  devicesIn: DeviceRef[];
  devicesOut: DeviceRef[];
  ticketCount: number;
}

interface AreasCardProps {
  areas: AreaRow[];
  /** Geräte, die Einlass oder Auslass einer Ressource sein können (Reiter „Geräte“). */
  devices?: AreaDevice[];
  readonly?: boolean;
  annyResources?: string[];
  annyServices?: string[];
  annyMappings?: Record<string, number>;
  /** Einlass-Regel „Tickets ohne Bereich …“ ist an (sonst Hinweis am Haken im Dialog). */
  ticketNeedsAreaOn?: boolean;
}

type Filter = "all" | "devices" | "none";

type DialogState =
  | { open: false }
  | { open: true; area: AreaData | null; parentId?: number | null; tab?: AreaDialogTab; askDelete?: boolean };

function toAreaData(a: AreaRow): AreaData {
  return {
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    allowReentry: a.allowReentry,
    personLimit: a.personLimit,
    scanLockSeconds: a.scanLockSeconds,
    allowUnassignedTickets: a.allowUnassignedTickets,
    showOnDashboard: a.showOnDashboard,
    openingHours: a.openingHours,
  };
}

const MAX_BADGES = 2;

/** Eine Richtung (Einlass oder Auslass) als Symbol plus Geräte-Pillen. */
function DeviceLine({ icon: Icon, label, devices }: { icon: typeof LogIn; label: string; devices: DeviceRef[] }) {
  if (devices.length === 0) return null;
  const show = devices.slice(0, MAX_BADGES);
  const rest = devices.length - show.length;
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <Icon className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-label={label} />
      <div className="flex min-w-0 flex-wrap gap-1">
        {show.map((d) => (
          <Badge key={d.id} variant="secondary" className="max-w-48 truncate font-medium">{d.name}</Badge>
        ))}
        {rest > 0 && (
          <Badge variant="neutral" className="tabular-nums" title={devices.slice(MAX_BADGES).map((d) => d.name).join(", ")}>
            +{rest}
          </Badge>
        )}
      </div>
    </div>
  );
}

/** Regeln einer Ressource als ruhige Pillen: Wiedereinlass, Sperrzeit, Limit. */
function RuleBadges({ area }: { area: AreaRow }) {
  const lock = formatScanLock(area.scanLockSeconds);
  return (
    <div className="flex flex-wrap gap-1">
      {area.allowReentry
        ? <Badge variant="success">Wiedereinlass</Badge>
        : <Badge variant="neutral">Einmalig</Badge>}
      {lock && <Badge variant="outline" className="tabular-nums">Sperre {lock}</Badge>}
      {area.personLimit != null && area.personLimit > 0 && (
        <Badge variant="outline" className="tabular-nums">max. {area.personLimit.toLocaleString("de-DE")}</Badge>
      )}
    </div>
  );
}

/** Kurzfassung für die Nebenzeile auf schmalen Bildschirmen. */
function mobileSummary(area: AreaRow): string {
  const parts: string[] = [];
  const nIn = area.devicesIn.length;
  const nOut = area.devicesOut.length;
  if (nIn + nOut === 0) parts.push("kein Gerät");
  else {
    if (nIn) parts.push(`${nIn} Einlass`);
    if (nOut) parts.push(`${nOut} Auslass`);
  }
  parts.push(area.allowReentry ? "Wiedereinlass" : "einmalig");
  if (area.personLimit) parts.push(`max. ${area.personLimit.toLocaleString("de-DE")}`);
  return parts.join(" · ");
}

/**
 * Seite „Ressourcen“: eine Karte mit dem Baum aller Ressourcen.
 *
 * Hauptressourcen stehen mit ihren Unterressourcen direkt darunter (eingerückt
 * mit Baumlinie), statt nach `parentId` sortiert am Ende der Liste. Geräte
 * stehen in einer Spalte (Einlass/Auslass als Symbol), die Regeln als Pillen.
 * Antippen der Zeile öffnet die Detailseite `/areas/[id]`; Seltenes (Unterressource anlegen,
 * Geräte zuordnen, Löschen) liegt im Mehr-Menü.
 */
export function AreasCard({ areas, devices = [], readonly, annyResources, annyServices, annyMappings, ticketNeedsAreaOn = false }: AreasCardProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const tree = useMemo(() => buildAreaTree(areas), [areas]);
  const allAreaData = useMemo(() => areas.map(toAreaData), [areas]);
  const deviceNames = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices]);

  const hasDevices = (a: AreaRow) => a.devicesIn.length + a.devicesOut.length > 0;
  const withDevices = areas.filter(hasDevices).length;
  const subCount = tree.filter((r) => r.depth > 0).length;
  const showFilters = areas.length > 5;

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("de");
    if (!q && filter === "all") return tree;
    return filterAreaTree(tree, (a) => {
      if (filter === "devices" && !hasDevices(a)) return false;
      if (filter === "none" && hasDevices(a)) return false;
      if (!q) return true;
      if (a.name.toLocaleLowerCase("de").includes(q)) return true;
      return [...a.devicesIn, ...a.devicesOut].some((d) =>
        (deviceNames.get(d.id) ?? d.name).toLocaleLowerCase("de").includes(q),
      );
    });
  }, [tree, query, filter, deviceNames]);

  // Bei Suche/Filter stehen Vorfahren als Kontext in der Liste; sie sind
  // selbst kein Treffer und werden leiser gezeigt.
  const isContextRow = (a: AreaRow) => {
    if (!query.trim() && filter === "all") return false;
    const q = query.trim().toLocaleLowerCase("de");
    const filterHit = filter === "all" || (filter === "devices") === hasDevices(a);
    const queryHit = !q
      || a.name.toLocaleLowerCase("de").includes(q)
      || [...a.devicesIn, ...a.devicesOut].some((d) => d.name.toLocaleLowerCase("de").includes(q));
    return !(filterHit && queryHit);
  };

  const openEdit = (a: AreaRow, tab?: AreaDialogTab) => setDialog({ open: true, area: toAreaData(a), tab });
  const openCreate = (parentId: number | null = null) => setDialog({ open: true, area: null, parentId });

  return (
    // Tabelle läuft unten bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17).
    <Card flush>
      <CardHeader>
        <CardTitle>Alle Ressourcen ({areas.length})</CardTitle>
        <CardDescription>
          {subCount > 0 ? `${areas.length - subCount} Haupt- und ${subCount} Unterressourcen, ${withDevices} mit Gerät. ` : `${withDevices} mit Gerät. `}
          <Link href="/services" className="text-primary hover:underline">Services</Link> und{" "}
          <Link href="/subscriptions" className="text-primary hover:underline">Abos</Link> geben Ressourcen für{" "}
          <Link href="/tickets" className="text-primary hover:underline">Tickets</Link> frei.
        </CardDescription>
        {/* Primärhandlung oben rechts im Kartenkopf (docs/design-regeln.md, Abschnitt 13). */}
        {!readonly && (
          <CardAction>
            <Button onClick={() => openCreate()} className="max-sm:h-11" aria-label="Ressource anlegen">
              <Plus className="h-4 w-4" />
              <span>Ressource<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              placeholder="Ressource oder Gerät suchen"
              aria-label="Ressource oder Gerät suchen"
              containerClassName="sm:max-w-72"
            />
            <Segmented<Filter>
              value={filter}
              onValueChange={setFilter}
              aria-label="Nach Geräten filtern"
              size="sm"
              className="max-sm:w-full sm:w-auto"
              stretch
              options={[
                { value: "all", label: "Alle" },
                { value: "devices", label: "Mit Gerät", count: withDevices },
                { value: "none", label: "Ohne Gerät", count: areas.length - withDevices },
              ]}
            />
          </div>
        )}

        {/* Bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand der Karte ein (`Table edge`). */}
        <div className="-mx-4 sm:-mx-[18px]">
          <Table edge>
            <TableHeader>
              <TableRow>
                <TableHead>Ressource</TableHead>
                <TableHead className="hidden md:table-cell">Geräte</TableHead>
                <TableHead className="hidden sm:table-cell">Regeln</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                {!readonly && <TableHead className="w-10"><span className="sr-only">Aktionen</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {areas.length === 0 && (
                <TableEmpty
                  colSpan={5}
                  icon={MapPin}
                  title="Noch keine Ressourcen angelegt."
                  description="Lege eine Ressource an, um Einlass und Auslass zu steuern."
                  compact={false}
                />
              )}
              {areas.length > 0 && rows.length === 0 && (
                <TableEmpty colSpan={5} icon={MapPin} title="Keine Ressource passt zur Suche." />
              )}
              {rows.map(({ area, depth, childCount }) => {
                const context = isContextRow(area);
                return (
                  <TableRow
                    key={area.id}
                    className={cn(
                      "max-sm:h-14",
                      !readonly && "cursor-pointer",
                      depth === 0 && childCount > 0 && "bg-glass-tile/60",
                    )}
                    onClick={() => !readonly && router.push(`/areas/${area.id}`)}
                  >
                    {/* Name mit Einrückung je Ebene; Handy: Kurzfassung als Nebenzeile. Lange Namen brechen um. */}
                    <TableCell className="max-w-0 w-full whitespace-normal py-2 md:w-auto md:max-w-none md:min-w-48">
                      <div className="flex min-w-0 items-center gap-2.5" style={{ paddingLeft: depth * 22 }}>
                        {depth > 0 && (
                          <span aria-hidden className="-ml-3.5 h-5 w-2.5 shrink-0 self-start rounded-bl-md border-b border-l border-border" />
                        )}
                        <IconChip
                          icon={childCount > 0 ? Layers : MapPin}
                          tone={hasDevices(area) ? "primary" : "neutral"}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className={cn("text-pretty font-medium", context ? "text-muted-foreground" : "text-foreground")}>
                            {readonly ? area.name : (
                              // Echter Link für Tastatur, Mittelklick und Screenreader; die ganze Zeile führt ebenfalls hin.
                              <Link href={`/areas/${area.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus-visible:underline">
                                {area.name}
                              </Link>
                            )}
                          </p>
                          {childCount > 0 && (
                            <p className="text-[11px] text-muted-foreground max-sm:hidden">
                              {childCount === 1 ? "1 Unterressource" : `${childCount} Unterressourcen`}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground sm:hidden">{mobileSummary(area)}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-2 md:table-cell">
                      {hasDevices(area) ? (
                        <div className="space-y-1">
                          <DeviceLine icon={LogIn} label="Einlass" devices={area.devicesIn} />
                          <DeviceLine icon={LogOut} label="Auslass" devices={area.devicesOut} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Kein Gerät</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden py-2 sm:table-cell sm:whitespace-normal">
                      <RuleBadges area={area} />
                    </TableCell>
                    <TableCell className={cn("text-right", readonly && "max-sm:pr-4")}>
                      {area.ticketCount > 0 ? (
                        <Link
                          href={`/tickets?area=${area.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex min-h-11 items-center justify-end gap-1 text-sm font-medium tabular-nums text-primary hover:underline sm:min-h-0"
                          aria-label={`${area.ticketCount} Tickets in ${area.name}`}
                        >
                          {area.ticketCount.toLocaleString("de-DE")}
                        </Link>
                      ) : (
                        <span className="text-sm tabular-nums text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    {!readonly && (
                      <TableCell className="w-10 py-1 pl-1" onClick={(e) => e.stopPropagation()}>
                        {/* Seltenes liegt einen Tipp tiefer (Abschnitt 1, Grundsatz 4). */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Weitere Aktionen für ${area.name}`}
                              title="Mehr"
                              className="h-11 w-11 sm:h-8 sm:w-8"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-56">
                            <DropdownMenuItem asChild>
                              <Link href={`/areas/${area.id}`}>
                                <Eye />
                                Details öffnen
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openEdit(area)}>
                              <Pencil />
                              Schnell bearbeiten
                            </DropdownMenuItem>
                            {devices.length > 0 && (
                              <DropdownMenuItem onSelect={() => openEdit(area, "devices")}>
                                <Cpu />
                                Geräte zuordnen
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => openCreate(area.id)}>
                              <Plus />
                              Unterressource anlegen
                            </DropdownMenuItem>
                            {area.ticketCount > 0 && (
                              <DropdownMenuItem asChild>
                                <Link href={`/tickets?area=${area.id}`}>
                                  <Ticket />
                                  Tickets ansehen
                                </Link>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ open: true, area: toAreaData(area), askDelete: true })}>
                              <Trash2 />
                              Löschen …
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {!readonly && (
        <AreaDialog
          open={dialog.open}
          area={dialog.open ? dialog.area : null}
          presetParentId={dialog.open ? dialog.parentId ?? null : null}
          initialTab={dialog.open ? dialog.tab : undefined}
          askDelete={dialog.open && !!dialog.askDelete}
          allAreas={allAreaData}
          devices={devices}
          annyResources={annyResources}
          annyServices={annyServices}
          annyMappings={annyMappings}
          ticketNeedsAreaOn={ticketNeedsAreaOn}
          onClose={() => setDialog({ open: false })}
        />
      )}
    </Card>
  );
}
