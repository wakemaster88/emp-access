import { KeySignClient } from "@/components/schliessanlage/key-sign-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Schlüsselübergabe",
  robots: { index: false, follow: false },
};

export default async function KeySignPage({ params }: PageProps) {
  const { token } = await params;
  return <KeySignClient token={token} />;
}
