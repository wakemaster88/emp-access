import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

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
  const account = extraConfig.account || "default";
  const interfaceId = extraConfig.interfaceId || 2;
  const interfaceType = extraConfig.interfaceType || "gate";

  try {
    const url = `https://${account}.wakesys.com/files_for_admin_and_browser/sql_query/query_operator.php?interface=gate&interface_id=${interfaceId}&controller_interface_type=${interfaceType}&id=${scan}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();

    const valid =
      data?.data?.value?.card_valid === "yes" ||
      !!data?.data?.value?.next_tickets_message?.[0] ||
      !!data?.data?.value?.valid_until;

    return NextResponse.json({
      valid,
      scan,
      data: data?.data?.value,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Wakesys error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }
}
