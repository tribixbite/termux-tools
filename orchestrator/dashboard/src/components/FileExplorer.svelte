<script lang="ts">
  import { fetchFileTree, fetchFileContentForSession } from "../lib/api";
  import type { FileEntry, FileContentResponse } from "../lib/types";

  interface Props {
    sessionName: string;
  }

  let { sessionName }: Props = $props();

  /** Current directory path segments (empty = root) */
  let pathSegments: string[] = $state([]);
  let entries: FileEntry[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);

  /** Currently viewed file content, null when browsing directories */
  let fileContent: FileContentResponse | null = $state(null);
  let fileLoading = $state(false);
  let fileError: string | null = $state(null);
  /** Path of the file currently being viewed */
  let viewingFilePath: string | null = $state(null);

  /** Joined subpath string for API calls */
  const currentPath = $derived(pathSegments.join("/"));

  /** Sorted entries: directories first, then files, alphabetical within each group */
  const sortedEntries = $derived(
    [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    }),
  );

  /** Whether we're in a subdirectory (show back button) */
  const inSubdir = $derived(pathSegments.length > 0);

  /** Whether we're viewing a file (vs browsing) */
  const viewingFile = $derived(viewingFilePath !== null);

  /** Format file size for display */
  function fmtSize(bytes?: number): string {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }

  /** Load directory listing for the current path */
  async function loadDir() {
    loading = true;
    error = null;
    // Clear any file view when navigating directories
    fileContent = null;
    viewingFilePath = null;
    fileError = null;
    try {
      const subPath = currentPath || undefined;
      entries = await fetchFileTree(sessionName, subPath);
    } catch (e) {
      error = (e as Error).message;
      entries = [];
    } finally {
      loading = false;
    }
  }

  /** Navigate into a directory */
  function navigateInto(dirName: string) {
    pathSegments = [...pathSegments, dirName];
  }

  /** Navigate to a specific breadcrumb index (-1 = root) */
  function navigateTo(index: number) {
    if (index < 0) {
      pathSegments = [];
    } else {
      pathSegments = pathSegments.slice(0, index + 1);
    }
  }

  /** Go back one level */
  function goBack() {
    if (viewingFile) {
      // Return to directory listing from file view
      fileContent = null;
      viewingFilePath = null;
      fileError = null;
    } else if (inSubdir) {
      pathSegments = pathSegments.slice(0, -1);
    }
  }

  /** Handle clicking a file — load its content */
  async function openFile(entry: FileEntry) {
    const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    fileLoading = true;
    fileError = null;
    fileContent = null;
    viewingFilePath = filePath;
    try {
      fileContent = await fetchFileContentForSession(sessionName, filePath);
    } catch (e) {
      fileError = (e as Error).message;
    } finally {
      fileLoading = false;
    }
  }

  /** Handle clicking an entry — directory or file */
  function handleEntryClick(entry: FileEntry) {
    if (entry.type === "directory") {
      navigateInto(entry.name);
    } else {
      openFile(entry);
    }
  }

  // Load directory when path or session changes
  $effect(() => {
    // Track both sessionName and currentPath so we reload on changes
    const _session = sessionName;
    const _path = currentPath;
    loadDir();
  });
</script>

