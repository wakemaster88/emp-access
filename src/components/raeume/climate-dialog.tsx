"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ErrorLine, apiRequest, shortDeviceName } from "@/components/raeume/shared";
import type { RoomClimateView, RoomDevice, ScheduleOption } from "@/components/raeume/types";
import { cn } from "@/lib/utils";

const HEATER_RE = /heiz|klima|radiator|ofen/i;
const FAN_RE = /l(ü|ue)ft|ventil/i;

/** "12:00" um Minuten verschieben, fuer das Beispiel im Dialog. */
function shiftLabel(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Klima eines Raums einstellen: Fuehler, Heizung(en), Solltemperatur zur
 * Betriebszeit, Absenkung ausserhalb, Vorheizen. Gespeichert in der Cloud,
 * geregelt im 5-Minuten-Takt (src/lib/room-climate.ts).
 */
export function ClimateDialog({
  roomId,
  roomName,
  roomScheduleName,
  climate,
  roomDevices,
  allShellys,
  scheduleOptions,
  onClose,
}: {
  roomId: number;
  roomName: string;
  /** Betriebszeit des Raums, falls gesetzt. */
  roomScheduleName: string | null;
  climate: RoomClimateView | null;
  roomDevices: RoomDevice[];
  /** Alle Shelly-Geraete des Mandanten, falls Fuehler oder Heizung in einem anderen Raum haengen. */
  allShellys: RoomDevice[];
  scheduleOptions: ScheduleOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const inRoom = new Set(roomDevices.map((d) => d.id));
  const shellys = [...allShellys].sort((a, b) => Number(inRoom.has(b.id)) - Number(inRoom.has(a.id)));
  const sensorChoices = shellys.filter((d) => d.category === "SENSOR" || /temperatur|fühler|thermo/i.test(d.name));
  const heaterChoices = shellys.filter(
    (d) => !["SENSOR", "MARKISE", "ROLLTOR", "BELEUCHTUNG", "TUER", "DREHKREUZ", "TASTER"].includes(d.category ?? ""),
  );
  const suggestedSensor = sensorChoices.find((d) => inRoom.has(d.id))?.id ?? null;
  const suggestedHeaters = heaterChoices.filter((d) => inRoom.has(d.id) && HEATER_RE.test(d.name)).map((d) => d.id);
  const suggestedFans = heaterChoices.filter((d) => inRoom.has(d.id) && FAN_RE.test(d.name)).map((d) => d.id);

  const [isActive, setIsActive] = useState(climate?.isActive ?? true);
  const [sensorId, setSensorId] = useState<number | null>(climate?.sensorDeviceId ?? suggestedSensor);
  const [heaterIds, setHeaterIds] = useState<number[]>(climate?.heaterDeviceIds ?? suggestedHeaters);
  const [fanIds, setFanIds] = useState<number[]>(climate?.fanDeviceIds ?? suggestedFans);
  const [fanOn, setFanOn] = useState(String(climate?.fanOnHumidity ?? 65).replace(".", ","));
  const [fanOff, setFanOff] = useState(String(climate?.fanOffHumidity ?? 58).replace(".", ","));
  const [fanAfterrun, setFanAfterrun] = useState(String(climate?.fanAfterrunMinutes ?? 45));
  const [fanMinTemp, setFanMinTemp] = useState(String(climate?.fanMinTempC ?? 8).replace(".", ","));
  const [targetC, setTargetC] = useState(String(climate?.targetC ?? 21).replace(".", ","));
  const [setbackOn, setSetbackOn] = useState(climate?.setbackC != null);
  const [setbackC, setSetbackC] = useState(String(climate?.setbackC ?? 16).replace(".", ","));
  const [preheat, setPreheat] = useState(String(climate?.preheatMinutes ?? 30));
  const [afterrun, setAfterrun] = useState(String(climate?.afterrunMinutes ?? 30));
  const [hysteresis, setHysteresis] = useState(String(climate?.hysteresisC ?? 0.5).replace(".", ","));
  const [scheduleId, setScheduleId] = useState<number | null>(climate?.operatingScheduleId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const label = (d: RoomDevice) =>
    inRoom.has(d.id) ? shortDeviceName(d.name, roomName) : d.name;

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest("/api/klima", "PUT", {
      roomId,
      isActive,
      sensorDeviceId: sensorId,
      heaterDeviceIds: heaterIds,
      fanDeviceIds: fanIds,
      fanOnHumidity: fanOn,
      fanOffHumidity: fanOff,
      fanAfterrunMinutes: fanAfterrun,
      fanMinTempC: fanMinTemp,
      targetC,
      setbackC: setbackOn ? setbackC : null,
      preheatMinutes: preheat,
      afterrunMinutes: afterrun,
      hysteresisC: hysteresis,
      operatingScheduleId: scheduleId,
    });
    setSaving(false);
    if (!res.ok) return setError(res.message);
    onClose();
    router.refresh();
  }

  async function remove() {
    setSaving(true);
    const res = await apiRequest(`/api/klima?roomId=${roomId}`, "DELETE");
    setSaving(false);
    if (!res.ok) return setError(res.message);
    onClose();
    router.refresh();
  }

  const scheduleName = scheduleId
    ? scheduleOptions.find((o) => o.id === scheduleId)?.name ?? null
    : roomScheduleName;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] min-w-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Klima · {roomName}</DialogTitle>
          <DialogDescription className="text-xs">
            Die Cloud prüft alle 5 Minuten die Temperatur und schaltet die Heizung. Fällt der Fühler aus,
            bleibt die Heizung aus; jedes Einschalten hat einen 15-Minuten-Auto-Aus im Shelly.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Solltemperatur (°C)</Label>
              <Input inputMode="decimal" value={targetC} onChange={(e) => setTargetC(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Gilt während</Label>
              <NativeSelect
                value={scheduleId ?? ""}
                onChange={(e) => setScheduleId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">
                  {roomScheduleName ? `Betriebszeit des Raums (${roomScheduleName})` : "immer (Raum ohne Betriebszeit)"}
                </option>
                {scheduleOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {scheduleName && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Vorlauf (Min. vor Öffnung)</Label>
                  <Input inputMode="numeric" value={preheat} onChange={(e) => setPreheat(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nachlauf (Min. nach Schluss)</Label>
                  <Input inputMode="numeric" value={afterrun} onChange={(e) => setAfterrun(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Beispiel: {scheduleName} 12–16 Uhr mit {preheat || 0} / {afterrun || 0} Min. → Heizung hält {targetC} °C von{" "}
                {shiftLabel("12:00", -(Number(preheat) || 0))} bis {shiftLabel("16:00", Number(afterrun) || 0)} Uhr.
              </p>
              <div className="space-y-1">
                <Label className="flex items-center justify-between text-xs">
                  Außerhalb dieser Zeit
                  <span className="flex items-center gap-1.5 font-normal text-muted-foreground">
                    {setbackOn ? "absenken" : "Heizung aus"}
                    <Switch size="sm" checked={setbackOn} onCheckedChange={setSetbackOn} aria-label="Absenkung" />
                  </span>
                </Label>
                <Input
                  inputMode="decimal"
                  value={setbackOn ? setbackC : ""}
                  placeholder="aus"
                  disabled={!setbackOn}
                  onChange={(e) => setSetbackC(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Temperaturfühler</Label>
            <NativeSelect
              value={sensorId ?? ""}
              onChange={(e) => setSensorId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Fühler wählen …</option>
              {(sensorChoices.length ? sensorChoices : shellys).map((d) => (
                <option key={d.id} value={d.id}>
                  {label(d)}
                  {inRoom.has(d.id) ? "" : " (anderer Raum)"}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Heizung</Label>
            <SwitchList
              choices={heaterChoices.filter((d) => !fanIds.includes(d.id))}
              selected={heaterIds}
              onChange={setHeaterIds}
              label={label}
              inRoom={inRoom}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Lüftung nach Luftfeuchte</Label>
            <SwitchList
              choices={heaterChoices.filter((d) => !heaterIds.includes(d.id))}
              selected={fanIds}
              onChange={setFanIds}
              label={label}
              inRoom={inRoom}
            />
            {fanIds.length > 0 && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-[11px]">An ab (%)</Label>
                  <Input inputMode="decimal" value={fanOn} onChange={(e) => setFanOn(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Aus unter (%)</Label>
                  <Input inputMode="decimal" value={fanOff} onChange={(e) => setFanOff(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Nachlauf (Min.)</Label>
                  <Input inputMode="numeric" value={fanAfterrun} onChange={(e) => setFanAfterrun(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Nie unter (°C)</Label>
                  <Input inputMode="decimal" value={fanMinTemp} onChange={(e) => setFanMinTemp(e.target.value)} />
                </div>
                <p className="col-span-full text-[11px] text-muted-foreground">
                  Lüftet ab {fanOn} % bis unter {fanOff} %, nach Betriebsende immer {fanAfterrun} Min. zum Trocknen. Unter{" "}
                  {fanMinTemp} °C wird nie gelüftet (Frostschutz geht vor).
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Spielraum (± °C)</Label>
              <Input inputMode="decimal" value={hysteresis} onChange={(e) => setHysteresis(e.target.value)} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-xs">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              Regelung aktiv
            </label>
          </div>

          <ErrorLine message={error} />
        </div>

        <div className="flex items-center gap-2">
          {climate && (
            <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={saving} className="h-8 text-destructive">
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Entfernen
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
              Abbrechen
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving} className="h-8 min-w-24">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (<><Save className="mr-1 h-3.5 w-3.5" />Speichern</>)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SwitchList({
  choices,
  selected,
  onChange,
  label,
  inRoom,
}: {
  choices: RoomDevice[];
  selected: number[];
  onChange: (ids: number[]) => void;
  label: (d: RoomDevice) => string;
  inRoom: Set<number>;
}) {
  return (
    <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
      {choices.length === 0 && <p className="p-2 text-[11px] text-muted-foreground">Keine Shelly-Schalter.</p>}
      {choices.map((d) => {
        const checked = selected.includes(d.id);
        return (
          <label
            key={d.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-xs max-sm:min-h-11",
              checked ? "bg-primary/10" : "hover:bg-muted/50",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() => onChange(checked ? selected.filter((x) => x !== d.id) : [...selected, d.id])}
            />
            <span className="min-w-0 flex-1 break-words">{label(d)}</span>
            {!inRoom.has(d.id) && <span className="shrink-0 text-[10px] text-muted-foreground">anderer Raum</span>}
          </label>
        );
      })}
    </div>
  );
}
