"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, DoorOpen, ToggleRight, RotateCcw, Loader2, Pencil,
  Power, PowerOff, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DeviceActionsProps {
  deviceId: number;
  deviceType: string;
  deviceCategory?: string | null;
  currentTask: number;
  isActive: boolean;
  onEdit: () => void;
}

// Tastenfarbe nach Rolle wie in `lib/device-controls`: Öffnen/Einschalten
// primär, NOT-AUF Gefahr, alles andere Glas.
type ActionVariant = "default" | "secondary" | "destructive";

// Actions for access control devices (Drehkreuz, Tür)
const ACCESS_ACTIONS: { key: string; label: string; icon: typeof AlertTriangle; variant: ActionVariant; activeTask: number }[] = [
  { key: "emergency",  label: "NOT-AUF",     icon: AlertTriangle, variant: "destructive", activeTask: 2 },
  { key: "open",       label: "Öffnen",       icon: DoorOpen,      variant: "default",     activeTask: 1 },
  { key: "deactivate", label: "Deaktivieren", icon: ToggleRight,   variant: "secondary",   activeTask: 3 },
  { key: "reset",      label: "Reset",        icon: RotateCcw,     variant: "secondary",   activeTask: 0 },
];

// Actions for Drehkreuz only – includes NOT-AUF
// Tür skips NOT-AUF (no DREHKREUZ = emergency open not needed)
const TUER_ACTIONS = ACCESS_ACTIONS.filter((a) => a.key !== "emergency");

// Actions for Schalter & Beleuchtung
const SWITCH_ACTIONS: { key: string; label: string; icon: typeof Power; variant: ActionVariant; activeTask: number }[] = [
  { key: "open",  label: "Einschalten", icon: Power,    variant: "default",   activeTask: 1 },
  { key: "reset", label: "Ausschalten", icon: PowerOff, variant: "secondary", activeTask: 0 },
];

export function DeviceActions({ deviceId, deviceCategory, currentTask, onEdit }: DeviceActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [task, setTask] = useState(currentTask);

  const isSensor = deviceCategory === "SENSOR";
  const isDrehkreuz = deviceCategory === "DREHKREUZ";
  const isTuer = deviceCategory === "TUER";
  const isSwitch = deviceCategory === "SCHALTER" || deviceCategory === "BELEUCHTUNG";

  const actions = isDrehkreuz ? ACCESS_ACTIONS
    : isTuer    ? TUER_ACTIONS
    : isSwitch  ? SWITCH_ACTIONS
    : [];

  async function handleAction(action: string) {
    setLoading(action);
    try {
      const res = await fetch(`/api/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setTask(data.task);
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5 max-sm:h-11">
        <Pencil className="h-4 w-4" />
        Bearbeiten
      </Button>

      {isSensor ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 italic">
          <Activity className="h-3.5 w-3.5" /> Sensor – nur Anzeige
        </span>
      ) : isSwitch ? (() => {
        const isOn = task === 1;
        const a = isOn ? SWITCH_ACTIONS[1] : SWITCH_ACTIONS[0];
        const Icon = a.icon;
        return (
          <Button
            size="sm"
            variant={a.variant}
            onClick={() => handleAction(a.key)}
            disabled={loading !== null}
            className="max-sm:h-11"
          >
            {loading === a.key
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Icon className="h-4 w-4" />}
            {a.label}
          </Button>
        );
      })() : (
        actions.map((a) => {
          const Icon = a.icon;
          const isActiveTask = task === a.activeTask && a.key !== "reset";
          return (
            <Button
              key={a.key}
              size="sm"
              variant={a.variant}
              onClick={() => handleAction(a.key)}
              disabled={loading !== null}
              className={cn(
                "max-sm:h-11",
                isActiveTask && "outline-solid outline-2 outline-offset-2 outline-primary"
              )}
            >
              {loading === a.key
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Icon className="h-4 w-4" />}
              {a.label}
            </Button>
          );
        })
      )}
    </div>
  );
}
