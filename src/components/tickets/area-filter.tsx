"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin } from "lucide-react";

interface Area {
  id: number;
  name: string;
}

export function AreaFilter({ areas, current }: { areas: Area[]; current?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("area");
    } else {
      params.set("area", value);
    }
    router.push(`/tickets${params.toString() ? `?${params}` : ""}`);
  }

  return (
    <Select value={current ?? "all"} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] h-9 text-sm">
        <MapPin className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
        <SelectValue placeholder="Alle Bereiche" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Alle Bereiche</SelectItem>
        {areas.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
