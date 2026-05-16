import { NextRequest, NextResponse } from "next/server";
import { POST as empControlWebhook } from "@/app/api/integrations/emp-control/webhook/route";
import { POST as annyWebhook } from "@/app/api/integrations/anny/webhook/route";
import { POST as nukiWebhook } from "@/app/api/integrations/nuki/webhook/route";

export async function POST(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider")?.toLowerCase();

  if (provider === "anny") return annyWebhook(request);
  if (provider === "emp-control" || provider === "emp_control") return empControlWebhook(request);
  if (provider === "nuki") return nukiWebhook(request);

  const cloned = request.clone();
  let body: Record<string, unknown> = {};
  try {
    body = await cloned.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if ("employees" in body || Array.isArray(body)) return empControlWebhook(request);
  if ("event" in body || "booking" in body || "bookings" in body || "data" in body) return annyWebhook(request);
  if ("smartlockId" in body || "smartLockId" in body) return nukiWebhook(request);

  return NextResponse.json(
    { error: "Cannot determine provider. Use ?provider=emp-control | anny | nuki, or POST to the dedicated endpoint." },
    { status: 400 }
  );
}

export async function GET() {
  return NextResponse.json({
    endpoints: {
      "emp-control": "POST /api/webhook/emp-control or POST /api/integrations/emp-control/webhook",
      "anny": "POST /api/webhook?provider=anny or POST /api/integrations/anny/webhook",
      "nuki": "POST /api/webhook?provider=nuki or POST /api/integrations/nuki/webhook?secret=…",
      utilization:
        "GET /api/webhook/utilization?date=YYYY-MM-DD — Auslastung pro Ressource (Account-API-Token wie /api/areas)",
    },
    auth: "Inbound webhooks: Authorization / X-Webhook-Secret / ?secret=. Auslastung: Account apiToken (Bearer oder ?token=) wie unter Einstellungen » Eigene API.",
  });
}
