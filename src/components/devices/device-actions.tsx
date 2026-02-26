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

// Actions for access control devices (Drehkreuz, Tür)
const ACCESS_ACTIONS = [
  { key: "emergency",  label: "NOT-AUF",     icon: AlertTriangle, className: "bg-rose-600 hover:bg-rose-700 text-white",   activeTask: 2 },
  { key: "open",       label: "Öffnen",       icon: DoorOpen,      className: "bg-emerald-600 hover:bg-emerald-700 text-white", activeTask: 1 },
  { key: "deactivate", label: "Deaktivieren", icon: ToggleRight,   className: "bg-amber-500 hover:bg-amber-600 text-white",  activeTask: 3 },
  { key: "reset",      label: "Reset",        icon: RotateCcw,     className: "bg-slate-600 hover:bg-slate-700 text-white",  activeTask: 0 },
];

// Actions for Drehkreuz only – includes NOT-AUF
// Tür skips NOT-AUF (no DREHKREUZ = emergency open not needed)
const TUER_ACTIONS = ACCESS_ACTIONS.filter((a) => a.key !== "emergency");

// Actions for Schalter & Beleuchtung
const SWITCH_ACTIONS = [
  { key: "open",  label: "Einschalten", icon: Power,    className: "bg-emerald-600 hover:bg-emerald-700 text-white", activeTask: 1 },
  { key: "reset", label: "Ausschalten", icon: PowerOff, className: "bg-slate-600 hover:bg-slate-700 text-white",    activeTask: 0 },
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
      <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
        <Pencil className="h-4 w-4" />
        Bearbeiten
      </Button>

      {isSensor ? (
        <span className="flex items-center gap-1.5 text-xs text-slate-400 px-2 italic">
          <Activity className="h-3.5 w-3.5" /> Sensor – nur Anzeige
        </span>
      ) : (
        actions.map((a) => {
          const Icon = a.icon;
          const isActiveTask = task === a.activeTask && a.key !== "reset";
          return (
            <Button
              key={a.key}
              size="sm"
              onClick={() => handleAction(a.key)}
              disabled={loading !== null}
              className={cn(
                a.className,
                isActiveTask && "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-950 ring-current"
              )}
            >
              {loading === a.key
                ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                : <Icon className="h-4 w-4 mr-1.5" />}
              {a.label}
            </Button>
          );
        })
      )}
    </div>
  );
}
