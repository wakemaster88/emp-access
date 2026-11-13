import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { SectionHeading } from "@/components/ui/section-heading";
import { TwoFactorCard } from "@/components/account/two-factor-card";
import { PasskeyCard } from "@/components/account/passkey-card";
import { passkeyListSelect, suggestPasskeyName } from "@/lib/passkey";
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
          passkeys: { select: passkeyListSelect, orderBy: { createdAt: "asc" } },
        },
      });
  if (!admin) redirect("/login");
  const userAgent = (await headers()).get("user-agent");

  return (
    <>
      <Header title="Konto & Sicherheit" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5 max-w-3xl">
        {/* Abschnittsüberschrift statt eigener Titelzeile; der Seitentitel steht im Kopfbalken. */}
        <SectionHeading
          title="Mein Konto"
          description={`Anmeldung von ${admin.email} absichern.`}
        />

        <PasskeyCard
          initialPasskeys={admin.passkeys.map((p) => ({
            ...p,
            createdAt: p.createdAt.toISOString(),
            lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
          }))}
          suggestedName={suggestPasskeyName(userAgent)}
        />

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
