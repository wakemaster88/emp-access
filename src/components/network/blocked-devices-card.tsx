"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Ban, Loader2, Plus, Unlock } from "lucide-react";
import { normalizeMac } from "@/lib/mac";
import type { BlockedRow } from "@/components/network/network-types";

/** Gerade gesehen = im Netz, obwohl gesperrt (gleiches Fenster wie die Online-Anzeige). */
const RECENT_MS = 30 * 60 * 1000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface BlockPrefill {
  macAddress: string;
  name: string;
}

/**
 * Sperrliste: Geräte sperren und wieder freigeben. Die Sperre im WLAN setzt
 * NETGEAR Insight (MAC ACL je SSID), weil es dafür keine offizielle
 * Schnittstelle gibt; der Schalter „In Insight eingetragen“ hält fest, ob das
 * erledigt ist. Der Hub-Scan meldet per Telegram, wenn ein gesperrtes Gerät
 * trotzdem im Netz ist.
 */
export function BlockedDevicesCard({
  blocked,
  prefill,
  onPrefillConsumed,
}: {
  blocked: BlockedRow[];
  /** Aus der Geräteliste „Sperren“ gedrückt: Dialog vorbefüllt öffnen. */
  prefill: BlockPrefill | null;
  onPrefillConsumed: () => void;
}) {
  const router = useRouter();
  const [manual, setManual] = useState<BlockPrefill | null>(null);
  const [toRelease, setToRelease] = useState<BlockedRow | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  /** Offener Dialog: manuell über „Sperren“ oder vorbefüllt aus der Geräteliste. */
  const dialog = manual ?? prefill;
  function closeDialog() {
    setManual(null);
    if (prefill) onPrefillConsumed();
  }

  async function toggleEnforced(b: BlockedRow) {
    setTogglingId(b.id);
    try {
      const res = await fetch(`/api/network/blocked/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enforced: !b.enforcedAt }),
      });
      if (res.ok) router.refresh();
    } finally {
      setTogglingId(null);
    }
  }

  async function release(b: BlockedRow) {
    const res = await fetch(`/api/network/blocked/${b.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Freigeben hat nicht geklappt");
    router.refresh();
  }

  const now = Date.now();
  const pending = blocked.filter((b) => !b.enforcedAt).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="tabular-nums">Gesperrte Geräte ({blocked.length})</CardTitle>
        <CardDescription className="text-xs">
          Der Hub meldet per Telegram, wenn ein gesperrtes Gerät trotzdem im Netz auftaucht.
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={() => setManual({ macAddress: "", name: "" })} className="gap-2 max-sm:h-11" aria-label="Gerät sperren">
            <Plus className="h-4 w-4" />
            <span>Sperren</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending > 0 && (
          <Notice tone="warning" compact title="Noch nicht in Insight eingetragen">
            Im WLAN wirkt die Sperre erst, wenn die MAC in NETGEAR Insight steht: WLAN › SSID › Bearbeiten ›
            MAC ACL, Richtlinie „Verbieten“. Danach hier „In Insight eingetragen“ einschalten.
          </Notice>
        )}
        {blocked.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Geräte gesperrt.</p>
        ) : (
          <ul className="divide-y divide-border">
            {blocked.map((b) => {
              const seenRecently = !!b.lastSeenAt && now - new Date(b.lastSeenAt).getTime() < RECENT_MS;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <IconChip icon={Ban} size="sm" tone="danger" className="max-sm:hidden" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-foreground break-words">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-mono">{b.macAddress}</span>
                      {" · "}gesperrt {formatTime(b.createdAt)}
                      {b.reason ? ` · ${b.reason}` : ""}
                    </p>
                    {b.lastSeenAt && (
                      <div className="mt-1">
                        <Badge variant={seenRecently ? "danger" : "neutral"} className="text-xs h-5">
                          {seenRecently ? "Gerade im Netz" : "Zuletzt gesehen"} {formatTime(b.lastSeenAt)}
                          {b.lastSeenIp ? ` · ${b.lastSeenIp}` : ""}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 max-sm:basis-full max-sm:justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={!!b.enforcedAt}
                        disabled={togglingId === b.id}
                        onCheckedChange={() => toggleEnforced(b)}
                        aria-label={`${b.name}: in Insight eingetragen`}
                      />
                      In Insight eingetragen
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 max-sm:h-11"
                      onClick={() => setToRelease(b)}
                    >
                      <Unlock className="h-4 w-4" />
                      Freigeben
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {dialog && (
        <BlockDialog
          key={`${dialog.macAddress}-${dialog.name}`}
          initial={dialog}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!toRelease}
        onOpenChange={(o) => { if (!o) setToRelease(null); }}
        title={`„${toRelease?.name ?? ""}“ freigeben?`}
        description="Das Gerät verschwindet von der Sperrliste und wird nicht mehr gemeldet. Den Eintrag in NETGEAR Insight (MAC ACL) bitte dort ebenfalls entfernen."
        confirmLabel="Freigeben"
        destructive={false}
        onConfirm={() => (toRelease ? release(toRelease) : undefined)}
      />
    </Card>
  );
}

function BlockDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: BlockPrefill;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ macAddress: initial.macAddress, name: initial.name, reason: "", enforced: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const macValid = !!normalizeMac(form.macAddress);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!macValid || !form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/network/blocked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Sperren hat nicht geklappt");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
      <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerät sperren</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="block-name">Name</Label>
              <Input
                id="block-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="z. B. Max Mustermann iPhone"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-mac">MAC-Adresse</Label>
              <Input
                id="block-mac"
                value={form.macAddress}
                onChange={(e) => setForm((f) => ({ ...f, macAddress: e.target.value }))}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-reason">Grund (optional)</Label>
              <Input
                id="block-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.enforced}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enforced: v }))}
              />
              Schon in Insight eingetragen
            </label>
            {form.macAddress && !macValid && <Notice tone="danger" compact title="Ungültige MAC-Adresse" />}
            {form.macAddress && macValid && isPrivateMac(form.macAddress) && (
              <Notice tone="info" compact title="Private WLAN-Adresse">
                Handys wechseln diese Adresse ab und zu. Taucht das Gerät mit neuer MAC wieder auf, meldet der Hub
                es als neues Gerät; dauerhaft hilft nur ein neues WLAN-Passwort.
              </Notice>
            )}
            {error && <Notice tone="danger" compact title={error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving || !macValid || !form.name.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sperren"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
  );
}

function isPrivateMac(raw: string): boolean {
  const mac = normalizeMac(raw);
  if (!mac) return false;
  return (parseInt(mac.slice(0, 2), 16) & 0x02) === 0x02;
}
