-- Hub offline/online als Push melden: Marke fuer den Zustandsuebergang,
-- analog zu Device.offlineNotifiedAt. Anlass: Hub-Ausfall 03.09. 20:37 bis
-- 04.09. 10:53 Uhr blieb unbemerkt.
ALTER TABLE "HubAgent" ADD COLUMN "offlineNotifiedAt" TIMESTAMP(3);
