import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/**
 * Was fehlt, bevor Mails rausgehen. Steht nur da, solange etwas fehlt
 * (Ruhe bei Normalbetrieb).
 */
export function ReadinessNotice({ gaps, onSettings }: { gaps: string[]; onSettings: boolean }) {
  if (gaps.length === 0) return null;
  const onlySwitch = gaps.length === 1 && gaps[0].startsWith("Versand ist ausgeschaltet");
  return (
    <Notice
      tone={onlySwitch ? "info" : "warning"}
      title={onlySwitch ? "Versand ist ausgeschaltet" : "Newsletter-Versand noch nicht bereit"}
      action={
        onSettings ? undefined : (
          <Button asChild variant="outline" size="sm" className="max-sm:h-11 max-sm:w-full">
            <Link href="/newsletter?tab=einstellungen">Einstellungen</Link>
          </Button>
        )
      }
    >
      {onlySwitch ? (
        "Testmails gehen schon. Bestätigungsmails und Aussendungen starten erst, wenn du den Versand einschaltest."
      ) : (
        <ul className="list-disc space-y-0.5 pl-4">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}
