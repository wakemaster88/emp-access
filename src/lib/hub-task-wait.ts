import type { TenantDb } from "@/lib/prisma";

/**
 * Auf das Ergebnis eines Hub-Tasks warten (kurzes DB-Polling).
 * Der Hub pollt Tasks alle ~5 s (1 s sobald der Heartbeat offene Tasks
 * meldet); Routen, die dem Nutzer sofort antworten wollen, warten daher
 * bis zu ~15 s und melden sonst "pending".
 */
export const HUB_TASK_WAIT_MS = 15_000;
const HUB_TASK_POLL_MS = 750;

export type HubTaskOutcome =
  | { status: "DONE"; result: unknown }
  | { status: "FAILED"; error: string }
  | { status: "PENDING" };

export async function waitForHubTask(
  db: TenantDb,
  taskId: number,
  timeoutMs = HUB_TASK_WAIT_MS
): Promise<HubTaskOutcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, HUB_TASK_POLL_MS));
    const current = await db.hubTask.findUnique({
      where: { id: taskId },
      select: { status: true, result: true, error: true },
    });
    if (!current) break;
    if (current.status === "DONE") return { status: "DONE", result: current.result };
    if (current.status === "FAILED") {
      return { status: "FAILED", error: current.error ?? "Task fehlgeschlagen" };
    }
  }
  return { status: "PENDING" };
}
