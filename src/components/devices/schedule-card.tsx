"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, Loader2, Check } from "lucide-react";
import { WeekScheduleEditor } from "@/components/devices/week-schedule-editor";
import { parseSchedule } from "@/lib/schedule";
import type { WeekSchedule } from "@/lib/schedule";

interface ScheduleCardProps {
  deviceId: number;
  initialSchedule: unknown;
}

export function ScheduleCard({ deviceId, initialSchedule }: ScheduleCardProps) {
  const router = useRouter();
  const [schedule, setSchedule] = useState<WeekSchedule>(parseSchedule(initialSchedule));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError("Fehler beim Speichern");
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">
          Automatische Zeitsteuerung
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <WeekScheduleEditor value={schedule} onChange={setSchedule} />

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2 min-w-32"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <><Check className="h-4 w-4" /> Gespeichert</>
            ) : (
              <><Save className="h-4 w-4" /> Speichern</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
