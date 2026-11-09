import { Dashboard } from "@/components/dashboard";
import { loadConfig } from "@/lib/config";
import { maskConfigSecrets } from "@/lib/config-secrets";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = await loadConfig();
  // Secrets maskieren, bevor die Config als Props an den Client geht.
  const safe = maskConfigSecrets(config);
  return (
    <main className="h-full w-full">
      <Dashboard initialConfig={safe} />
    </main>
  );
}
