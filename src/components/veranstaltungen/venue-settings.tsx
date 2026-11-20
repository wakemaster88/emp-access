"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, Copy, Globe, Loader2, MapPin, Package, Pencil, Plus, RefreshCw, Trash2, Users,
} from "lucide-react";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { Switch } from "@/components/ui/switch";
import { formatEuro, UNIT_LABEL, type VenueExtraUnit } from "@/lib/venue-event-rules";
import { parseEuroToCents } from "@/lib/verein-portal-rules";

export interface AreaRow {
  id: number;
  name: string;
  eventVenue: boolean;
  eventBufferMinutes: number;
  eventCapacity: number | null;
}

export interface ExtraRow {
  id: number;
  areaId: number;
  name: string;
  description: string | null;
  priceCents: number;
  unit: VenueExtraUnit;
  active: boolean;
  sortOrder: number;
}

export interface PartnerRow {
  id: number;
  name: string;
  contactName: string | null;
<<<<<<< HEAD
  logoUrl: string | null;
=======
>>>>>>> origin/claude/project-thread-iy5t9v
  contactEmail: string | null;
  notifyEmail: string | null;
  portalToken: string | null;
  portalEnabled: boolean;
  areaIds: number[];
  editLockHours: number;
  horizonDays: number;
  eventCount: number;
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(payload.error ?? "Das hat nicht geklappt.");
  return payload;
}

/** Einstellungen: Veranstaltungsräume, Zusatzleistungen je Raum, Partner mit Link. */
export function VenueSettings({ areas, extras, partners }: { areas: AreaRow[]; extras: ExtraRow[]; partners: PartnerRow[] }) {
  const venues = areas.filter((a) => a.eventVenue);
  return (
    <div className="space-y-4">
      <VenuesCard areas={areas} />
      <ExtrasCard venues={venues} extras={extras} />
      <PartnersCard venues={venues} partners={partners} />
    </div>
  );
}

// ─── Räume ──────────────────────────────────────────────────────────────────

