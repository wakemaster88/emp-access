"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { RiderOpenRow } from "@/lib/riders-open";
import { ageFrom as age, fmtDay as fmtDate, RiderForm } from "./rider-form";

/**
 * Abos mit Kundenkonto, aber ohne Person („Fahrer offen“). Meist steht am
 * Kids-Abo das Geburtsdatum der Eltern. Hier sagt man, wer damit fährt:
 * eine Person des Kontos oder eine neue.
 */
export function RidersOpenCard({ rows }: { rows: RiderOpenRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [row, setRow] = useState<RiderOpenRow | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.ticketName.toLowerCase().includes(q) || r.email.includes(q) || r.aboName?.toLowerCase().includes(q)
        || r.persons.some((p) => p.name.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle>Fahrer offen ({rows.length})</CardTitle>
          <CardDescription>
            Wer mit diesen Abos fährt, ist unklar, meist steht am Kids-Abo das Geburtsdatum der Eltern.
            Trag den Fahrer hier oder an der Kasse ein.
          </CardDescription>
        </CardHeader>
        <div className="px-4 pb-3 sm:px-5">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="Name, E-Mail oder Abo suchen"
            aria-label="Name, E-Mail oder Abo suchen"
            containerClassName="sm:max-w-sm"
          />
        </div>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Am Abo steht</TableHead>
              <TableHead className="max-sm:hidden">Abo</TableHead>
              <TableHead className="text-right max-sm:hidden">Läuft bis</TableHead>
              <TableHead className="text-right">Eintragen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && <TableEmpty colSpan={4} title="Kein Abo gefunden." />}
            {shown.map((r) => {
              const a = age(r.ticketBirthDate);
              return (
                <TableRow key={r.id}>
                  <TableCell className="max-sm:whitespace-normal">
                    <div className="font-medium">
                      {r.ticketName}
                      {a != null && <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">({a})</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                      <span className="break-all">{r.email}</span>
                      <span className="sm:hidden">· {r.aboName ?? "Abo"} · bis {fmtDate(r.endDate)}</span>
                      {r.status === "PAUSED" && <Badge variant="warning">Pausiert</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="max-sm:hidden">{r.aboName ?? "–"}</TableCell>
                  <TableCell className="text-right tabular-nums max-sm:hidden">{fmtDate(r.endDate)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Fahrer für ${r.aboName ?? "Abo"} von ${r.ticketName} eintragen`}
                      className="max-sm:size-11"
                      onClick={() => setRow(r)}
                    >
                      <UserPlus />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={row != null} onOpenChange={(o) => !o && setRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fahrer eintragen</DialogTitle>
            <DialogDescription>
              {row
                ? `${row.aboName ?? "Abo"} · ${row.email}. Am Abo steht ${row.ticketName}`
                  + (row.ticketBirthDate ? `, geboren ${fmtDate(row.ticketBirthDate, "")}.` : ".")
                : ""}
            </DialogDescription>
          </DialogHeader>
          {row && (
            <RiderForm
              key={row.id}
              ticketId={row.id}
              persons={row.persons}
              initialLastName={row.lastName}
              onCancel={() => setRow(null)}
              onDone={() => {
                setRow(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
