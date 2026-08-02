import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { publishTailgatePass } from "@/lib/event-bus";
import { postShopAlert } from "@/lib/emp-access-alert";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Löst eine Sofortmeldung zum Ausprobieren aus.
 *
 * Ohne so einen Knopf lässt sich nicht feststellen, ob der Ton auf dem
 * Kiosk-Bildschirm überhaupt durchkommt — Browser lassen ihn erst zu,
 * nachdem jemand die Seite angefasst hat, und ein echter Vorfall kommt
 * nicht auf Zuruf.
 *
 * `?shop=1` schickt zusätzlich das Popup an den Kassen-Monitor.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const withShop = url.searchParams.get("shop") === "1";
  const cfg = await loadConfig();
  const cam =
    cfg.cams.find((c) => c.enabled && c.tailgate.enabled) ?? cfg.cams[0];
  if (!cam) {
    return NextResponse.json({ ok: false, error: "Keine Kamera" }, { status: 400 });
  }

  const crossedAt = Date.now();
  publishTailgatePass({
    source: cam.id,
    camId: cam.id,
    camName: cam.name,
    crossedAt,
    count: 1,
  });
  await logEvent({
    action: "tailgate-pass",
    target: cam.id,
    ok: true,
    meta: { test: true },
  });

  let shop: string | null = null;
  if (withShop) {
    try {
      await postShopAlert({ camName: `${cam.name} (Test)`, count: 1, crossedAt });
    } catch (e) {
      shop = (e as Error).message;
    }
  }

  return NextResponse.json({ ok: true, camName: cam.name, shopError: shop });
}
