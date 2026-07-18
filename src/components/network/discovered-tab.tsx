"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Radar } from "lucide-react";

export interface DiscoveredRow {
  id: number;
  macAddress: string;
  ipAddress: string | null;
  iface: string | null;
  hubName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

function formatSeen(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} min`;
  if (diffMin < 60 * 24) return `vor ${Math.floor(diffMin / 60)} h`;
  return new Date(iso).toLocaleDateString("de-DE");
}

export function DiscoveredTab({ devices }: { devices: DiscoveredRow[] }) {
  // "Aktiv" = im letzten Scan-Fenster gesehen (15 min Toleranz).
  const activeCutoff = Date.now() - 15 * 60_000;

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-4">
        <CardTitle className="text-base sm:text-xl flex items-center gap-2">
          <Radar className="h-5 w-5 text-violet-500" />
          Vom Hub entdeckte Geräte ({devices.length})
        </CardTitle>
        <p className="text-xs text-slate-500">
          Wird automatisch vom lokalen Hub per Netzwerk-Scan aktualisiert.
        </p>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        {devices.length === 0 ? (
          <p className="text-sm text-slate-500 px-6 pb-6 sm:px-0">
            Noch keine Geräte gemeldet. Läuft der Hub und ist das Modul
            „auto-scan“ aktiv?
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[130px]">IP-Adresse</TableHead>
                  <TableHead className="min-w-[160px]">MAC-Adresse</TableHead>
                  <TableHead className="hidden sm:table-cell">Interface</TableHead>
                  <TableHead className="hidden md:table-cell">Hub</TableHead>
                  <TableHead>Zuletzt gesehen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => {
                  const active = new Date(d.lastSeenAt).getTime() > activeCutoff;
                  return (
                    <TableRow key={d.id} className="border-slate-200 dark:border-slate-700">
                      <TableCell>
                        {active ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> aktiv
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> inaktiv
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{d.ipAddress ?? "–"}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">{d.macAddress}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-slate-500">{d.iface ?? "–"}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-slate-500">{d.hubName ?? "–"}</TableCell>
                      <TableCell className="text-sm text-slate-500">{formatSeen(d.lastSeenAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