function VenuesCard({ areas }: { areas: AreaRow[] }) {
  const [editing, setEditing] = useState<AreaRow | null>(null);
  const [picking, setPicking] = useState(false);
  const venues = areas.filter((a) => a.eventVenue);
  const others = areas.filter((a) => !a.eventVenue);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Veranstaltungsräume</CardTitle>
        <CardDescription>Ressourcen, die für Veranstaltungen belegt werden. Neue Ressourcen legst du unter Ressourcen an.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {venues.length === 0 && <EmptyState size="sm" icon={MapPin} title="Noch kein Veranstaltungsraum." />}
        {venues.map((a) => (
          <div key={a.id} className="glass-tile flex items-center gap-3 px-3 py-2.5">
            <IconChip icon={MapPin} tone="primary" active />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {a.eventCapacity ? `bis ${a.eventCapacity} Personen` : "ohne Personengrenze"} · {a.eventBufferMinutes} Min. Puffer
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(a)} aria-label={`${a.name} bearbeiten`}>
              <Pencil /> <span className="max-sm:sr-only">Bearbeiten</span>
            </Button>
          </div>
        ))}
        {others.length > 0 && (
          picking ? (
            <NativeSelect aria-label="Ressource wählen" defaultValue="" onChange={(e) => {
              const a = others.find((o) => o.id === Number(e.target.value));
              if (a) { setEditing({ ...a, eventVenue: true }); setPicking(false); }
            }}>
              <option value="" disabled>Ressource wählen …</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setPicking(true)}><Plus /> Ressource hinzufügen</Button>
          )
        )}
      </CardContent>
      <VenueDialog area={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function VenueDialog({ area, onClose }: { area: AreaRow | null; onClose: () => void }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [buffer, setBuffer] = useState("60");
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!area) return;
    setEnabled(area.eventVenue);
    setBuffer(String(area.eventBufferMinutes));
    setCapacity(area.eventCapacity ? String(area.eventCapacity) : "");
    setError(null);
  }, [area]);

  async function save() {
    if (!area) return;
    setBusy(true);
    setError(null);
    try {
      await send("/api/veranstaltungen/venues", "PUT", {
        areaId: area.id,
        eventVenue: enabled,
        bufferMinutes: Number(buffer) || 0,
        capacity: capacity.trim() ? Number(capacity) : null,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!area} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{area?.name}</DialogTitle>
          <DialogDescription>Als Veranstaltungsraum lässt sich die Ressource unter Veranstaltungen belegen.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="glass-tile flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2">
            <span className="text-sm font-medium">Veranstaltungsraum</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vv-buffer">Puffer (Min.)</Label>
              <Input id="vv-buffer" type="number" min={0} inputMode="numeric" value={buffer} onChange={(e) => setBuffer(e.target.value)} className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vv-cap">Höchstens Personen</Label>
              <Input id="vv-cap" type="number" min={1} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="ohne Grenze" className="max-sm:h-11" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Der Puffer bleibt zwischen zwei Veranstaltungen frei, für Auf- und Abbau. Überschneidungen lehnt das System ab.</p>
        </div>
        {error && <Notice tone="danger" title={error} compact />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Zusatzleistungen ───────────────────────────────────────────────────────

function ExtrasCard({ venues, extras }: { venues: AreaRow[]; extras: ExtraRow[] }) {
  const [editing, setEditing] = useState<ExtraRow | { areaId: number } | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Zusatzleistungen</CardTitle>
        <CardDescription>Was Partner zu einer Veranstaltung anklicken können und wir weiterberechnen. Preise netto.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {venues.length === 0 && <p className="text-sm text-muted-foreground">Erst einen Veranstaltungsraum einschalten.</p>}
        {venues.map((v) => {
          const list = extras.filter((x) => x.areaId === v.id);
          return (
            <section key={v.id} className="space-y-2">
              <SectionHeading
                title={v.name}
                aside={<Button variant="outline" size="sm" onClick={() => setEditing({ areaId: v.id })}><Plus /> Leistung</Button>}
              />
              {list.length === 0 ? (
                <EmptyState size="sm" icon={Package} title="Noch keine Zusatzleistungen." description="z. B. Reinigung pauschal, Security je Stück, Endreinigung, Technik, Getränkepauschale je Person." />
              ) : (
                list.map((x) => (
                  <div key={x.id} className="glass-tile flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{x.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatEuro(x.priceCents)} {UNIT_LABEL[x.unit]}{x.description ? ` · ${x.description}` : ""}
                      </p>
                    </div>
                    {!x.active && <Badge variant="neutral">Ausgeblendet</Badge>}
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(x)} aria-label={`${x.name} bearbeiten`}><Pencil /></Button>
                  </div>
                ))
              )}
            </section>
          );
        })}
      </CardContent>
      <ExtraDialog target={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function ExtraDialog({ target, onClose }: { target: ExtraRow | { areaId: number } | null; onClose: () => void }) {
  const router = useRouter();
  const existing = target && "id" in target ? target : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState<VenueExtraUnit>("FLAT");
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!target) return;
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
    setPrice(existing ? (existing.priceCents / 100).toFixed(2).replace(".", ",") : "");
    setUnit(existing?.unit ?? "FLAT");
    setActive(existing?.active ?? true);
    setSortOrder(String(existing?.sortOrder ?? 0));
    setError(null);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function save() {
    if (!target) return;
    const cents = parseEuroToCents(price);
    if (!name.trim()) { setError("Bitte einen Namen angeben."); return; }
    if (cents == null) { setError("Der Preis ist keine Zahl."); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { areaId: target.areaId, name: name.trim(), description: description.trim() || null, priceCents: cents, unit, active, sortOrder: Number(sortOrder) || 0 };
      if (existing) await send(`/api/veranstaltungen/extras/${existing.id}`, "PUT", body);
      else await send("/api/veranstaltungen/extras", "POST", body);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    await send(`/api/veranstaltungen/extras/${existing.id}`, "DELETE");
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : "Zusatzleistung anlegen"}</DialogTitle>
          <DialogDescription>Schon gebuchte Termine behalten ihren Preis, wenn du ihn hier änderst.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vx-name">Name *</Label>
            <Input id="vx-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="z. B. Endreinigung" className="max-sm:h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vx-desc">Beschreibung (optional)</Label>
            <Input id="vx-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="max-sm:h-11" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vx-price">Preis netto (€)</Label>
              <Input id="vx-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vx-unit">Abrechnung</Label>
              <NativeSelect id="vx-unit" value={unit} onChange={(e) => setUnit(e.target.value as VenueExtraUnit)}>
                <option value="FLAT">pauschal</option>
                <option value="PER_PERSON">je Person</option>
                <option value="PER_PIECE">je Stück</option>
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="glass-tile flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">Sichtbar</span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="vx-sort" className="sr-only">Reihenfolge</Label>
              <Input id="vx-sort" type="number" min={0} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} aria-describedby="vx-sort-hint" className="max-sm:h-11" />
              <p id="vx-sort-hint" className="text-xs text-muted-foreground">Reihenfolge (klein zuerst)</p>
            </div>
          </div>
        </div>
        {error && <Notice tone="danger" title={error} compact />}
        {confirmDelete ? (
          <ConfirmStep title={`„${existing?.name}“ löschen?`} description="Schon gebuchte Termine behalten Name und Preis." icon={Trash2}
            onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
        ) : (
          <DialogFooter className="gap-2">
            {existing && <Button variant="outline" className="sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 /> Löschen</Button>}
            <Button variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button>
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Speichern</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Partner ────────────────────────────────────────────────────────────────

function PartnersCard({ venues, partners }: { venues: AreaRow[]; partners: PartnerRow[] }) {
  const [editing, setEditing] = useState<PartnerRow | "new" | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Partner</CardTitle>
        <CardDescription>Externe Partner bekommen einen eigenen Link. Sie sehen nur ihre eigenen Termine und Dokumente, fremde Termine nur als belegt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {partners.length === 0 && <EmptyState size="sm" icon={Users} title="Noch keine Partner." />}
        {partners.map((p) => (
          <div key={p.id} className="glass-tile flex items-center gap-3 px-3 py-2.5">
            <IconChip icon={Globe} tone={p.portalEnabled ? "primary" : "neutral"} active={p.portalEnabled} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {p.areaIds.length === 0 ? "Kein Raum freigegeben" : venues.filter((v) => p.areaIds.includes(v.id)).map((v) => v.name).join(", ")}
                {` · ${p.eventCount} ${p.eventCount === 1 ? "Termin" : "Termine"}`}
              </p>
            </div>
            <Badge variant={p.portalEnabled ? "success" : "neutral"} className="max-sm:hidden">{p.portalEnabled ? "Aktiv" : "Aus"}</Badge>
            <Button variant="outline" size="sm" onClick={() => setEditing(p)} aria-label={`${p.name} einrichten`}>
              <Pencil /> <span className="max-sm:sr-only">Einrichten</span>
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus /> Partner anlegen</Button>
      </CardContent>
      <PartnerDialog target={editing} venues={venues} onClose={() => setEditing(null)} />
    </Card>
  );
}

function PartnerDialog({ target, venues, onClose }: { target: PartnerRow | "new" | null; venues: AreaRow[]; onClose: () => void }) {
  const router = useRouter();
  const existing = target && target !== "new" ? target : null;
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
<<<<<<< HEAD
  const [logoUrl, setLogoUrl] = useState("");
=======
>>>>>>> origin/claude/project-thread-iy5t9v
  const [contactEmail, setContactEmail] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [areaIds, setAreaIds] = useState<Set<number>>(new Set());
  const [lockHours, setLockHours] = useState("48");
  const [horizonDays, setHorizonDays] = useState("365");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<null | "rotate" | "delete">(null);

  useEffect(() => {
    if (!target) return;
    setName(existing?.name ?? "");
    setContactName(existing?.contactName ?? "");
<<<<<<< HEAD
    setLogoUrl(existing?.logoUrl ?? "");
=======
>>>>>>> origin/claude/project-thread-iy5t9v
    setContactEmail(existing?.contactEmail ?? "");
    setNotifyEmail(existing?.notifyEmail ?? "");
    setEnabled(existing?.portalEnabled ?? true);
    setAreaIds(new Set(existing?.areaIds ?? venues.map((v) => v.id)));
    setLockHours(String(existing?.editLockHours ?? 48));
    setHorizonDays(String(existing?.horizonDays ?? 365));
    setToken(existing?.portalToken ?? null);
    setError(null);
    setConfirm(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const link = token && typeof window !== "undefined" ? `${window.location.origin}/partner/${token}` : null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        contactName: contactName.trim() || null,
<<<<<<< HEAD
        logoUrl: logoUrl.trim() || null,
=======
>>>>>>> origin/claude/project-thread-iy5t9v
        contactEmail: contactEmail.trim() || null,
        notifyEmail: notifyEmail.trim() || null,
        portalEnabled: enabled,
        areaIds: [...areaIds],
        editLockHours: Number(lockHours) || 0,
        horizonDays: Number(horizonDays) || 1,
      };
      if (existing) await send(`/api/veranstaltungen/partners/${existing.id}`, "PUT", body);
      else await send("/api/veranstaltungen/partners", "POST", body);
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    if (!existing) return;
    const res = (await send(`/api/veranstaltungen/partners/${existing.id}`, "POST", { action: "rotate" })) as { portalToken?: string };
    setToken(res.portalToken ?? null);
    setConfirm(null);
    router.refresh();
  }

  async function remove() {
    if (!existing) return;
    await send(`/api/veranstaltungen/partners/${existing.id}`, "DELETE");
    router.refresh();
    onClose();
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
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : "Partner anlegen"}</DialogTitle>
          <DialogDescription>Über den Link trägt der Partner Termine ein, meldet Personen und wählt Zusatzleistungen.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="vp-name">Name *</Label>
            <Input id="vp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Firmenname" className="max-sm:h-11" />
          </div>

<<<<<<< HEAD
          <div className="space-y-1.5">
            <Label htmlFor="vp-logo">Logo des Partners (optional)</Label>
            <Input id="vp-logo" type="url" inputMode="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} maxLength={500}
              placeholder="https://…/logo.png" className="max-sm:h-11" />
            <p className="text-xs text-muted-foreground">Bild-Adresse, z. B. von der Website des Partners. Erscheint oben in seinem Zugang; ohne Logo der Anfangsbuchstabe. Euer Logo kommt aus E-Mail-Einstellungen.</p>
          </div>

=======
>>>>>>> origin/claude/project-thread-iy5t9v
          <label className="glass-tile flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2">
            <span className="text-sm font-medium">Zugang aktiv</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>

          {link ? (
            <div className="space-y-1.5">
              <Label htmlFor="vp-link">Link für den Partner</Label>
              <div className="flex gap-2">
                <Input id="vp-link" readOnly value={link} className="font-mono text-xs max-sm:h-11" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" className="max-sm:size-11" onClick={copy} aria-label="Link kopieren">
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Wer den Link hat, kommt rein. Nur an den Partner geben; bei Verdacht neuen Link erzeugen.</p>
              {existing && confirm !== "rotate" && (
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setConfirm("rotate")}>
                  <RefreshCw className="size-3" /> Neuen Link erzeugen
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Der Link entsteht beim Speichern mit „Zugang aktiv“.</p>
          )}

          <div className="space-y-2">
            <Label>Räume</Label>
            {venues.length === 0 ? (
              <p className="text-sm text-muted-foreground">Noch kein Veranstaltungsraum eingeschaltet.</p>
            ) : (
              <div className="glass-tile divide-y divide-border">
                {venues.map((v) => (
                  <label key={v.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm">
                    <Checkbox checked={areaIds.has(v.id)} onCheckedChange={(on) => setAreaIds((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(v.id); else next.delete(v.id);
                      return next;
                    })} />
                    {v.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vp-lock">Ändern bis (Std. vorher)</Label>
              <Input id="vp-lock" type="number" min={0} inputMode="numeric" value={lockHours} onChange={(e) => setLockHours(e.target.value)} className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vp-horizon">Eintragen (Tage im Voraus)</Label>
              <Input id="vp-horizon" type="number" min={1} inputMode="numeric" value={horizonDays} onChange={(e) => setHorizonDays(e.target.value)} className="max-sm:h-11" />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Danach ändert ihr auf Zuruf. Die tatsächliche Personenzahl meldet der Partner bis zur Schlussrechnung.</p>

          <SectionHeading title="Benachrichtigungen" />
          <div className="space-y-1.5">
            <Label htmlFor="vp-cname">Ansprechpartner (optional)</Label>
            <Input id="vp-cname" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} className="max-sm:h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vp-cmail">E-Mail des Partners</Label>
            <Input id="vp-cmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={200} className="max-sm:h-11" />
            <p className="text-xs text-muted-foreground">Bekommt eine Mail bei Bestätigung, Absage und neuem Dokument (ohne Anhang, mit Link).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vp-nmail">E-Mail an uns</Label>
            <Input id="vp-nmail" type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} maxLength={200} className="max-sm:h-11" />
            <p className="text-xs text-muted-foreground">Wenn der Partner einträgt, ändert, absagt oder Personen meldet. Push aufs Handy kommt immer.</p>
          </div>
        </div>
        {error && <Notice tone="danger" title={error} compact />}
        {confirm === "rotate" ? (
          <ConfirmStep title="Neuen Link erzeugen?" description="Der bisherige Link funktioniert dann sofort nicht mehr." confirmLabel="Neuer Link"
            onConfirm={rotate} onCancel={() => setConfirm(null)} />
        ) : confirm === "delete" ? (
          <ConfirmStep title={`${existing?.name} löschen?`} description="Geht nur, solange der Partner keine Termine hat." icon={Trash2}
            onConfirm={remove} onCancel={() => setConfirm(null)} />
        ) : (
          <DialogFooter className="gap-2">
            {existing && existing.eventCount === 0 && (
              <Button variant="outline" className="sm:mr-auto" onClick={() => setConfirm("delete")} disabled={busy}><Trash2 /> Löschen</Button>
            )}
            <Button variant="outline" onClick={onClose} disabled={busy}>Abbrechen</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>{busy && <Loader2 className="animate-spin" />} Speichern</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
