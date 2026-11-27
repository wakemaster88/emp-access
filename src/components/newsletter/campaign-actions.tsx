"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Laufende Aussendung anhalten oder abgebrochene löschen. */
export function CampaignActions({ id, canCancel, canDelete }: { id: number; canCancel: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function call(url: string, method: "POST" | "DELETE", fallback: string) {
    const res = await fetch(url, { method });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(typeof json.error === "string" ? json.error : fallback);
    }
  }

  if (!canCancel && !canDelete) return null;
  return (
    <>
      {canCancel && (
        <Button type="button" variant="outline" onClick={() => setCancelOpen(true)} className="max-sm:h-11 max-sm:w-full">
          <Pause className="h-4 w-4" />
          Versand anhalten
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDeleteOpen(true)}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-sm:h-11 max-sm:w-full"
        >
          <Trash2 className="h-4 w-4" />
          Löschen
        </Button>
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Versand anhalten?"
        description="Wer die Mail noch nicht bekommen hat, bekommt sie nicht mehr. Fortsetzen geht nicht, nur eine Kopie neu senden."
        confirmLabel="Anhalten"
        onConfirm={async () => {
          await call(`/api/newsletter/campaigns/${id}/cancel`, "POST", "Anhalten fehlgeschlagen");
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Aussendung löschen?"
        description="Mit ihr verschwindet das Versandprotokoll. Abmeldungen bleiben bei den Abonnenten gespeichert."
        onConfirm={async () => {
          await call(`/api/newsletter/campaigns/${id}`, "DELETE", "Löschen fehlgeschlagen");
          router.push("/newsletter");
          router.refresh();
        }}
      />
    </>
  );
}
