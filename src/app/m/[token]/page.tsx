import { notFound } from "next/navigation";
import { loadEmployeeByMobileToken } from "@/lib/employee-access";
import { MobileAccessClient } from "@/components/employees/mobile-pwa-client";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export default async function MobileAccessPage({ params }: PageProps) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const profile = await loadEmployeeByMobileToken(token);
  if (!profile) notFound();

  // Sensitive Felder (Email, RFID) reichen wir bewusst NICHT an den Client.
  return (
    <MobileAccessClient
      token={token}
      profile={{
        name: profile.name,
        firstName: profile.firstName,
        lastName: profile.lastName,
        ticketTypeName: profile.ticketTypeName,
        profileImage: profile.profileImage,
        accountName: profile.accountName,
        status: profile.status,
        startDate: profile.startDate ? profile.startDate.toISOString() : null,
        endDate: profile.endDate ? profile.endDate.toISOString() : null,
        weekSchedule: profile.weekSchedule,
        contractOk: profile.contractOk,
        contractReason: profile.contractReason,
        scheduleCheck: profile.scheduleCheck,
        devices: profile.devices.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          category: d.category,
          via: d.via,
        })),
      }}
    />
  );
}
