"use client";

import { useState } from "react";
import { DoorOpen, FileSignature, KeyRound, ScrollText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HandoversTab } from "@/components/schliessanlage/handovers-tab";
import { KeysTab } from "@/components/schliessanlage/keys-tab";
import { PoliciesTab } from "@/components/schliessanlage/policies-tab";
import { RoomsTab } from "@/components/schliessanlage/rooms-tab";
import type { SchliessanlageData } from "@/components/schliessanlage/types";

interface Props {
  data: SchliessanlageData;
  /** Super-Admin schaut nur zu (kein Mandanten-Kontext zum Schreiben). */
  readonly: boolean;
}

export function SchliessanlageClient({ data, readonly }: Props) {
  const [tab, setTab] = useState("struktur");

  const openHandovers = data.handovers.filter(
    (h) => h.status === "ISSUED" || h.status === "PARTIALLY_RETURNED",
  ).length;

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="struktur" className="gap-1.5">
          <DoorOpen className="h-3.5 w-3.5" />
          Räume &amp; Türen
        </TabsTrigger>
        <TabsTrigger value="schluessel" className="gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Schlüssel ({data.keys.length})
        </TabsTrigger>
        <TabsTrigger value="protokoll" className="gap-1.5">
          <FileSignature className="h-3.5 w-3.5" />
          Protokoll{openHandovers > 0 ? ` (${openHandovers} offen)` : ""}
        </TabsTrigger>
        <TabsTrigger value="vorlagen" className="gap-1.5">
          <ScrollText className="h-3.5 w-3.5" />
          Vorlagen
        </TabsTrigger>
      </TabsList>

      <TabsContent value="struktur">
        <RoomsTab
          rooms={data.rooms}
          looseDoors={data.looseDoors}
          devices={data.deviceOptions}
          cameras={data.cameraOptions}
          readonly={readonly}
        />
      </TabsContent>

      <TabsContent value="schluessel">
        <KeysTab keys={data.keys} lockOptions={data.lockOptions} readonly={readonly} />
      </TabsContent>

      <TabsContent value="protokoll">
        <HandoversTab
          handovers={data.handovers}
          keys={data.keys}
          holders={data.holders}
          employees={data.employees}
          policies={data.policies}
          readonly={readonly}
        />
      </TabsContent>

      <TabsContent value="vorlagen">
        <PoliciesTab policies={data.policies} readonly={readonly} />
      </TabsContent>
    </Tabs>
  );
}
