<script lang="ts">
  import { startSession, stopSession, restartSession, goSession, openTab, closeSession } from "../lib/api";
  import { store, refreshStatus } from "../lib/store.svelte";
  import type { DaemonStatus, SessionState } from "../lib/types";
  import SessionCard from "./SessionCard.svelte";

  let expandedSession: string | null = $state(null);
  let actionError: string | null = $state(null);

  /** Derived from shared store — no own SSE/fetch needed */
  const status = $derived<DaemonStatus | null>(store.daemon);
  const error = $derived<string | null>(store.error);

  /** Status dot color class */
  function dotCls(st: string): string {
    switch (st) {
      case "running": return "dot-green";
      case "degraded": return "dot-yellow";
      case "starting": case "waiting": return "dot-blue";
      case "failed": return "dot-red";
      default: return "dot-dim";
    }
  }

  function toggleExpand(name: string) {
    expandedSession = expandedSession === name ? null : name;
  }

  async function handleAction(e: Event, action: string, name: string) {
    e.stopPropagation();
    actionError = null;
    try {
      switch (action) {
        case "start": await startSession(name); break;
        case "stop": await stopSession(name); break;
        case "restart": await restartSession(name); break;
        case "go": await goSession(name); break;
      }
      await refreshStatus();
    } catch (err) {
      actionError = `${action} failed for ${name}: ${(err as Error).message}`;
    }
  }

  async function handleOpenTab(e: Event, name: string) {
    e.stopPropagation();
    try {
      await openTab(name);
    } catch (err) {
      actionError = `Open tab failed for ${name}: ${(err as Error).message}`;
    }
  }

  async function handleClose(e: Event, name: string) {
    e.stopPropagation();
    actionError = null;
    try {
      await closeSession(name);
      await refreshStatus();
    } catch (err) {
      actionError = `Close failed for ${name}: ${(err as Error).message}`;
    }
  }
</script>

{#if error}
  <div class="card border-[var(--accent-red)]">
    <p class="text-[var(--accent-red)] text-sm">Failed to connect: {error}</p>
  </div>
{/if}

{#if actionError}
  <div class="card mb-2" style="border: 1px solid var(--accent-red); padding: 0.5rem 0.75rem">
    <p class="text-xs" style="color: var(--accent-red)">{actionError}</p>
  </div>
{/if}

{#if status}
  <table class="session-table">
    <thead>
      <tr>
        <th class="th-name">Session</th>
        <th class="th-rss">RSS</th>
        <th class="th-actions"></th>
      </tr>
    </thead>
    <tbody>
      {#each status.sessions as session (session.name)}
        <tr class="session-row" onclick={() => toggleExpand(session.name)}>
          <td class="td-name">
            <span class="dot {dotCls(session.status)}"></span>
            <button
              class="session-name"
              onclick={(e) => handleOpenTab(e, session.name)}
              title="Open in Termux tab"
            >{session.name}</button>
          </td>
          <td class="td-rss">
            {#if session.rss_mb != null}
              {session.rss_mb}<span class="unit">MB</span>
            {/if}
          </td>
          <td class="td-actions" onclick={(e) => e.stopPropagation()}>
            {#if session.status === "running" || session.status === "degraded"}
              <button class="btn-icon danger" onclick={(e) => handleAction(e, "stop", session.name)} title="Stop">&#x25A0;</button>
              <button class="btn-icon" onclick={(e) => handleAction(e, "restart", session.name)} title="Restart">&#x21BB;</button>
              <button class="btn-icon success" onclick={(e) => handleAction(e, "go", session.name)} title="Go">&#x25B6;</button>
            {:else if session.status === "stopped" || session.status === "failed" || session.status === "pending"}
              <button class="btn-icon primary" onclick={(e) => handleAction(e, "start", session.name)} title="Start">&#x25B6;</button>
              <button class="btn-icon danger" onclick={(e) => handleClose(e, session.name)} title="Remove">&#x2715;</button>
            {/if}
          </td>
        </tr>
        {#if expandedSession === session.name}
          <tr><td colspan="3" class="td-expand"><SessionCard {session} /></td></tr>
        {/if}
      {/each}
    </tbody>
  </table>
{:else if !error}
  <p class="text-[var(--text-muted)] text-sm">Loading...</p>
{/if}

<style>
  .session-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  thead th {
    text-align: left;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 0.375rem 0.5rem;
  }
  .th-rss { text-align: right; }
  .th-actions { text-align: right; width: 6.5rem; }
  .session-row {
    cursor: pointer;
    transition: background 0.15s;
  }
  .session-row:hover { background: var(--bg-tertiary); }
  .session-row td {
    padding: 0.5rem 0.375rem;
    border-top: 1px solid var(--border);
    vertical-align: middle;
  }
  .td-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .td-rss {
    text-align: right;
    color: var(--text-secondary);
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .unit { color: var(--text-muted); margin-left: 1px; }
  .td-actions {
    text-align: right;
    white-space: nowrap;
  }
  .td-actions :global(.btn-icon) {
    margin-left: 0.25rem;
  }
  .td-expand {
    padding: 0.25rem 0.375rem 0.75rem;
    border-top: none;
  }
  .session-name {
    font-weight: 600;
    font-size: 0.8125rem;
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
</style>
