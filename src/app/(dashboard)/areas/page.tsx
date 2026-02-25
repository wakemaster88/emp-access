import { auth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AreasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const areas = await db.accessArea.findMany({
    where: isSuperAdmin ? {} : { accountId: session.user.accountId! },
    include: {
      parent: true,
      _count: { select: { tickets: true, children: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <Header title="Zugangsbereiche" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader>
            <CardTitle>Alle Bereiche ({areas.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Übergeordnet</TableHead>
                  <TableHead>Personenlimit</TableHead>
                  <TableHead>Wiedereintritt</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right">Unterbereiche</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {areas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500 py-12">
                      Keine Bereiche konfiguriert
                    </TableCell>
                  </TableRow>
                )}
                {areas.map((area) => (
                  <TableRow key={area.id}>
                    <TableCell className="font-medium">{area.name}</TableCell>
                    <TableCell className="text-sm text-slate-500">{area.parent?.name || "–"}</TableCell>
                    <TableCell>
                      {area.personLimit ? (
                        <Badge variant="secondary">{area.personLimit} Pers.</Badge>
                      ) : (
                        <span className="text-slate-400">Unbegrenzt</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={area.allowReentry ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}>
                        {area.allowReentry ? "Ja" : "Nein"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{area._count.tickets}</TableCell>
                    <TableCell className="text-right">{area._count.children}</TableCell>
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
