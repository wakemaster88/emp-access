"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Gift, Loader2, ScanLine } from "lucide-react";
import type { BenefitVoucherState } from "@/lib/gamification";

export interface BenefitVoucherRow {
  id: number;
  code: string;
  label: string;
  owner: string | null;
  source: string | null;
  state: BenefitVoucherState;
  createdAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
  redeemedVia: string | null;
}

const STATE_BADGE: Record<BenefitVoucherState, { label: string; variant: "info" | "success" | "neutral" | "warning" }> = {
  open: { label: "offen", variant: "info" },
  redeemed: { label: "eingelöst", variant: "success" },
  expired: { label: "abgelaufen", variant: "warning" },
  disabled: { label: "deaktiviert", variant: "neutral" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
}

/** Leistungs-Gutscheine: per Handscanner oder Klick entwerten, darunter die Liste. */
export function BenefitVouchersCard({ vouchers }: { vouchers: BenefitVoucherRow[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function redeem(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(trimmed);
    setResult(null);
    try {
      const res = await fetch("/api/gamification/vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        setResult({ ok: true, text: `Entwertet: ${json.label} (${json.code})` });
        router.refresh();
      } else {
        setResult({ ok: false, text: typeof json.message === "string" ? json.message : "Entwerten fehlgeschlagen" });
      }
    } catch {
      setResult({ ok: false, text: "Netzwerkfehler" });
    } finally {
      setBusy(null);
      setCode("");
      inputRef.current?.focus();
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-primary shrink-0" />
            Gutschein entwerten
          </CardTitle>
          <CardDescription>
            QR-Code mit dem Handscanner scannen oder den Code eintippen. Am Check-in-Monitor reicht ebenfalls ein Scan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void redeem(code);
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="benefit-code">Code</Label>
              <Input
                id="benefit-code"
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="GS-…"
                autoComplete="off"
                autoFocus
                className="font-mono max-sm:h-11"
              />
            </div>
            <Button type="submit" disabled={!code.trim() || busy != null} className="max-sm:h-11">
              {busy != null ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              Entwerten
            </Button>
          </form>
          {result && <Notice tone={result.ok ? "success" : "danger"} compact title={result.text} role={result.ok ? "status" : "alert"} />}
        </CardContent>
      </Card>

      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary shrink-0" />
            Leistungs-Gutscheine ({vouchers.length})
          </CardTitle>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Leistung</TableHead>
              <TableHead className="hidden sm:table-cell">Fahrer</TableHead>
              <TableHead className="hidden lg:table-cell">Code</TableHead>
              <TableHead className="hidden md:table-cell">Gültig bis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right"><span className="sr-only">Aktion</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vouchers.length === 0 && (
              <TableEmpty
                colSpan={6}
                icon={Gift}
                title="Noch keine Leistungs-Gutscheine"
                description="Sie entstehen automatisch, sobald ein Fahrer einen Meilenstein mit Gutschein erreicht."
                compact={false}
              />
            )}
            {vouchers.map((v) => {
              const badge = STATE_BADGE[v.state];
              return (
                <TableRow key={v.id} className="max-sm:h-11">
                  <TableCell className="max-sm:whitespace-normal">
                    <span className="font-medium text-foreground">{v.label}</span>
                    <div className="text-xs text-muted-foreground">
                      <span className="sm:hidden">{v.owner ?? "–"} · </span>
                      {v.source ?? `ausgegeben ${fmtDate(v.createdAt)}`}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{v.owner ?? "–"}</TableCell>
                  <TableCell className="hidden lg:table-cell font-mono text-xs">{v.code}</TableCell>
                  <TableCell className="hidden md:table-cell tabular-nums">{v.expiresAt ? fmtDate(v.expiresAt) : "unbegrenzt"}</TableCell>
                  <TableCell>
                    <Badge variant={badge.variant} className="font-normal">{badge.label}</Badge>
                    {v.state === "redeemed" && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {fmtDate(v.redeemedAt)}{v.redeemedVia === "CHECKIN" ? " · Check-in" : v.redeemedVia === "ADMIN" ? " · Admin" : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {v.state === "open" && (
                      <Button variant="outline" size="sm" onClick={() => void redeem(v.code)} disabled={busy != null} className="max-sm:h-11">
                        {busy === v.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Entwerten
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
