<script lang="ts">
  import { SseClient, fetchStatus, startSession, stopSession, restartSession, goSession } from "../lib/api";
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

  function activityDot(activity: SessionState["activity"]): { cls: string; label: string } {
    switch (activity) {
      case "active": return { cls: "dot-green", label: "active" };
      case "idle": return { cls: "dot-yellow", label: "idle" };
      case "stopped": return { cls: "dot-dim", label: "stopped" };
      default: return { cls: "dot-dim", label: "-" };
    }
  }

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

  async function handleAction(action: string, name: string) {
    switch (action) {
      case "start": await startSession(name); break;
      case "stop": await stopSession(name); break;
      case "restart": await restartSession(name); break;
      case "go": await goSession(name); break;
    }
    // Refresh immediately
    status = await fetchStatus();
  }
</script>

{#if error}
  <div class="card border-[var(--accent-red)]">
    <p class="text-[var(--accent-red)] text-sm">Failed to connect: {error}</p>
  </div>
{/if}

{#if status}
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-[var(--text-muted)] text-xs">
          <th class="pb-2 pr-4">Session</th>
          <th class="pb-2 pr-4">Status</th>
          <th class="pb-2 pr-4 hidden sm:table-cell">Activity</th>
          <th class="pb-2 pr-4 hidden sm:table-cell">RSS</th>
          <th class="pb-2 pr-4 hidden md:table-cell">Uptime</th>
          <th class="pb-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each status.sessions as session (session.name)}
          {@const sBadge = statusBadge(session.status)}
          {@const aDot = activityDot(session.activity)}
          <tr
            class="border-t border-[var(--border)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
            onclick={() => toggleExpand(session.name)}
          >
            <td class="py-2 pr-4 font-medium">{session.name}</td>
            <td class="py-2 pr-4">
              <span class="badge {sBadge.cls}">{sBadge.label}</span>
            </td>
            <td class="py-2 pr-4 hidden sm:table-cell">
              <span class="flex items-center gap-1.5">
                <span class="dot {aDot.cls}"></span>
                <span class="text-xs text-[var(--text-secondary)]">{aDot.label}</span>
              </span>
            </td>
            <td class="py-2 pr-4 hidden sm:table-cell text-[var(--text-secondary)]">
              {session.rss_mb != null ? `${session.rss_mb}MB` : "-"}
            </td>
            <td class="py-2 pr-4 hidden md:table-cell text-[var(--text-muted)]">
              {session.uptime ?? "-"}
            </td>
            <td class="py-2">
              <div class="flex gap-1" onclick={(e) => e.stopPropagation()}>
                {#if session.status === "running" || session.status === "degraded"}
                  <button class="btn btn-danger" onclick={() => handleAction("stop", session.name)}>Stop</button>
                  <button class="btn" onclick={() => handleAction("restart", session.name)}>Restart</button>
                  <button class="btn btn-primary" onclick={() => handleAction("go", session.name)}>Go</button>
                {:else if session.status === "stopped" || session.status === "failed" || session.status === "pending"}
                  <button class="btn btn-primary" onclick={() => handleAction("start", session.name)}>Start</button>
                {/if}
              </div>
            </td>
          </tr>
          {#if expandedSession === session.name}
            <tr>
              <td colspan="6" class="p-0">
                <SessionCard {session} />
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{:else if !error}
  <p class="text-[var(--text-muted)] text-sm">Loading...</p>
{/if}
