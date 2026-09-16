/**
 * London-DI-Protokoll (BSS Soundweb London), Byte-Ebene.
 *
 * Quelle: Soundweb London Interface Kit, Rev. 2.7. Ein Rahmen ist
 * `STX <Body> <Prüfsumme> ETX`; die Prüfsumme ist das XOR aller Body-Bytes.
 * Danach werden die Sonderzeichen im Body und in der Prüfsumme ersetzt:
 * 0x02→1B 82, 0x03→1B 83, 0x06→1B 86, 0x15→1B 95, 0x1B→1B 9B.
 *
 * Der Body einer SV-Nachricht ist `<Typ> <Node 2> <VD 1> <Objekt 3> <SV 2>
 * <Daten 4>`, alles Big-Endian; Preset-Abrufe haben nur `<Typ> <Daten 4>`.
 * Über Ethernet gibt es kein ACK/NAK – das übernimmt TCP.
 *
 * Bewusst ohne Netz und ohne Hub-Importe, damit sich das Modul ohne Hardware
 * gegen aufgezeichnete Bytes prüfen lässt.
 */

export const STX = 0x02;
export const ETX = 0x03;
export const ACK = 0x06;
export const NAK = 0x15;
export const ESC = 0x1b;

export const MSG = {
  SETSV: 0x88,
  SUBSCRIBESV: 0x89,
  UNSUBSCRIBESV: 0x8a,
  VENUE_PRESET_RECALL: 0x8b,
  PARAM_PRESET_RECALL: 0x8c,
  SETSVPERCENT: 0x8d,
  SUBSCRIBESVPERCENT: 0x8e,
  UNSUBSCRIBESVPERCENT: 0x8f,
  BUMPSVPERCENT: 0x90,
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

const SV_MESSAGE_TYPES = new Set<number>([
  MSG.SETSV,
  MSG.SUBSCRIBESV,
  MSG.UNSUBSCRIBESV,
  MSG.SETSVPERCENT,
  MSG.SUBSCRIBESVPERCENT,
  MSG.UNSUBSCRIBESVPERCENT,
  MSG.BUMPSVPERCENT,
]);
const PRESET_MESSAGE_TYPES = new Set<number>([MSG.VENUE_PRESET_RECALL, MSG.PARAM_PRESET_RECALL]);

/** Länge des Bodys ohne Prüfsumme je Nachrichtenart. */
const SV_BODY_LENGTH = 1 + 2 + 1 + 3 + 2 + 4;
const PRESET_BODY_LENGTH = 1 + 4;

export interface SvAddress {
  node: number;
  virtualDevice: number;
  objectId: number;
  stateVariable: number;
}

export interface DecodedMessage {
  type: number;
  /** Fehlt bei Preset-Abrufen. */
  address: SvAddress | null;
  /** 32 Bit signed: Rohwert, Prozent*65536, Rate oder Preset-ID. */
  data: number;
}

/** Schlüssel einer SV für Abonnements und Nachschlagen. */
export function svKey(a: SvAddress): string {
  return `${a.node}:${a.virtualDevice}:${a.objectId}:${a.stateVariable}`;
}

/** Derselbe Schlüssel ohne Node – Antworten tragen den Node der Quelle. */
export function svKeyWithoutNode(a: SvAddress): string {
  return `*:${a.virtualDevice}:${a.objectId}:${a.stateVariable}`;
}

export function formatAddress(a: SvAddress): string {
  return (
    "0x" +
    a.node.toString(16).padStart(4, "0") +
    a.virtualDevice.toString(16).padStart(2, "0") +
    a.objectId.toString(16).padStart(6, "0") +
    ` SV ${a.stateVariable}`
  );
}

function escapeBytes(bytes: Buffer): Buffer {
  const out: number[] = [];
  for (const b of bytes) {
    if (b === STX || b === ETX || b === ACK || b === NAK || b === ESC) {
      out.push(ESC, b + 0x80);
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out);
}

function checksum(body: Buffer): number {
  let x = 0;
  for (const b of body) x ^= b;
  return x;
}

/** Fertiger Rahmen für die Leitung: STX, ersetzter Body samt Prüfsumme, ETX. */
export function encodeFrame(body: Buffer): Buffer {
  const withChecksum = Buffer.concat([body, Buffer.from([checksum(body)])]);
  return Buffer.concat([Buffer.from([STX]), escapeBytes(withChecksum), Buffer.from([ETX])]);
}

function int32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(Math.trunc(value));
  return buf;
}

export function buildSvMessage(type: MessageType, address: SvAddress, data: number): Buffer {
  if (!SV_MESSAGE_TYPES.has(type)) throw new Error(`Kein SV-Nachrichtentyp: 0x${type.toString(16)}`);
  const body = Buffer.alloc(SV_BODY_LENGTH);
  body[0] = type;
  body.writeUInt16BE(address.node & 0xffff, 1);
  body[3] = address.virtualDevice & 0xff;
  body.writeUIntBE(address.objectId & 0xffffff, 4, 3);
  body.writeUInt16BE(address.stateVariable & 0xffff, 7);
  int32(data).copy(body, 9);
  return encodeFrame(body);
}

export function buildPresetRecall(type: MessageType, presetId: number): Buffer {
  if (!PRESET_MESSAGE_TYPES.has(type)) throw new Error(`Kein Preset-Nachrichtentyp: 0x${type.toString(16)}`);
  const body = Buffer.alloc(PRESET_BODY_LENGTH);
  body[0] = type;
  int32(presetId).copy(body, 1);
  return encodeFrame(body);
}

/** Prozent (0–100) in das 32-Bit-Feld für SETSVPERCENT. */
export function percentToRaw(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)) * 65536);
}

