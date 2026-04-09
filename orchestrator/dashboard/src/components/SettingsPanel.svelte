<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { fetchCustomization, fetchFileContent, saveFileContent, downloadFile, fetchRecent } from "../lib/api";
  import type {
    CustomizationResponse, McpServerInfo, PluginInfo, SkillInfo,
    ClaudeMdInfo, HookInfo, MarketplacePlugin, RecentProject,
  } from "../lib/types";
  import McpManager from "./McpManager.svelte";

  // -- Constants --------------------------------------------------------------

  const HOME_PREFIX = "/data/data/com.termux/files/home/";

  /** Shorten absolute paths: /data/data/com.termux/files/home/... → ~/... */
  function shortenPath(p: string): string {
    if (p.startsWith(HOME_PREFIX)) return "~/" + p.slice(HOME_PREFIX.length);
    return p;
  }

  // -- State ------------------------------------------------------------------

  let data: CustomizationResponse | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);

  /** Which project path is selected (empty = no project filter) */
  let selectedProject = $state("");

  /** All recent projects from /api/recent */
  let recentProjects: RecentProject[] = $state([]);

  /** Project search/filter text */
  let projectSearch = $state("");

  /** Whether inactive projects section is expanded */
  let showInactive = $state(false);

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
  let downloadingAll: string | null = $state(null);

  /** Marketplace search filter */
  let marketplaceSearch = $state("");

  /** New skill creation state */
  let newSkillOpen = $state(false);
  let newSkillScope: "user" | "project" | null = $state(null);
  let newSkillName = $state("");
  let newSkillContent = $state("");
  let savingNewSkill = $state(false);

  const SKILL_TEMPLATE = `# Skill Name

## Description
Brief description of what this skill does.

## When to use
- Trigger condition 1
- Trigger condition 2

## Instructions
Detailed instructions for the agent when this skill is invoked.

## Examples
\`\`\`
Example usage or output
\`\`\`
`;

  // -- Derived ----------------------------------------------------------------

  /** Running session paths (from SSE state) */
  const runningSessions = $derived(
    new Set(
      (store.daemon?.sessions ?? [])
        .filter(s => s.status === "running" || s.status === "degraded" || s.status === "starting")
        .map(s => s.path)
        .filter((p): p is string => !!p)
    )
  );

  /** Active projects: running sessions + recent with "running"/"registered" status */
  const activeProjects = $derived(
    recentProjects
      .filter(p => p.status === "running" || p.status === "registered" || runningSessions.has(p.path))
      .filter((v, i, a) => a.findIndex(x => x.path === v.path) === i) // unique by path
  );

  /** Inactive projects: config/untracked and not running */
  const inactiveProjects = $derived(
    recentProjects
      .filter(p => p.status !== "running" && p.status !== "registered" && !runningSessions.has(p.path))
      .filter((v, i, a) => a.findIndex(x => x.path === v.path) === i)
  );

  /** Filter projects by search term */
  function matchesSearch(p: RecentProject): boolean {
    if (!projectSearch) return true;
    const q = projectSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q);
  }

  const filteredActive = $derived(activeProjects.filter(matchesSearch));
  const filteredInactive = $derived(inactiveProjects.filter(matchesSearch));

  /** Legacy compat — all project paths (active + inactive) */
  const projectPaths = $derived(
    [...activeProjects, ...inactiveProjects].map(p => p.path)
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
    loadRecentProjects();
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

  async function loadRecentProjects() {
    try {
      recentProjects = await fetchRecent();
    } catch {
      // Non-critical — dropdown will fall back to running sessions
    }
  }

  function selectProject(path: string) {
    selectedProject = path;
    expandedItem = null;
    editingItem = null;
    fileContents = {};
    newSkillOpen = false;
    projectSearch = "";
    loadData();
  }

  function handleProjectChange(e: Event) {
    selectProject((e.target as HTMLSelectElement).value);
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

  /** Share file content via Web Share API */
  async function handleShare(path: string) {
    const content = fileContents[path];
    if (!content) return;
    const filename = path.split("/").pop() ?? "file.md";

    if (navigator.share) {
      try {
        const file = new File([content], filename, { type: "text/markdown" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
        } else {
          // Fallback: share as text
          await navigator.share({ title: filename, text: content });
        }
      } catch (e: any) {
        if (e.name !== "AbortError") error = `Share failed: ${e.message}`;
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(content);
        error = null;
        // Brief visual feedback — reuse error slot
        const prev = error;
        error = "Copied to clipboard";
        setTimeout(() => { if (error === "Copied to clipboard") error = prev; }, 2000);
      } catch {
        error = "Share not supported on this browser";
      }
    }
  }

  /** Download all .md files from a section as a zip */
  async function handleDownloadAll(
    items: Array<{ path: string; name?: string; label?: string }>,
    sectionName: string,
  ) {
    downloadingAll = sectionName;
    try {
      // Fetch all file contents in parallel
      const results = await Promise.allSettled(
        items.map(async (item) => {
          const content = fileContents[item.path] ?? await fetchFileContent(item.path);
          // Cache for future use
          fileContents[item.path] = content;
          return { item, content };
        }),
      );

      const files: Array<{ name: string; data: Uint8Array }> = [];
      const projLabel = selectedProject ? selectedProject.split("/").pop() ?? "project" : "user";

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { item, content } = r.value;
        const filename = item.path.split("/").pop() ?? "file.md";
        files.push({ name: filename, data: new TextEncoder().encode(content) });
      }

      if (files.length === 0) {
        error = "No files to download";
        return;
      }

      // Build zip using minimal zip format (no compression — md files are small)
      const zipBlob = buildZip(files);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sectionName}-${projLabel}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      error = `Download failed: ${e.message}`;
    } finally {
      downloadingAll = null;
    }
  }

  /** Minimal zip file builder (store-only, no compression) */
  function buildZip(files: Array<{ name: string; data: Uint8Array }>): Blob {
    const parts: Uint8Array[] = [];
    const centralDir: Uint8Array[] = [];
    let offset = 0;

    for (const { name, data } of files) {
      const nameBytes = new TextEncoder().encode(name);
      // Local file header (30 + nameLen + dataLen)
      const localHeader = new ArrayBuffer(30);
      const lv = new DataView(localHeader);
      lv.setUint32(0, 0x04034b50, true);  // local file header signature
      lv.setUint16(4, 20, true);            // version needed (2.0)
      lv.setUint16(6, 0, true);             // general purpose flag
      lv.setUint16(8, 0, true);             // compression: store
      lv.setUint16(10, 0, true);            // mod time
      lv.setUint16(12, 0, true);            // mod date
      lv.setUint32(14, crc32(data), true);  // CRC-32
      lv.setUint32(18, data.length, true);  // compressed size
      lv.setUint32(22, data.length, true);  // uncompressed size
      lv.setUint16(26, nameBytes.length, true); // name length
      lv.setUint16(28, 0, true);            // extra field length

      const localHeaderBytes = new Uint8Array(localHeader);
      parts.push(localHeaderBytes, nameBytes, data);

      // Central directory entry (46 + nameLen)
      const cdHeader = new ArrayBuffer(46);
      const cv = new DataView(cdHeader);
      cv.setUint32(0, 0x02014b50, true);  // central dir signature
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0, true);             // flags
      cv.setUint16(10, 0, true);            // compression: store
      cv.setUint16(12, 0, true);            // mod time
      cv.setUint16(14, 0, true);            // mod date
      cv.setUint32(16, crc32(data), true);  // CRC-32
      cv.setUint32(20, data.length, true);  // compressed size
      cv.setUint32(24, data.length, true);  // uncompressed size
      cv.setUint16(28, nameBytes.length, true); // name length
      cv.setUint16(30, 0, true);            // extra field length
      cv.setUint16(32, 0, true);            // comment length
      cv.setUint16(34, 0, true);            // disk number
      cv.setUint16(36, 0, true);            // internal attrs
      cv.setUint32(38, 0, true);            // external attrs
      cv.setUint32(42, offset, true);       // local header offset

      centralDir.push(new Uint8Array(cdHeader), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }

    // Central directory size
    let cdSize = 0;
    for (const part of centralDir) cdSize += part.length;

    // End of central directory (22 bytes)
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);  // EOCD signature
    ev.setUint16(4, 0, true);            // disk number
    ev.setUint16(6, 0, true);            // disk with CD
    ev.setUint16(8, files.length, true); // entries on this disk
    ev.setUint16(10, files.length, true);// total entries
    ev.setUint32(12, cdSize, true);      // CD size
    ev.setUint32(16, offset, true);      // CD offset
    ev.setUint16(20, 0, true);           // comment length

    return new Blob([...parts, ...centralDir, new Uint8Array(eocd)], { type: "application/zip" });
  }

  /** CRC-32 for zip (IEEE polynomial) */
  function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** Open new skill creation form */
  function openNewSkill(scope: "user" | "project") {
    newSkillScope = scope;
    newSkillName = "";
    newSkillContent = SKILL_TEMPLATE;
    newSkillOpen = true;
  }

  /** Save new skill file */
  async function saveNewSkill() {
    if (!newSkillName.trim() || !newSkillScope) return;
    const safeName = newSkillName.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/\.md$/, "");
    const filename = `${safeName}.md`;

    // Determine target directory
    let targetPath: string;
    if (newSkillScope === "project" && selectedProject) {
      targetPath = `${selectedProject}/.claude/skills/${filename}`;
    } else {
      const home = "/data/data/com.termux/files/home";
      targetPath = `${home}/.claude/skills/${filename}`;
    }

    savingNewSkill = true;
    try {
      await saveFileContent(targetPath, newSkillContent);
      newSkillOpen = false;
      newSkillScope = null;
      // Refresh to show new skill
      await loadData();
    } catch (e: any) {
      error = `Failed to create skill: ${e.message}`;
    } finally {
      savingNewSkill = false;
    }
  }

  /** Format install count with K/M suffix */
  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  /** Stop event propagation (for buttons inside section headers) */
  function stopProp(e: Event) { e.stopPropagation(); }
