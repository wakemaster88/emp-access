import { StocktakeDetailPage } from "@/components/warenwirtschaft/stocktake-detail-page";
import { wawiPageSession } from "../../wawi-page";

export default async function StichtagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, accountId, db } = await wawiPageSession();
  const id = Number((await params).id);
  return <StocktakeDetailPage id={id} kind="CUTOFF" db={db} accountId={accountId} accountName={session.user.accountName} adminId={Number.parseInt(session.user.id ?? "", 10) || null} />;
}
