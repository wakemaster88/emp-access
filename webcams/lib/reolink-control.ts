import { reolinkCommand } from "./reolink";
import type { Cam } from "./types";

export type PtzOp =
  | "Left"
  | "Right"
  | "Up"
  | "Down"
  | "LeftUp"
  | "LeftDown"
  | "RightUp"
  | "RightDown"
  | "ZoomInc"
  | "ZoomDec"
  | "FocusInc"
  | "FocusDec"
  | "Stop"
  | "Auto"
  | "ToPos"
  | "SetPos";

export async function ptzCtrl(cam: Cam, op: PtzOp, opts: { speed?: number; presetId?: number } = {}) {
  const { speed = 32, presetId } = opts;
  const param: Record<string, unknown> = {
    channel: cam.channel,
    op,
    speed,
  };
  if (op === "ToPos" || op === "SetPos") {
    if (presetId === undefined) {
      throw new Error("presetId required for ToPos/SetPos");
    }
    param.id = presetId;
  }
  return reolinkCommand(cam, { cmd: "PtzCtrl", action: 0, param });
}

export async function setSpotlight(
  cam: Cam,
  on: boolean,
  brightness = 100,
) {
  return reolinkCommand(cam, {
    cmd: "SetWhiteLed",
    action: 0,
    param: {
      WhiteLed: {
        channel: cam.channel,
        state: on ? 1 : 0,
        mode: 1, // manual
        bright: Math.max(1, Math.min(100, brightness)),
      },
    },
  });
}

export type IrState = "Auto" | "On" | "Off";

export async function setIr(cam: Cam, state: IrState) {
  return reolinkCommand(cam, {
    cmd: "SetIrLights",
    action: 0,
    param: { IrLights: { channel: cam.channel, state } },
  });
}

/**
 * Sirene wird über AudioAlarmPlay manuell gesteuert.
 * Reolink kennt keinen Dauer-Parameter, daher Auslösung +
 * verzögertes Stop von Aufrufer.
 */
export async function setAudioAlarm(cam: Cam, on: boolean) {
  return reolinkCommand(cam, {
    cmd: "AudioAlarmPlay",
    action: 0,
    param: {
      alarm_mode: "manul",
      manual_switch: on ? 1 : 0,
      times: 1,
      channel: cam.channel,
    },
  });
}

export async function getPtzPresets(cam: Cam) {
  return reolinkCommand<{ PtzPreset: { id: number; name: string; channel: number }[] }>(
    cam,
    { cmd: "GetPtzPreset", action: 1, param: { channel: cam.channel } },
  );
}

export interface SnapshotOptions {
  signal?: AbortSignal;
}

export async function getSnapshot(cam: Cam, opts: SnapshotOptions = {}): Promise<Buffer> {
  const url = `http://${cam.ip}:${cam.port}/cgi-bin/api.cgi?cmd=Snap&channel=${cam.channel}&rs=webcams${Date.now()}&user=${encodeURIComponent(cam.username)}&password=${encodeURIComponent(cam.password)}`;
  const r = await fetch(url, { signal: opts.signal });
  if (!r.ok) throw new Error(`Snap HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}
