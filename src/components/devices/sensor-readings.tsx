/**
 * Messwerte eines Geraets anzeigen – Tuerkontakt, Riegel, Temperatur, Batterie.
 *
 * Geteilt zwischen Geraeteliste und Detailseite, damit derselbe Messwert an
 * beiden Stellen gleich aussieht.
 *
 * Zustaende (Tür offen, Riegel zu) stehen als Plakette, Umgebungswerte und
 * Batterie als ruhiger Text daneben – wie bei den uebrigen Geraetearten.
 */

import {
  Battery,
  BatteryLow,
  BatteryWarning,
  DoorClosed,
  DoorOpen,
  Droplets,
  Lock,
  Radar,
  Sun,
  Thermometer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SensorReading } from "@/lib/shelly-sensor";

const EMPHASIS_BADGE: Record<string, string> = {
  warn: "bg-warning/14 text-warning",
  alert: "bg-destructive/12 text-destructive",
};

const EMPHASIS_TEXT: Record<string, string> = {
  warn: "text-warning",
  alert: "text-destructive",
};

function readingIcon(reading: SensorReading) {
  switch (reading.kind) {
    case "contact":
      return reading.emphasis ? DoorOpen : DoorClosed;
    case "lock":
      return Lock;
    case "motion":
      return Radar;
    case "temperature":
      return Thermometer;
    case "humidity":
      return Droplets;
    case "illuminance":
      return Sun;
    case "battery":
      return reading.emphasis === "alert"
        ? BatteryWarning
        : reading.emphasis === "warn"
          ? BatteryLow
          : Battery;
  }
}

/// Zustaende gehoeren hervorgehoben, Messwerte bleiben Beiwerk.
const AS_BADGE = new Set<SensorReading["kind"]>(["contact", "lock", "motion"]);

export function SensorReadings({ readings }: { readings: SensorReading[] }) {
  return (
    <>
      {readings.map((reading) => {
        const Icon = readingIcon(reading);
        const key = `${reading.kind}-${reading.label}`;

        if (AS_BADGE.has(reading.kind)) {
          return (
            <Badge
              key={key}
              className={cn(
                "gap-1 text-xs h-5",
                reading.emphasis
                  ? EMPHASIS_BADGE[reading.emphasis]
                  : "bg-muted text-muted-foreground",
              )}
              title={reading.label}
            >
              <Icon className="h-3 w-3" />
              {reading.value}
            </Badge>
          );
        }

        return (
          <span
            key={key}
            className={cn(
              "flex items-center gap-0.5 text-xs",
              reading.emphasis ? EMPHASIS_TEXT[reading.emphasis] : "text-muted-foreground/70",
            )}
            title={reading.label}
          >
            <Icon className="h-3 w-3" />
            {reading.value}
          </span>
        );
      })}
    </>
  );
}
