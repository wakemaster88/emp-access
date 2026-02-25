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

export default async function TicketsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const tickets = await db.ticket.findMany({
    where: isSuperAdmin ? {} : { accountId: session.user.accountId! },
    include: { accessArea: true, _count: { select: { scans: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case "VALID":
        return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Gültig</Badge>;
      case "INVALID":
        return <Badge variant="destructive">Ungültig</Badge>;
      case "PROTECTED":
        return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Geschützt</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <>
      <Header title="Tickets" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle>Alle Tickets ({tickets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Bereich</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Gültig ab</TableHead>
                  <TableHead>Gültig bis</TableHead>
                  <TableHead className="text-right">Scans</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-slate-500 py-12">
                      Keine Tickets vorhanden
                    </TableCell>
                  </TableRow>
                )}
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-medium">{ticket.name}</TableCell>
                    <TableCell className="text-xs font-mono text-slate-500">
                      {ticket.barcode || ticket.qrCode || ticket.rfidCode || "–"}
                    </TableCell>
                    <TableCell>{ticket.accessArea?.name || "–"}</TableCell>
                    <TableCell>{statusBadge(ticket.status)}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {ticket.startDate?.toLocaleDateString("de-DE") || "–"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {ticket.endDate?.toLocaleDateString("de-DE") || "–"}
                    </TableCell>
                    <TableCell className="text-right">{ticket._count.scans}</TableCell>
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
