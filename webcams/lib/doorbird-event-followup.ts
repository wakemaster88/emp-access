import { loadConfig } from "./config";
import {
  fetchDoorbirdJpeg,
  persistDoorbirdEventSnapshot,
} from "./doorbird-event-snapshots";
import { notify } from "./notify";

/**
 * Nach einem akzeptierten Klingel-Webhook: optional Snapshot ziehen,
 * lokal persistieren, Telegram mit demselben Bild versorgen (kein Doppel-Fetch).
 */
export function scheduleDoorbirdRingSnapshotPipeline(callerIp: string | null): void {
  void (async () => {
    try {
      const cfg = await loadConfig();
      const persist = cfg.doorbird.eventSnapshots.enabled;
      const tg = cfg.settings.telegram;
      const tgNeedsJpeg =
        tg.enabled &&
        !!tg.botToken &&
        tg.chatIds.length > 0 &&
        tg.events.doorRing &&
        tg.includeSnapshot;

      let jpeg: Buffer | null | undefined;
      if (persist || tgNeedsJpeg) {
        jpeg = await fetchDoorbirdJpeg(cfg.doorbird);
      } else {
        jpeg = undefined;
      }

      if (persist) {
        await persistDoorbirdEventSnapshot({
          kind: "ring",
          jpeg: jpeg ?? null,
          meta: { callerIp },
          retentionDays: cfg.doorbird.eventSnapshots.retentionDays,
        });
      }

      void notify({
        type: "door-ring",
        data: jpeg === undefined ? {} : { snapshot: jpeg },
      });
    } catch (e) {
      console.error("[doorbird-events] ring pipeline", e);
    }
  })();
}

export function scheduleDoorbirdOpenSnapshotPipeline(args: {
  source: string;
  plate?: string;
  owner?: string;
  inRingWindow: boolean;
  elapsedSinceRingMs: number;
}): void {
  void (async () => {
    try {
      const cfg = await loadConfig();
      const persist = cfg.doorbird.eventSnapshots.enabled;
      const tg = cfg.settings.telegram;
      const tgNeedsJpeg =
        tg.enabled &&
        !!tg.botToken &&
        tg.chatIds.length > 0 &&
        tg.events.doorOpen &&
        tg.includeSnapshot;

      let jpeg: Buffer | null | undefined;
      if (persist || tgNeedsJpeg) {
        jpeg = await fetchDoorbirdJpeg(cfg.doorbird);
      } else {
        jpeg = undefined;
      }

      if (persist) {
        await persistDoorbirdEventSnapshot({
          kind: "door-open",
          jpeg: jpeg ?? null,
          meta: {
            source: args.source,
            plate: args.plate,
            owner: args.owner,
            inRingWindow: args.inRingWindow,
            elapsedSinceRingMs: args.elapsedSinceRingMs,
          },
          retentionDays: cfg.doorbird.eventSnapshots.retentionDays,
        });
      }

      void notify({
        type: "door-open",
        data:
          jpeg === undefined
            ? { source: args.source, plate: args.plate, owner: args.owner }
            : {
                source: args.source,
                plate: args.plate,
                owner: args.owner,
                snapshot: jpeg,
              },
      });
    } catch (e) {
      console.error("[doorbird-events] open pipeline", e);
    }
  })();
}
