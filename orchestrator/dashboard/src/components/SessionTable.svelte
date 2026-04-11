<script lang="ts">
  import {
    startSession, stopSession, restartSession, goSession,
    openTab, closeSession, suspendSession, resumeSession,
  } from "../lib/api";
  import { store, refreshStatus } from "../lib/store.svelte";
  import type { DaemonStatus, SessionState } from "../lib/types";
  import SessionCard from "./SessionCard.svelte";
  import ScriptRunner from "./ScriptRunner.svelte";
  import SessionTimeline from "./SessionTimeline.svelte";
  import ConversationDrawer from "./ConversationDrawer.svelte";
  import GitPanel from "./GitPanel.svelte";
  import FileExplorer from "./FileExplorer.svelte";

  let expandedSession: string | null = $state(null);
  let actionError: string | null = $state(null);
  /** Session name for the conversation drawer (null = closed) */
  let drawerSession: string | null = $state(null);

  /** Derived from shared store — no own SSE/fetch needed */
  const status = $derived<DaemonStatus | null>(store.daemon);
  const error = $derived<string | null>(store.error);
  /** Non-service sessions only — services go to ServiceStatus card */
  const allSessions = $derived(status?.sessions.filter((s) => s.type !== "service") ?? []);

  /** Active = running/degraded/starting/waiting/stopping */
  const ACTIVE_STATUSES = new Set(["running", "degraded", "starting", "waiting", "stopping"]);

  /** Sorted: active sessions first (by name), then inactive (by name) */
  const activeSessions = $derived(
    allSessions.filter((s) => ACTIVE_STATUSES.has(s.status)).sort((a, b) => a.name.localeCompare(b.name))
  );
  const inactiveSessions = $derived(
    allSessions.filter((s) => !ACTIVE_STATUSES.has(s.status)).sort((a, b) => a.name.localeCompare(b.name))
  );

  /** Whether the inactive group is expanded */
  let showInactive: boolean = $state(false);

  /** Status dot color class */
  function dotCls(st: string, suspended: boolean): string {
    if (suspended) return "dot-cyan";
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

  async function handleSuspend(e: Event, name: string) {
    e.stopPropagation();
    actionError = null;
    try {
      await suspendSession(name);
      await refreshStatus();
    } catch (err) {
      actionError = `Suspend failed for ${name}: ${(err as Error).message}`;
    }
  }

  async function handleResume(e: Event, name: string) {
    e.stopPropagation();
    actionError = null;
    try {
      await resumeSession(name);
      await refreshStatus();
    } catch (err) {
      actionError = `Resume failed for ${name}: ${(err as Error).message}`;
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

  function openDrawer(e: Event, name: string) {
    e.stopPropagation();
    drawerSession = name;
  }
</script>

{#snippet sessionRow(session: SessionState)}
  <tr class="session-row" onclick={() => toggleExpand(session.name)}>
    <td class="td-name">
      <span class="dot {dotCls(session.status, session.suspended)}"></span>
      <button
        class="session-name"
        onclick={(e) => handleOpenTab(e, session.name)}
        title="Open in Termux tab"
      >{session.name}</button>
      {#if session.claude_status === "waiting"}
        <span class="claude-badge waiting" title="Waiting for input">idle</span>
      {:else if session.claude_status === "working"}
        <span class="claude-badge working" title="Actively working">busy</span>
      {/if}
    </td>
    <td class="td-rss">
      {#if session.rss_mb != null}
        {session.rss_mb}<span class="unit">MB</span>
      {/if}
    </td>
    <td class="td-actions" onclick={(e) => e.stopPropagation()}>
      {#if session.type === "claude"}
        <button class="btn-icon chat" onclick={(e) => openDrawer(e, session.name)} title="Conversation">&#x2709;</button>
      {/if}
      {#if session.status === "running" || session.status === "degraded"}
        <button class="btn-icon danger" onclick={(e) => handleAction(e, "stop", session.name)} title="Stop">&#x25A0;</button>
        <button class="btn-icon" onclick={(e) => handleAction(e, "restart", session.name)} title="Restart">&#x21BB;</button>
        {#if session.suspended}
          <button class="btn-icon success" onclick={(e) => handleResume(e, session.name)} title="Resume">&#x25B6;</button>
        {:else}
          <button class="btn-icon success" onclick={(e) => handleAction(e, "go", session.name)} title="Go">&#x25B6;</button>
          <button class="btn-icon muted" onclick={(e) => handleSuspend(e, session.name)} title="Pause">&#x23F8;</button>
        {/if}
      {:else if session.status === "starting" || session.status === "waiting" || session.status === "stopping"}
        <button class="btn-icon danger" onclick={(e) => handleAction(e, "stop", session.name)} title="Stop">&#x25A0;</button>
      {:else if session.status === "stopped" || session.status === "failed" || session.status === "pending"}
        <button class="btn-icon primary" onclick={(e) => handleAction(e, "start", session.name)} title="Start">&#x25B6;</button>
        <button class="btn-icon danger" onclick={(e) => handleClose(e, session.name)} title="Remove">&#x2715;</button>
      {/if}
    </td>
  </tr>
  {#if expandedSession === session.name}
    <tr><td colspan="3" class="td-expand">
      {#if session.last_output}
        <pre class="pane-output">{session.last_output}</pre>
      {/if}
      {#if session.path}
        <ScriptRunner sessionName={session.name} sessionPath={session.path} />
      {/if}
      <SessionCard {session} />
      {#if session.type === "claude"}
        <SessionTimeline sessionName={session.name} />
      {/if}
      {#if session.path}
        <GitPanel sessionName={session.name} />
        <FileExplorer sessionName={session.name} />
      {/if}
    </td></tr>
  {/if}
{/snippet}

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
      {#each activeSessions as session (session.name)}
        {@render sessionRow(session)}
      {/each}

      <!-- Collapsed inactive group -->
      {#if inactiveSessions.length > 0}
        <tr class="inactive-divider" onclick={() => (showInactive = !showInactive)}>
          <td colspan="3">
            <span class="inactive-toggle">{showInactive ? "\u25BC" : "\u25B6"}</span>
            <span class="inactive-label">Inactive</span>
            <span class="inactive-count">{inactiveSessions.length}</span>
          </td>
        </tr>
        {#if showInactive}
          {#each inactiveSessions as session (session.name)}
            {@render sessionRow(session)}
          {/each}
        {/if}
      {/if}
    </tbody>
  </table>
{:else if !error}
  <p class="text-[var(--text-muted)] text-sm">Loading...</p>
{/if}

{#if drawerSession}
  <ConversationDrawer
    sessionName={drawerSession}
    onclose={() => drawerSession = null}
  />
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
  .th-actions { text-align: right; width: 8.5rem; }
  .session-row {
    cursor: pointer;
    transition: background 0.15s;
  }
  .session-row:hover { background: var(--bg-tertiary); }

  .inactive-divider {
    cursor: pointer;
    transition: background 0.15s;
  }
  .inactive-divider:hover { background: var(--bg-tertiary); }
  .inactive-divider td {
    padding: 0.375rem 0.375rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .inactive-toggle {
    display: inline-block;
    width: 1rem;
    text-align: center;
    font-size: 0.6rem;
  }
  .inactive-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
  }
  .inactive-count {
    margin-left: 0.25rem;
    background: var(--bg-tertiary);
    border-radius: 9999px;
    padding: 0.0625rem 0.375rem;
    font-size: 0.625rem;
  }
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
    /* Prevent width jitter when RSS numbers change (e.g. 96 -> 267 -> 1249) */
    font-variant-numeric: tabular-nums;
    min-width: 4.5rem;
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
  /* Claude status badge */
  .claude-badge {
    font-size: 0.5625rem;
    font-weight: 600;
    padding: 0.0625rem 0.3125rem;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }
  .claude-badge.waiting {
    color: var(--accent-yellow);
    background: rgba(245, 158, 11, 0.15);
  }
  .claude-badge.working {
    color: var(--accent-green);
    background: rgba(34, 197, 94, 0.15);
  }
  /* Pane output preview */
  .pane-output {
    font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
    font-size: 0.625rem;
    line-height: 1.4;
    color: var(--text-muted);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.375rem 0.5rem;
    margin: 0 0 0.5rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 4.5rem;
    overflow: hidden;
  }
  /* Chat button */
  .td-actions :global(.btn-icon.chat) { color: var(--accent-blue); opacity: 0.6; }
  .td-actions :global(.btn-icon.chat:hover) { opacity: 1; background: rgba(88, 166, 255, 0.1); }
  /* Muted button for pause */
  .td-actions :global(.btn-icon.muted) { color: var(--text-muted); }
  .td-actions :global(.btn-icon.muted:hover) { background: rgba(255, 255, 255, 0.08); }

  /* Mobile compact */
  @media (max-width: 768px) {
    .session-table { font-size: 0.6875rem; }
    thead th { font-size: 0.5625rem; padding: 0 0.25rem 0.375rem; }
    .th-actions { width: 6rem; }
    .session-row td { padding: 0.375rem 0.25rem; }
    .session-name { font-size: 0.6875rem; }
    .td-rss { font-size: 0.625rem; }
    .td-name { gap: 0.375rem; }
    .claude-badge { font-size: 0.5rem; padding: 0.0625rem 0.25rem; }
    .pane-output { font-size: 0.5625rem; max-height: 3.5rem; padding: 0.25rem 0.375rem; }
  }
</style>
