import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateLostItemButton, LostItemsTable } from "@/components/lost-items/lost-items-table";
import { listImageSrcs, lostItemImageUrl } from "@/lib/list-images";
import { inlineImageRows } from "@/lib/list-images-db";

export default async function FundsachenPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  // Liste ohne Bildspalte; Fotos lädt der Browser einzeln über die Bild-Route.
  const items = await db.lostItem.findMany({
    where: accountFilter,
    orderBy: [{ pickedUp: "asc" }, { foundDate: "desc" }],
    omit: { image: true },
  });
  const [withImage, inline] = await Promise.all([
    db.lostItem.findMany({ where: { ...accountFilter, image: { not: null } }, select: { id: true } }),
    inlineImageRows("lostItem", items.map((it) => it.id), { accountId: isSuperAdmin ? null : session.user.accountId! }),
  ]);
  const versions = new Map(items.map((it) => [it.id, it.updatedAt]));
  const imageSrcs = listImageSrcs(withImage, inline, (id) => lostItemImageUrl(id, versions.get(id) ?? new Date(0)));

  return (
    <>
      <Header title="Fundsachen" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        {/* Tabelle läuft bis an den Kartenrand: Karte unten und Inhalt seitlich ohne Innenabstand. */}
        <Card flush>
          <CardHeader>
            {/* Geschütztes Leerzeichen: auf dem Handy bricht der Titel vor „Verlustmeldungen“ um,
                statt die Anzahl allein in die zweite Zeile zu stellen. */}
            <CardTitle>Fundsachen & Verlustmeldungen&nbsp;({items.length})</CardTitle>
            <CardDescription>
              Gefundene Gegenstände und Verlustmeldungen können hier im Backend oder am Shop-Monitor erfasst und als erledigt markiert werden.
            </CardDescription>
            {/* Primärhandlung oben rechts im Kartenkopf (docs/design-regeln.md, Abschnitt 13). */}
            {!isSuperAdmin && (
              <CardAction>
                <CreateLostItemButton />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <LostItemsTable
              items={items.map((it) => ({
                id: it.id,
                kind: it.kind,
                description: it.description,
                foundDate: it.foundDate.toISOString(),
                image: imageSrcs.get(it.id) ?? null,
                contact: it.contact,
                reporterName: it.reporterName,
                callbackPhone: it.callbackPhone,
                pickedUp: it.pickedUp,
                pickedUpAt: it.pickedUpAt ? it.pickedUpAt.toISOString() : null,
              }))}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
