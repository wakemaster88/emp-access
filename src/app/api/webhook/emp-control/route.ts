import { NextResponse } from "next/server";

export { POST } from "@/app/api/integrations/emp-control/webhook/route";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "EMP Access",
    webhook: "emp-control",
    method: "POST",
    auth: "Authorization: Bearer <webhook-secret> or X-Webhook-Secret: <webhook-secret>",
    body: '{ "employees": [ { "id", "firstName", "lastName", "rfidCode", "contractStart", "contractEnd", "active", "areaIds": [1, 2, 3], "deviceIds": [22, 23] } ] }',
    fields: {
      areaIds:
        "Zutrittsbereiche. Alternativ areaId oder resourceIds. IDs aus GET /api/areas.",
      deviceIds:
        "Einzelne Geräte, die dieser Mitarbeiter zusätzlich bedienen darf – " +
        "additiv zu den Bereichen. Alternativ deviceId. IDs aus GET /api/devices.",
      hinweis:
        "Fehlt ein Feld, bleibt der bestehende Wert unverändert. Eine leere Liste " +
        "entfernt alle Einträge. Unbekannte IDs werden übersprungen und in der " +
        "Antwort unter \"unknown\" gemeldet.",
    },
  });
}
