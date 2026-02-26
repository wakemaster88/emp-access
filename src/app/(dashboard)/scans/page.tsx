import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { fmtDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  const filterDevice = deviceId
    ? await db.device.findFirst({ where: { id: deviceId }, select: { name: true } })
    : null;

  const resultBadge = (result: string) => {
    switch (result) {
      case "GRANTED":
        return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Erlaubt</Badge>;
      case "DENIED":
        return <Badge variant="destructive">Abgelehnt</Badge>;
      case "PROTECTED":
        return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Geschützt</Badge>;
      default:
        return <Badge variant="secondary">{result}</Badge>;
    }
  };

  return (
    <>
      <Header title="Scan-Historie" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <CardTitle>Letzte Scans ({scans.length})</CardTitle>
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
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeit</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Gerät</TableHead>
                  <TableHead>Ergebnis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500 py-12">
                      Keine Scans vorhanden
                    </TableCell>
                  </TableRow>
                )}
                {scans.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell className="text-sm">
                      {fmtDateTime(scan.scanTime)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{scan.code}</TableCell>
                    <TableCell>{scan.ticket?.name || "–"}</TableCell>
                    <TableCell className="text-sm">{scan.device.name}</TableCell>
                    <TableCell>{resultBadge(scan.result)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
