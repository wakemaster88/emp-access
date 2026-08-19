"use client";

import { useEffect, useState } from "react";
import { CamSchema, REOLINK_CAPS, REOLINK_MODELS, type Cam } from "@/lib/types";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { LineEditor } from "@/components/admin/line-editor";
import { PtzAutoSection } from "@/components/admin/ptz-auto-section";
import { PeopleHistoryCard } from "@/components/admin/people-history-card";

interface CamFormProps {
  initial?: Cam;
  /** Alle Kameras — für die Auswahl zusätzlicher Blickwinkel. */
  allCams?: Cam[];
  onSaved: (cam: Cam) => void;
  onCancel: () => void;
}

const EMPTY: Cam = {
  id: "",
  name: "",
  model: "RLC-810A",
  ip: "",
  port: 80,
  rtspPort: 554,
  username: "admin",
  password: "",
  channel: 0,
  streamMain: "h264Preview_01_main",
  streamSub: "h264Preview_01_sub",
  enabled: true,
  peopleCounter: {
    enabled: false,
    intervalSec: 60,
    mode: "presence",
    line: null,
    direction: "ab",
  },
  ptzAuto: {
    mode: "off",
    patrol: { presetIds: [], dwellSec: 20 },
    follow: {
      targetClass: "person",
      controlMode: "continuous",
      deadbandPct: 0.06,
      outerDeadbandPct: 0.10,
      maxPulseMs: 200,
      speedMin: 6,
      speedMax: 40,
      smoothingAlpha: 0.45,
      latencyCompMs: 300,
      returnHomeAfterSec: 15,
      homePresetId: null,
      zoomEnabled: false,
      zoomTargetRatio: 0.4,
    },
  },
  empAccess: { enabled: false, deviceIds: [] },
  tailgate: {
    enabled: false,
    deviceIds: [],
    countDirection: "in",
    windowSec: 600,
    tolerance: 3,
    cooldownSec: 900,
    contextCamIds: [],
    instantAlert: true,
    notifyShopMonitor: true,
  },
  alpr: { enabled: false, openDoorbird: false },
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseEmpDeviceIds(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,\s]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(t);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

export function CamForm({
  initial,
  allCams = [],
  onSaved,
  onCancel,
}: CamFormProps) {
  const editing = !!initial;
  const [data, setData] = useState<Cam>(initial ?? EMPTY);
  const [empIdsText, setEmpIdsText] = useState(
    () => (initial ?? EMPTY).empAccess.deviceIds.join(", "),
  );
  const [tailgateIdsText, setTailgateIdsText] = useState(
    () => (initial ?? EMPTY).tailgate.deviceIds.join(", "),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [autoId, setAutoId] = useState(!editing);
  const { toast } = useToast();

  useEffect(() => {
    if (initial) {
      setEmpIdsText(initial.empAccess.deviceIds.join(", "));
      setTailgateIdsText(initial.tailgate.deviceIds.join(", "));
    }
  }, [initial?.id]);

  useEffect(() => {
    if (autoId && data.name) {
      const id = `cam-${slugify(data.name)}`;
      if (id !== data.id) setData((d) => ({ ...d, id }));
    }
  }, [data.name, autoId, data.id]);

  function update<K extends keyof Cam>(key: K, value: Cam[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    setErrors({});
    const parsed = CamSchema.safeParse(data);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path.join(".");
        errs[k] = issue.message;
      }
      setErrors(errs);
      toast("Bitte Pflichtfelder prüfen", "error");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/cams/${initial!.id}` : "/api/cams";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await r.json();
      if (!r.ok) {
        toast(json.error ?? "Speichern fehlgeschlagen", "error");
        return;
      }
      toast(editing ? "Kamera aktualisiert" : "Kamera angelegt", "success");
      onSaved(json.cam ?? parsed.data);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!editing) {
      toast("Erst speichern, dann testen.", "info");
      return;
    }
    const r = await fetch(`/api/cams/${initial!.id}/test`, { method: "POST" });
    const json = await r.json();
    if (json.ok) {
      const m = json.info?.DevInfo?.model ?? "unbekannt";
      toast(`Verbindung ok – Modell: ${m}`, "success");
    } else {
      toast(`Verbindung fehlgeschlagen: ${json.error}`, "error");
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" hint="Wird im Dashboard angezeigt" error={errors.name}>
        <Input
          value={data.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Eingang, Hof, Tor …"
          autoFocus
        />
      </Field>
      <Field label="ID" hint="technische ID; aus Name abgeleitet" error={errors.id}>
        <Input
          value={data.id}
          onChange={(e) => {
            update("id", e.target.value);
            setAutoId(false);
          }}
          disabled={editing}
          placeholder="cam-eingang"
        />
      </Field>

      <Field label="Modell" error={errors.model}>
        <Select value={data.model} onChange={(e) => update("model", e.target.value as Cam["model"])}>
          {REOLINK_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="IP-Adresse" error={errors.ip}>
        <Input
          value={data.ip}
          onChange={(e) => update("ip", e.target.value)}
          placeholder="192.168.1.51"
        />
      </Field>

      <Field label="HTTP-Port" error={errors.port}>
        <Input
          type="number"
          value={data.port}
          onChange={(e) => update("port", Number(e.target.value))}
        />
      </Field>
      <Field label="RTSP-Port" error={errors.rtspPort}>
        <Input
          type="number"
          value={data.rtspPort}
          onChange={(e) => update("rtspPort", Number(e.target.value))}
        />
      </Field>

      <Field label="Benutzername" error={errors.username}>
        <Input value={data.username} onChange={(e) => update("username", e.target.value)} />
      </Field>
      <Field label="Passwort" error={errors.password} hint={editing ? "Leer lassen = unverändert" : ""}>
        <Input
          type="password"
          value={data.password === "***" ? "" : data.password}
          onChange={(e) => update("password", e.target.value)}
          placeholder={editing ? "(unverändert)" : ""}
        />
      </Field>

      <Field label="Channel" hint="Bei NVR-Anschluss; sonst 0">
        <Input
          type="number"
          value={data.channel}
          onChange={(e) => update("channel", Number(e.target.value))}
        />
      </Field>
      <Field label="Aktiv">
        <div className="flex h-10 items-center">
          <Switch checked={data.enabled} onChange={(v) => update("enabled", v)} />
        </div>
      </Field>

      <Field label="Stream Main" hint="z. B. h264Preview_01_main">
        <Input value={data.streamMain} onChange={(e) => update("streamMain", e.target.value)} />
      </Field>
      <Field label="Stream Sub" hint="z. B. h264Preview_01_sub">
        <Input value={data.streamSub} onChange={(e) => update("streamSub", e.target.value)} />
      </Field>

      {REOLINK_CAPS[data.model].ptz && (
        <div className="sm:col-span-2 mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
          <div className="mb-2">
            <div className="text-sm font-medium">PTZ-Auto-Pilot</div>
            <div className="text-xs text-foreground/60">
              Patrol durch Presets, Follow für automatisches Verfolgen, oder
              beides kombiniert. Manuelle PTZ-Eingriffe (Joystick) pausieren
              den Auto-Pilot 90 s.
            </div>
          </div>
          <PtzAutoSection
            cam={data}
            editing={editing}
            value={data.ptzAuto}
            onChange={(ptzAuto) => update("ptzAuto", ptzAuto)}
          />
        </div>
      )}

      <div className="sm:col-span-2 mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Personen zählen (KI)</div>
            <div className="text-xs text-foreground/60">
              Anwesenheit per Snapshot (Ollama) oder gerichtetes Zählen (rein/raus)
              über den Tracker-Sidecar.
            </div>
          </div>
          <Switch
            checked={data.peopleCounter.enabled}
            onChange={(v) =>
              update("peopleCounter", { ...data.peopleCounter, enabled: v })
            }
          />
        </div>
        {data.peopleCounter.enabled && (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Modus" hint="Anwesenheit zählt sichtbare Personen pro Snapshot; Crossing zählt rein/raus über eine Linie">
                <Select
                  value={data.peopleCounter.mode}
                  onChange={(e) =>
                    update("peopleCounter", {
                      ...data.peopleCounter,
                      mode: e.target.value as Cam["peopleCounter"]["mode"],
                    })
                  }
                >
                  <option value="presence">Anwesenheit (Ollama)</option>
                  <option value="crossing">Crossing rein/raus (Sidecar)</option>
                </Select>
              </Field>
              {data.peopleCounter.mode === "presence" && (
                <Field
                  label="Intervall (Sekunden)"
                  hint="60 s ist ein guter Default; Minimum 15 s"
                  error={errors["peopleCounter.intervalSec"]}
                >
                  <Input
                    type="number"
                    min={15}
                    max={3600}
                    value={data.peopleCounter.intervalSec}
                    onChange={(e) =>
                      update("peopleCounter", {
                        ...data.peopleCounter,
                        intervalSec: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
            </div>
            {data.peopleCounter.mode === "crossing" && (
              <>
                {editing ? (
                  <LineEditor
                    camId={data.id}
                    value={data.peopleCounter.line}
                    onChange={(line) =>
                      update("peopleCounter", { ...data.peopleCounter, line })
                    }
                    direction={data.peopleCounter.direction}
                    onDirectionChange={(direction) =>
                      update("peopleCounter", { ...data.peopleCounter, direction })
                    }
                  />
                ) : (
                  <p className="text-xs text-foreground/60">
                    Erst speichern, dann kann die Linie auf einem Live-Snapshot gesetzt werden.
                  </p>
                )}
                <p className="text-[11px] leading-snug text-foreground/50">
                  Der Tracker-Sidecar (siehe <code>tracker/</code>) muss laufen.
                  Nach dem Speichern wird er automatisch über <code>/reload</code> informiert.
                </p>
                {editing && data.id && (
                  <PeopleHistoryCard camId={data.id} days={14} />
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="sm:col-span-2 mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Kennzeichenerkennung</div>
            <div className="text-xs text-foreground/60">
              Optional im Kontrollzentrum. Kennzeichen und Türöffnung laufen
              am Hub (Fahrzeuge auf emp-access.de). Hier nur Anzeige, die Tür
              öffnet der Kiosk standardmäßig nicht.
            </div>
          </div>
          <Switch
            checked={data.alpr.enabled}
            onChange={(v) => update("alpr", { ...data.alpr, enabled: v })}
          />
        </div>
        {data.alpr.enabled && (
          <Field label="Bei Treffer Tür öffnen">
            <div className="flex h-10 items-center">
              <Switch
                checked={data.alpr.openDoorbird}
                onChange={(v) =>
                  update("alpr", { ...data.alpr, openDoorbird: v })
                }
              />
            </div>
          </Field>
        )}
      </div>

      <div className="sm:col-span-2 mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">emp-access.de</div>
            <div className="text-xs text-foreground/60">
              Geräte-IDs aus der emp-access-Konsole; Zugang ok / abgelehnt erscheint als Overlay
              auf dem Kamera-Tile. API-Token unter Einstellungen.
            </div>
          </div>
          <Switch
            checked={data.empAccess.enabled}
            onChange={(v) => update("empAccess", { ...data.empAccess, enabled: v })}
          />
        </div>
        {data.empAccess.enabled && (
          <Field
            label="Geräte-IDs"
            hint="Kommagetrennt, z. B. 1, 2, 5 (positive Ganzzahlen)"
            error={errors["empAccess.deviceIds"]}
          >
            <Input
              value={empIdsText}
              onChange={(e) => setEmpIdsText(e.target.value)}
              onBlur={() => {
                const ids = parseEmpDeviceIds(empIdsText);
                setEmpIdsText(ids.join(", "));
                setData((d) => ({
                  ...d,
                  empAccess: { ...d.empAccess, deviceIds: ids },
                }));
              }}
              placeholder="1, 2"
            />
          </Field>
        )}
      </div>

      <div className="sm:col-span-2 mt-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Drehkreuz-Kontrolle</div>
            <div className="text-xs text-foreground/60">
              Vergleicht die gezählten Durchgänge mit den gültigen Scans dieser
              Geräte. Braucht den Personenzähler im Modus „Linie überqueren".
            </div>
          </div>
          <Switch
            checked={data.tailgate.enabled}
            onChange={(v) => update("tailgate", { ...data.tailgate, enabled: v })}
          />
        </div>
        {data.tailgate.enabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Geräte-IDs"
              hint="Alle Drehkreuze, die diese Kamera sieht"
              error={errors["tailgate.deviceIds"]}
              className="sm:col-span-2"
            >
              <Input
                value={tailgateIdsText}
                onChange={(e) => setTailgateIdsText(e.target.value)}
                onBlur={() => {
                  const ids = parseEmpDeviceIds(tailgateIdsText);
                  setTailgateIdsText(ids.join(", "));
                  setData((d) => ({
                    ...d,
                    tailgate: { ...d.tailgate, deviceIds: ids },
                  }));
                }}
                placeholder="49, 51, 53"
              />
            </Field>
            <Field label="Geprüfte Richtung">
              <Select
                value={data.tailgate.countDirection}
                onChange={(e) =>
                  update("tailgate", {
                    ...data.tailgate,
                    countDirection: e.target.value as "in" | "out",
                  })
                }
              >
                <option value="in">Rein</option>
                <option value="out">Raus</option>
              </Select>
            </Field>
            <Field label="Zeitfenster (Sekunden)" hint="60 bis 3600">
              <Input
                type="number"
                min={60}
                max={3600}
                step={60}
                value={data.tailgate.windowSec}
                onChange={(e) =>
                  update("tailgate", {
                    ...data.tailgate,
                    windowSec: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field
              label="Alarm ab"
              hint="Ungedeckte Durchgänge im Fenster. Zu klein = Fehlalarme."
            >
              <Input
                type="number"
                min={1}
                max={50}
                value={data.tailgate.tolerance}
                onChange={(e) =>
                  update("tailgate", {
                    ...data.tailgate,
                    tolerance: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Sperrfrist (Sekunden)" hint="Pause nach einem Alarm">
              <Input
                type="number"
                min={60}
                max={7200}
                step={60}
                value={data.tailgate.cooldownSec}
                onChange={(e) =>
                  update("tailgate", {
                    ...data.tailgate,
                    cooldownSec: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field
              label="Sofortmeldung"
              hint="Ton im Kontrollzentrum, sobald ein einzelner Durchgang keinen passenden Scan hat. Reagiert nach wenigen Sekunden und ist dafür fehleranfälliger als der Fenster-Abgleich oben."
              className="sm:col-span-2"
            >
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={data.tailgate.instantAlert}
                    onChange={(v) =>
                      update("tailgate", { ...data.tailgate, instantAlert: v })
                    }
                  />
                  Ton im Kontrollzentrum
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={data.tailgate.notifyShopMonitor}
                    onChange={(v) =>
                      update("tailgate", {
                        ...data.tailgate,
                        notifyShopMonitor: v,
                      })
                    }
                  />
                  Popup auf dem Kassen-Monitor
                </label>
              </div>
            </Field>
            <Field
              label="Zusätzliche Blickwinkel"
              hint="Von diesen Kameras wird bei jedem Durchgang ein Bild mitgespeichert — hilfreich, wenn die Zählkamera keine Gesichter zeigt."
              className="sm:col-span-2"
            >
              <div className="flex flex-wrap gap-2">
                {allCams
                  .filter((c) => c.id !== data.id)
                  .map((c) => {
                    const on = data.tailgate.contextCamIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          update("tailgate", {
                            ...data.tailgate,
                            contextCamIds: on
                              ? data.tailgate.contextCamIds.filter(
                                  (x) => x !== c.id,
                                )
                              : [...data.tailgate.contextCamIds, c.id],
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          on
                            ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                            : "border-white/10 text-foreground/60 hover:border-white/25"
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </Field>
          </div>
        )}
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-2">
        <Button variant="secondary" onClick={testConnection} disabled={!editing}>
          Verbindung testen
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Speichere…" : editing ? "Speichern" : "Anlegen"}
          </Button>
        </div>
      </div>

      {editing && (
        <p className="sm:col-span-2 text-xs text-foreground/50">
          Beim Speichern wird die go2rtc-Konfiguration neu generiert und der Dienst
          (sofern erreichbar) automatisch neu geladen.
        </p>
      )}
    </div>
  );
}