</script>

<div class="settings-root">
  <!-- Project selector -->
  {#if projectPaths.length > 0}
    <div class="project-selector">
      <label class="selector-label" for="project-select">Project scope</label>
      <select id="project-select" class="selector" onchange={handleProjectChange} value={selectedProject}>
        <option value="">All (user-scoped)</option>
        {#if filteredActive.length > 0}
          <optgroup label="Active">
            {#each filteredActive as p (p.path)}
              <option value={p.path}>{p.name}</option>
            {/each}
          </optgroup>
        {/if}
        {#if filteredInactive.length > 0}
          <optgroup label="Inactive">
            {#each filteredInactive as p (p.path)}
              <option value={p.path}>{p.name}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
      {#if recentProjects.length > 8}
        <input
          class="project-filter"
          type="text"
          placeholder="Filter..."
          bind:value={projectSearch}
        />
      {/if}
    </div>
    {#if selectedProject}
      <div class="project-path-hint">{shortenPath(selectedProject)}</div>
    {/if}
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
          <McpManager servers={data.mcpServers} onrefresh={loadData} />
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
      <div class="section-header" role="button" tabindex="0" onclick={() => toggleSection("skills")}>
        <span class="chevron">{sections.skills ? "▾" : "▸"}</span>
        <span class="section-title">Skills</span>
        <span class="badge badge-blue">{data.skills.length}</span>
        <!-- Header action buttons (stop propagation so they don't toggle the section) -->
        <span class="header-actions" onclick={stopProp}>
          <button
            class="btn-icon btn-sm-icon"
            title="Download all as zip"
            disabled={downloadingAll === "skills"}
            onclick={() => handleDownloadAll(data!.skills, "skills")}
          >{downloadingAll === "skills" ? "..." : "\u2913"}</button>
          <span class="new-skill-dropdown">
            <button class="btn-icon btn-sm-icon primary" title="New skill" onclick={() => {
              if (selectedProject) openNewSkill("project");
              else openNewSkill("user");
            }}>+</button>
            {#if selectedProject}
              <!-- If project selected, show scope choice on click -->
            {/if}
          </span>
        </span>
      </div>
      {#if sections.skills}
        <div class="section-body">
          <!-- New skill form -->
          {#if newSkillOpen}
            <div class="new-skill-form">
              <div class="new-skill-header">
                <span class="new-skill-title">New Skill</span>
                <span class="badge" class:badge-blue={newSkillScope === "user"} class:badge-dim={newSkillScope === "project"}>
                  {newSkillScope}
                </span>
                {#if selectedProject}
                  <button class="btn btn-sm" onclick={() => newSkillScope = newSkillScope === "user" ? "project" : "user"}>
                    Switch to {newSkillScope === "user" ? "project" : "user"}
                  </button>
                {/if}
              </div>
              <input
                class="new-skill-name"
                type="text"
                placeholder="skill-name (without .md)"
                bind:value={newSkillName}
              />
              <textarea
                class="edit-area"
                bind:value={newSkillContent}
                rows="16"
              ></textarea>
              <div class="edit-actions">
                <button
                  class="btn btn-primary btn-sm"
                  onclick={saveNewSkill}
                  disabled={savingNewSkill || !newSkillName.trim()}
                >
                  {savingNewSkill ? "Creating..." : "Create"}
                </button>
                <button class="btn btn-sm" onclick={() => { newSkillOpen = false; newSkillScope = null; }}>Cancel</button>
              </div>
            </div>
          {/if}

          {#if data.skills.length === 0 && !newSkillOpen}
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
                    <span class="item-path" title={skill.path}>{shortenPath(skill.path)}</span>
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
                          <button class="btn btn-sm" onclick={() => handleShare(skill.path)}>Share</button>
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
      <div class="section-header" role="button" tabindex="0" onclick={() => toggleSection("claudeMd")}>
        <span class="chevron">{sections.claudeMd ? "▾" : "▸"}</span>
        <span class="section-title">CLAUDE.md</span>
        <span class="badge badge-blue">{data.claudeMds.length}</span>
        <span class="header-actions" onclick={stopProp}>
          <button
            class="btn-icon btn-sm-icon"
            title="Download all as zip"
            disabled={downloadingAll === "claude-md"}
            onclick={() => handleDownloadAll(data!.claudeMds, "claude-md")}
          >{downloadingAll === "claude-md" ? "..." : "\u2913"}</button>
        </span>
      </div>
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
                    <span class="item-path" title={md.path}>{shortenPath(md.path)}</span>
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
                          <button class="btn btn-sm" onclick={() => handleShare(md.path)}>Share</button>
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
          <div class="marketplace-sources">
            {#each data.marketplace.sources as src}
              <span class="badge badge-dim" title="Updated: {src.lastUpdated}">{src.name}</span>
            {/each}
          </div>

          <input
            class="search-input"
            type="text"
            placeholder="Filter plugins..."
            bind:value={marketplaceSearch}
          />

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
                      <td class="cmd-cell mono" title={shortenPath(hook.command)}>{shortenPath(hook.command)}</td>
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
  .project-filter {
    width: 80px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.6875rem;
    padding: 0.375rem 0.5rem;
    flex-shrink: 0;
  }
  .project-filter::placeholder { color: var(--text-muted); }
  .project-filter:focus { outline: none; border-color: var(--accent-blue); }
  .project-path-hint {
    font-size: 0.625rem;
    color: var(--text-muted);
    margin-top: -0.25rem;
    padding-left: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  /* Header action buttons (download all, new skill) */
  .header-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .btn-sm-icon {
    width: 1.5rem;
    height: 1.5rem;
    font-size: 0.8rem;
    padding: 0;
    line-height: 1;
  }

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
  .item-name { font-weight: 500; white-space: nowrap; }
  .item-path {
    flex: 1;
    font-size: 0.5625rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    min-width: 0;
  }
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

  /* New skill form */
  .new-skill-form {
    background: var(--bg-primary);
    border: 1px solid var(--accent-blue);
    border-radius: 6px;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .new-skill-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .new-skill-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-blue);
  }
  .new-skill-name {
    width: 100%;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem;
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }
  .new-skill-name::placeholder { color: var(--text-muted); }
  .new-skill-name:focus { outline: none; border-color: var(--accent-blue); }

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
    .btn-sm-icon { width: 1.25rem; height: 1.25rem; font-size: 0.7rem; }
    .item-path { font-size: 0.5rem; }
    .project-path-hint { font-size: 0.5625rem; }
  }
</style>
