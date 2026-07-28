import { redirect } from "next/navigation";
import { safeAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { TwoFactorCard } from "@/components/account/two-factor-card";
import { isTwoFactorActive } from "@/lib/two-factor";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const adminId = parseInt(session.user.id, 10);
  const admin = Number.isNaN(adminId)
    ? null
    : await prisma.admin.findUnique({
        where: { id: adminId },
        select: {
          email: true,
          twoFactorSecret: true,
          twoFactorEnabledAt: true,
          twoFactorRecoveryCodes: true,
        },
      });
  if (!admin) redirect("/login");

  return (
    <>
      <Header title="Sicherheit" accountName={session.user.accountName} />
      <div className="p-4 md:p-6 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Mein Konto</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Anmeldung von {admin.email} absichern.
          </p>
        </div>

        <TwoFactorCard
          email={admin.email}
          initialEnabled={isTwoFactorActive(admin)}
          initialRecoveryCodesLeft={admin.twoFactorRecoveryCodes.length}
          enabledAt={admin.twoFactorEnabledAt ? admin.twoFactorEnabledAt.toISOString() : null}
        />
      </div>
    </>
  );
}
