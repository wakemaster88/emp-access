/**
 * `HubAgent.status`: ein JSON-Objekt, in das mehrere Meldungen des Hubs je
 * ihren eigenen Schluessel schreiben (Heartbeat: system, repoAccess,
 * sentinel und, von aelteren Hubs, parking; Parkmeldung: parking;
 * Switch-Abfrage: snmp). Reine Regeln ohne Datenbank, testbar; die
 * Schreibung in einer Anweisung steht in `hub-agent-status.ts` und folgt
 * genau diesen Regeln.
 *
 * Unter `snmp` liegt nur eine Kurzfassung je Switch. Ports, Port-Zustaende
 * und MAC-Tabellen stehen nach dem Abgleich (`snmp-ingest.ts`) in den
 * Netzwerk-Tabellen; aus dem Status liest sie niemand. Mit ihnen war der
 * Status rund 47 KB gross und wurde bei jeder Meldung neu geschrieben.
 */

/** Kurzfassung eines Switches in `status.snmp.switches`. */
export interface SwitchStatusSummary {
  host: string;
  sysName: string | null;
  polledAt: string | null;
  /** Anzahl Ports. */
  ports: number;
  /** Davon verbunden. */
  portsUp: number;
  /** Eintraege der MAC-Tabelle. */
  macs: number;
  error: string | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Kurzfassung je Switch aus dem Upload des Hubs (Ports und MAC-Tabelle als
 * Listen). Eine schon gekuerzte Angabe (Zahlen) bleibt, wie sie ist;
 * Eintraege, die kein Objekt sind, fallen weg.
 */
export function snmpStatusSummary(switches: unknown): SwitchStatusSummary[] {
  if (!Array.isArray(switches)) return [];
  return switches.filter(isObject).map((s) => {
    const ports = Array.isArray(s.ports) ? s.ports : null;
    return {
      host: str(s.host) ?? "",
      sysName: str(s.sysName),
      polledAt: str(s.polledAt),
      ports: ports ? ports.length : num(s.ports),
      portsUp: ports ? ports.filter((p) => isObject(p) && p.up === true).length : num(s.portsUp),
      macs: Array.isArray(s.macTable) ? s.macTable.length : num(s.macs),
      error: str(s.error),
    };
  });
}

/** Steht unter `snmp.switches` noch ein Switch mit Port-Liste oder MAC-Tabelle? */
export function hasSnmpDetail(status: unknown): boolean {
  if (!isObject(status) || !isObject(status.snmp) || !Array.isArray(status.snmp.switches)) return false;
  return status.snmp.switches.some((s) => isObject(s) && (Array.isArray(s.ports) || Array.isArray(s.macTable)));
}

/**
 * Status nach einer Meldung: Die Schluessel aus `patch` werden ersetzt, alle
 * anderen bleiben (`undefined` im Patch zaehlt nicht, wie beim Schreiben als
 * JSON). Ein leerer, fehlender oder kaputter Status (kein Objekt) wird zu
 * einem neuen Objekt. Steht unter `snmp.switches` noch die fruehere
 * Fassung mit Port-Listen und MAC-Tabellen, wird sie dabei durch die
 * Kurzfassung ersetzt: Der Altbestand verschwindet mit der naechsten
 * Meldung irgendeines Schreibers, ohne Migration.
 */
export function mergeHubStatus(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = isObject(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  if (hasSnmpDetail(merged)) {
    const snmp = merged.snmp as Record<string, unknown>;
    merged.snmp = { ...snmp, switches: snmpStatusSummary(snmp.switches) };
  }
  return merged;
}
