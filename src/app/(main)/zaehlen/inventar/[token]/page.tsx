import { PublicInventoryClient } from "@/components/warenwirtschaft/public-inventory-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Inventar zählen",
  robots: { index: false, follow: false },
};

export default async function InventoryCountPage({ params }: PageProps) {
  const { token } = await params;
  return <PublicInventoryClient token={token} />;
}
