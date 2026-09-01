"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorLine, apiRequest } from "@/components/schliessanlage/shared";
import type { PolicyRow } from "@/components/schliessanlage/types";

interface Props {
  policy: PolicyRow | null;
  open: boolean;
  onClose: () => void;
}

const DEFAULT_BODY = `Der Empfänger bestätigt den Erhalt der aufgeführten Schlüssel.

1. Die Schlüssel sind sorgfältig aufzubewahren und dürfen nicht an Dritte weitergegeben oder nachgefertigt werden.
2. Der Verlust eines Schlüssels ist unverzüglich zu melden.
3. Die Schlüssel sind auf Verlangen sowie spätestens bei Beendigung des Arbeits- bzw. Auftragsverhältnisses zurückzugeben.
4. Eine Weitergabe an Personen außerhalb des berechtigten Kreises ist untersagt.`;

const DEFAULT_LIABILITY = `Bei Verlust eines Schlüssels haftet der Empfänger für die entstehenden Kosten, insbesondere für den Austausch der betroffenen Schließzylinder und die Neuanfertigung der zugehörigen Schlüssel, sofern der Verlust von ihm zu vertreten ist.`;

export function PolicyDialog({ policy, open, onClose }: Props) {
  const router = useRouter();
  const isNew = !policy;
  const [name, setName] = useState(policy?.name ?? "Schlüsselbelehrung");
  const [bodyText, setBodyText] = useState(policy?.bodyText ?? DEFAULT_BODY);
  const [liabilityText, setLiabilityText] = useState(policy?.liabilityText ?? DEFAULT_LIABILITY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await apiRequest(
      isNew ? "/api/schliessanlage/policies" : `/api/schliessanlage/policies/${policy.id}`,
      isNew ? "POST" : "PUT",
      {
        name: name.trim(),
        bodyText: bodyText.trim(),
        liabilityText: liabilityText.trim() || null,
        isActive: true,
      },
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isNew ? "Neue Vorlage" : `${policy.name} bearbeiten`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {!isNew && (
            <p className="rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500 dark:bg-slate-800/50">
              Beim Speichern entsteht Version {policy.version + 1}. Bereits unterschriebene
              Dokumente behalten den alten Wortlaut.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="p-name" className="text-xs">
              Name <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-body" className="text-xs">
              Belehrung <span className="text-rose-500">*</span>
            </Label>
            <textarea
              id="p-body"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={12}
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-liability" className="text-xs">
              Haftungserklärung
            </Label>
            <textarea
              id="p-liability"
              value={liabilityText}
              onChange={(e) => setLiabilityText(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
            <p className="text-[10px] text-slate-400">
              Wird auf der Signaturseite separat bestätigt. Leer lassen, wenn keine gesonderte
              Haftungserklärung nötig ist.
            </p>
          </div>

          <ErrorLine message={error} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving} className="h-8">
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !name.trim() || !bodyText.trim()}
            className="h-8 min-w-24 bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" />
                {isNew ? "Erstellen" : "Neue Version"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
