import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScanGroupCard } from "@/components/scans/scan-group-card";

interface Props {
  searchParams: Promise<{ device?: string; result?: string }>;
}

export default async function ScansPage({ searchParams }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const { device, result } = await searchParams;
  const deviceId = device ? Number(device) : undefined;
  const resultFilter = result && ["GRANTED", "DENIED", "PROTECTED"].includes(result)
    ? (result as "GRANTED" | "DENIED" | "PROTECTED")
    : undefined;

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const scans = await db.scan.findMany({
    where: {
      ...(isSuperAdmin ? {} : { accountId: session.user.accountId! }),
      ...(deviceId ? { deviceId } : {}),
      ...(resultFilter ? { result: resultFilter } : {}),
    },
    include: { device: true, ticket: true },
    orderBy: { scanTime: "desc" },
    take: 200,
  });

  const groupedByCode = scans.reduce<Map<string, typeof scans>>((acc, scan) => {
    const code = scan.code;
    if (!acc.has(code)) acc.set(code, []);
    acc.get(code)!.push(scan);
    return acc;
  }, new Map());
  const sortedCodes = Array.from(groupedByCode.entries())
    .sort(([, a], [, b]) => new Date(b[0].scanTime).getTime() - new Date(a[0].scanTime).getTime())
    .map(([code]) => code);

  const filterDevice = deviceId
    ? await db.device.findFirst({ where: { id: deviceId }, select: { name: true } })
    : null;

  return (
    <>
      <Header title="Scan-Historie" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <CardTitle className="text-base sm:text-lg">Letzte Scans ({scans.length})</CardTitle>
              {(filterDevice || resultFilter) && (
                <div className="flex items-center gap-2">
                  {filterDevice && (
                    <Badge variant="secondary" className="text-xs">{filterDevice.name}</Badge>
                  )}
                  {resultFilter && (
                    <Badge variant="outline" className="text-xs">
                      {resultFilter === "GRANTED" ? "Erlaubt" : resultFilter === "DENIED" ? "Abgelehnt" : "Geschützt"}
                    </Badge>
                  )}
                  <a href="/scans" className="text-xs text-indigo-600 hover:underline">Filter entfernen</a>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-6">
            {scans.length === 0 ? (
              <p className="text-center text-slate-500 py-12">Keine Scans vorhanden</p>
            ) : (
              <div className="space-y-4">
                {sortedCodes.map((code) => {
                  const group = groupedByCode.get(code)!;
                  const ticketName = group[0].ticket?.name || "–";
                  const scanList = group.map((s) => ({
                    id: s.id,
                    scanTime: s.scanTime.toISOString(),
                    deviceName: s.device?.name ?? "Web-Scanner",
                    result: s.result,
                    ticketTypeName: s.ticket?.ticketTypeName ?? null,
                  }));
                  return (
                    <ScanGroupCard
                      key={code}
                      ticketName={ticketName}
                      code={code}
                      scans={scanList}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
