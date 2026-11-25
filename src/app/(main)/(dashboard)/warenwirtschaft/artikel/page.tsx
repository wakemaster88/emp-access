import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Notice } from "@/components/ui/notice";
import { WawiImportButton } from "@/components/warenwirtschaft/import-button";
import { ArticlesView, CreateArticleButton } from "@/components/warenwirtschaft/articles-view";
import { formatEuro, valueCents } from "@/lib/warenwirtschaft";
import { Boxes, Euro, ImageOff } from "lucide-react";
import { wawiPageSession } from "../wawi-page";
import { articleImageUrl, listImageSrcs } from "@/lib/list-images";
import { inlineImageRows } from "@/lib/list-images-db";

export default async function ArtikelPage() {
  const { session, accountId, db } = await wawiPageSession();
  // Liste ohne Bildspalte; Fotos lädt der Browser einzeln über die Bild-Route.
  const rows = await db.article.findMany({
    where: { accountId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    omit: { image: true, imageSearchedAt: true, createdAt: true, accountId: true },
  });
  const [withImage, inline] = await Promise.all([
    db.article.findMany({ where: { accountId, image: { not: null } }, select: { id: true } }),
    inlineImageRows("article", rows.map((a) => a.id), { accountId }),
  ]);
  const versions = new Map(rows.map((a) => [a.id, a.updatedAt]));
  const imageSrcs = listImageSrcs(withImage, inline, (id) => articleImageUrl(id, versions.get(id) ?? new Date(0)));
  const articles = rows.map((a) => ({ ...a, image: imageSrcs.get(a.id) ?? null }));
  const categories = [...new Set(articles.map((a) => a.category))].sort((a, b) => a.localeCompare(b, "de"));
  const active = articles.filter((a) => a.active);
  const totalValue = active.reduce((sum, a) => sum + valueCents(Math.max(0, a.stock), a.purchasePriceCents), 0);
  const withoutImage = articles.filter((a) => !a.image).length;
  const pendingSearch = await db.article.count({ where: { accountId, image: null, imageSearchedAt: null, active: true } });

  return (
    <>
      <Header title="Artikel" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Aktive Artikel" value={active.length} icon={Boxes} tone="primary" hint={`${categories.length} Kategorien`} />
          <StatCard label="Lagerwert netto" value={formatEuro(totalValue)} icon={Euro} tone="success" hint="Bestand × EK" />
          <StatCard label="Ohne Bild" value={withoutImage} icon={ImageOff} tone="neutral" className="max-lg:col-span-2" />
        </div>

        <Card flush>
          <CardHeader>
            <CardTitle>Artikel&nbsp;({articles.length})</CardTitle>
            <CardDescription>
              Stammdaten für Inventuren: Einheit, Einkaufspreis und aktueller Bestand. Der Bestand wird beim Abschluss einer Inventur übernommen.
            </CardDescription>
            <CardAction>
              <CreateArticleButton categories={categories} />
            </CardAction>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <div className="space-y-3 px-4 pb-4 sm:px-[18px]">
              <WawiImportButton hint="Inventurliste mit Bezeichnung, Einheit und EK netto. Ein Datum im Kopf wird als Stichtagsinventur übernommen." />
              {pendingSearch > 0 && (
                <Notice tone="info" compact title={`Für ${pendingSearch} Artikel wird im Hintergrund ein Produktfoto gesucht.`}>
                  Etwa 70 Artikel pro Stunde, Quelle Open Food Facts (CC BY-SA). Ohne eindeutigen Treffer bleibt das Symbol; im Artikel kannst du unter „Bild suchen“ selbst wählen oder ein Foto hochladen.
                </Notice>
              )}
            </div>
            <ArticlesView articles={articles} categories={categories} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
