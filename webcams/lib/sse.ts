import { subscribe, type BusEvent } from "./event-bus";

/**
 * Server-Sent-Events-Strom über den Ereignis-Bus.
 *
 * Gemeinsame Grundlage für alle Push-Routen: Jedes Ereignis geht mit seinem
 * Typ als SSE-Event raus, der Client hört sich das heraus, was ihn angeht.
 */
export function busEventStream(): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: BusEvent) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            ),
          );
        } catch {
          /* closed */
        }
      };

      controller.enqueue(encoder.encode(`: connected ${Date.now()}\n\n`));
      unsubscribe = subscribe(send);

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 25_000);
    },
    cancel() {
      unsubscribe?.();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
