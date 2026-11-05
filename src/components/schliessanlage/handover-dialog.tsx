"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Save, Search, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Separator } from "@/components/ui/separator";
import {
  ErrorLine,
  LevelBadge,
  apiRequest,
  selectFieldClass,
} from "@/components/schliessanlage/shared";
import type {
  EmployeeOption,
  HolderRow,
  KeyRow,
  PolicyRow,
} from "@/components/schliessanlage/types";
import { cn } from "@/lib/utils";

interface Props {
  keys: KeyRow[];
  holders: HolderRow[];
  employees: EmployeeOption[];
  policies: PolicyRow[];
  open: boolean;
  onClose: () => void;
}

type HolderMode = "existing" | "employee" | "free";

export function HandoverDialog({ keys, holders, employees, policies, open, onClose }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<HolderMode>(holders.length > 0 ? "existing" : "employee");
  const [holderId, setHolderId] = useState<number | null>(null);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [keyIds, setKeyIds] = useState<number[]>([]);
  const [keyQuery, setKeyQuery] = useState("");
  const [policyId, setPolicyId] = useState<number | null>(
    policies.find((p) => p.isActive)?.id ?? null,
  );
  const [dueAt, setDueAt] = useState("");
  const [deposit, setDeposit] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const availableKeys = useMemo(() => {
    const q = keyQuery.trim().toLowerCase();
    return keys
      .filter((k) => k.status === "AVAILABLE")
      .filter((k) =>
        q ? [k.keyNumber, k.label ?? "", ...k.lockLabels].join(" ").toLowerCase().includes(q) : true,
      );
  }, [keys, keyQuery]);

  const activePolicies = useMemo(
    () => policies.filter((p) => p.isActive),
    [policies],
  );

  const holderValid =
    (mode === "existing" && holderId != null) ||
    (mode === "employee" && ticketId != null) ||
    (mode === "free" && (lastName.trim() !== "" || company.trim() !== ""));

  async function save() {
    setSaving(true);
    setError("");

    const newHolder =
      mode === "employee"
        ? { ticketId }
        : mode === "free"
          ? {
              firstName: firstName.trim() || null,
              lastName: lastName.trim() || null,
              company: company.trim() || null,
              email: email.trim() || null,
              phone: phone.trim() || null,
            }
          : undefined;

    const res = await apiRequest("/api/schliessanlage/handovers", "POST", {
      ...(mode === "existing" ? { holderId } : { newHolder }),
      keyIds,
      policyTemplateId: policyId,
      dueAt: dueAt || null,
      deposit: deposit.trim() ? Number(deposit.replace(",", ".")) : null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  const toggleKey = (id: number) =>
    setKeyIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schlüssel ausgeben</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              Empfänger <span className="text-destructive">*</span>
            </Label>
            {/* Art des Empfängers als Segmentwahl (Glas-Kapsel mit heller Pille). */}
            <Segmented<HolderMode>
              aria-label="Empfänger"
              value={mode}
              onValueChange={setMode}
              stretch
              options={(
                [
                  ["existing", "Bekannt", Users],
                  ["employee", "Mitarbeiter", Users],
                  ["free", "Extern", UserPlus],
                ] as const
              ).map(([value, text, Icon]) => ({
                value,
                label: (
                  <>
                    <Icon className="h-3.5 w-3.5 max-sm:hidden" />
                    {text}
                  </>
                ),
              }))}
            />

            {mode === "existing" && (
              <select
                value={holderId ?? ""}
                onChange={(e) => setHolderId(e.target.value ? Number(e.target.value) : null)}
                className={cn(selectFieldClass, "w-full max-sm:h-11")}
              >
                <option value="">— Empfänger wählen —</option>
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.displayName}
                  </option>
                ))}
              </select>
            )}

            {mode === "employee" && (
              <select
                value={ticketId ?? ""}
                onChange={(e) => setTicketId(e.target.value ? Number(e.target.value) : null)}
                className={cn(selectFieldClass, "w-full max-sm:h-11")}
              >
                <option value="">— Mitarbeiter wählen —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.ticketTypeName ? ` · ${e.ticketTypeName}` : ""}
                  </option>
                ))}
              </select>
            )}

            {mode === "free" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Vorname"
                    className="max-sm:h-11"
                  />
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Nachname"
                    className="max-sm:h-11"
                  />
                </div>
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Firma (z. B. Elektro Meier)"
                  className="max-sm:h-11"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="E-Mail"
                    type="email"
                    className="max-sm:h-11"
                  />
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Telefon"
                    className="max-sm:h-11"
                  />
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>
                Schlüssel <span className="text-destructive">*</span>
              </Label>
              <span className="text-[11px] text-muted-foreground tabular-nums">{keyIds.length} gewählt</span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={keyQuery}
                onChange={(e) => setKeyQuery(e.target.value)}
                placeholder="Verfügbare Schlüssel suchen…"
                className="pl-8 max-sm:h-11"
              />
            </div>
            {/* Auswahlliste als Glas-Kachel (in Ebenen automatisch getönt). */}
            <div className="glass-tile scrollbar-thin max-h-52 space-y-0.5 overflow-y-auto p-1">
              {availableKeys.length === 0 ? (
                <EmptyState compact icon={KeyRound} title="Keine verfügbaren Schlüssel." />
              ) : (
                availableKeys.map((k) => {
                  const selected = keyIds.includes(k.id);
                  return (
                    // Ganze Zeile ist Beschriftung des Kästchens und damit die Tippfläche; das Kästchen
                    // selbst nimmt keine Zeiger an (kein doppeltes Umschalten).
                    <label
                      key={k.id}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors max-sm:min-h-11",
                        selected
                          ? "bg-primary/10"
                          : "hover:bg-glass-tile",
                      )}
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleKey(k.id)}
                        className="pointer-events-none"
                      />
                      <span className="shrink-0 font-mono text-xs text-foreground">
                        {k.keyNumber}
                      </span>
                      <LevelBadge level={k.level} />
                      <span className="truncate text-[11px] text-muted-foreground">
                        {k.label || k.lockLabels[0] || ""}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="h-due">
                Rückgabe bis
              </Label>
              <Input
                id="h-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="max-sm:h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="h-deposit">
                Pfand (EUR)
              </Label>
              <Input
                id="h-deposit"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="tabular-nums max-sm:h-11"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="h-policy">
              Belehrungsvorlage
            </Label>
            <select
              id="h-policy"
              value={policyId ?? ""}
              onChange={(e) => setPolicyId(e.target.value ? Number(e.target.value) : null)}
              className={cn(selectFieldClass, "w-full max-sm:h-11")}
            >
              <option value="">— aktive Vorlage verwenden —</option>
              {activePolicies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (v{p.version})
                </option>
              ))}
            </select>
            {activePolicies.length === 0 && (
              <p className="text-[11px] text-warning">
                Noch keine aktive Vorlage – der Signatur-Link lässt sich erst danach erzeugen.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="h-notes">
              Notiz
            </Label>
            <Input
              id="h-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="max-sm:h-11"
            />
          </div>

          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || !holderValid || keyIds.length === 0}
            className="min-w-28 max-sm:h-11"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" />
                Ausgeben
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
