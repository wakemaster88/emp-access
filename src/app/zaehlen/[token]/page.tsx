import { PublicCountClient } from "@/components/warenwirtschaft/public-count-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Inventur zählen",
  robots: { index: false, follow: false },
};

export default async function CountPage({ params }: PageProps) {
  const { token } = await params;
  return <PublicCountClient token={token} />;
}
