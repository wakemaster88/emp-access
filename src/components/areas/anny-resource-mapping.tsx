"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link2, Save, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AreaOption {
  id: number;
  name: string;
}

interface AnnyResourceMappingProps {
  areas: AreaOption[];
  annyResources: string[];
  mappings: Record<string, number>;
  extraConfig: string;
}

export function AnnyResourceMapping({
  areas,
  annyResources,
  mappings: initialMappings,
  extraConfig: initialExtraConfig,
}: AnnyResourceMappingProps) {
  const [mappings, setMappings] = useState(initialMappings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  if (annyResources.length === 0) return null;

  function updateMapping(resourceName: string, areaId: number | null) {
    setMappings((prev) => {
      const next = { ...prev };
      if (areaId === null) {
        delete next[resourceName];
      } else {
        next[resourceName] = areaId;
      }
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const cfgRes = await fetch("/api/settings/integrations");
      if (!cfgRes.ok) throw new Error("Laden fehlgeschlagen");
      const configs = await cfgRes.json();
      const annyConfig = Array.isArray(configs)
        ? configs.find((c: { provider: string }) => c.provider === "ANNY")
        : null;
      if (!annyConfig) throw new Error("anny.co nicht konfiguriert");

      let extra: Record<string, unknown> = {};
      try {
        if (annyConfig.extraConfig) extra = JSON.parse(annyConfig.extraConfig);
      } catch { /* ignore */ }

      extra.mappings = { ...((extra.mappings as Record<string, number>) || {}), ...mappings };
      // Remove deleted mappings
      for (const key of Object.keys(extra.mappings as Record<string, number>)) {
        if (annyResources.includes(key) && !(key in mappings)) {
          delete (extra.mappings as Record<string, number>)[key];
        }
      }

      const saveRes = await fetch("/api/settings/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ANNY",
          token: annyConfig.token,
          baseUrl: annyConfig.baseUrl || "",
          extraConfig: JSON.stringify(extra),
        }),
      });
      if (!saveRes.ok) throw new Error("Speichern fehlgeschlagen");

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  const mappedCount = annyResources.filter((r) => mappings[r] != null).length;

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-violet-500" />
            anny Ressourcen-Zuordnung
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {mappedCount}/{annyResources.length} verknüpft
          </Badge>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Verknüpfe anny Ressourcen mit deinen lokalen Resourcen. Die Verfügbarkeiten werden dann im Dashboard angezeigt.
        </p>
      </CardHeader>
      <Separator className="dark:bg-slate-800" />
      <CardContent className="pt-4 space-y-3">
        {annyResources.map((res) => {
          const currentArea = mappings[res] != null ? String(mappings[res]) : "__none__";
          return (
            <div key={res} className="flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-500 shrink-0">
                  anny
                </Badge>
                <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{res}</span>
              </div>
              <Select
                value={currentArea}
                onValueChange={(v) => updateMapping(res, v === "__none__" ? null : Number(v))}
              >
                <SelectTrigger className="w-48 h-8 text-xs">
                  <SelectValue placeholder="Keine Resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">– Keine Resource –</SelectItem>
                  {areas.map((area) => (
                    <SelectItem key={area.id} value={String(area.id)}>
                      {area.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
        )}

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "min-w-28",
              saved ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <><CheckCircle2 className="h-4 w-4 mr-1.5" />Gespeichert</>
            ) : (
              <><Save className="h-4 w-4 mr-1.5" />Speichern</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
