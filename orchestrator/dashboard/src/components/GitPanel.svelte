<script lang="ts">
  import { fetchGitInfo } from "../lib/api";
  import type { GitInfo } from "../lib/types";

  interface Props {
    sessionName: string;
  }

  let { sessionName }: Props = $props();

  let info: GitInfo | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);

  /** Number of uncommitted (dirty) files */
  const dirtyCount = $derived(info?.dirty_files.length ?? 0);

  /** Last 5 commits from the repo */
  const recentCommits = $derived(info?.recent_commits.slice(0, 5) ?? []);

  async function load() {
    loading = true;
    error = null;
    try {
      info = await fetchGitInfo(sessionName);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  // Load on mount, re-load when sessionName changes
  $effect(() => {
    // Reference sessionName to track changes
    const _name = sessionName;
    load();
  });
</script>

<div class="git-panel" onclick={(e) => e.stopPropagation()}>
  {#if loading}
    <div class="status-msg">Loading git info...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if info}
    <!-- Branch + dirty count row -->
    <div class="branch-row">
      <span class="branch-badge" title="Current branch">{info.branch}</span>
      {#if dirtyCount > 0}
        <span class="dirty-badge" title="{dirtyCount} uncommitted file{dirtyCount !== 1 ? 's' : ''}">
          {dirtyCount} dirty
        </span>
      {:else}
        <span class="clean-badge">clean</span>
      {/if}
    </div>

    <!-- Recent commits -->
    {#if recentCommits.length > 0}
      <div class="commits">
        {#each recentCommits as commit (commit.hash)}
          <div class="commit-row">
            <span class="commit-hash">{commit.hash.slice(0, 7)}</span>
            <span class="commit-msg">{commit.message}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="status-msg">No commits</div>
    {/if}
  {/if}
</div>

<style>
  .git-panel {
    max-height: 150px;
    overflow: hidden;
  }

  .status-msg {
    font-size: 0.6875rem;
    color: var(--text-muted);
    padding: 0.25rem 0;
  }

  .error-msg {
    font-size: 0.6875rem;
    color: var(--accent-red, #f85149);
    padding: 0.25rem 0;
  }

  /* Branch + dirty indicator row */
  .branch-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.375rem;
  }

  .branch-badge {
    font-size: 0.625rem;
    font-weight: 600;
    font-family: "SF Mono", "Cascadia Code", monospace;
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background: rgba(136, 98, 220, 0.15);
    color: var(--accent-purple, #b392f0);
    max-width: 140px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty-badge {
    font-size: 0.5625rem;
    font-weight: 600;
    padding: 0.0625rem 0.3125rem;
    border-radius: 3px;
    background: rgba(227, 179, 65, 0.15);
    color: var(--accent-yellow, #e3b341);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  .clean-badge {
    font-size: 0.5625rem;
    font-weight: 600;
    padding: 0.0625rem 0.3125rem;
    border-radius: 3px;
    background: rgba(63, 185, 80, 0.15);
    color: var(--accent-green, #3fb950);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  /* Commit list */
  .commits {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .commit-row {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    padding: 0.125rem 0;
    min-width: 0;
  }

  .commit-hash {
    font-size: 0.625rem;
    font-family: "SF Mono", "Cascadia Code", monospace;
    color: var(--accent-blue, #58a6ff);
    flex-shrink: 0;
  }

  .commit-msg {
    font-size: 0.625rem;
    color: var(--text-secondary, #b1bac4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  @media (max-width: 768px) {
    .branch-badge { font-size: 0.5625rem; max-width: 100px; }
    .dirty-badge, .clean-badge { font-size: 0.5rem; }
    .commit-hash { font-size: 0.5625rem; }
    .commit-msg { font-size: 0.5625rem; }
    .status-msg, .error-msg { font-size: 0.625rem; }
  }
</style>
