"use client";

import { useInstallState } from "@/components/pwa/use-install-state";
import { Download, Share, SquarePlus, X, CheckCircle2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";

/**
 * Installationshinweis fuer die Web-App.
 *
 *  - Android/Chrome: `beforeinstallprompt` abfangen und einen echten
 *    "Installieren"-Knopf anbieten.
 *  - iPhone/iPad: Safari kennt keinen Prompt – die zwei Schritte
 *    "Teilen → Zum Home-Bildschirm" werden angezeigt. Erst als installierte
 *    App gibt es auf iOS Push-Nachrichten, Vollbild und Splash-Screen.
 *  - Bereits installiert (standalone): Banner verschwindet, die Karte zeigt
 *    den Haken.
 *
 * `banner` klebt unten (Safe-Area beachtet, mit `aboveTabBar` ueber der
 * Tab-Leiste des Dashboards) und laesst sich 14 Tage lang wegklicken; `card` passt auf die Einstellungsseite; `inline` ist nur der
 * Text, z. B. unter der Push-Karte.
 */
type Variant = "banner" | "card" | "inline";

export function InstallPrompt({
  variant = "card",
  appName = "EMP Access",
  aboveTabBar = false,
}: {
  variant?: Variant;
  appName?: string;
  /** Banner über der schwebenden Tab-Leiste der Dashboard-Hülle (nur Handy). */
  aboveTabBar?: boolean;
}) {
  const { info, canPrompt, install, dismiss, standalone, showBanner } = useInstallState();

  if (!info) return null;
  const isStandalone = standalone;

  if (variant === "banner") {
    if (!showBanner) return null;
    // Schwebende Ebene über dem Inhalt: dichtes Glas (glass-surface), damit
    // der Text darunter nicht durchscheint. `data-install-banner` lässt die
    // Seite davor unten Platz machen, solange der Hinweis zu sehen ist.
    return (
      <div
        data-install-banner
        className={
          aboveTabBar
            ? "md:hidden fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(max(0.75rem,env(safe-area-inset-bottom)-0.25rem)+4.5rem)] pointer-events-none"
            : "fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pointer-events-none"
        }
      >
        <div className="glass-surface mx-auto max-w-md rounded-card p-3.5 pointer-events-auto text-foreground">
          <div className="flex items-start gap-3">
            <IconChip icon={Smartphone} tone="primary" active size="lg" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold leading-tight">{appName} als App</p>
              {info.ios ? (
                <p className="mt-1 text-muted-foreground leading-snug">
                  Unten <Share className="inline h-3.5 w-3.5 -mt-0.5" aria-label="Teilen" /> <span className="font-medium text-foreground">Teilen</span> antippen,
                  dann <SquarePlus className="inline h-3.5 w-3.5 -mt-0.5" aria-label="Plus" /> <span className="font-medium text-foreground">Zum Home-Bildschirm</span>.
                  {!info.safari && " Dafür die Seite in Safari öffnen."}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground leading-snug">Startet im Vollbild und liegt als Symbol auf dem Startbildschirm.</p>
              )}
              {canPrompt && !info.ios && (
                <Button type="button" onClick={install} className="mt-2.5 h-11">
                  <Download className="h-4 w-4" /> Installieren
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={dismiss}
              aria-label="Hinweis ausblenden"
              className="size-11 shrink-0 -mr-2 -mt-2 rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const body = isStandalone ? (
    <p className="flex items-center gap-2 text-sm text-success">
      <CheckCircle2 className="h-4 w-4" /> Läuft als installierte App.
    </p>
  ) : info.ios ? (
    <div className="text-sm text-muted-foreground space-y-1.5">
      <p>
        Auf iPhone und iPad: in Safari unten <Share className="inline h-4 w-4 -mt-0.5" aria-label="Teilen" />{" "}
        <span className="font-medium text-foreground">Teilen</span> antippen, dann{" "}
        <SquarePlus className="inline h-4 w-4 -mt-0.5" aria-label="Plus" /> <span className="font-medium text-foreground">Zum Home-Bildschirm</span> wählen.
      </p>
      <p className="text-xs">Erst als installierte App gibt es Push-Benachrichtigungen, Vollbild und ein Startbild.</p>
    </div>
  ) : canPrompt ? (
    <Button type="button" onClick={install} className="max-sm:h-11">
      <Download className="h-4 w-4" /> App installieren
    </Button>
  ) : (
    <p className="text-sm text-muted-foreground">
      In Chrome oder Edge über das Menü <span className="font-medium text-foreground">„App installieren“</span> wählen; auf Android erscheint der Hinweis automatisch.
    </p>
  );

  if (variant === "inline") return body;

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" />
          <h3>{appName} auf dem Handy</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
