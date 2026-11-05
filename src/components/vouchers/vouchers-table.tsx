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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Search,
  Copy,
  Check,
  ArrowUpDown,
  Pencil,
  Ban,
  RotateCcw,
  Loader2,
  Gift,
} from "lucide-react";
import { fmtDateTimeShort } from "@/lib/utils";

/**
 * Die Tabelle läuft bis an den Kartenrand; erste und letzte Spalte bekommen
 * den Innenabstand der Karte (16 px, ab sm 18 px), damit Text und Karte fluchten.
 */
const TABLE_EDGE =
  "[&>*>tr>*:first-child]:pl-4 sm:[&>*>tr>*:first-child]:pl-[18px] [&>*>tr>*:last-child]:pr-4 sm:[&>*>tr>*:last-child]:pr-[18px]";

// Felder und Tasten im Dialog: auf dem Handy 44 px hoch, ab sm 36 px (docs/design-regeln.md, Abschnitt 16).
const DIALOG_FIELD = "h-11 sm:h-9";
const DIALOG_SELECT = "w-full data-[size=default]:h-11 sm:data-[size=default]:h-9";

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
      <Badge variant="neutral">
        Deaktiviert
      </Badge>
    );
  }
  if (v.redeemedAt) {
    return (
      <Badge variant="success">
        Eingelöst
      </Badge>
    );
  }
  if (v.expiresAt && new Date(v.expiresAt) < new Date()) {
    return (
      <Badge variant="danger">
        Abgelaufen
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
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
      <div className="flex items-center gap-2 px-4 sm:px-[18px]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 z-10 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, Ticket-Typ oder Notiz suchen…"
            className="h-11 pl-9 sm:h-9"
          />
        </div>
      </div>

      {error ? (
        <Notice tone="danger" compact title={error} className="mx-4 sm:mx-[18px]" />
      ) : null}

      {vouchers.length === 0 ? (
        <EmptyState
          icon={Gift}
          className="border-t border-border"
          title={currentQuery
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
        />
      ) : (
        <div className="border-t border-border">
          <Table className={TABLE_EDGE}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button
                    onClick={() => toggleSort("code")}
                    className="flex items-center gap-1 uppercase hover:text-primary"
                  >
                    Code {sortIcon("code")}
                  </button>
                </TableHead>
                {/* Handy: Code mit Status und Ticket-Typ darunter, dazu Aktionen. Weitere Spalten erst, wenn Platz
                    ist (sm, md, xl, 2xl), damit „Aktionen“ ohne waagerechtes Wischen sichtbar bleibt. */}
                <TableHead className="hidden sm:table-cell">
                  <button
                    onClick={() => toggleSort("ticketType")}
                    className="flex items-center gap-1 uppercase hover:text-primary"
                  >
                    Ticket-Typ {sortIcon("ticketType")}
                  </button>
                </TableHead>
                <TableHead className="hidden 2xl:table-cell">Bereich</TableHead>
                <TableHead className="hidden xl:table-cell">Gültigkeit</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden 2xl:table-cell">
                  <button
                    onClick={() => toggleSort("createdAt")}
                    className="flex items-center gap-1 uppercase hover:text-primary"
                  >
                    Erstellt {sortIcon("createdAt")}
                  </button>
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  <button
                    onClick={() => toggleSort("redeemedAt")}
                    className="flex items-center gap-1 uppercase hover:text-primary"
                  >
                    Eingelöst {sortIcon("redeemedAt")}
                  </button>
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  <button
                    onClick={() => toggleSort("expiresAt")}
                    className="flex items-center gap-1 uppercase hover:text-primary"
                  >
                    Verfällt {sortIcon("expiresAt")}
                  </button>
                </TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.map((v) => (
                <TableRow
                  key={v.id}
                  className={v.disabledAt ? "opacity-60" : ""}
                >
                  {/* Handy: die Zelle nimmt die freie Breite (w-full + max-w-0), der Ticket-Typ darunter kürzt. */}
                  <TableCell className="font-mono text-xs max-sm:w-full max-sm:max-w-0">
                    <button
                      type="button"
                      onClick={() => copy(v.id, v.code)}
                      className="inline-flex items-center gap-1 hover:text-primary group"
                      title="Kopieren"
                    >
                      <span>{v.code}</span>
                      {copiedId === v.id ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60" />
                      )}
                    </button>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 font-sans sm:hidden">
                      {statusBadge(v)}
                      <span className="truncate text-[11px] text-muted-foreground">
                        {v.ticketTypeName ?? v.serviceName ?? "—"}
                        {v.discountPercent ? ` · −${v.discountPercent}%` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">
                    {v.ticketTypeName ?? v.serviceName ?? (
                      <span className="text-muted-foreground/70">—</span>
                    )}
                    {v.discountPercent ? (
                      <Badge variant="outline" className="ml-2 tabular-nums">
                        −{v.discountPercent}%
                      </Badge>
                    ) : null}
                    {/* Notiz als zweite Zeile statt eigener Spalte; gekürzt, voller Text im Tooltip. */}
                    {v.notes ? (
                      <p className="hidden max-w-[220px] truncate text-xs text-muted-foreground lg:block" title={v.notes}>
                        {v.notes}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden 2xl:table-cell text-sm">
                    {v.accessAreaName ?? (
                      <span className="text-muted-foreground/70">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-sm">
                    <span className="text-muted-foreground">
                      {validityLabel(v)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{statusBadge(v)}</TableCell>
                  <TableCell className="hidden 2xl:table-cell text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {fmtDateTimeShort(v.createdAt)}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {v.redeemedAt ? (
                      <span className="text-success font-medium">
                        {fmtDateTimeShort(v.redeemedAt)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {v.expiresAt ? (
                      new Date(v.expiresAt) < new Date() && !v.redeemedAt ? (
                        <span className="text-destructive">
                          {fmtDateTimeShort(v.expiresAt)}
                        </span>
                      ) : (
                        fmtDateTimeShort(v.expiresAt)
                      )
                    ) : (
                      <span className="text-muted-foreground/70">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {/* Auf dem Handy 44 px Tippfläche, ab sm kompakt. */}
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="max-sm:size-11"
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
                          size="icon-sm"
                          variant="ghost"
                          className="max-sm:size-11 text-success hover:text-success"
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
                          size="icon-sm"
                          variant="ghost"
                          className="max-sm:size-11 text-destructive hover:text-destructive"
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

      {/* Sperren immer als AlertDialog mit destruktiver Taste (Abschnitt 18). */}
      <AlertDialog
        open={confirmDisable !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDisable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gutschein deaktivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Gutschein{" "}
              <span className="font-mono font-medium">{confirmDisable?.code}</span>{" "}
              kann anschließend nicht mehr eingelöst werden. Du kannst ihn
              jederzeit wieder reaktivieren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busyId !== null}
              className={DIALOG_FIELD}
            >
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                // Offen lassen, bis die Anfrage durch ist; toggleDisabled schließt bei Erfolg.
                e.preventDefault();
                if (confirmDisable) toggleDisabled(confirmDisable, true);
              }}
              disabled={busyId !== null}
              className={DIALOG_FIELD}
            >
              {busyId !== null ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Wird deaktiviert…
                </>
              ) : (
                "Deaktivieren"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gutschein bearbeiten</DialogTitle>
          <DialogDescription>
            Code{" "}
            <span className="font-mono font-medium">{voucher?.code}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isReadOnlyCore ? (
            // Hinweis als Kachel statt Warnfarbe im Beschreibungstext.
            <Notice tone="warning" compact title="Bereits eingelöst – nur Notiz und Verfallsdatum änderbar." />
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="v-name">Anzeigename / Ticket-Typ</Label>
            <Input
              id="v-name"
              value={ticketTypeName}
              onChange={(e) => setTicketTypeName(e.target.value)}
              placeholder="z. B. 2 Stunden Strandbad"
              disabled={isReadOnlyCore}
              className={DIALOG_FIELD}
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
                <SelectTrigger className={DIALOG_SELECT}>
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
                <SelectTrigger className={DIALOG_SELECT}>
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
                <SelectTrigger className={DIALOG_SELECT}>
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
                className={DIALOG_FIELD}
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
                className={DIALOG_FIELD}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-expires">Verfallsdatum</Label>
              <Input
                id="v-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={DIALOG_FIELD}
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
              className={DIALOG_FIELD}
            />
          </div>

          {error ? (
            <Notice tone="danger" compact title={error} />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className={DIALOG_FIELD}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving} className={DIALOG_FIELD}>
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
