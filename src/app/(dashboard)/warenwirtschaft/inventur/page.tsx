import { StocktakeListPage } from "@/components/warenwirtschaft/stocktake-list-page";
import { wawiPageSession } from "../wawi-page";

export default async function InventurPage() {
  const { session, accountId, db } = await wawiPageSession();
  return <StocktakeListPage kind="ROLLING" db={db} accountId={accountId} accountName={session.user.accountName} />;
}
