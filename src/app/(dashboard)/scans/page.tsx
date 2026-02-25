import { auth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
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

export default async function ScansPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const scans = await db.scan.findMany({
    where: isSuperAdmin ? {} : { accountId: session.user.accountId! },
    include: { device: true, ticket: true },
    orderBy: { scanTime: "desc" },
    take: 200,
  });

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
          <CardHeader>
            <CardTitle>Letzte Scans</CardTitle>
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
                      {scan.scanTime.toLocaleString("de-DE")}
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
