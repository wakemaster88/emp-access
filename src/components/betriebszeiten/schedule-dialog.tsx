"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import { cleanFacilities, facilityKey } from "@/lib/facility-overlap";
import {
  OPERATING_ROLES,
  OPERATING_ROLE_LABELS,
  isOperatingRole,
  type OperatingRoleKind,
} from "@/lib/operating-role";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/components/raeume/shared";
import { ExceptionEditor } from "@/components/betriebszeiten/exception-editor";
import { SeasonEditor } from "@/components/betriebszeiten/season-editor";
import type { ExceptionSpec, ScheduleRow, SeasonSpec } from "@/components/betriebszeiten/types";

/** Ganzjährig geöffnet, Mo–So 10–18 Uhr: Startpunkt für ein neues Profil. */
function defaultSeason(): SeasonSpec {
  return {
    name: "Ganzjährig",
    startMmDd: "01-01",
    endMmDd: "12-31",
    sortOrder: 0,
    periods: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      opensAt: "10:00",
      closesAt: "18:00",
    })),
  };
}

export function ScheduleDialog({
  schedule,
  schedules,
  initialParentId = null,
  open,
  disabled,
  onClose,
}: {
  /** `null` = neues Profil anlegen. */
  schedule: ScheduleRow | null;
  /** Alle Profile: Auswahl „Gehört zu“ und bekannte Anlagen. */
  schedules: ScheduleRow[];
  /** Beim Anlegen: gleich als Unterprofil dieses Bereichs. */
  initialParentId?: number | null;
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(schedule?.name ?? "");
  const [description, setDescription] = useState(schedule?.description ?? "");
  const [isDefault, setIsDefault] = useState(schedule?.isDefault ?? false);
  const [parentId, setParentId] = useState<number | null>(schedule ? schedule.parentId : initialParentId);
  const [facilities, setFacilities] = useState<string[]>(() => schedule?.facilities ?? []);
  const [newFacility, setNewFacility] = useState("");
  const [annyResourceId, setAnnyResourceId] = useState(schedule?.annyResourceId ?? "");
  const [sharedTime, setSharedTime] = useState(schedule?.sharedTime ?? false);
  const [role, setRole] = useState<OperatingRoleKind | null>(schedule?.role ?? null);

  // Gleiche Verwendung an einem anderen Profil: wechselt beim Speichern hierher.
  const roleOwner = role ? schedules.find((s) => s.role === role && s.id !== schedule?.id) ?? null : null;
  // Nur eine Ebene: Oberprofile sind Bereiche ohne eigenes Oberprofil, nie das Profil selbst.
  const parents = schedules.filter((s) => s.parentId == null && s.id !== schedule?.id);
  const hasChildren = schedule != null && schedules.some((s) => s.parentId === schedule.id);
  // Bekannte Anlagen aus allen Profilen, dazu die des Profils selbst.
  const knownFacilities = cleanFacilities([...schedules.flatMap((s) => s.facilities), ...facilities]);
  const selectedKeys = new Set(facilities.map(facilityKey));

  function toggleFacility(name: string) {
    const key = facilityKey(name);
    setFacilities((prev) =>
      prev.some((f) => facilityKey(f) === key) ? prev.filter((f) => facilityKey(f) !== key) : [...prev, name],
    );
  }

  function addFacility() {
    const name = newFacility.trim();
    if (!name) return;
    setFacilities((prev) => cleanFacilities([...prev, name]));
    setNewFacility("");
  }
  const [seasons, setSeasons] = useState<SeasonSpec[]>(
    () => (schedule?.seasons.length ? schedule.seasons : [defaultSeason()]),
  );
  const [exceptions, setExceptions] = useState<ExceptionSpec[]>(() => schedule?.exceptions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) {
      setError("Bitte einen Namen angeben.");
      return;
    }
    const emptySeason = seasons.find((s) => !s.name.trim());
    if (emptySeason) {
      setError("Jede Saison braucht einen Namen.");
      return;
    }
    const brokenException = exceptions.find((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.date));
    if (brokenException) {
      setError("Jeder Ausnahmetag braucht ein Datum.");
      return;
    }

    setSaving(true);
    setError("");
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      isDefault: parentId == null && isDefault,
      parentId,
      facilities: cleanFacilities(facilities),
      annyResourceId: annyResourceId.trim() || null,
      sharedTime,
      role: parentId == null ? role : null,
      seasons: seasons.map((season, index) => ({ ...season, sortOrder: index })),
      exceptions: exceptions.map((e) => ({
        date: e.date,
        closed: e.closed,
        opensAt: e.closed ? null : e.opensAt,
        closesAt: e.closed ? null : e.closesAt,
        note: e.note?.trim() || null,
      })),
    };
    const res = schedule
      ? await apiRequest(`/api/betriebszeiten/${schedule.id}`, "PUT", payload)
      : await apiRequest("/api/betriebszeiten", "POST", payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {schedule ? `Betriebszeit: ${schedule.name}` : "Neue Betriebszeit"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <Label>Name</Label>
              <Input
                value={name}
                disabled={disabled}
                placeholder="z.B. Strandbad"
                className="max-sm:h-11"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="min-w-40 flex-[2] space-y-1">
              <Label>Beschreibung</Label>
              <Input
                value={description}
                disabled={disabled}
                placeholder="optional"
                className="max-sm:h-11"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <Label htmlFor="sched-parent">Gehört zu</Label>
              <NativeSelect
                id="sched-parent"
                value={parentId ?? ""}
                disabled={disabled || hasChildren}
                onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Eigener Bereich</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    Unterprofil von {p.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground">
                {hasChildren
                  ? "Hat selbst Unterprofile und bleibt ein eigener Bereich."
                  : parentId != null
                    ? "Nicht in der Kunden-App; zählt nicht als Öffnung des Bereichs."
                    : "Eigene Bereiche erscheinen in der Kunden-App."}
              </p>
            </div>
            <div className="min-w-40 flex-1 space-y-1">
              <Label htmlFor="sched-anny">anny-Ressource</Label>
              <Input
                id="sched-anny"
                value={annyResourceId}
                disabled={disabled}
                inputMode="numeric"
                placeholder="z.B. 179480, optional"
                className="max-sm:h-11"
                onChange={(e) => setAnnyResourceId(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-[11px] text-muted-foreground">Für den Abgleich. Leer: über Website und Namen.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label id="sched-facilities-label">Anlagen</Label>
            <div className="flex flex-wrap items-center gap-2">
              {knownFacilities.length > 0 && (
                <ToggleChipGroup aria-labelledby="sched-facilities-label">
                  {knownFacilities.map((f) => (
                    <ToggleChip
                      key={facilityKey(f)}
                      size="sm"
                      disabled={disabled}
                      pressed={selectedKeys.has(facilityKey(f))}
                      onPressedChange={() => toggleFacility(f)}
                    >
                      {f}
                    </ToggleChip>
                  ))}
                </ToggleChipGroup>
              )}
              <div className="flex min-w-44 flex-1 gap-1.5">
                <Input
                  aria-label="Neue Anlage"
                  value={newFacility}
                  disabled={disabled}
                  placeholder="Neue Anlage, z.B. Seilbahn A"
                  className="h-8 text-xs max-sm:h-11"
                  onChange={(e) => setNewFacility(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFacility();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || !newFacility.trim()}
                  className="h-8 shrink-0 text-xs max-sm:h-11"
                  onClick={addFacility}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="sr-only">Anlage hinzufügen</span>
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Profile mit gleicher Anlage dürfen sich zeitlich nicht überschneiden; sonst wird nicht gespeichert.
            </p>
          </div>

          {facilities.length > 0 && (
            <div className="glass-tile flex items-start justify-between gap-3 p-2.5">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="sched-shared">Geteilte Zeit</Label>
                <p className="text-[11px] text-muted-foreground">
                  Für Buchungsangebote wie Bahnmiete und Kurs: dürfen sich mit anderen Profilen mit geteilter Zeit
                  überschneiden, wer zuerst bucht, bekommt die Anlage. Gegen den öffentlichen Betrieb wird weiter geprüft.
                </p>
              </div>
              <Switch id="sched-shared" checked={sharedTime} disabled={disabled} onCheckedChange={setSharedTime} />
            </div>
          )}

          {/* Ja/Nein als Schalterzeile in einer Glas-Kachel wie in den Resource- und Service-Dialogen (docs/design-regeln.md, Abschnitte 14 und 18).
              Unterprofile sind nie Vorbelegung für Räume. */}
          {parentId == null && (
            <div className="glass-tile flex items-center justify-between gap-3 p-2.5">
              <Label htmlFor="sched-default">Vorbelegung für neue Räume</Label>
              <Switch
                id="sched-default"
                checked={isDefault}
                disabled={disabled}
                onCheckedChange={setIsDefault}
              />
            </div>
          )}

          {parentId == null && (
            <div className="space-y-1">
              <Label htmlFor="sched-role">Verwendung</Label>
              <NativeSelect
                id="sched-role"
                disabled={disabled}
                value={role ?? ""}
                onChange={(e) => setRole(isOperatingRole(e.target.value) ? e.target.value : null)}
              >
                <option value="">keine besondere</option>
                {OPERATING_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {OPERATING_ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground">
                {role && roleOwner
                  ? `Bisher bei „${roleOwner.name}“; beim Speichern wechselt die Verwendung hierher.`
                  : "Welche Zeiten Kunden-App, Check-in-Monitor und Beach Pass zeigen. Ohne Angabe entscheidet der Name."}
              </p>
            </div>
          )}

          <Tabs defaultValue="seasons">
            {/* Glas-Kapsel, in der Ebene automatisch getönt (docs/design-regeln.md, Abschnitt 18). */}
            <TabsList>
              <TabsTrigger value="seasons">
                Saisons ({seasons.length})
              </TabsTrigger>
              <TabsTrigger value="exceptions">
                Ausnahmetage ({exceptions.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="seasons" className="mt-2 space-y-2">
              {seasons.length === 0 && (
                <Notice
                  tone="warning"
                  compact
                  title="Ohne Saison gilt dieses Profil als dauerhaft geschlossen."
                />
              )}
              {seasons.map((season, index) => (
                <SeasonEditor
                  key={index}
                  season={season}
                  disabled={disabled}
                  onChange={(next) => setSeasons(seasons.map((s, i) => (i === index ? next : s)))}
                  onRemove={() => setSeasons(seasons.filter((_, i) => i !== index))}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                className="h-8 text-xs max-sm:h-11"
                onClick={() => setSeasons([...seasons, defaultSeason()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Saison
              </Button>
              {seasons.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Überschneiden sich zwei Saisons, gewinnt die obere.
                </p>
              )}
            </TabsContent>

            <TabsContent value="exceptions" className="mt-2">
              <ExceptionEditor
                exceptions={exceptions}
                disabled={disabled}
                onChange={setExceptions}
              />
            </TabsContent>
          </Tabs>

          {error && <Notice tone="danger" compact title={error} />}
        </div>

        {/* Handy: Tasten volle Breite, Primärtaste oben (docs/design-regeln.md, Abschnitt 16).
            Tasten 36 px wie in der Lösch-Rückfrage (Abschnitt 5: 34 bis 44 px). */}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || disabled}
            className="min-w-24 max-sm:h-11"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="h-4 w-4" />
                Speichern
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
