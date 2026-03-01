import { NextRequest, NextResponse } from "next/server";
import { POST as empControlWebhook } from "@/app/api/integrations/emp-control/webhook/route";
import { POST as annyWebhook } from "@/app/api/integrations/anny/webhook/route";

export async function POST(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider")?.toLowerCase();

  if (provider === "anny") return annyWebhook(request);
  if (provider === "emp-control" || provider === "emp_control") return empControlWebhook(request);

  const cloned = request.clone();
  let body: Record<string, unknown> = {};
  try {
    body = await cloned.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if ("employees" in body || Array.isArray(body)) return empControlWebhook(request);
  if ("booking" in body || "bookings" in body || "data" in body) return annyWebhook(request);

  return NextResponse.json(
    { error: "Cannot determine provider. Use ?provider=emp-control or ?provider=anny, or POST to /api/webhook/emp-control or /api/integrations/emp-control/webhook" },
    { status: 400 }
  );
}

export async function GET() {
  return NextResponse.json({
    endpoints: {
      "emp-control": "POST /api/webhook/emp-control or POST /api/integrations/emp-control/webhook",
      "anny": "POST /api/webhook?provider=anny or POST /api/integrations/anny/webhook",
    },
    auth: "Header: Authorization: Bearer <secret> or X-Webhook-Secret: <secret>",
  });
}
