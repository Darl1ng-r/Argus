import { Response } from 'express';

interface ActiveSseClient {
  id: string;
  res: Response;
  topicId?: string;
  userId?: string;
  createdAt: number;
}

const activeClients = new Map<string, ActiveSseClient>();

/**
 * Registers an active Server-Sent Events client socket for tracking and lifecycle management.
 */
export function registerSseClient(
  id: string,
  res: Response,
  meta?: { topicId?: string; userId?: string }
): void {
  activeClients.set(id, {
    id,
    res,
    topicId: meta?.topicId,
    userId: meta?.userId,
    createdAt: Date.now(),
  });
}

/**
 * Unregisters an active SSE client socket upon normal closure.
 */
export function unregisterSseClient(id: string): void {
  activeClients.delete(id);
}

/**
 * Returns total count of active SSE streams.
 */
export function getActiveSseCount(): number {
  return activeClients.size;
}

/**
 * Gracefully drains all active SSE connections during SIGTERM/SIGINT teardown.
 * Sends a 'reconnect' event containing randomized jitter to prevent the "Thundering Herd"
 * stampede when clients reconnect across newly spawned pods.
 */
export async function drainAllSseClients(
  jitterMinMs = 1000,
  jitterMaxMs = 5000
): Promise<number> {
  const count = activeClients.size;
  if (count === 0) return 0;

  const drainPromises: Promise<void>[] = [];

  for (const [id, client] of activeClients.entries()) {
    drainPromises.push(
      new Promise<void>((resolve) => {
        try {
          if (!client.res.writableEnded) {
            const reconnectJitterMs =
              Math.floor(Math.random() * (jitterMaxMs - jitterMinMs + 1)) + jitterMinMs;

            client.res.write(
              `event: reconnect\ndata: ${JSON.stringify({
                status: 'draining',
                reason: 'server_instance_terminating',
                reconnectDelayMs: reconnectJitterMs,
              })}\n\n`
            );
            client.res.end(() => resolve());
          } else {
            resolve();
          }
        } catch {
          resolve();
        }
      })
    );
  }

  await Promise.allSettled(drainPromises);
  activeClients.clear();
  return count;
}
