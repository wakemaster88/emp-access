/**
 * Fahrbefehle fuer Antriebe, die der Shelly selbst als Rollladen fuehrt
 * (Geraeteprofil "Cover").
 *
 * In diesem Profil gibt es keine `Switch`-Komponente. Relaisbefehle
 * (`Switch.Set`, `/device/relay/control`) weist das Geraet ab – gefahren wird
 * ueber `Cover.Open`/`Cover.Close`/`Cover.Stop`, in der Cloud ueber
 * `/device/relay/roller/control`. Die Verriegelung der beiden Fahrtrichtungen
 * uebernimmt dann die Geraete-Firmware; das ist zuverlaessiger als jede
 * Umschaltpause ueber das Netzwerk.
 *
 * Eine Fahrzeit wird bewusst NICHT mitgesendet: Der Shelly begrenzt die Fahrt
 * im Cover-Profil selbst (`maxtime_open`/`maxtime_close`) und stoppt in der
 * Endlage. Ein `duration` ausserhalb dieser Grenze wuerde er ablehnen, und die
 * in EMP hinterlegte Fahrzeit weiss nichts von der Geraetekonfiguration.
 *
 * Das Gegenstueck fuer Antriebe an zwei getrennten Relais steht in
 * `src/lib/shelly-relay.ts`; welcher Weg gilt, entscheidet
 * `src/lib/shelly-cover.ts` anhand des Geraetestatus.
 */

import { shellyCloudPost } from "./shelly-cloud";
import type { ShellyCloudCreds } from "./shelly-relay";
import type { CoverAction } from "./cover-constants";

export interface CoverCommandResult {
  ok: boolean;
  /// Grund der Ablehnung, soweit das Geraet bzw. die Cloud einen nennt.
  error?: string;
}

const RPC_METHODS: Record<CoverAction, string> = {
  open: "Cover.Open",
  close: "Cover.Close",
  stop: "Cover.Stop",
};

/** Gen1-Ersatzpfad (`/roller/0?go=…`) fuer Shelly 2 und 2.5 im Roller-Modus. */
const GEN1_GO: Record<CoverAction, string> = {
  open: "open",
  close: "close",
  stop: "stop",
};

/**
 * Fehlertext aus einer abgelehnten Gen2-RPC-Antwort ziehen. Der Grund gehoert
 * nach oben durchgereicht: "Antrieb nicht erreichbar" ist irrefuehrend, wenn das
 * Geraet antwortet und den Befehl nur nicht ausfuehren kann.
 */
async function rpcErrorText(res: Response): Promise<string | undefined> {
  try {
    const data = (await res.json()) as { message?: string; code?: number };
    if (data?.message) {
      return data.code != null ? `${data.message} (Code ${data.code})` : data.message;
    }
  } catch {
    /* keine JSON-Antwort */
  }
  return `Shelly antwortete mit HTTP ${res.status}`;
}

/** Fahrbefehl ueber die lokale IP: Gen2-RPC, sonst Gen1-Roller-Pfad. */
export async function shellyCoverCommandLocal(
  ip: string,
  coverId: number,
  action: CoverAction,
): Promise<CoverCommandResult> {
  // Antwortet das Geraet mit einer Ablehnung, ist das die belastbarere
  // Information als ein spaeteres Scheitern des Gen1-Versuchs.
  let rejected: string | undefined;

  try {
    const res = await fetch(`http://${ip}/rpc/${RPC_METHODS[action]}?id=${coverId}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return { ok: true };
    rejected = await rpcErrorText(res);
  } catch {
    /* Gen1 versuchen */
  }

  try {
    const res = await fetch(`http://${ip}/roller/${coverId}?go=${GEN1_GO[action]}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return { ok: true };
  } catch {
    /* nicht erreichbar */
  }

  return { ok: false, error: rejected };
}

function cloudErrorText(errors: unknown): string {
  if (errors && typeof errors === "object") {
    const keys = Object.keys(errors as Record<string, unknown>);
    // Bleibt nur uebrig, wenn auch der Wiederholungsversuch abgewiesen wurde.
    if (keys.includes("max_req")) {
      return "Shelly Cloud hat zu viele Anfragen kurz hintereinander erhalten – bitte einen Moment warten";
    }
    if (keys.length > 0) {
      return `Shelly Cloud hat den Fahrbefehl abgelehnt (${keys.join(", ")})`;
    }
  }
  return "Shelly Cloud hat den Fahrbefehl abgelehnt";
}

/** Fahrbefehl ueber die Shelly Cloud – der einzige Weg von Vercel aus. */
export async function shellyCoverCommandCloud(
  creds: ShellyCloudCreds,
  baseId: string,
  coverId: number,
  action: CoverAction,
): Promise<CoverCommandResult> {
  const body = new URLSearchParams({
    auth_key: creds.token.trim(),
    id: baseId,
    direction: action,
  });
  // Der Endpunkt kennt fuer einkanalige Antriebe keinen `channel`; nur bei
  // Geraeten mit mehreren Cover-Komponenten muss die Zuordnung mitgehen.
  if (coverId > 0) body.set("channel", String(coverId));

  const reply = await shellyCloudPost(creds.baseUrl, "/device/relay/roller/control", body);
  if (reply.isok) return { ok: true };
  if (reply.status === 0) return { ok: false, error: "Shelly Cloud nicht erreichbar" };
  return { ok: false, error: cloudErrorText(reply.errors) };
}
