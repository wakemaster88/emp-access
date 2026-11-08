"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Globe, Loader2, RefreshCw, Settings2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { parseEuroToCents } from "@/lib/verein-portal-rules";

interface PortalVereinRow {
  id: number;
  name: string;
  enabled: boolean;
  serviceCount: number;
}

interface PortalSettings {
  token: string | null;
  enabled: boolean;
  cancelHours: number;
  horizonDays: number;
  billingContact: string | null;
  leadMinutes: number;
  trailMinutes: number;
  deviceIds: number[];
  doorbirdIds: number[];
  allDevices: { id: number; name: string }[];
  allDoorbirds: { id: number; name: string }[];
  services: { serviceId: number; priceCents: number }[];
  allServices: { id: number; name: string }[];
}

/** Liste der Vereine mit Portal-Zustand; „Einrichten“ öffnet die Einstellungen. */
export function VereinPortalsCard({ vereine }: { vereine: PortalVereinRow[] }) {
  const [editing, setEditing] = useState<PortalVereinRow | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vereinsportale ({vereine.filter((v) => v.enabled).length} aktiv)</CardTitle>
        <CardDescription>Jeder Verein bekommt einen eigenen Link, über den er die freigegebenen Angebote selbst bucht.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {vereine.length === 0 && <EmptyState size="sm" icon={Users} title="Noch keine Vereine angelegt." />}
        {vereine.map((v) => (
          <div key={v.id} className="glass-tile flex items-center gap-3 px-3 py-2.5">
            <IconChip icon={Globe} tone={v.enabled ? "primary" : "neutral"} active={v.enabled} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{v.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {v.serviceCount === 0 ? "Keine Angebote freigegeben" : `${v.serviceCount} ${v.serviceCount === 1 ? "Angebot" : "Angebote"} buchbar`}
              </p>
            </div>
            <Badge variant={v.enabled ? "success" : "neutral"} className="max-sm:hidden">{v.enabled ? "Aktiv" : "Aus"}</Badge>
            <Button variant="outline" size="sm" onClick={() => setEditing(v)} aria-label={`Portal von ${v.name} einrichten`}>
              <Settings2 /> <span className="max-sm:sr-only">Einrichten</span>
            </Button>
          </div>
        ))}
      </CardContent>
      <PortalDialog verein={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function PortalDialog({ verein, onClose }: { verein: PortalVereinRow | null; onClose: () => void }) {
  const router = useRouter();
  const [settings, setSettings] = useState<PortalSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cancelHours, setCancelHours] = useState("48");
  const [horizonDays, setHorizonDays] = useState("60");
  const [billingContact, setBillingContact] = useState("");
  const [leadMinutes, setLeadMinutes] = useState("30");
  const [trailMinutes, setTrailMinutes] = useState("30");
  const [access, setAccess] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  function apply(s: PortalSettings) {
    setSettings(s);
    setEnabled(s.enabled);
    setCancelHours(String(s.cancelHours));
    setHorizonDays(String(s.horizonDays));
    setBillingContact(s.billingContact ?? "");
    setLeadMinutes(String(s.leadMinutes));
    setTrailMinutes(String(s.trailMinutes));
    setAccess(new Set([...s.doorbirdIds.map((id) => `doorbird:${id}`), ...s.deviceIds.map((id) => `device:${id}`)]));
    setPrices(Object.fromEntries(s.services.map((x) => [x.serviceId, (x.priceCents / 100).toFixed(2).replace(".", ",")])));
  }

  useEffect(() => {
    if (!verein) return;
    setSettings(null);
    setError(null);
    setConfirmRotate(false);
    fetch(`/api/vereine/${verein.id}/portal`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Laden fehlgeschlagen."))))
      .then(apply)
      .catch((e: Error) => setError(e.message));
  }, [verein]);

  const link = settings?.token && typeof window !== "undefined" ? `${window.location.origin}/verein/${settings.token}` : null;

  async function save() {
    if (!verein) return;
    const services: { serviceId: number; priceCents: number }[] = [];
    for (const [id, value] of Object.entries(prices)) {
      const cents = parseEuroToCents(value);
      if (cents == null) {
        const name = settings?.allServices.find((s) => s.id === Number(id))?.name ?? "einem Angebot";
        setError(`Preis bei ${name} ist keine Zahl.`);
        return;
      }
      services.push({ serviceId: Number(id), priceCents: cents });
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vereine/${verein.id}/portal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          cancelHours: Number(cancelHours) || 0,
          horizonDays: Number(horizonDays) || 1,
          billingContact: billingContact.trim() || null,
          leadMinutes: Number(leadMinutes) || 0,
          trailMinutes: Number(trailMinutes) || 0,
          deviceIds: [...access].filter((k) => k.startsWith("device:")).map((k) => Number(k.slice(7))),
          doorbirdIds: [...access].filter((k) => k.startsWith("doorbird:")).map((k) => Number(k.slice(9))),
          services,
        }),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen. Prüfe Frist und Vorlauf.");
      apply(await res.json());
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!verein) return;
    const res = await fetch(`/api/vereine/${verein.id}/portal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rotate" }),
    });
    if (!res.ok) throw new Error("Neuer Link konnte nicht erzeugt werden.");
    const next = (await res.json()) as PortalSettings;
    setSettings((prev) => (prev ? { ...prev, token: next.token } : next));
    setConfirmRotate(false);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* Zwischenablage gesperrt */ }
  }

  return (
    <Dialog open={!!verein} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Portal von {verein?.name}</DialogTitle>
          <DialogDescription>Der Verein bucht über den Link selbst Slots. Abgerechnet wird unter Buchungen.</DialogDescription>
        </DialogHeader>

        {!settings && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Lädt …</div>
        )}

        {settings && (
          <div className="max-h-[60dvh] space-y-5 overflow-y-auto">
            <div className="glass-tile flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              <Label htmlFor="vp-enabled" className="text-sm">Portal aktiv</Label>
              <Switch id="vp-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {link ? (
              <div className="space-y-1.5">
                <Label htmlFor="vp-link">Link für den Verein</Label>
                <div className="flex gap-2">
                  <Input id="vp-link" readOnly value={link} className="font-mono text-xs max-sm:h-11" onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" size="icon" className="max-sm:size-11" onClick={copy} aria-label="Link kopieren">
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
                {!confirmRotate && (
                  <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setConfirmRotate(true)}>
                    <RefreshCw className="size-3" /> Neuen Link erzeugen
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Der Link entsteht beim ersten Speichern mit „Portal aktiv“.</p>
            )}

            <div className="space-y-2">
              <Label>Buchbare Angebote und Preis pro Slot</Label>
              {settings.allServices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Services angelegt.</p>
              ) : (
                <div className="glass-tile divide-y divide-border">
                  {settings.allServices.map((s) => {
                    const checked = s.id in prices;
                    return (
                      <div key={s.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                        <Checkbox
                          id={`vp-svc-${s.id}`}
                          checked={checked}
                          onCheckedChange={(v) => setPrices((prev) => {
                            const next = { ...prev };
                            if (v) next[s.id] = next[s.id] ?? "0,00"; else delete next[s.id];
                            return next;
                          })}
                        />
                        <Label htmlFor={`vp-svc-${s.id}`} className={cn("min-w-0 flex-1 truncate text-sm font-normal", !checked && "text-muted-foreground")}>
                          {s.name}
                        </Label>
                        {checked && (
                          <div className="flex shrink-0 items-center gap-1">
                            <Input
                              aria-label={`Preis ${s.name} in Euro`}
                              inputMode="decimal"
                              value={prices[s.id]}
                              onChange={(e) => setPrices((prev) => ({ ...prev, [s.id]: e.target.value }))}
                              className="h-9 w-24 text-right tabular-nums"
                            />
                            <span className="text-sm text-muted-foreground">€</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Nur Slot-Services mit ANNY-Verknüpfung, z. B. „Exklusive Bahnmiete“. Die Buchung sperrt den Slot in ANNY.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vp-cancel">Storno bis (Std. vorher)</Label>
                <Input id="vp-cancel" type="number" min={0} inputMode="numeric" value={cancelHours} onChange={(e) => setCancelHours(e.target.value)} className="max-sm:h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vp-horizon">Buchbar (Tage im Voraus)</Label>
                <Input id="vp-horizon" type="number" min={1} inputMode="numeric" value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} className="max-sm:h-11" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Zugang außerhalb des Betriebs</Label>
              {settings.allDoorbirds.length + settings.allDevices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Tore oder Türen angelegt.</p>
              ) : (
                <div className="glass-tile divide-y divide-border">
                  {[
                    ...settings.allDoorbirds.map((d) => ({ key: `doorbird:${d.id}`, name: d.name, hint: "DoorBird" })),
                    ...settings.allDevices.map((d) => ({ key: `device:${d.id}`, name: d.name, hint: null })),
                  ].map((p) => (
                    <div key={p.key} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                      <Checkbox
                        id={`vp-acc-${p.key}`}
                        checked={access.has(p.key)}
                        onCheckedChange={(v) => setAccess((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(p.key); else next.delete(p.key);
                          return next;
                        })}
                      />
                      <Label htmlFor={`vp-acc-${p.key}`} className="min-w-0 flex-1 truncate text-sm font-normal">
                        {p.name}{p.hint && <span className="text-muted-foreground"> · {p.hint}</span>}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="vp-lead">Vorbereitung (Min.)</Label>
                  <Input id="vp-lead" type="number" min={0} inputMode="numeric" value={leadMinutes} onChange={(e) => setLeadMinutes(e.target.value)} className="max-sm:h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vp-trail">Nachbereitung (Min.)</Label>
                  <Input id="vp-trail" type="number" min={0} inputMode="numeric" value={trailMinutes} onChange={(e) => setTrailMinutes(e.target.value)} className="max-sm:h-11" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Im gebuchten Slot plus Vor- und Nachbereitung öffnet der Verein die gewählten Tore und Türen im Portal, und die Mitglieder kommen durch die Drehkreuze.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vp-billing">Rechnungsempfänger</Label>
              <Textarea id="vp-billing" rows={2} value={billingContact} onChange={(e) => setBillingContact(e.target.value)} placeholder="Name, Adresse, E-Mail" maxLength={500} />
            </div>
          </div>
        )}

        {error && <Notice tone="danger" title={error} compact />}

        {confirmRotate ? (
          <ConfirmStep
            title="Neuen Link erzeugen?"
            description="Der bisherige Link funktioniert dann sofort nicht mehr."
            confirmLabel="Neuer Link"
            onConfirm={rotate}
            onCancel={() => setConfirmRotate(false)}
          />
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button>
            <Button onClick={save} disabled={busy || !settings}>
              {busy && <Loader2 className="animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
