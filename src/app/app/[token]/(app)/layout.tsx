import { riderAppPath } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { RiderNav } from "@/components/rider/rider-nav";

/** Geschützter Teil der Kunden-App: ohne Anmeldung geht es zum Einrichten oder Anmelden. */
export default async function RiderAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  await requireRider(token);
  return (
    <>
      <main className="rd-main">{children}</main>
      <RiderNav base={riderAppPath(token)} />
    </>
  );
}
