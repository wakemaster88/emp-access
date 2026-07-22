import { Dashboard } from "@/components/dashboard";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = await loadConfig();
  // Mask passwords before sending to client
  const safe = {
    ...config,
    cams: config.cams.map((c) => ({ ...c, password: "" })),
    doorbird: { ...config.doorbird, password: "", webhookSecret: "" },
  };
  return (
    <main className="h-full w-full">
      <Dashboard initialConfig={safe} />
    </main>
  );
}