<div class="file-explorer" onclick={(e) => e.stopPropagation()}>
  <!-- Breadcrumb navigation -->
  <div class="breadcrumb-bar">
    {#if inSubdir || viewingFile}
      <button class="btn-back" onclick={goBack} title="Go back">
        &larr;
      </button>
    {/if}
    <div class="breadcrumbs">
      <button
        class="crumb"
        class:crumb-active={!inSubdir && !viewingFile}
        onclick={() => navigateTo(-1)}
      >
        /
      </button>
      {#each pathSegments as segment, i}
        <span class="crumb-sep">/</span>
        <button
          class="crumb"
          class:crumb-active={i === pathSegments.length - 1 && !viewingFile}
          onclick={() => navigateTo(i)}
        >
          {segment}
        </button>
      {/each}
      {#if viewingFilePath}
        <span class="crumb-sep">/</span>
        <span class="crumb crumb-active crumb-file">
          {viewingFilePath.split("/").pop()}
        </span>
      {/if}
    </div>
  </div>

  <!-- File content view -->
  {#if viewingFile}
    <div class="file-view">
      {#if fileLoading}
        <div class="status-msg">Loading file...</div>
      {:else if fileError}
        <div class="error-msg">{fileError}</div>
      {:else if fileContent}
        {#if fileContent.truncated}
          <div class="truncated-notice">
            Truncated ({fmtSize(fileContent.size)} total)
          </div>
        {/if}
        <pre class="file-content language-{fileContent.language}">{fileContent.content}</pre>
      {/if}
    </div>

  <!-- Directory listing -->
  {:else if loading}
    <div class="status-msg">Loading...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if sortedEntries.length === 0}
    <div class="status-msg">Empty directory</div>
  {:else}
    <div class="entry-list">
      {#each sortedEntries as entry (entry.name)}
        <button class="entry-row" onclick={() => handleEntryClick(entry)}>
          <span class="entry-icon">
            {entry.type === "directory" ? "\u{1F4C1}" : "\u{1F4C4}"}
          </span>
          <span class="entry-name" class:entry-dir={entry.type === "directory"}>
            {entry.name}
          </span>
          {#if entry.type === "file" && entry.size != null}
            <span class="entry-size">{fmtSize(entry.size)}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .file-explorer {
    /* Container — no max-height here; children constrain themselves */
  }

  .status-msg {
    font-size: 0.6875rem;
    color: var(--text-muted);
    padding: 0.375rem 0;
  }

  .error-msg {
    font-size: 0.6875rem;
    color: var(--accent-red, #f85149);
    padding: 0.375rem 0;
  }

  /* Breadcrumb bar */
  .breadcrumb-bar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.375rem;
    min-height: 1.5rem;
  }

  .btn-back {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: 0.6875rem;
    cursor: pointer;
    padding: 0;
  }
  .btn-back:hover {
    border-color: var(--accent-blue);
    color: var(--accent-blue);
  }

  .breadcrumbs {
    display: flex;
    align-items: center;
    gap: 0;
    min-width: 0;
    overflow: hidden;
    flex-wrap: nowrap;
  }

  .crumb {
    font-size: 0.625rem;
    font-family: "SF Mono", "Cascadia Code", monospace;
    color: var(--accent-blue, #58a6ff);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.0625rem 0.125rem;
    border-radius: 2px;
    white-space: nowrap;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .crumb:hover { background: var(--bg-tertiary); }
  .crumb-active {
    color: var(--text-primary);
    cursor: default;
  }
  .crumb-active:hover { background: none; }
  .crumb-file {
    color: var(--text-secondary);
    cursor: default;
  }
  .crumb-sep {
    font-size: 0.5625rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  /* Directory entry list */
  .entry-list {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    max-height: 300px;
    overflow-y: auto;
  }

  .entry-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    padding: 0.25rem 0.5rem;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .entry-row:last-child { border-bottom: none; }
  .entry-row:hover { background: var(--bg-tertiary); }

  .entry-icon {
    font-size: 0.625rem;
    flex-shrink: 0;
    width: 1rem;
    text-align: center;
  }

  .entry-name {
    font-size: 0.6875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .entry-dir {
    color: var(--accent-blue, #58a6ff);
    font-weight: 500;
  }

  .entry-size {
    font-size: 0.5625rem;
    color: var(--text-muted);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  /* File content view */
  .file-view {
    /* Container for content preview */
  }

  .truncated-notice {
    font-size: 0.5625rem;
    color: var(--accent-yellow, #e3b341);
    margin-bottom: 0.25rem;
  }

  .file-content {
    max-height: 300px;
    overflow: auto;
    margin: 0;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-family: "SF Mono", "Cascadia Code", monospace;
    font-size: 0.625rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
  }

  @media (max-width: 768px) {
    .crumb { font-size: 0.5625rem; max-width: 60px; }
    .crumb-sep { font-size: 0.5rem; }
    .entry-name { font-size: 0.625rem; }
    .entry-icon { font-size: 0.5625rem; }
    .entry-size { font-size: 0.5rem; }
    .file-content { font-size: 0.5625rem; padding: 0.375rem; max-height: 250px; }
    .status-msg, .error-msg { font-size: 0.625rem; }
    .btn-back { width: 1.125rem; height: 1.125rem; font-size: 0.625rem; }
    .truncated-notice { font-size: 0.5rem; }
  }
</style>
