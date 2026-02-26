import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { fmtDate } from "@/lib/utils";
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

export default async function AccountsPage() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") redirect("/");

  const accounts = await superAdminClient.account.findMany({
    include: {
      _count: { select: { admins: true, devices: true, tickets: true, scans: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <Header title="Mandanten-Verwaltung" />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle>Alle Mandanten ({accounts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Subdomain</TableHead>
                  <TableHead>API Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Admins</TableHead>
                  <TableHead className="text-right">Geräte</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Scans</TableHead>
                  <TableHead>Erstellt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-slate-500 py-12">
                      Keine Mandanten vorhanden
                    </TableCell>
                  </TableRow>
                )}
                {accounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-medium">{acc.name}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{acc.subdomain}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-400">{acc.apiToken.slice(0, 12)}...</TableCell>
                    <TableCell>
                      <Badge className={acc.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700"}>
                        {acc.isActive ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{acc._count.admins}</TableCell>
                    <TableCell className="text-right">{acc._count.devices}</TableCell>
                    <TableCell className="text-right">{acc._count.tickets}</TableCell>
                    <TableCell className="text-right">{acc._count.scans}</TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {fmtDate(acc.createdAt)}
                    </TableCell>
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
