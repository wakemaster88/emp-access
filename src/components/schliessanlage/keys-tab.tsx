"use client";

import { useMemo, useState } from "react";
import { Crown, KeyRound, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KeyBulkDialog } from "@/components/schliessanlage/key-bulk-dialog";
import { KeyDialog } from "@/components/schliessanlage/key-dialog";
import {
  EmptyHint,
  KeyStatusBadge,
  LevelBadge,
} from "@/components/schliessanlage/shared";
import type { KeyRow, LockOption } from "@/components/schliessanlage/types";
import { KEY_LEVEL_LABELS, KEY_STATUS_LABELS } from "@/lib/keying";
import { cn } from "@/lib/utils";

interface Props {
  keys: KeyRow[];
  lockOptions: LockOption[];
  readonly: boolean;
}

/** „Schließt“ kurz: bis zu zwei Schlösser, sonst das erste und die Zahl der weiteren. */
function lockSummary(labels: string[]): string {
  if (labels.length === 0) return "kein Schloss";
  if (labels.length <= 2) return labels.join(" · ");
  return `${labels[0]} +${labels.length - 1} weitere`;
}

/**
 * Kurze Nummern in Klammern („(T-071)“, „[V-0171]“) bleiben beim Umbruch zusammen – sonst bricht
 * der Browser nach dem Bindestrich („[V-“ / „0171]“). Längere Klammerinhalte dürfen weiter umbrechen.
 */
function keepCodes(text: string): React.ReactNode {
  return text.split(/([([][^\s()[\]]{1,12}[)\]])/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function KeysTab({ keys, lockOptions, readonly }: Props) {
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dialog, setDialog] = useState<{ keyItem: KeyRow | null } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keys.filter((k) => {
      if (levelFilter && k.level !== levelFilter) return false;
      if (statusFilter && k.status !== statusFilter) return false;
      if (!q) return true;
      return [k.keyNumber, k.label ?? "", ...k.lockLabels].join(" ").toLowerCase().includes(q);
    });
  }, [keys, query, levelFilter, statusFilter]);

  const grandCount = keys.filter((k) => k.level === "GRAND").length;
  const issuedCount = keys.filter((k) => k.status === "ISSUED").length;

  // Weitere Handlung „Serie“: ab sm neben der Primärtaste im Kopf, auf dem Handy in einer Zeile
  // unter dem Kopf, damit der Kopf nur die Primärtaste trägt (docs/design-regeln.md, Abschnitt 13).
  const bulkButton = (className: string) => (
    <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} className={className}>
      <Layers className="mr-1 h-3.5 w-3.5" />
      Serie
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="tabular-nums">
          {/* Neben der Taste bricht der Titel auf dem Handy um: Zahl und Wort bleiben zusammen. */}
          {keys.length} Schlüssel · <span className="whitespace-nowrap">{issuedCount} ausgegeben</span>
        </CardTitle>
        <CardDescription>
          Jede Kopie ist ein eigener Datensatz mit eigener Nummer.
          {grandCount > 0 && ` Davon ${grandCount} Generalschlüssel.`}
        </CardDescription>
        {!readonly && (
          <CardAction className="flex gap-2">
            {bulkButton("max-sm:hidden")}
            <Button
              size="sm"
              onClick={() => setDialog({ keyItem: null })}
              className="max-sm:h-11"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Schlüssel
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {!readonly && <div className="sm:hidden">{bulkButton("h-11")}</div>}
        <div className="flex flex-wrap gap-2">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nummer, Bezeichnung oder Schloss suchen…"
            containerClassName="min-w-48 flex-1 max-sm:basis-full"
            // text-ellipsis: auf dem Handy (16 px) passt der Platzhalter nicht ganz; Auslassung statt Abriss mitten im Wort.
            className="text-ellipsis max-sm:h-11"
          />
          {/* Filter in Inhaltsbreite (w-auto statt der vollen Breite von NativeSelect), auf dem Handy teilen sie sich die Zeile. */}
          <NativeSelect
            aria-label="Schlüsselart"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            containerClassName="w-auto max-sm:flex-1"
            className="max-sm:h-11"
          >
            <option value="">Alle Arten</option>
            {Object.entries(KEY_LEVEL_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            containerClassName="w-auto max-sm:flex-1"
            className="max-sm:h-11"
          >
            <option value="">Alle Status</option>
            {Object.entries(KEY_STATUS_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </div>

        {filtered.length === 0 ? (
          <EmptyHint icon={KeyRound}>
            {keys.length === 0
              ? "Noch keine Schlüssel angelegt."
              : "Keine Schlüssel passen zu den Filtern."}
          </EmptyHint>
        ) : (
          // Tabelle bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand ein.
          // Handy (326 px): nur Nummer und Status; Bezeichnung und Schließt stehen als Nebenzeilen
          // unter der Nummer, Art zeigt das Symbol (Krone = Generalschlüssel). Ab sm alle Spalten,
          // lange Texte brechen um statt die Tabelle zu verbreitern (docs/design-regeln.md, Abschnitt 17).
          <div className="-mx-4 sm:-mx-[18px]">
            <Table edge>
              <TableHeader>
                <TableRow>
                  <TableHead className="sm:w-32">Nummer</TableHead>
                  <TableHead className="max-sm:hidden">Bezeichnung</TableHead>
                  <TableHead className="w-36 max-sm:hidden">Art</TableHead>
                  {/* Auf dem Handy die letzte sichtbare Spalte: Randabstand wie die Karte. */}
                  <TableHead className="w-28 max-sm:pr-4">Status</TableHead>
                  <TableHead className="max-sm:hidden">Schließt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((k) => (
                  <TableRow
                    key={k.id}
                    onClick={() => !readonly && setDialog({ keyItem: k })}
                    className={cn("max-sm:h-11", !readonly && "cursor-pointer")}
                  >
                    <TableCell className="font-mono text-xs font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {k.level === "GRAND" ? (
                          <Crown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5 text-muted-foreground/70" />
                        )}
                        {k.keyNumber}
                      </span>
                      <div className="mt-0.5 space-y-0.5 font-sans text-xs font-normal whitespace-normal sm:hidden">
                        {(k.label || k.notes) && (
                          <p>
                            {k.label}
                            {k.notes && (
                              <span className="text-[11px] text-muted-foreground">
                                {k.label ? " · " : ""}
                                {k.notes}
                              </span>
                            )}
                          </p>
                        )}
                        <p className="text-muted-foreground">{keepCodes(lockSummary(k.lockLabels))}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal max-sm:hidden">
                      {k.label || <span className="text-muted-foreground">—</span>}
                      {k.notes && (
                        <span className="ml-1 text-[11px] text-muted-foreground">· {k.notes}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      <LevelBadge level={k.level} />
                    </TableCell>
                    <TableCell className="max-sm:pr-4">
                      <KeyStatusBadge status={k.status} />
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground max-sm:hidden sm:min-w-40">
                      {k.lockLabels.length > 2 ? (
                        <span title={k.lockLabels.join("\n")}>{keepCodes(lockSummary(k.lockLabels))}</span>
                      ) : (
                        keepCodes(lockSummary(k.lockLabels))
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {dialog && (
        <KeyDialog
          keyItem={dialog.keyItem}
          lockOptions={lockOptions}
          open
          onClose={() => setDialog(null)}
        />
      )}
      {bulkOpen && (
        <KeyBulkDialog lockOptions={lockOptions} open onClose={() => setBulkOpen(false)} />
      )}
    </Card>
  );
}
