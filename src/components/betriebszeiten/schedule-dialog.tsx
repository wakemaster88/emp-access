"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorLine, apiRequest } from "@/components/raeume/shared";
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
  open,
  disabled,
  onClose,
}: {
  /** `null` = neues Profil anlegen. */
  schedule: ScheduleRow | null;
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(schedule?.name ?? "");
  const [description, setDescription] = useState(schedule?.description ?? "");
  const [isDefault, setIsDefault] = useState(schedule?.isDefault ?? false);
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
      isDefault,
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {schedule ? `Betriebszeit: ${schedule.name}` : "Neue Betriebszeit"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                disabled={disabled}
                placeholder="z.B. Strandbad"
                className="h-8 text-xs"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="min-w-40 flex-[2] space-y-1">
              <Label className="text-xs">Beschreibung</Label>
              <Input
                value={description}
                disabled={disabled}
                placeholder="optional"
                className="h-8 text-xs"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={isDefault}
              disabled={disabled}
              className="h-3.5 w-3.5"
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Vorbelegung für neue Räume
          </label>

          <Tabs defaultValue="seasons">
            <TabsList className="h-8">
              <TabsTrigger value="seasons" className="text-xs">
                Saisons ({seasons.length})
              </TabsTrigger>
              <TabsTrigger value="exceptions" className="text-xs">
                Ausnahmetage ({exceptions.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="seasons" className="mt-2 space-y-2">
              {seasons.length === 0 && (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  Ohne Saison gilt dieses Profil als dauerhaft geschlossen.
                </p>
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
                className="h-8 text-xs"
                onClick={() => setSeasons([...seasons, defaultSeason()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Saison
              </Button>
              {seasons.length > 1 && (
                <p className="text-[11px] text-neutral-500">
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

          <ErrorLine message={error} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || disabled}
            className="h-8 min-w-24 bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" />
                Speichern
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
