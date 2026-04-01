<script lang="ts">
  import { fetchScripts, runScript, saveScript } from "../lib/api";
  import type { ScriptEntry } from "../lib/types";

  interface Props {
    sessionName: string;
    sessionPath: string;
  }

  let { sessionName, sessionPath }: Props = $props();

  let scripts: ScriptEntry[] = $state([]);
  let commandInput: string = $state("");
  let filter: string = $state("");
  let saving: boolean = $state(false);
  let saveName: string = $state("");
  let running: boolean = $state(false);
  let error: string | null = $state(null);
  let loaded: boolean = $state(false);

  /** Filtered scripts list */
  const filtered = $derived(
    filter
      ? scripts.filter(
          (s) =>
            s.name.toLowerCase().includes(filter.toLowerCase()) ||
            s.command?.toLowerCase().includes(filter.toLowerCase()),
        )
      : scripts,
  );

  /** Whether to show the filter input */
  const showFilter = $derived(scripts.length > 5);

  /** Source badge class */
  function badgeCls(source: string): string {
    switch (source) {
      case "root": return "badge-dim";
      case "scripts": return "badge-blue";
      case "package.json": return "badge-green";
      case "saved": return "badge-yellow";
      default: return "badge-dim";
    }
  }

  /** Source label for display */
  function sourceLabel(source: string): string {
    switch (source) {
      case "package.json": return "npm";
      default: return source;
    }
  }

  /** Load scripts on mount */
  async function loadScripts() {
    try {
      scripts = await fetchScripts(sessionName);
    } catch (err) {
      error = `Failed to load scripts: ${(err as Error).message}`;
    } finally {
      loaded = true;
    }
  }

  /** Run an ad-hoc command */
  async function handleRunCommand() {
    if (!commandInput.trim() || running) return;
    running = true;
    error = null;
    try {
      await runScript(sessionName, { command: commandInput.trim() });
      commandInput = "";
    } catch (err) {
      error = (err as Error).message;
    } finally {
      running = false;
    }
  }

  /** Run a listed script */
  async function handleRunScript(entry: ScriptEntry) {
    if (running) return;
    running = true;
    error = null;
    try {
      await runScript(sessionName, { script: entry.name, source: entry.source });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      running = false;
    }
  }

  /** Toggle save mode or save the script */
  async function handleSave() {
    if (!saving) {
      saving = true;
      saveName = "";
      return;
    }
    if (!saveName.trim() || !commandInput.trim()) {
      saving = false;
      return;
    }
    error = null;
    try {
      await saveScript(sessionName, saveName.trim(), commandInput.trim());
      saving = false;
      saveName = "";
      commandInput = "";
      // Refresh the list to show the new script
      await loadScripts();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  /** Cancel save mode */
  function cancelSave() {
    saving = false;
    saveName = "";
  }

  /** Handle Enter key in command input */
  function handleCommandKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleRunCommand();
    }
  }

  /** Handle Enter key in save name input */
  function handleSaveKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      cancelSave();
    }
  }

  // Load on mount
  $effect(() => {
    loadScripts();
  });
</script>

<div class="script-runner" onclick={(e) => e.stopPropagation()}>
  <!-- Command input row -->
  <div class="cmd-row">
    <input
      type="text"
      class="cmd-input"
      placeholder="Run command..."
      bind:value={commandInput}
      onkeydown={handleCommandKeydown}
      disabled={running}
    />
    <button
      class="btn-icon primary"
      onclick={handleRunCommand}
      disabled={!commandInput.trim() || running}
      title="Run"
    >&#x25B6;</button>
    <button
      class="btn-icon"
      onclick={handleSave}
      disabled={!commandInput.trim()}
      title="Save as script"
      style={saving ? "border-color: var(--accent-yellow); color: var(--accent-yellow)" : ""}
    >&#x1F4BE;</button>
  </div>

  <!-- Inline save name input -->
  {#if saving}
    <div class="save-row">
      <input
        type="text"
        class="cmd-input"
        placeholder="Script name (e.g. my-build)"
        bind:value={saveName}
        onkeydown={handleSaveKeydown}
      />
      <button class="btn btn-sm btn-primary" onclick={handleSave} disabled={!saveName.trim()}>Save</button>
      <button class="btn btn-sm" onclick={cancelSave}>Cancel</button>
    </div>
  {/if}

  <div class="cmd-hint">Opens in new Termux tab</div>

  {#if error}
    <div class="script-error">{error}</div>
  {/if}

  <!-- Script list -->
  {#if loaded && scripts.length > 0}
    {#if showFilter}
      <input
        type="text"
        class="filter-input"
        placeholder="Filter scripts..."
        bind:value={filter}
      />
    {/if}
    <div class="script-list" class:scrollable={scripts.length > 5}>
      {#each filtered as entry (entry.source + ":" + entry.name)}
        <div class="script-row">
          <div class="script-info">
            <span class="script-name">{entry.name}</span>
            <span class="badge {badgeCls(entry.source)}">{sourceLabel(entry.source)}</span>
            {#if entry.command}
              <span class="script-cmd">{entry.command}</span>
            {/if}
          </div>
          <button
            class="btn-icon primary"
            onclick={() => handleRunScript(entry)}
            disabled={running}
            title="Run {entry.name}"
          >&#x25B6;</button>
        </div>
      {/each}
      {#if filtered.length === 0}
        <div class="no-results">No matching scripts</div>
      {/if}
    </div>
  {:else if loaded}
    <div class="no-results">No scripts found</div>
  {/if}
</div>

<style>
  .script-runner {
    margin-bottom: 0.5rem;
  }
  .cmd-row {
    display: flex;
    gap: 0.375rem;
    align-items: center;
  }
  .cmd-input {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.75rem;
    outline: none;
    min-width: 0;
  }
  .cmd-input::placeholder { color: var(--text-muted); }
  .cmd-input:focus { border-color: var(--accent-blue); }
  .cmd-input:disabled { opacity: 0.5; }
  .save-row {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    margin-top: 0.375rem;
  }
  .cmd-hint {
    font-size: 0.625rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
    margin-bottom: 0.375rem;
  }
  .script-error {
    font-size: 0.6875rem;
    color: var(--accent-red);
    margin-bottom: 0.375rem;
  }
  .filter-input {
    width: 100%;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.6875rem;
    outline: none;
    margin-bottom: 0.375rem;
  }
  .filter-input::placeholder { color: var(--text-muted); }
  .filter-input:focus { border-color: var(--accent-blue); }
  .script-list {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .script-list.scrollable {
    max-height: 200px;
    overflow-y: auto;
  }
  .script-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.5rem;
    border-bottom: 1px solid var(--border);
    gap: 0.5rem;
  }
  .script-row:last-child { border-bottom: none; }
  .script-row:hover { background: var(--bg-tertiary); }
  .script-info {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    flex-wrap: wrap;
  }
  .script-name {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .script-cmd {
    font-size: 0.625rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  .no-results {
    font-size: 0.6875rem;
    color: var(--text-muted);
    padding: 0.5rem;
    text-align: center;
  }

  /* Badge styles are global but we scope sizes here */
  .badge {
    font-size: 0.5625rem;
    padding: 0.0625rem 0.3125rem;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .cmd-input { font-size: 0.6875rem; padding: 0.3125rem 0.375rem; }
    .script-name { font-size: 0.6875rem; }
    .badge { font-size: 0.5rem; }
    .cmd-hint { font-size: 0.5625rem; }
  }
</style>
