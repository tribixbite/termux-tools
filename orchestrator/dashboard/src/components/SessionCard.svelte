<script lang="ts">
  import type { SessionState } from "../lib/types";

  interface Props {
    session: SessionState;
  }

  let { session }: Props = $props();

  function formatDate(iso: string | null): string {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleTimeString();
  }
</script>

<div class="card m-2 ml-6 text-sm">
  <div class="grid grid-cols-2 gap-x-4 gap-y-1">
    <div class="text-[var(--text-muted)]">PID</div>
    <div>{session.tmux_pid ?? "-"}</div>

    <div class="text-[var(--text-muted)]">Restarts</div>
    <div class:text-[var(--accent-yellow)]={session.restart_count > 0}>
      {session.restart_count}
    </div>

    <div class="text-[var(--text-muted)]">Health</div>
    <div>
      {#if session.last_health_check}
        {#if session.consecutive_failures > 0}
          <span class="text-[var(--accent-red)]">{session.consecutive_failures} failures</span>
        {:else}
          <span class="text-[var(--accent-green)]">ok</span>
        {/if}
        <span class="text-[var(--text-muted)] text-xs ml-1">({formatDate(session.last_health_check)})</span>
      {:else}
        <span class="text-[var(--text-muted)]">never checked</span>
      {/if}
    </div>

    <div class="text-[var(--text-muted)]">Activity</div>
    <div>{session.activity ?? "-"}</div>

    <div class="text-[var(--text-muted)]">RSS</div>
    <div>{session.rss_mb != null ? `${session.rss_mb} MB` : "-"}</div>

    {#if session.last_error}
      <div class="text-[var(--text-muted)]">Error</div>
      <div class="text-[var(--accent-red)] break-all">{session.last_error}</div>
    {/if}

    <div class="text-[var(--text-muted)]">Started</div>
    <div>{formatDate(session.uptime_start)}</div>
  </div>
</div>
