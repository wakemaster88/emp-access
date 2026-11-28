"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { isValidShopCostPin, isWeakShopCostPin, SHOP_COST_PIN_MAX_LENGTH, SHOP_COST_PIN_MIN_LENGTH } from "@/lib/shop-scan";

/**
 * PIN für EK und Marge im Shop-Monitor (28.11.2026). Gespeichert wird nur ein
 * Hash auf dem Server; hier steht nur, ob eine PIN gesetzt ist.
 */
export function EmpShopCostPin() {
  const [status, setStatus] = useState<{ pinSet: boolean; pinSetAt: string | null; lockedUntil: string | null } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const res = await fetch("/api/integrations/emp-shop/pin", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stand kommt vom Server
    void load();
  }, []);

  async function save() {
    if (!isValidShopCostPin(pin)) {
      setNote({ ok: false, text: `Die PIN muss aus ${SHOP_COST_PIN_MIN_LENGTH} bis ${SHOP_COST_PIN_MAX_LENGTH} Ziffern bestehen.` });
      return;
    }
    if (isWeakShopCostPin(pin)) {
      setNote({ ok: false, text: "Bitte keine PIN aus gleichen oder fortlaufenden Ziffern." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/integrations/emp-shop/pin", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? "Die PIN ließ sich nicht speichern." });
        return;
      }
      setPin("");
      setNote({ ok: true, text: "PIN gespeichert. Am Monitor gilt ab jetzt nur noch diese PIN." });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/integrations/emp-shop/pin", { method: "DELETE" });
      if (!res.ok) {
        setNote({ ok: false, text: "Die PIN ließ sich nicht entfernen." });
        return;
      }
      setNote({ ok: true, text: "PIN entfernt. Der Monitor zeigt keine EK und Marge mehr." });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-tile p-3 space-y-3">
      <div className="space-y-1">
        <p className="text-label flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          PIN für EK und Marge
        </p>
        <p className="text-[11px] text-muted-foreground">
          Im Shop-Monitor zeigt die Taste „EK“ Einkaufspreis und Marge erst nach dieser PIN. Der API-Schlüssel braucht dafür
          zusätzlich die Berechtigung „Einkaufspreise lesen (Ø-EK)“. Nach 5 falschen PINs ist die Anzeige 15 Minuten gesperrt.
        </p>
        {status && (
          <p className="text-[11px]">
            {status.pinSet ? (
              <>
                <strong>PIN gesetzt</strong>
                {status.pinSetAt && <> am {fmtDate(status.pinSetAt)}</>}
                {status.lockedUntil && <> · nach Fehlversuchen gesperrt bis {fmtDateTime(status.lockedUntil, { hour: "2-digit", minute: "2-digit" })} Uhr</>}
              </>
            ) : (
              <strong>Keine PIN gesetzt, EK und Marge sind am Monitor aus.</strong>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={SHOP_COST_PIN_MAX_LENGTH}
          placeholder={`${status?.pinSet ? "Neue PIN" : "PIN"} (${SHOP_COST_PIN_MIN_LENGTH} bis ${SHOP_COST_PIN_MAX_LENGTH} Ziffern)`}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          className="font-mono max-sm:h-11"
          aria-label="PIN für EK und Marge"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => void save()} disabled={busy || !pin} className="shrink-0 h-9 max-sm:h-11">
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {status?.pinSet ? "Ändern" : "Festlegen"}
        </Button>
        {status?.pinSet && (
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} disabled={busy} className="shrink-0 h-9 max-sm:h-11" aria-label="PIN entfernen">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {note && (
        <Notice tone={note.ok ? "success" : "danger"} icon={note.ok ? CheckCircle2 : XCircle} compact>
          <p>{note.text}</p>
        </Notice>
      )}
    </div>
  );
}
