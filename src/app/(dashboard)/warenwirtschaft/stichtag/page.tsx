import { StocktakeListPage } from "@/components/warenwirtschaft/stocktake-list-page";
import { wawiPageSession } from "../wawi-page";

export default async function StichtagPage() {
  const { session, accountId, db } = await wawiPageSession();
  return <StocktakeListPage kind="CUTOFF" db={db} accountId={accountId} accountName={session.user.accountName} />;
}
