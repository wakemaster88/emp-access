"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Filter, CreditCard, Package } from "lucide-react";
import { cn } from "@/lib/utils";

const SORT_OPTIONS = [
  { value: "date_desc", label: "Neueste zuerst", sort: "date", order: "desc" as const },
  { value: "date_asc", label: "Älteste zuerst", sort: "date", order: "asc" as const },
  { value: "name_asc", label: "Name A–Z", sort: "name", order: "asc" as const },
  { value: "name_desc", label: "Name Z–A", sort: "name", order: "desc" as const },
  { value: "resource_asc", label: "Resource A–Z", sort: "resource", order: "asc" as const },
  { value: "resource_desc", label: "Resource Z–A", sort: "resource", order: "desc" as const },
  { value: "status_asc", label: "Status A–Z", sort: "status", order: "asc" as const },
  { value: "status_desc", label: "Status Z–A", sort: "status", order: "desc" as const },
] as const;

const SOURCE_OPTIONS = [
  { value: "all", label: "Alle Quellen" },
  { value: "Eigenes", label: "Eigenes" },
  { value: "ANNY", label: "anny" },
  { value: "WAKESYS", label: "wakesys" },
  { value: "EMP_CONTROL", label: "emp-control" },
  { value: "BINARYTEC", label: "binarytec" },
  { value: "SHELLY", label: "shelly" },
] as const;

interface SubOption {
  id: number;
  name: string;
}

interface SvcOption {
  id: number;
  name: string;
}

export function TicketSortFilter({
  currentSort,
  currentOrder,
  currentSource,
  currentSub,
  currentSvc,
  subscriptions = [],
  services = [],
}: {
  currentSort: string;
  currentOrder: string;
  currentSource: string;
  currentSub?: string;
  currentSvc?: string;
  subscriptions?: SubOption[];
  services?: SvcOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortValue = SORT_OPTIONS.find(
    (o) => o.sort === currentSort && o.order === currentOrder
  )?.value ?? "date_desc";

  function updateParams(updates: { sort?: string; order?: string; source?: string; sub?: string; svc?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (updates.sort !== undefined) params.set("sort", updates.sort);
    if (updates.order !== undefined) params.set("order", updates.order);
    if (updates.source !== undefined) {
      if (updates.source === "all") params.delete("source");
      else params.set("source", updates.source);
    }
    if (updates.sub !== undefined) {
      if (updates.sub === "none") params.delete("sub");
      else params.set("sub", updates.sub);
    }
    if (updates.svc !== undefined) {
      if (updates.svc === "none") params.delete("svc");
      else params.set("svc", updates.svc);
    }
    router.push(`/tickets${params.toString() ? `?${params}` : ""}`);
  }

  function handleSortChange(value: string) {
    const opt = SORT_OPTIONS.find((o) => o.value === value);
    if (opt) updateParams({ sort: opt.sort, order: opt.order });
  }

  function handleSourceChange(value: string) {
    updateParams({ source: value });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={sortValue} onValueChange={handleSortChange}>
        <SelectTrigger className="w-[180px] h-9 text-sm">
          <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-slate-400 shrink-0" />
          <SelectValue placeholder="Sortieren" />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={currentSource || "all"} onValueChange={handleSourceChange}>
        <SelectTrigger className="w-[160px] h-9 text-sm">
          <Filter className="h-3.5 w-3.5 mr-1.5 text-slate-400 shrink-0" />
          <SelectValue placeholder="Quelle" />
        </SelectTrigger>
        <SelectContent>
          {SOURCE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {subscriptions.length > 0 && (
        <Select value={currentSub || "none"} onValueChange={(v) => updateParams({ sub: v })}>
          <SelectTrigger className={cn("w-[170px] h-9 text-sm", currentSub && "border-indigo-300 dark:border-indigo-700")}>
            <CreditCard className="h-3.5 w-3.5 mr-1.5 text-slate-400 shrink-0" />
            <SelectValue placeholder="Alle Abos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Alle</SelectItem>
            <SelectItem value="all">Alle Abos</SelectItem>
            {subscriptions.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {services.length > 0 && (
        <Select value={currentSvc || "none"} onValueChange={(v) => updateParams({ svc: v })}>
          <SelectTrigger className={cn("w-[170px] h-9 text-sm", currentSvc && "border-indigo-300 dark:border-indigo-700")}>
            <Package className="h-3.5 w-3.5 mr-1.5 text-slate-400 shrink-0" />
            <SelectValue placeholder="Alle Services" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Alle</SelectItem>
            <SelectItem value="all">Alle Services</SelectItem>
            {services.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
