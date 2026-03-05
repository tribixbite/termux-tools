/**
 * Shared reactive store — single SSE connection + initial fetch
 * for all dashboard components. Prevents connection exhaustion
 * (browser limit: 6 per origin).
 */

import { SseClient, fetchStatus } from "./api";
import type { DaemonStatus } from "./types";

/** Reactive store object — mutate properties, don't reassign */
export const store = $state<{
  daemon: DaemonStatus | null;
  error: string | null;
}>({
  daemon: null,
  error: null,
});

/** Re-fetch status on demand (e.g. after session actions) */
export async function refreshStatus(): Promise<void> {
  try {
    store.daemon = await fetchStatus();
    store.error = null;
  } catch (e: any) {
    store.error = e.message;
  }
}

if (typeof window !== "undefined") {
  refreshStatus();

  const sse = new SseClient();
  sse.on<DaemonStatus>("state", (data) => {
    store.daemon = data;
    store.error = null;
  });
}
