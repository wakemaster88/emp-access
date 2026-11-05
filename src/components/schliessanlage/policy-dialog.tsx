"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "Neue Vorlage" : `${policy.name} bearbeiten`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {!isNew && (
            <Notice tone="info" compact>
              Beim Speichern entsteht Version {policy.version + 1}. Bereits unterschriebene
              Dokumente behalten den alten Wortlaut.
            </Notice>
          )}

          <div className="space-y-1">
            <Label htmlFor="p-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-sm:h-11"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-body">
              Belehrung <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="p-body"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={12}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-liability">
              Haftungserklärung
            </Label>
            <Textarea
              id="p-liability"
              value={liabilityText}
              onChange={(e) => setLiabilityText(e.target.value)}
              rows={5}
            />
            <p className="text-[11px] text-muted-foreground">
              Wird auf der Signaturseite separat bestätigt. Leer lassen, wenn keine gesonderte
              Haftungserklärung nötig ist.
            </p>
          </div>

          <ErrorLine message={error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="max-sm:h-11">
            Abbrechen
          </Button>
          <Button
            onClick={save}
            disabled={saving || !name.trim() || !bodyText.trim()}
            className="min-w-24 max-sm:h-11"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
