-- Weitere Adressen eines Kundenkontos nach dem Zusammenlegen (Etappe 3b)
ALTER TABLE "Customer" ADD COLUMN "aliasEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
