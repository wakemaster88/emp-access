import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
    include: {
      device: { include: { camera: { select: { id: true, name: true } } } },
      ticket: true,
      snapshot: { select: { capturedAt: true } },
    },
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
      <div className="page-content">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <CardTitle className="tabular-nums">Letzte Scans ({scans.length})</CardTitle>
              {(filterDevice || resultFilter) && (
                <div className="flex flex-wrap items-center gap-2">
                  {filterDevice && (
                    <Badge variant="secondary">{filterDevice.name}</Badge>
                  )}
                  {/* Ergebnis-Filter in der Farbe des Ergebnisses wie in der Liste (docs/design-regeln.md, Abschnitt 3); eine Glas-Umrandung wäre im Hellen nicht zu sehen. */}
                  {resultFilter && (
                    <Badge variant={resultFilter === "GRANTED" ? "success" : resultFilter === "DENIED" ? "danger" : "warning"}>
                      {resultFilter === "GRANTED" ? "Erlaubt" : resultFilter === "DENIED" ? "Abgelehnt" : "Geschützt"}
                    </Badge>
                  )}
                  <a href="/scans" className="inline-flex items-center text-xs text-primary hover:underline max-sm:min-h-11">Filter entfernen</a>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {scans.length === 0 ? (
              <EmptyState icon={ScanLine} title="Keine Scans vorhanden" />
            ) : (
              <div className="space-y-3">
                {sortedCodes.map((code) => {
                  const group = groupedByCode.get(code)!;
                  const ticketName = group[0].ticket?.name || "–";
                  const scanList = group.map((s) => ({
                    id: s.id,
                    scanTime: s.scanTime.toISOString(),
                    deviceName: s.device?.name ?? "Web-Scanner",
                    cameraId: s.device?.camera?.id ?? null,
                    cameraName: s.device?.camera?.name ?? null,
                    snapshotCapturedAt: s.snapshot?.capturedAt.toISOString() ?? null,
                    result: s.result,
                    ticketTypeName: s.ticket?.ticketTypeName ?? null,
                    note: s.note,
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
