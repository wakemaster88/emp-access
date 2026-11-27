-- Newsletter-Design nach der Website: eigene Farben und eigenes Logo für Mails und die
-- Seiten Bestätigen/Abmelden. Nur neue, leere Spalten (leer = Petrol/Gelb der Website).
-- AlterTable
ALTER TABLE "NewsletterConfig" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "accentColor" TEXT,
ADD COLUMN     "logoUrl" TEXT;
