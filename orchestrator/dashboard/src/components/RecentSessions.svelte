<script lang="ts">
  import { fetchRecent, openSession, registerProjects, cloneRepo, createProject } from "../lib/api";
  import { refreshStatus } from "../lib/store.svelte";
  import type { RecentProject } from "../lib/types";

  let expanded = $state(false);
  let projects = $state<RecentProject[]>([]);
  let search = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let actionMsg = $state<string | null>(null);

  /** Which inline form is active */
  let activeForm = $state<"clone" | "create" | null>(null);
  let formValue = $state("");
  let formBusy = $state(false);

  /** Relative time string (e.g. "2h ago", "3d ago") */
  function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /** Truncate path for display */
  function shortPath(path: string): string {
    const home = "/data/data/com.termux/files/home/";
    if (path.startsWith(home)) return "~/" + path.slice(home.length);
    return path;
  }

  /** Status badge color */
  function statusCls(st: RecentProject["status"]): string {
    switch (st) {
      case "running": return "badge-green";
      case "registered": return "badge-blue";
      case "config": return "badge-purple";
      default: return "badge-dim";
    }
  }

  /** Filter projects by search term */
  const filtered = $derived(
    projects.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
    })
  );

  async function loadRecent() {
    loading = true;
    error = null;
    try {
      projects = await fetchRecent();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleOpen(e: Event, project: RecentProject) {
    e.stopPropagation();
    actionMsg = null;
    try {
      await openSession(project.path);
      actionMsg = `Starting ${project.name}...`;
      await refreshStatus();
      await loadRecent();
    } catch (err) {
      actionMsg = `Failed: ${(err as Error).message}`;
    }
  }

  async function handleScan() {
    actionMsg = null;
    formBusy = true;
    try {
      const result = await registerProjects();
      actionMsg = `Registered ${result.registered.length} projects (${result.skipped} skipped)`;
      await loadRecent();
    } catch (err) {
      actionMsg = `Scan failed: ${(err as Error).message}`;
    } finally {
      formBusy = false;
    }
  }

  async function handleFormSubmit() {
    if (!formValue.trim()) return;
    formBusy = true;
    actionMsg = null;
    try {
      if (activeForm === "clone") {
        const result = await cloneRepo(formValue.trim());
        actionMsg = `Cloned → ${result.name}`;
      } else if (activeForm === "create") {
        const result = await createProject(formValue.trim());
        actionMsg = `Created → ${result.name}`;
      }
      formValue = "";
      activeForm = null;
      await loadRecent();
    } catch (err) {
      actionMsg = `Failed: ${(err as Error).message}`;
    } finally {
      formBusy = false;
    }
  }

  function toggleForm(type: "clone" | "create") {
    if (activeForm === type) {
      activeForm = null;
      formValue = "";
    } else {
      activeForm = type;
      formValue = "";
    }
  }

  function toggle() {
    expanded = !expanded;
    if (expanded && projects.length === 0) {
      loadRecent();
    }
  }
</script>

<div class="card mb-4">
  <button class="panel-header" onclick={toggle}>
    <h2 class="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
      Recent Projects
    </h2>
    <span class="chevron" class:open={expanded}>&#x25B8;</span>
  </button>

  {#if expanded}
    <div class="panel-body">
      <!-- Action bar: Scan / Clone / New -->
      <div class="action-bar">
        <button class="btn btn-sm" onclick={handleScan} disabled={formBusy} title="Scan ~/git and register all projects">
          Scan
        </button>
        <button class="btn btn-sm" class:active={activeForm === "clone"} onclick={() => toggleForm("clone")} title="Clone a git repo">
          Clone
        </button>
        <button class="btn btn-sm" class:active={activeForm === "create"} onclick={() => toggleForm("create")} title="Create new project">
          New
        </button>
      </div>

      <!-- Inline form for clone/create -->
      {#if activeForm}
        <form class="inline-form" onsubmit={(e) => { e.preventDefault(); handleFormSubmit(); }}>
          <input
            type="text"
            class="search-input"
            placeholder={activeForm === "clone" ? "https://github.com/user/repo" : "project-name"}
            bind:value={formValue}
            disabled={formBusy}
          />
          <button class="btn btn-sm btn-primary" type="submit" disabled={formBusy || !formValue.trim()}>
            {activeForm === "clone" ? "Clone" : "Create"}
          </button>
        </form>
      {/if}

      {#if actionMsg}
        <div class="action-msg">{actionMsg}</div>
      {/if}

      <input
        type="text"
        class="search-input"
        placeholder="Filter by name or path..."
        bind:value={search}
      />

      {#if loading}
        <p class="text-xs text-[var(--text-muted)] mt-2">Loading...</p>
      {:else if error}
        <p class="text-xs text-[var(--accent-red)] mt-2">{error}</p>
      {:else if filtered.length === 0}
        <p class="text-xs text-[var(--text-muted)] mt-2">No recent projects found</p>
      {:else}
        <div class="recent-list">
          {#each filtered as project (project.path + project.session_id)}
            <div class="recent-item">
              <div class="recent-info">
                <span class="recent-name">{project.name}</span>
                <span class="badge {statusCls(project.status)}">{project.status}</span>
                <span class="recent-time">{timeAgo(project.last_active)}</span>
              </div>
              <div class="recent-path">{shortPath(project.path)}</div>
              <div class="recent-actions">
                {#if project.status !== "running"}
                  <button
                    class="btn-icon primary"
                    onclick={(e) => handleOpen(e, project)}
                    title="Open session"
                  >&#x25B6;</button>
                {:else}
                  <span class="dot dot-green"></span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
  }
  .chevron {
    font-size: 0.75rem;
    color: var(--text-muted);
    transition: transform 0.15s;
  }
  .chevron.open { transform: rotate(90deg); }
  .panel-body { margin-top: 0.75rem; }

  .action-bar {
    display: flex;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
  }
  .action-bar :global(.btn.active) {
    border-color: var(--accent-blue);
    color: var(--accent-blue);
  }

  .inline-form {
    display: flex;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
  }
  .inline-form .search-input { flex: 1; }

  .search-input {
    width: 100%;
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    font-family: inherit;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    outline: none;
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-input:focus { border-color: var(--accent-blue); }

  .recent-list {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .recent-item {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: 0 0.5rem;
    padding: 0.375rem 0.25rem;
    border-top: 1px solid var(--border);
    align-items: center;
  }
  .recent-info {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
  }
  .recent-name {
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recent-time {
    font-size: 0.625rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .recent-path {
    font-size: 0.625rem;
    color: var(--text-muted);
    grid-column: 1;
    grid-row: 2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recent-actions {
    grid-column: 2;
    grid-row: 1 / 3;
    display: flex;
    align-items: center;
  }

  .badge {
    font-size: 0.5rem;
    padding: 0.0625rem 0.25rem;
    border-radius: 3px;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .badge-green { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
  .badge-blue { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); }
  .badge-purple { background: rgba(188, 140, 255, 0.15); color: var(--accent-purple); }
  .badge-dim { background: rgba(110, 118, 129, 0.15); color: var(--text-muted); }

  .action-msg {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
</style>
