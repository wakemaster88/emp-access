import { Cloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { SesStatus } from "@/lib/newsletter/ses-status";

type Tone = "success" | "warning" | "danger" | "neutral";

const DKIM_LABEL: Record<string, { text: string; tone: Tone }> = {
  SUCCESS: { text: "DKIM aktiv", tone: "success" },
  PENDING: { text: "DKIM wartet auf DNS", tone: "warning" },
  FAILED: { text: "DKIM fehlgeschlagen", tone: "danger" },
  TEMPORARY_FAILURE: { text: "DKIM gestört", tone: "warning" },
  NOT_STARTED: { text: "DKIM nicht begonnen", tone: "neutral" },
};

const MAIL_FROM_LABEL: Record<string, { text: string; tone: Tone }> = {
  SUCCESS: { text: "aktiv", tone: "success" },
  PENDING: { text: "wartet auf DNS", tone: "warning" },
  FAILED: { text: "fehlgeschlagen", tone: "danger" },
  TEMPORARY_FAILURE: { text: "gestört", tone: "warning" },
};

function Row({ label, detail, badge, tone }: { label: string; detail?: React.ReactNode; badge: string; tone: Tone }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {detail && <p className="break-words text-xs text-muted-foreground">{detail}</p>}
      </div>
      <Badge variant={tone} className="shrink-0 font-normal">{badge}</Badge>
    </div>
  );
}

/** Stand bei Amazon SES: Zugangsdaten, Freigabe, Domain, DKIM, MAIL FROM. */
export function SesStatusCard({ status, snsEndpoint }: { status: SesStatus; snsEndpoint: string }) {
  const { account, identity } = status;
  const dkim = identity?.dkimStatus ? DKIM_LABEL[identity.dkimStatus] ?? { text: identity.dkimStatus, tone: "neutral" as Tone } : null;
  const mailFrom = identity?.mailFromStatus
    ? MAIL_FROM_LABEL[identity.mailFromStatus] ?? { text: identity.mailFromStatus, tone: "neutral" as Tone }
    : null;
  const showDkimRecords = !!identity && identity.dkimTokens.length > 0 && identity.dkimStatus !== "SUCCESS";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-4 w-4 shrink-0 text-primary" />
          Amazon SES
        </CardTitle>
        <CardDescription>Stand jetzt bei AWS, beim Öffnen der Seite abgefragt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Row
            label="Zugangsdaten"
            detail={status.configured ? `In Vercel eingetragen · Region ${status.region}` : "SES_ACCESS_KEY_ID und SES_SECRET_ACCESS_KEY in Vercel eintragen"}
            badge={status.configured ? "da" : "fehlen"}
            tone={status.configured ? "success" : "danger"}
          />
          {account && (
            <>
              <Row
                label="Freigabe für den Versand"
                detail={
                  account.productionAccessEnabled
                    ? `${account.sentLast24Hours ?? 0} von ${account.max24HourSend ?? "–"} Mails in 24 Stunden · ${account.maxSendRate ?? "–"} je Sekunde`
                    : "Sandkasten: Mails nur an Adressen, die in SES bestätigt sind. Freigabe bei AWS beantragen."
                }
                badge={account.productionAccessEnabled ? "freigegeben" : "Sandkasten"}
                tone={account.productionAccessEnabled ? "success" : "warning"}
              />
              {!account.sendingEnabled && (
                <Row label="Versand bei AWS" detail="AWS hat den Versand angehalten." badge="angehalten" tone="danger" />
              )}
              {account.enforcementStatus && account.enforcementStatus !== "HEALTHY" && (
                <Row label="Kontostatus" detail="AWS prüft das Konto. Nachricht im SES-Konto lesen." badge={account.enforcementStatus} tone="danger" />
              )}
            </>
          )}
          {status.configured && (
            <Row
              label={status.domain ? `Domain ${status.domain}` : "Domain"}
              detail={
                !status.domain
                  ? "Erst die Absender-Adresse speichern."
                  : identity === null
                    ? "Fehlt in SES. Unter Identitäten anlegen."
                    : identity
                      ? identity.verifiedForSending
                        ? "In SES bestätigt."
                        : "Wartet auf die DNS-Einträge."
                      : undefined
              }
              badge={!status.domain ? "–" : identity === null ? "fehlt" : identity?.verifiedForSending ? "bestätigt" : identity ? "ausstehend" : "unbekannt"}
              tone={!status.domain ? "neutral" : identity?.verifiedForSending ? "success" : identity === null ? "danger" : "warning"}
            />
          )}
          {dkim && <Row label="DKIM-Signatur" badge={dkim.text} tone={dkim.tone} />}
          {identity && (
            <Row
              label="MAIL FROM"
              detail={identity.mailFromDomain ?? "Keine eigene MAIL-FROM-Domain. Empfohlen: mail.<domain>."}
              badge={mailFrom?.text ?? "nicht eingerichtet"}
              tone={mailFrom?.tone ?? "neutral"}
            />
          )}
        </div>

        {status.accountError && <Notice tone="danger" compact title={status.accountError} />}
        {status.identityError && status.identityError !== status.accountError && (
          <Notice tone="danger" compact title={status.identityError} />
        )}

        {showDkimRecords && status.domain && (
          <div className="space-y-1.5">
            <p className="text-label">DKIM-Einträge beim DNS-Anbieter</p>
            <div className="glass-tile divide-y divide-border">
              {identity!.dkimTokens.map((t) => (
                <div key={t} className="space-y-0.5 px-3 py-2 font-mono text-xs break-all">
                  <div><span className="text-muted-foreground">CNAME </span>{t}._domainkey.{status.domain}</div>
                  <div><span className="text-muted-foreground">→ </span>{t}.dkim.amazonses.com</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-label">Endpunkt für SNS (HTTPS)</p>
          <p className="glass-tile px-3 py-2 font-mono text-xs break-all">{snsEndpoint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
