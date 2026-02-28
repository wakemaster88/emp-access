import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { isValueValid } from "@/lib/wakesys";

/**
 * Wakesys API (query_operator.php) – wie api_wakesys.php.
 * Gültig wenn: card_valid === "yes" ODER next_tickets[0] ODER valid_until >= aktuelle Zeit.
 */

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const scan = request.nextUrl.searchParams.get("scan");
  if (!scan) {
    return NextResponse.json({ error: "Missing scan parameter" }, { status: 400 });
  }

  const { db } = auth;
  const config = await db.apiConfig.findFirst({
    where: { accountId: auth.account.id, provider: "WAKESYS" },
  });

  if (!config) {
    return NextResponse.json({ error: "Wakesys not configured" }, { status: 404 });
  }

  const extraConfig = config.extraConfig ? JSON.parse(config.extraConfig) : {};
  const account = extraConfig.account || (config.baseUrl ? new URL(config.baseUrl).hostname.split(".")[0] : null) || "default";
  const interfaceType = extraConfig.interfaceType || "gate";
  const interfaceIds: number[] = Array.isArray(extraConfig.interfaceIds)
    ? extraConfig.interfaceIds
    : extraConfig.interfaceId != null
      ? [Number(extraConfig.interfaceId)]
      : [2];

  try {
    const idsToTry = interfaceIds.length > 0 ? interfaceIds : [2];
    let lastData: unknown = null;

    for (const interfaceId of idsToTry) {
      const url = `https://${account}.wakesys.com/files_for_admin_and_browser/sql_query/query_operator.php?interface=gate&interface_id=${interfaceId}&controller_interface_type=${interfaceType}&id=${encodeURIComponent(scan)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const value = data?.data?.value ?? null;
      lastData = value;

      if (isValueValid(value)) {
        return NextResponse.json({
          valid: true,
          scan,
          interfaceId,
          data: value,
        });
      }
    }

    return NextResponse.json({ valid: false, scan, data: lastData });
  } catch (err) {
    return NextResponse.json(
      { error: `Wakesys error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }
}
