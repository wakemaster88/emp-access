"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save, Search, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ErrorLine, LevelBadge, apiRequest } from "@/components/schliessanlage/shared";
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Schlüssel ausgeben</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Empfänger <span className="text-rose-500">*</span>
            </Label>
            <div className="inline-flex gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900/40">
              {(
                [
                  ["existing", "Bekannt", Users],
                  ["employee", "Mitarbeiter", Users],
                  ["free", "Extern", UserPlus],
                ] as const
              ).map(([value, text, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
                    mode === value
                      ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {text}
                </button>
              ))}
            </div>

            {mode === "existing" && (
              <select
                value={holderId ?? ""}
                onChange={(e) => setHolderId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
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
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
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
                    className="h-9"
                  />
                  <Input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Nachname"
                    className="h-9"
                  />
                </div>
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Firma (z. B. Elektro Meier)"
                  className="h-9"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="E-Mail"
                    type="email"
                    className="h-9"
                  />
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Telefon"
                    className="h-9"
                  />
                </div>
              </div>
            )}
          </div>

          <Separator className="dark:bg-slate-800" />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Schlüssel <span className="text-rose-500">*</span>
              </Label>
              <span className="text-[11px] text-slate-400">{keyIds.length} gewählt</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={keyQuery}
                onChange={(e) => setKeyQuery(e.target.value)}
                placeholder="Verfügbare Schlüssel suchen…"
                className="h-8 w-full rounded border border-slate-200 bg-white pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1 dark:border-slate-700">
              {availableKeys.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-slate-400">
                  Keine verfügbaren Schlüssel.
                </p>
              ) : (
                availableKeys.map((k) => {
                  const selected = keyIds.includes(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => toggleKey(k.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                        selected
                          ? "bg-indigo-50 dark:bg-indigo-950/20"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          selected
                            ? "border-indigo-500 bg-indigo-500"
                            : "border-slate-300 dark:border-slate-600",
                        )}
                      >
                        {selected && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-slate-700 dark:text-slate-300">
                        {k.keyNumber}
                      </span>
                      <LevelBadge level={k.level} />
                      <span className="truncate text-[11px] text-slate-400">
                        {k.label || k.lockLabels[0] || ""}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <Separator className="dark:bg-slate-800" />

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="h-due" className="text-xs">
                Rückgabe bis
              </Label>
              <Input
                id="h-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="h-deposit" className="text-xs">
                Pfand (EUR)
              </Label>
              <Input
                id="h-deposit"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="h-9 tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="h-policy" className="text-xs">
              Belehrungsvorlage
            </Label>
            <select
              id="h-policy"
              value={policyId ?? ""}
              onChange={(e) => setPolicyId(e.target.value ? Number(e.target.value) : null)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">— aktive Vorlage verwenden —</option>
              {activePolicies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (v{p.version})
                </option>
              ))}
            </select>
            {activePolicies.length === 0 && (
              <p className="text-[10px] text-amber-600">
                Noch keine aktive Vorlage – der Signatur-Link lässt sich erst danach erzeugen.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="h-notes" className="text-xs">
              Notiz
            </Label>
            <Input
              id="h-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9"
            />
          </div>

          <ErrorLine message={error} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !holderValid || keyIds.length === 0}
            className="h-8 min-w-28 bg-indigo-600 hover:bg-indigo-700"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
