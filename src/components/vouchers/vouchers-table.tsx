"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Copy, Check, ArrowUpDown } from "lucide-react";
import { fmtDateTimeShort } from "@/lib/utils";

export interface VoucherRow {
  id: number;
  code: string;
  ticketTypeName: string | null;
  serviceName: string | null;
  accessAreaName: string | null;
  discountPercent: number | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  createdAt: string;
  redeemedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  sourceTicketId: number | null;
  redeemedTicketId: number | null;
}

interface Props {
  vouchers: VoucherRow[];
  currentQuery: string;
  currentStatus: string;
  currentSort: string;
  currentOrder: string;
}

function statusBadge(v: VoucherRow) {
  if (v.redeemedAt) {
    return (
      <Badge className="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-normal">
        Eingelöst
      </Badge>
    );
  }
  if (v.expiresAt && new Date(v.expiresAt) < new Date()) {
    return (
      <Badge className="bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 font-normal">
        Abgelaufen
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 font-normal">
      Offen
    </Badge>
  );
}

function validityLabel(v: VoucherRow): string {
  if (v.validityType === "DURATION" && v.validityDurationMinutes) {
    const mins = v.validityDurationMinutes;
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60} h`;
    return `${mins} Min`;
  }
  if (v.validityType === "DATE_RANGE") return "Tag";
  if (v.validityType === "TIME_SLOT") return "Slot";
  return "—";
}

export function VouchersTable({
  vouchers,
  currentQuery,
  currentStatus,
  currentSort,
  currentOrder,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(currentQuery);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Debounce search → URL
  useEffect(() => {
    const id = setTimeout(() => {
      if (search === currentQuery) return;
      const next = new URLSearchParams(params.toString());
      if (search.trim()) next.set("q", search.trim());
      else next.delete("q");
      router.replace(`/vouchers?${next.toString()}`);
    }, 300);
    return () => clearTimeout(id);
  }, [search, currentQuery, params, router]);

  function toggleSort(column: string) {
    const next = new URLSearchParams(params.toString());
    if (currentSort === column) {
      next.set("order", currentOrder === "asc" ? "desc" : "asc");
    } else {
      next.set("sort", column);
      next.set("order", "desc");
    }
    router.push(`/vouchers?${next.toString()}`);
  }

  async function copy(id: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // Clipboard nicht verfuegbar (z.B. iOS ohne Permission) -> ignorieren
    }
  }

  const sortIcon = (column: string) =>
    currentSort === column ? (
      <ArrowUpDown className="h-3 w-3 opacity-100" />
    ) : (
      <ArrowUpDown className="h-3 w-3 opacity-30" />
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, Ticket-Typ oder Notiz suchen…"
            className="pl-9"
          />
        </div>
      </div>

      {vouchers.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400">
          {currentQuery
            ? `Keine Gutscheine für "${currentQuery}" gefunden.`
            : currentStatus === "redeemed"
              ? "Noch kein Gutschein wurde eingelöst."
              : currentStatus === "open"
                ? "Es sind keine offenen Gutscheine vorhanden."
                : currentStatus === "expired"
                  ? "Keine abgelaufenen Gutscheine."
                  : "Es wurden noch keine Gutscheine erstellt."}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow className="bg-slate-50 dark:bg-slate-900/50">
                <TableHead>
                  <button
                    onClick={() => toggleSort("code")}
                    className="flex items-center gap-1 text-xs font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    Code {sortIcon("code")}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => toggleSort("ticketType")}
                    className="flex items-center gap-1 text-xs font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    Ticket-Typ {sortIcon("ticketType")}
                  </button>
                </TableHead>
                <TableHead className="text-xs font-medium">Bereich</TableHead>
                <TableHead className="text-xs font-medium">Gültigkeit</TableHead>
                <TableHead className="text-xs font-medium">Status</TableHead>
                <TableHead>
                  <button
                    onClick={() => toggleSort("createdAt")}
                    className="flex items-center gap-1 text-xs font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    Erstellt {sortIcon("createdAt")}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => toggleSort("redeemedAt")}
                    className="flex items-center gap-1 text-xs font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    Eingelöst {sortIcon("redeemedAt")}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    onClick={() => toggleSort("expiresAt")}
                    className="flex items-center gap-1 text-xs font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    Verfällt {sortIcon("expiresAt")}
                  </button>
                </TableHead>
                <TableHead className="text-xs font-medium">Notiz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => copy(v.id, v.code)}
                      className="inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 group"
                      title="Kopieren"
                    >
                      <span>{v.code}</span>
                      {copiedId === v.id ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.ticketTypeName ?? v.serviceName ?? (
                      <span className="text-slate-400">—</span>
                    )}
                    {v.discountPercent ? (
                      <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">
                        −{v.discountPercent}%
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.accessAreaName ?? (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="text-slate-600 dark:text-slate-300">
                      {validityLabel(v)}
                    </span>
                  </TableCell>
                  <TableCell>{statusBadge(v)}</TableCell>
                  <TableCell className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {fmtDateTimeShort(v.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {v.redeemedAt ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {fmtDateTimeShort(v.redeemedAt)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {v.expiresAt ? (
                      new Date(v.expiresAt) < new Date() && !v.redeemedAt ? (
                        <span className="text-rose-600 dark:text-rose-400">
                          {fmtDateTimeShort(v.expiresAt)}
                        </span>
                      ) : (
                        fmtDateTimeShort(v.expiresAt)
                      )
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                    {v.notes ?? <span className="text-slate-400">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
