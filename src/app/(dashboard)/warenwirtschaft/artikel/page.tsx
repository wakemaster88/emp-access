import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Notice } from "@/components/ui/notice";
import { ArticlesView, CreateArticleButton } from "@/components/warenwirtschaft/articles-view";
import { formatEuro, valueCents } from "@/lib/warenwirtschaft";
import { Boxes, Euro, ImageOff } from "lucide-react";
import { wawiPageSession } from "../wawi-page";

export default async function ArtikelPage() {
  const { session, accountId, db } = await wawiPageSession();
  const articles = await db.article.findMany({
    where: { accountId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    omit: { imageSearchedAt: true, createdAt: true, updatedAt: true, accountId: true },
  });
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
            {pendingSearch > 0 && (
              <div className="px-4 pb-4 sm:px-[18px]">
                <Notice tone="info" compact title={`Für ${pendingSearch} Artikel wird im Hintergrund ein Produktfoto gesucht.`}>
                  Etwa 70 Artikel pro Stunde, Quelle Open Food Facts (CC BY-SA). Ohne eindeutigen Treffer bleibt das Symbol; im Artikel kannst du unter „Bild suchen“ selbst wählen oder ein Foto hochladen.
                </Notice>
              </div>
            )}
            <ArticlesView articles={articles} categories={categories} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
