"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Search,
  Copy,
  Check,
  ArrowUpDown,
  Pencil,
  Ban,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { fmtDateTimeShort } from "@/lib/utils";

export interface VoucherRow {
  id: number;
  code: string;
  ticketTypeName: string | null;
  serviceId: number | null;
  serviceName: string | null;
  accessAreaId: number | null;
  accessAreaName: string | null;
  discountPercent: number | null;
  validityType: string | null;
  validityDurationMinutes: number | null;
  createdAt: string;
  redeemedAt: string | null;
  expiresAt: string | null;
  disabledAt: string | null;
  notes: string | null;
  sourceTicketId: number | null;
  redeemedTicketId: number | null;
}

interface OptionItem {
  id: number;
  name: string;
}

interface Props {
  vouchers: VoucherRow[];
  services: OptionItem[];
  accessAreas: OptionItem[];
  currentQuery: string;
  currentStatus: string;
  currentSort: string;
  currentOrder: string;
}

function statusBadge(v: VoucherRow) {
  if (v.disabledAt) {
    return (
      <Badge className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700 font-normal">
        Deaktiviert
      </Badge>
    );
  }
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

function validityLabel(v: { validityType: string | null; validityDurationMinutes: number | null }): string {
  if (v.validityType === "DURATION" && v.validityDurationMinutes) {
    const mins = v.validityDurationMinutes;
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60} h`;
    return `${mins} Min`;
  }
  if (v.validityType === "DATE_RANGE") return "Tag";
  if (v.validityType === "TIME_SLOT") return "Slot";
  return "—";
}

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function VouchersTable({
  vouchers,
  services,
  accessAreas,
  currentQuery,
  currentStatus,
  currentSort,
  currentOrder,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(currentQuery);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const [editing, setEditing] = useState<VoucherRow | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<VoucherRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      // Clipboard nicht verfuegbar
    }
  }

  async function toggleDisabled(v: VoucherRow, disable: boolean) {
    setError(null);
    setBusyId(v.id);
    try {
      const res = await fetch(`/api/vouchers/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: disable }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const msg = json?.error?.formErrors?.[0] ?? "Aktion fehlgeschlagen.";
        setError(msg);
        return;
      }
      setConfirmDisable(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setBusyId(null);
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

      {error ? (
        <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

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
                  : currentStatus === "disabled"
                    ? "Keine deaktivierten Gutscheine."
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
                <TableHead className="text-xs font-medium text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((v) => (
                <TableRow
                  key={v.id}
                  className={v.disabledAt ? "opacity-60" : ""}
                >
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
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title="Bearbeiten"
                        onClick={() => {
                          setError(null);
                          setEditing(v);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {v.disabledAt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700"
                          title="Reaktivieren"
                          disabled={busyId === v.id}
                          onClick={() => toggleDisabled(v, false)}
                        >
                          {busyId === v.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700"
                          title={v.redeemedAt ? "Bereits eingelöst – Deaktivieren möglich" : "Deaktivieren"}
                          disabled={busyId === v.id}
                          onClick={() => setConfirmDisable(v)}
                        >
                          {busyId === v.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Ban className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EditVoucherDialog
        voucher={editing}
        services={services}
        accessAreas={accessAreas}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <Dialog
        open={confirmDisable !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDisable(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gutschein deaktivieren?</DialogTitle>
            <DialogDescription>
              Der Gutschein{" "}
              <span className="font-mono font-medium">{confirmDisable?.code}</span>{" "}
              kann anschließend nicht mehr eingelöst werden. Du kannst ihn
              jederzeit wieder reaktivieren.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDisable(null)}
              disabled={busyId !== null}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDisable && toggleDisabled(confirmDisable, true)}
              disabled={busyId !== null}
            >
              {busyId !== null ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Wird deaktiviert…
                </>
              ) : (
                "Deaktivieren"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EditDialogProps {
  voucher: VoucherRow | null;
  services: OptionItem[];
  accessAreas: OptionItem[];
  onClose: () => void;
  onSaved: () => void;
}

function EditVoucherDialog({
  voucher,
  services,
  accessAreas,
  onClose,
  onSaved,
}: EditDialogProps) {
  const [ticketTypeName, setTicketTypeName] = useState("");
  const [serviceId, setServiceId] = useState<string>("none");
  const [accessAreaId, setAccessAreaId] = useState<string>("none");
  const [validityType, setValidityType] = useState<string>("DATE_RANGE");
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bei eingeloesten Gutscheinen sperren wir die strukturellen Felder.
  const isReadOnlyCore = !!voucher?.redeemedAt;

  useEffect(() => {
    if (!voucher) return;
    setTicketTypeName(voucher.ticketTypeName ?? "");
    setServiceId(voucher.serviceId ? String(voucher.serviceId) : "none");
    setAccessAreaId(voucher.accessAreaId ? String(voucher.accessAreaId) : "none");
    setValidityType(voucher.validityType ?? "DATE_RANGE");
    setDurationMinutes(
      voucher.validityDurationMinutes != null
        ? String(voucher.validityDurationMinutes)
        : "",
    );
    setDiscountPercent(
      voucher.discountPercent != null ? String(voucher.discountPercent) : "",
    );
    setExpiresAt(toLocalDatetimeInput(voucher.expiresAt));
    setNotes(voucher.notes ?? "");
    setError(null);
  }, [voucher]);

  const open = voucher !== null;

  async function save() {
    if (!voucher) return;
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        notes: notes.trim() ? notes.trim() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      if (!isReadOnlyCore) {
        payload.ticketTypeName = ticketTypeName.trim() ? ticketTypeName.trim() : null;
        payload.serviceId = serviceId === "none" ? null : Number(serviceId);
        payload.accessAreaId = accessAreaId === "none" ? null : Number(accessAreaId);
        payload.validityType = validityType;
        const mins = durationMinutes.trim() ? Number(durationMinutes) : null;
        payload.validityDurationMinutes = mins && mins > 0 ? mins : null;
        const disc = discountPercent.trim() ? Number(discountPercent) : null;
        payload.discountPercent = disc != null && disc >= 0 ? disc : null;
      }

      const res = await fetch(`/api/vouchers/${voucher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const msg = json?.error?.formErrors?.[0] ?? "Speichern fehlgeschlagen.";
        setError(msg);
        return;
      }
      onSaved();
    } catch {
      setError("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  }

  const validityOptions = useMemo(
    () => [
      { value: "DATE_RANGE", label: "Tag" },
      { value: "DURATION", label: "Stundenkontingent" },
      { value: "TIME_SLOT", label: "Zeitslot" },
    ],
    [],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gutschein bearbeiten</DialogTitle>
          <DialogDescription>
            Code{" "}
            <span className="font-mono font-medium">{voucher?.code}</span>
            {isReadOnlyCore ? (
              <span className="block text-xs text-amber-600 dark:text-amber-400 mt-1">
                Bereits eingelöst – nur Notiz und Verfallsdatum änderbar.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-name">Anzeigename / Ticket-Typ</Label>
            <Input
              id="v-name"
              value={ticketTypeName}
              onChange={(e) => setTicketTypeName(e.target.value)}
              placeholder="z. B. 2 Stunden Strandbad"
              disabled={isReadOnlyCore}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select
                value={serviceId}
                onValueChange={setServiceId}
                disabled={isReadOnlyCore}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— keiner —</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Bereich</Label>
              <Select
                value={accessAreaId}
                onValueChange={setAccessAreaId}
                disabled={isReadOnlyCore}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Bereich" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— keiner —</SelectItem>
                  {accessAreas.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Gültigkeit</Label>
              <Select
                value={validityType}
                onValueChange={setValidityType}
                disabled={isReadOnlyCore}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {validityOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-duration">Dauer (Minuten)</Label>
              <Input
                id="v-duration"
                type="number"
                min={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="z. B. 120"
                disabled={isReadOnlyCore || validityType !== "DURATION"}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-discount">Rabatt (%)</Label>
              <Input
                id="v-discount"
                type="number"
                min={0}
                max={100}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                placeholder="z. B. 10"
                disabled={isReadOnlyCore}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-expires">Verfallsdatum</Label>
              <Input
                id="v-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-notes">Notiz</Label>
            <Input
              id="v-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="interne Notiz"
            />
          </div>

          {error ? (
            <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Speichern…
              </>
            ) : (
              "Speichern"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
