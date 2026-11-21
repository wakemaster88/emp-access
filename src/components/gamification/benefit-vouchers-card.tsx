"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Gift, Loader2, ScanLine } from "lucide-react";
import type { BenefitVoucherState } from "@/lib/gamification";
import { REDEEMED_VIA_LABEL } from "@/lib/voucher-via";

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
  // Offene zuerst: eingelöste und abgelaufene sind nur noch Verlauf.
  const openCount = vouchers.filter((v) => v.state === "open").length;
  const [filter, setFilter] = useState<"open" | "all">(openCount > 0 ? "open" : "all");
  const shown = filter === "open" ? vouchers.filter((v) => v.state === "open") : vouchers;

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
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void redeem(code);
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                id="benefit-code"
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Code scannen"
                aria-label="Gutschein-Code"
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
          <p className="text-xs text-muted-foreground">
            Am Check-in-Monitor reicht ebenfalls ein Scan. Für die Kasse gibt es den{" "}
            <Link href="/monitors" className="text-primary underline-offset-4 hover:underline">Gutschein-Monitor</Link>{" "}
            (unter Monitore anlegen).
          </p>
          {result && <Notice tone={result.ok ? "success" : "danger"} compact title={result.text} role={result.ok ? "status" : "alert"} />}
        </CardContent>
      </Card>

      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary shrink-0" />
            Leistungs-Gutscheine
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <Segmented
            aria-label="Gutscheine filtern"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "open", label: "Offen", count: openCount },
              { value: "all", label: "Alle", count: vouchers.length },
            ]}
          />
        </CardContent>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Leistung</TableHead>
              <TableHead className="hidden sm:table-cell">Fahrer</TableHead>
              <TableHead className="hidden lg:table-cell">Code</TableHead>
              <TableHead className="hidden md:table-cell">Gültig bis</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableEmpty
                colSpan={5}
                icon={Gift}
                title={vouchers.length === 0 ? "Noch keine Leistungs-Gutscheine" : "Keine offenen Gutscheine"}
                description={vouchers.length === 0 ? "Sie entstehen automatisch, sobald ein Fahrer einen Award mit Gutschein erreicht." : undefined}
                compact={vouchers.length > 0}
              />
            )}
            {shown.map((v) => {
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
                  <TableCell className="text-right">
                    {v.state === "open" ? (
                      <Button variant="outline" size="sm" onClick={() => void redeem(v.code)} disabled={busy != null} className="max-sm:h-11">
                        {busy === v.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Entwerten
                      </Button>
                    ) : (
                      <>
                        <Badge variant={badge.variant} className="font-normal">{badge.label}</Badge>
                        {v.state === "redeemed" && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {fmtDate(v.redeemedAt)}{v.redeemedVia && REDEEMED_VIA_LABEL[v.redeemedVia] ? ` · ${REDEEMED_VIA_LABEL[v.redeemedVia]}` : ""}
                          </div>
                        )}
                      </>
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
