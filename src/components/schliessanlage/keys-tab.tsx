"use client";

import { useMemo, useState } from "react";
import { Crown, KeyRound, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="tabular-nums">
              {keys.length} Schlüssel · {issuedCount} ausgegeben
            </CardTitle>
            <CardDescription>
              Jede Kopie ist ein eigener Datensatz mit eigener Nummer.
              {grandCount > 0 && ` Davon ${grandCount} Generalschlüssel.`}
            </CardDescription>
          </div>
          {!readonly && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} className="max-sm:h-11">
                <Layers className="mr-1 h-3.5 w-3.5" />
                Serie
              </Button>
              <Button
                size="sm"
                onClick={() => setDialog({ keyItem: null })}
                className="max-sm:h-11"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Schlüssel
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nummer, Bezeichnung oder Schloss suchen…"
            containerClassName="min-w-48 flex-1 max-sm:basis-full"
            className="max-sm:h-11"
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
          <div className="-mx-4 sm:-mx-[18px]">
            <Table edge>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Nummer</TableHead>
                  <TableHead>Bezeichnung</TableHead>
                  <TableHead className="w-36">Art</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Schließt</TableHead>
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
                    </TableCell>
                    <TableCell className="text-xs">
                      {k.label || <span className="text-muted-foreground">—</span>}
                      {k.notes && (
                        <span className="ml-1 text-[11px] text-muted-foreground">· {k.notes}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LevelBadge level={k.level} />
                    </TableCell>
                    <TableCell>
                      <KeyStatusBadge status={k.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lockLabels.length === 0 ? (
                        <span className="text-muted-foreground">kein Schloss</span>
                      ) : k.lockLabels.length <= 2 ? (
                        k.lockLabels.join(" · ")
                      ) : (
                        <span title={k.lockLabels.join("\n")}>
                          {k.lockLabels[0]} +{k.lockLabels.length - 1} weitere
                        </span>
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
