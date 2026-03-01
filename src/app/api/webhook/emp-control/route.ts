import { NextResponse } from "next/server";

export { POST } from "@/app/api/integrations/emp-control/webhook/route";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "EMP Access",
    webhook: "emp-control",
    method: "POST",
    auth: "Authorization: Bearer <webhook-secret> or X-Webhook-Secret: <webhook-secret>",
    body: '{ "employees": [ { "id", "firstName", "lastName", "rfidCode", "contractStart", "contractEnd", "active", "areaId" } ] }',
  });
}
