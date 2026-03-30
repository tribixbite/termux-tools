<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { fetchCustomization, fetchFileContent, saveFileContent, downloadFile } from "../lib/api";
  import type {
    CustomizationResponse, McpServerInfo, PluginInfo, SkillInfo,
    ClaudeMdInfo, HookInfo, MarketplacePlugin,
  } from "../lib/types";

  // -- State ------------------------------------------------------------------

  let data: CustomizationResponse | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);

  /** Which project path is selected (empty = no project filter) */
  let selectedProject = $state("");

  /** Track which sections are expanded */
  let sections = $state({
    mcp: true,
    plugins: false,
    skills: false,
    claudeMd: false,
    marketplace: false,
    hooks: false,
  });

  /** Which item is expanded for detail view (keyed by path or id) */
  let expandedItem: string | null = $state(null);

  /** File content cache for expanded items */
  let fileContents = $state<Record<string, string>>({});

  /** Which item is in edit mode */
  let editingItem: string | null = $state(null);
  let editBuffer = $state("");

  /** Saving/loading indicators */
  let savingFile = $state(false);
  let loadingFile: string | null = $state(null);

  /** Marketplace search filter */
  let marketplaceSearch = $state("");

  // -- Derived ----------------------------------------------------------------

  /** Available project paths from running sessions */
  const projectPaths = $derived(
    (store.daemon?.sessions ?? [])
      .map(s => s.path)
      .filter((p): p is string => !!p)
      .filter((v, i, a) => a.indexOf(v) === i) // unique
  );

  /** Filtered marketplace plugins */
  const filteredMarketplace = $derived(
    (data?.marketplace.available ?? []).filter(p => {
      if (!marketplaceSearch) return true;
      const q = marketplaceSearch.toLowerCase();
      return p.name.toLowerCase().includes(q)
        || p.description.toLowerCase().includes(q)
        || p.author.toLowerCase().includes(q);
    })
  );

  // -- Effects ----------------------------------------------------------------

  $effect(() => {
    if (typeof window === "undefined") return;
    loadData();
  });

  // -- Functions --------------------------------------------------------------

  async function loadData() {
    loading = true;
    error = null;
    try {
      data = await fetchCustomization(selectedProject || undefined);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function handleProjectChange(e: Event) {
    selectedProject = (e.target as HTMLSelectElement).value;
    // Reset expanded state
    expandedItem = null;
    editingItem = null;
    fileContents = {};
    loadData();
  }

  function toggleSection(key: keyof typeof sections) {
    sections[key] = !sections[key];
  }

  async function toggleExpand(path: string) {
    if (expandedItem === path) {
      expandedItem = null;
      editingItem = null;
      return;
    }
    expandedItem = path;
    editingItem = null;

    // Load content if not cached
    if (!fileContents[path]) {
      loadingFile = path;
      try {
        fileContents[path] = await fetchFileContent(path);
      } catch (e: any) {
        fileContents[path] = `Error loading: ${e.message}`;
      } finally {
        loadingFile = null;
      }
    }
  }

  function startEdit(path: string) {
    editingItem = path;
    editBuffer = fileContents[path] ?? "";
  }

  function cancelEdit() {
    editingItem = null;
    editBuffer = "";
  }

  async function saveEdit(path: string) {
    savingFile = true;
    try {
      await saveFileContent(path, editBuffer);
      fileContents[path] = editBuffer;
      editingItem = null;
    } catch (e: any) {
      error = `Save failed: ${e.message}`;
    } finally {
      savingFile = false;
    }
  }

  function handleDownload(path: string) {
    const content = fileContents[path];
    if (!content) return;
    const filename = path.split("/").pop() ?? "file.md";
    downloadFile(filename, content);
  }

  /** Format install count with K/M suffix */
  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
</script>

<div class="settings-root">
  <!-- Project selector -->
  {#if projectPaths.length > 0}
    <div class="project-selector">
      <label class="selector-label" for="project-select">Project scope</label>
      <select id="project-select" class="selector" onchange={handleProjectChange} value={selectedProject}>
        <option value="">All (user-scoped)</option>
        {#each projectPaths as p}
          <option value={p}>{p.split("/").pop()}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if loading && !data}
    <div class="card"><p class="muted">Loading customization data...</p></div>
  {:else if error && !data}
    <div class="card"><p class="error-text">Error: {error}</p></div>
  {:else if data}

    <!-- Section 1: MCP Servers -->
    <div class="card section-card">
      <button class="section-header" onclick={() => toggleSection("mcp")}>
        <span class="chevron">{sections.mcp ? "▾" : "▸"}</span>
        <span class="section-title">MCP Servers</span>
        <span class="badge badge-blue">{data.mcpServers.length}</span>
      </button>
      {#if sections.mcp}
        <div class="section-body">
          {#if data.mcpServers.length === 0}
            <p class="muted">No MCP servers configured</p>
          {:else}
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Scope</th>
                    <th>Command</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.mcpServers as srv (srv.name + srv.source)}
                    <tr class:disabled-row={srv.disabled} onclick={() => toggleExpand(`mcp:${srv.name}`)}>
                      <td class="name-cell">{srv.name}</td>
                      <td>
                        <span class="badge" class:badge-blue={srv.scope === "user"} class:badge-dim={srv.scope === "project"}>
                          {srv.scope}
                        </span>
                      </td>
                      <td class="cmd-cell" title="{srv.command} {srv.args.join(' ')}">
                        {srv.command}
                      </td>
                      <td>
                        {#if srv.disabled}
                          <span class="badge badge-dim">disabled</span>
                        {:else}
                          <span class="badge badge-green">active</span>
                        {/if}
                      </td>
                    </tr>
                    {#if expandedItem === `mcp:${srv.name}`}
                      <tr class="detail-row">
                        <td colspan="4">
                          <div class="detail-content">
                            <div class="detail-grid">
                              <span class="detail-label">Source</span>
                              <span>{srv.source}</span>
                              <span class="detail-label">Command</span>
                              <span class="mono">{srv.command}</span>
                              {#if srv.args.length > 0}
                                <span class="detail-label">Args</span>
                                <span class="mono">{srv.args.join(" ")}</span>
                              {/if}
                              {#if srv.env}
                                <span class="detail-label">Env</span>
                                <span class="mono">
                                  {#each Object.entries(srv.env) as [k, v]}
                                    <div>{k}={v}</div>
                                  {/each}
                                </span>
                              {/if}
                            </div>
                          </div>
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Section 2: Plugins -->
    <div class="card section-card">
      <button class="section-header" onclick={() => toggleSection("plugins")}>
        <span class="chevron">{sections.plugins ? "▾" : "▸"}</span>
        <span class="section-title">Plugins</span>
        <span class="badge badge-blue">{data.plugins.length}</span>
      </button>
      {#if sections.plugins}
        <div class="section-body">
          {#if data.plugins.length === 0}
            <p class="muted">No plugins installed</p>
          {:else}
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Installs</th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.plugins as plugin (plugin.id)}
                    <tr
                      class:disabled-row={!plugin.enabled}
                      class:blocked-row={plugin.blocked}
                    >
                      <td>
                        <div class="plugin-name">{plugin.name}</div>
                        {#if plugin.author}
                          <div class="plugin-author">{plugin.author}</div>
                        {/if}
                      </td>
                      <td>
                        <span class="badge" class:badge-blue={plugin.type === "native"} class:badge-dim={plugin.type === "external"}>
                          {plugin.type}
                        </span>
                      </td>
                      <td>
                        {#if plugin.blocked}
                          <span class="badge badge-red" title={plugin.blockReason}>blocked</span>
                        {:else if plugin.enabled}
                          <span class="badge badge-green">enabled</span>
                        {:else}
                          <span class="badge badge-dim">disabled</span>
                        {/if}
                      </td>
                      <td class="muted">{plugin.installs != null ? formatCount(plugin.installs) : "-"}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Section 3: Skills -->
    <div class="card section-card">
      <button class="section-header" onclick={() => toggleSection("skills")}>
        <span class="chevron">{sections.skills ? "▾" : "▸"}</span>
        <span class="section-title">Skills</span>
        <span class="badge badge-blue">{data.skills.length}</span>
      </button>
      {#if sections.skills}
        <div class="section-body">
          {#if data.skills.length === 0}
            <p class="muted">No skills found</p>
          {:else}
            <div class="item-list">
              {#each data.skills as skill (skill.path)}
                <div class="item-row">
                  <button class="item-header" onclick={() => toggleExpand(skill.path)}>
                    <span class="chevron">{expandedItem === skill.path ? "▾" : "▸"}</span>
                    <span class="item-name">{skill.name}</span>
                    <span class="badge" class:badge-blue={skill.scope === "user"} class:badge-dim={skill.scope === "project"}>
                      {skill.scope}
                    </span>
                    {#if skill.source}
                      <span class="muted plugin-source">({skill.source})</span>
                    {/if}
                  </button>
                  {#if expandedItem === skill.path}
                    <div class="item-content">
                      {#if loadingFile === skill.path}
                        <p class="muted">Loading...</p>
                      {:else if editingItem === skill.path}
                        <textarea
                          class="edit-area"
                          bind:value={editBuffer}
                          rows="20"
                        ></textarea>
                        <div class="edit-actions">
                          <button class="btn btn-primary btn-sm" onclick={() => saveEdit(skill.path)} disabled={savingFile}>
                            {savingFile ? "Saving..." : "Save"}
                          </button>
                          <button class="btn btn-sm" onclick={cancelEdit}>Cancel</button>
                        </div>
                      {:else}
                        <div class="file-actions">
                          <button class="btn btn-sm" onclick={() => startEdit(skill.path)}>Edit</button>
                          <button class="btn btn-sm" onclick={() => handleDownload(skill.path)}>Download</button>
                        </div>
                        <pre class="file-preview">{fileContents[skill.path] ?? ""}</pre>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Section 4: CLAUDE.md -->
    <div class="card section-card">
      <button class="section-header" onclick={() => toggleSection("claudeMd")}>
        <span class="chevron">{sections.claudeMd ? "▾" : "▸"}</span>
        <span class="section-title">CLAUDE.md</span>
        <span class="badge badge-blue">{data.claudeMds.length}</span>
      </button>
      {#if sections.claudeMd}
        <div class="section-body">
          {#if data.claudeMds.length === 0}
            <p class="muted">No CLAUDE.md files found</p>
          {:else}
            <div class="item-list">
              {#each data.claudeMds as md (md.path)}
                <div class="item-row">
                  <button class="item-header" onclick={() => toggleExpand(md.path)}>
                    <span class="chevron">{expandedItem === md.path ? "▾" : "▸"}</span>
                    <span class="item-name">{md.label}</span>
                    <span class="badge" class:badge-blue={md.scope === "user"} class:badge-dim={md.scope === "project"} class:badge-yellow={md.scope === "memory"}>
                      {md.scope}
                    </span>
                  </button>
                  {#if expandedItem === md.path}
                    <div class="item-content">
                      {#if loadingFile === md.path}
                        <p class="muted">Loading...</p>
                      {:else if editingItem === md.path}
                        <textarea
                          class="edit-area"
                          bind:value={editBuffer}
                          rows="20"
                        ></textarea>
                        <div class="edit-actions">
                          <button class="btn btn-primary btn-sm" onclick={() => saveEdit(md.path)} disabled={savingFile}>
                            {savingFile ? "Saving..." : "Save"}
                          </button>
                          <button class="btn btn-sm" onclick={cancelEdit}>Cancel</button>
                        </div>
                      {:else}
                        <div class="file-actions">
                          <button class="btn btn-sm" onclick={() => startEdit(md.path)}>Edit</button>
                          <button class="btn btn-sm" onclick={() => handleDownload(md.path)}>Download</button>
                        </div>
                        <pre class="file-preview">{fileContents[md.path] ?? ""}</pre>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Section 5: Marketplace -->
    <div class="card section-card">
      <button class="section-header" onclick={() => toggleSection("marketplace")}>
        <span class="chevron">{sections.marketplace ? "▾" : "▸"}</span>
        <span class="section-title">Marketplace</span>
        <span class="badge badge-blue">{data.marketplace.available.length}</span>
      </button>
      {#if sections.marketplace}
        <div class="section-body">
          <!-- Sources -->
          <div class="marketplace-sources">
            {#each data.marketplace.sources as src}
              <span class="badge badge-dim" title="Updated: {src.lastUpdated}">{src.name}</span>
            {/each}
          </div>

          <!-- Search -->
          <input
            class="search-input"
            type="text"
            placeholder="Filter plugins..."
            bind:value={marketplaceSearch}
          />

          <!-- Plugin list -->
          {#if filteredMarketplace.length === 0}
            <p class="muted">No plugins match filter</p>
          {:else}
            <div class="marketplace-grid">
              {#each filteredMarketplace as plugin (plugin.id)}
                <div class="marketplace-card" class:installed={plugin.installed}>
                  <div class="mp-header">
                    <span class="mp-name">{plugin.name}</span>
                    {#if plugin.installed && plugin.enabled}
                      <span class="badge badge-green">active</span>
                    {:else if plugin.installed}
                      <span class="badge badge-yellow">installed</span>
                    {/if}
                  </div>
                  <p class="mp-desc">{plugin.description || "No description"}</p>
                  <div class="mp-footer">
                    <span class="mp-author">{plugin.author || "Unknown"}</span>
                    <span class="mp-meta">
                      <span class="badge" class:badge-blue={plugin.type === "native"} class:badge-dim={plugin.type === "external"}>
                        {plugin.type}
                      </span>
                      {#if plugin.installs > 0}
                        <span class="mp-installs">{formatCount(plugin.installs)}</span>
                      {/if}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Section 6: Hooks -->
    <div class="card section-card">
      <button class="section-header" onclick={() => toggleSection("hooks")}>
        <span class="chevron">{sections.hooks ? "▾" : "▸"}</span>
        <span class="section-title">Hooks</span>
        <span class="badge badge-blue">{data.hooks.length}</span>
      </button>
      {#if sections.hooks}
        <div class="section-body">
          {#if data.hooks.length === 0}
            <p class="muted">No hooks configured</p>
          {:else}
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Matcher</th>
                    <th>Command</th>
                    <th>Timeout</th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.hooks as hook, i}
                    <tr>
                      <td>{hook.event}</td>
                      <td class="mono">{hook.matcher}</td>
                      <td class="cmd-cell mono" title={hook.command}>{hook.command.split("/").pop()}</td>
                      <td class="muted">{hook.timeout ? `${hook.timeout}s` : "-"}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/if}
    </div>

  {/if}

  {#if error && data}
    <div class="card error-card">
      <p class="error-text">{error}</p>
      <button class="btn btn-sm" onclick={() => error = null}>Dismiss</button>
    </div>
  {/if}
</div>

<style>
  .settings-root {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Project selector */
  .project-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .selector-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .selector {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.375rem 0.5rem;
    max-width: 300px;
  }

  /* Sections */
  .section-card { padding: 0; overflow: hidden; }
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem;
    background: none;
    border: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .section-header:hover { background: var(--bg-tertiary); }
  .chevron { font-size: 0.625rem; color: var(--text-muted); width: 0.75rem; flex-shrink: 0; }
  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    flex: 1;
  }
  .section-body { padding: 0 0.75rem 0.75rem; }

  /* Tables */
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
  th {
    text-align: left;
    padding: 0.375rem 0.5rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover:not(.detail-row) { background: rgba(88, 166, 255, 0.04); cursor: pointer; }
  .disabled-row { opacity: 0.5; }
  .blocked-row td:first-child { color: var(--accent-red); }
  .name-cell { font-weight: 500; white-space: nowrap; }
  .cmd-cell {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .mono { font-family: inherit; color: var(--accent-purple); }
  .muted { color: var(--text-muted); font-size: 0.75rem; }

  /* Detail row (expanded MCP server) */
  .detail-row td { padding: 0; border-bottom: 1px solid var(--border); }
  .detail-content { padding: 0.5rem 0.75rem; background: var(--bg-primary); }
  .detail-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.125rem 0.75rem;
    font-size: 0.6875rem;
  }
  .detail-label { color: var(--text-muted); }

  /* Plugin table */
  .plugin-name { font-weight: 500; }
  .plugin-author { font-size: 0.625rem; color: var(--text-muted); }

  /* Item list (skills, CLAUDE.md) */
  .item-list {
    display: flex;
    flex-direction: column;
  }
  .item-row {
    border-bottom: 1px solid var(--border);
  }
  .item-row:last-child { border-bottom: none; }
  .item-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.25rem;
    background: none;
    border: none;
    color: var(--text-primary);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    text-align: left;
  }
  .item-header:hover { background: rgba(88, 166, 255, 0.04); }
  .item-name { flex: 1; font-weight: 500; }
  .plugin-source { font-size: 0.625rem; }

  /* File content viewer */
  .item-content {
    padding: 0 0.25rem 0.5rem;
  }
  .file-actions {
    display: flex;
    gap: 0.375rem;
    margin-bottom: 0.375rem;
  }
  .file-preview {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem;
    font-size: 0.6875rem;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
    margin: 0;
    color: var(--text-secondary);
  }
  .edit-area {
    width: 100%;
    background: var(--bg-primary);
    border: 1px solid var(--accent-blue);
    border-radius: 6px;
    padding: 0.5rem;
    font-family: inherit;
    font-size: 0.6875rem;
    line-height: 1.5;
    color: var(--text-primary);
    resize: vertical;
    min-height: 200px;
  }
  .edit-actions {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }

  /* Marketplace */
  .marketplace-sources {
    display: flex;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }
  .search-input {
    width: 100%;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.625rem;
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-input:focus { outline: none; border-color: var(--accent-blue); }

  .marketplace-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.375rem;
  }
  .marketplace-card {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.625rem;
  }
  .marketplace-card.installed { border-color: rgba(63, 185, 80, 0.3); }
  .mp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }
  .mp-name { font-size: 0.75rem; font-weight: 600; }
  .mp-desc {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    margin: 0 0 0.375rem;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .mp-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.625rem;
  }
  .mp-author { color: var(--text-muted); }
  .mp-meta { display: flex; align-items: center; gap: 0.375rem; }
  .mp-installs { color: var(--text-muted); }

  /* Error card */
  .error-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .error-text { color: var(--accent-red); font-size: 0.75rem; margin: 0; }

  /* Mobile */
  @media (max-width: 768px) {
    .section-header { padding: 0.625rem; }
    .section-title { font-size: 0.6875rem; }
    .section-body { padding: 0 0.5rem 0.5rem; }
    table { font-size: 0.6875rem; }
    th { font-size: 0.5625rem; padding: 0.25rem 0.375rem; }
    td { padding: 0.375rem; }
    .file-preview { font-size: 0.5625rem; max-height: 300px; }
    .edit-area { font-size: 0.5625rem; }
    .item-header { font-size: 0.6875rem; }
    .mp-name { font-size: 0.6875rem; }
    .mp-desc { font-size: 0.5625rem; }
  }
</style>