/**
 * Bytes vom Socket in Nachrichten zerlegen. Verkraftet zerstückelte und
 * zusammengeklebte Rahmen, ignoriert ACK/NAK und Müll zwischen Rahmen und
 * meldet Rahmen mit falscher Prüfsumme als Fehler statt sie zu verwerfen –
 * so fällt eine Fehlkonfiguration im Log auf.
 */
export class FrameParser {
  private inFrame = false;
  private escaped = false;
  private body: number[] = [];
  /** Unfertige Rahmen nicht endlos wachsen lassen (Sync verloren). */
  private static readonly MAX_BODY = 64;

  push(chunk: Buffer): { messages: DecodedMessage[]; errors: string[] } {
    const messages: DecodedMessage[] = [];
    const errors: string[] = [];
    for (const byte of chunk) {
      if (!this.inFrame) {
        if (byte === STX) {
          this.inFrame = true;
          this.escaped = false;
          this.body = [];
        }
        // ACK/NAK und alles andere außerhalb eines Rahmens sind uninteressant.
        continue;
      }
      if (byte === STX) {
        // Neuer Rahmen mitten im alten: alten verwerfen.
        errors.push("Rahmen ohne ETX abgebrochen");
        this.body = [];
        this.escaped = false;
        continue;
      }
      if (byte === ETX) {
        this.inFrame = false;
        const decoded = this.decode(Buffer.from(this.body));
        if ("error" in decoded) errors.push(decoded.error);
        else messages.push(decoded);
        continue;
      }
      if (this.escaped) {
        this.body.push((byte - 0x80) & 0xff);
        this.escaped = false;
        continue;
      }
      if (byte === ESC) {
        this.escaped = true;
        continue;
      }
      this.body.push(byte);
      if (this.body.length > FrameParser.MAX_BODY) {
        errors.push("Rahmen zu lang – Synchronisation verloren");
        this.inFrame = false;
        this.body = [];
      }
    }
    return { messages, errors };
  }

  private decode(frame: Buffer): DecodedMessage | { error: string } {
    if (frame.length < 2) return { error: "Leerer Rahmen" };
    const body = frame.subarray(0, frame.length - 1);
    const sum = frame[frame.length - 1];
    if (checksum(body) !== sum) {
      return { error: `Prüfsumme falsch (${body.toString("hex")})` };
    }
    const type = body[0];
    if (SV_MESSAGE_TYPES.has(type)) {
      if (body.length !== SV_BODY_LENGTH) {
        return { error: `SV-Nachricht 0x${type.toString(16)} mit ${body.length} Bytes` };
      }
      return {
        type,
        address: {
          node: body.readUInt16BE(1),
          virtualDevice: body[3],
          objectId: body.readUIntBE(4, 3),
          stateVariable: body.readUInt16BE(7),
        },
        data: body.readInt32BE(9),
      };
    }
    if (PRESET_MESSAGE_TYPES.has(type)) {
      if (body.length !== PRESET_BODY_LENGTH) {
        return { error: `Preset-Nachricht mit ${body.length} Bytes` };
      }
      return { type, address: null, data: body.readInt32BE(1) };
    }
    return { error: `Unbekannter Nachrichtentyp 0x${type.toString(16)}` };
  }
}
