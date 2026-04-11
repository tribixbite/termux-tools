/**
 * Shared reactive store — single SSE connection + initial fetch
 * for all dashboard components. Prevents connection exhaustion
 * (browser limit: 6 per origin).
 */

import { SseClient, fetchStatus } from "./api";
import type { DaemonStatus, ConversationDelta, NotificationRecord, TelemetryRecord } from "./types";

/** Reactive store object — mutate properties, don't reassign */
export const store = $state<{
  daemon: DaemonStatus | null;
  error: string | null;
  /** Live conversation deltas pushed by daemon, keyed by session name */
  conversationDeltas: Record<string, ConversationDelta> | null;
  /** Latest notification pushed via SSE */
  lastNotification: NotificationRecord | null;
  /** Latest telemetry record pushed via SSE */
  lastTelemetry: TelemetryRecord | null;
}>({
  daemon: null,
  error: null,
  conversationDeltas: null,
  lastNotification: null,
  lastTelemetry: null,
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

  sse.on<ConversationDelta>("conversation", (data) => {
    if (!store.conversationDeltas) store.conversationDeltas = {};
    store.conversationDeltas[data.session] = data;
  });

  sse.on<NotificationRecord>("notification", (data) => {
    store.lastNotification = data;
  });

  sse.on<TelemetryRecord>("telemetry", (data) => {
    store.lastTelemetry = data;
  });
}
