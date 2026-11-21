import { InfoFormClient } from "@/components/info/info-form-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export default async function InfoFormPage({ params }: PageProps) {
  const { token } = await params;
  return <InfoFormClient token={token} />;
}
