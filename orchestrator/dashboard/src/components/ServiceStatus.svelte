<script lang="ts">
  import { store, refreshStatus } from "../lib/store.svelte";
  import { startSession, stopSession, restartSession } from "../lib/api";
  import type { SessionState } from "../lib/types";

  let expanded = $state(false);
  let actionError: string | null = $state(null);

  /** Filter service-type sessions from shared store */
  const services = $derived<SessionState[]>(
    (store.daemon?.sessions ?? []).filter((s) => s.type === "service"),
  );

  /** Status dot color class */
  function dotCls(status: string): string {
    switch (status) {
      case "running": return "dot-green";
      case "degraded": return "dot-yellow";
      case "starting": case "waiting": return "dot-blue";
      case "failed": return "dot-red";
      default: return "dot-dim";
    }
  }

  /** Short display name: strip common prefixes for compact badges */
  function shortName(name: string): string {
    return name.replace(/^termux-/, "");
  }

  /** Handle service action (start/stop/restart) */
  async function handleAction(e: Event, action: string, name: string) {
    e.stopPropagation();
    actionError = null;
    try {
      switch (action) {
        case "start": await startSession(name); break;
        case "stop": await stopSession(name); break;
        case "restart": await restartSession(name); break;
      }
      await refreshStatus();
    } catch (err) {
      actionError = `${action} failed for ${name}: ${(err as Error).message}`;
    }
  }
</script>

{#if services.length > 0}
  <div class="card compact-card" class:expanded>
    <button class="card-header" onclick={() => expanded = !expanded}>
      <span class="header-left">
        <span class="chevron">{expanded ? "▾" : "▸"}</span>
        <span class="label">Services</span>
      </span>
      {#if !expanded}
        <span class="badge-row">
          {#each services as svc}
            <span class="svc-badge" class:svc-degraded={svc.status === "degraded"} class:svc-failed={svc.status === "failed"}>
              <span class="dot {dotCls(svc.status)}"></span>
              <span class="svc-name">{shortName(svc.name)}</span>
              {#if svc.status === "degraded"}
                <span class="svc-status-tag">degraded</span>
              {:else if svc.status === "failed"}
                <span class="svc-status-tag failed">failed</span>
              {:else if svc.rss_mb != null}
                <span class="svc-rss">{svc.rss_mb}MB</span>
              {/if}
            </span>
          {/each}
        </span>
      {/if}
    </button>

    {#if expanded}
      <div class="card-body">
        {#if actionError}
          <div class="svc-error">{actionError}</div>
        {/if}
        {#each services as svc}
          <div class="svc-detail">
            <span class="dot {dotCls(svc.status)}"></span>
            <span class="detail-name">{svc.name}</span>
            <span class="detail-status">{svc.status}</span>
            {#if svc.rss_mb != null}
              <span class="detail-rss">{svc.rss_mb}<span class="unit">MB</span></span>
            {/if}
            {#if svc.uptime}
              <span class="detail-uptime">{svc.uptime}</span>
            {/if}
            {#if svc.restart_count > 0}
              <span class="detail-restarts">{svc.restart_count}x</span>
            {/if}
            <span class="detail-actions">
              {#if svc.status === "running" || svc.status === "degraded"}
                <button class="btn-icon danger" onclick={(e) => handleAction(e, "stop", svc.name)} title="Stop">&#x25A0;</button>
                <button class="btn-icon" onclick={(e) => handleAction(e, "restart", svc.name)} title="Restart">&#x21BB;</button>
              {:else if svc.status === "starting" || svc.status === "waiting" || svc.status === "stopping"}
                <button class="btn-icon danger" onclick={(e) => handleAction(e, "stop", svc.name)} title="Stop">&#x25A0;</button>
              {:else if svc.status === "stopped" || svc.status === "failed" || svc.status === "pending"}
                <button class="btn-icon primary" onclick={(e) => handleAction(e, "start", svc.name)} title="Start">&#x25B6;</button>
              {/if}
            </span>
          </div>
          {#if svc.status === "degraded" && svc.last_error}
            <div class="svc-last-error">{svc.last_error}</div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .compact-card { padding: 0; overflow: hidden; }
  .compact-card.expanded { padding: 0; }
  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: none;
    border: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .card-header:hover { background: var(--bg-tertiary); }
  .header-left {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  .chevron { font-size: 0.625rem; color: var(--text-muted); width: 0.75rem; }
  .label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge-row {
    display: flex;
    gap: 0.625rem;
    flex: 1;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .svc-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
  }
  .svc-name {
    color: var(--text-secondary);
    font-weight: 500;
  }
  .svc-rss {
    color: var(--text-muted);
    font-size: 0.625rem;
  }
  .card-body { padding: 0 0.75rem 0.75rem; }
  .svc-detail {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.6875rem;
  }
  .svc-detail + .svc-detail { border-top: 1px solid var(--border); }
  .detail-name { font-weight: 600; color: var(--text-primary); flex: 1; }
  .detail-status { color: var(--text-muted); }
  .detail-rss { color: var(--text-secondary); white-space: nowrap; }
  .unit { color: var(--text-muted); margin-left: 1px; }
  .detail-uptime { color: var(--text-muted); }
  .detail-restarts { color: var(--accent-yellow); font-size: 0.625rem; }
  .detail-actions {
    display: flex;
    gap: 0.125rem;
    flex-shrink: 0;
    margin-left: auto;
  }
  .svc-error {
    font-size: 0.625rem;
    color: var(--accent-red);
    padding: 0.25rem 0;
    margin-bottom: 0.25rem;
  }
  .svc-last-error {
    font-size: 0.5625rem;
    color: var(--accent-yellow);
    padding: 0 0 0.25rem 1.25rem;
    opacity: 0.8;
  }
  /* Degraded/failed highlight in collapsed view */
  .svc-degraded { opacity: 1; }
  .svc-failed { opacity: 0.6; }
  .svc-status-tag {
    font-size: 0.5rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--accent-yellow);
    letter-spacing: 0.03em;
  }
  .svc-status-tag.failed { color: var(--accent-red); }
</style>
