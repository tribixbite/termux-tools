<script lang="ts">
  import { SseClient, fetchStatus, startSession, stopSession, restartSession, goSession, openTab } from "../lib/api";
  import type { DaemonStatus, SessionState } from "../lib/types";
  import SessionCard from "./SessionCard.svelte";

  let status: DaemonStatus | null = $state(null);
  let expandedSession: string | null = $state(null);
  let error: string | null = $state(null);

  // Initial fetch (browser only — SSR has no API)
  if (typeof window !== "undefined") {
    fetchStatus().then((d) => (status = d)).catch((e) => (error = e.message));
  }

  // SSE for real-time updates (browser only)
  const sse = typeof window !== "undefined" ? new SseClient() : null;
  sse?.on<DaemonStatus>("state", (data) => {
    status = data;
    error = null;
  });

  function statusBadge(st: string): { cls: string; label: string } {
    switch (st) {
      case "running": return { cls: "badge-green", label: "running" };
      case "degraded": return { cls: "badge-yellow", label: "degraded" };
      case "starting": case "waiting": return { cls: "badge-blue", label: st };
      case "failed": return { cls: "badge-red", label: "failed" };
      case "stopping": return { cls: "badge-yellow", label: "stopping" };
      default: return { cls: "badge-dim", label: st };
    }
  }

  function toggleExpand(name: string) {
    expandedSession = expandedSession === name ? null : name;
  }

  async function handleAction(e: Event, action: string, name: string) {
    e.stopPropagation();
    switch (action) {
      case "start": await startSession(name); break;
      case "stop": await stopSession(name); break;
      case "restart": await restartSession(name); break;
      case "go": await goSession(name); break;
    }
    status = await fetchStatus();
  }

  async function handleOpenTab(e: Event, name: string) {
    e.stopPropagation();
    await openTab(name);
  }
</script>

{#if error}
  <div class="card border-[var(--accent-red)]">
    <p class="text-[var(--accent-red)] text-sm">Failed to connect: {error}</p>
  </div>
{/if}

{#if status}
  <div class="space-y-1">
    {#each status.sessions as session (session.name)}
      {@const sBadge = statusBadge(session.status)}
      <div
        class="session-row"
        onclick={() => toggleExpand(session.name)}
      >
        <!-- Top line: name + status badge + RSS -->
        <div class="flex items-center gap-2 min-w-0">
          <button
            class="session-name"
            onclick={(e) => handleOpenTab(e, session.name)}
            title="Open in Termux tab"
          >{session.name}</button>
          <span class="badge {sBadge.cls}">{sBadge.label}</span>
          {#if session.rss_mb != null}
            <span class="text-xs text-[var(--text-muted)] ml-auto flex-shrink-0">{session.rss_mb}MB</span>
          {/if}
        </div>

        <!-- Actions row -->
        <div class="action-row" onclick={(e) => e.stopPropagation()}>
          {#if session.status === "running" || session.status === "degraded"}
            <button class="btn btn-sm btn-danger" onclick={(e) => handleAction(e, "stop", session.name)}>Stop</button>
            <button class="btn btn-sm" onclick={(e) => handleAction(e, "restart", session.name)}>Restart</button>
            <button class="btn btn-sm btn-primary" onclick={(e) => handleAction(e, "go", session.name)}>Go</button>
          {:else if session.status === "stopped" || session.status === "failed" || session.status === "pending"}
            <button class="btn btn-sm btn-primary" onclick={(e) => handleAction(e, "start", session.name)}>Start</button>
          {/if}
        </div>
      </div>

      {#if expandedSession === session.name}
        <div class="px-2">
          <SessionCard {session} />
        </div>
      {/if}
    {/each}
  </div>
{:else if !error}
  <p class="text-[var(--text-muted)] text-sm">Loading...</p>
{/if}

<style>
  .session-row {
    padding: 0.5rem 0.625rem;
    border-top: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s;
  }
  .session-row:first-child { border-top: none; }
  .session-row:hover { background: var(--bg-tertiary); }
  .session-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--accent-blue);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .session-name:hover { text-decoration: underline; }
  .session-name:active { color: var(--accent-purple); }
  .action-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.375rem;
  }
</style>
