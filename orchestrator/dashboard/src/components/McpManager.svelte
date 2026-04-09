<script lang="ts">
  import { addMcpServer, updateMcpServer, deleteMcpServer, toggleMcpServer, fetchCustomization } from "../lib/api";
  import type { McpServerInfo, CustomizationResponse } from "../lib/types";

  const HOME_PREFIX = "/data/data/com.termux/files/home/";

  function shortenPath(p: string): string {
    if (p.startsWith(HOME_PREFIX)) return "~/" + p.slice(HOME_PREFIX.length);
    return p;
  }

  interface Props {
    servers: McpServerInfo[];
    /** Callback to reload customization data after mutations */
    onrefresh: () => void;
  }
  let { servers, onrefresh }: Props = $props();

  // Expand/collapse state
  let expandedItem: string | null = $state(null);

  // Form state
  let formMode: "add" | "edit" | null = $state(null);
  let formName = $state("");
  let formCommand = $state("");
  let formArgs = $state("");
  let formEnvRows: Array<{ key: string; value: string }> = $state([]);
  let formError: string | null = $state(null);
  let formSaving = $state(false);

  // Confirm delete
  let confirmDelete: string | null = $state(null);

  // Action feedback
  let actionError: string | null = $state(null);

  function toggleExpand(name: string) {
    expandedItem = expandedItem === name ? null : name;
  }

  function openAddForm() {
    formMode = "add";
    formName = "";
    formCommand = "";
    formArgs = "";
    formEnvRows = [{ key: "", value: "" }];
    formError = null;
    expandedItem = null;
  }

  function openEditForm(srv: McpServerInfo) {
    formMode = "edit";
    formName = srv.name;
    formCommand = srv.command;
    formArgs = srv.args.join(" ");
    formEnvRows = srv.env
      ? Object.entries(srv.env).map(([key, value]) => ({ key, value }))
      : [];
    if (formEnvRows.length === 0) formEnvRows = [{ key: "", value: "" }];
    formError = null;
    expandedItem = null;
  }

  function cancelForm() {
    formMode = null;
    formError = null;
  }

  function addEnvRow() {
    formEnvRows = [...formEnvRows, { key: "", value: "" }];
  }

  function removeEnvRow(idx: number) {
    formEnvRows = formEnvRows.filter((_, i) => i !== idx);
    if (formEnvRows.length === 0) formEnvRows = [{ key: "", value: "" }];
  }

  async function submitForm() {
    formError = null;
    const name = formName.trim();
    const command = formCommand.trim();
    if (!name || !command) {
      formError = "Name and command are required";
      return;
    }
    const args = formArgs.trim() ? formArgs.trim().split(/\s+/) : [];
    const env: Record<string, string> = {};
    for (const row of formEnvRows) {
      if (row.key.trim()) env[row.key.trim()] = row.value;
    }

    formSaving = true;
    try {
      if (formMode === "add") {
        await addMcpServer(name, command, args, Object.keys(env).length > 0 ? env : undefined);
      } else {
        await updateMcpServer(name, {
          command,
          args,
          env: Object.keys(env).length > 0 ? env : undefined,
        });
      }
      formMode = null;
      onrefresh();
    } catch (e: any) {
      formError = e.message;
    } finally {
      formSaving = false;
    }
  }

  async function handleDelete(name: string) {
    actionError = null;
    try {
      await deleteMcpServer(name);
      confirmDelete = null;
      expandedItem = null;
      onrefresh();
    } catch (e: any) {
      actionError = `Delete failed: ${e.message}`;
    }
  }

  async function handleToggle(e: Event, name: string) {
    e.stopPropagation();
    actionError = null;
    try {
      await toggleMcpServer(name);
      onrefresh();
    } catch (e: any) {
      actionError = `Toggle failed: ${(e as Error).message}`;
    }
  }
</script>

{#if actionError}
  <p class="error-msg">{actionError}</p>
{/if}

{#if formMode}
  <!-- Add/Edit form -->
  <div class="form-card">
    <h4 class="form-title">{formMode === "add" ? "Add MCP Server" : `Edit: ${formName}`}</h4>
    {#if formError}
      <p class="error-msg">{formError}</p>
    {/if}
    <div class="form-field">
      <label>Name</label>
      <input type="text" bind:value={formName} disabled={formMode === "edit"} placeholder="my-server" />
    </div>
    <div class="form-field">
      <label>Command</label>
      <input type="text" bind:value={formCommand} placeholder="node" />
    </div>
    <div class="form-field">
      <label>Args <span class="hint">(space-separated)</span></label>
      <input type="text" bind:value={formArgs} placeholder="/path/to/server.js --flag" />
    </div>
    <div class="form-field">
      <label>Environment</label>
      {#each formEnvRows as row, idx (idx)}
        <div class="env-row">
          <input type="text" bind:value={row.key} placeholder="KEY" class="env-key" />
          <span class="env-eq">=</span>
          <input type="text" bind:value={row.value} placeholder="value" class="env-val" />
          <button class="btn-icon-sm" onclick={() => removeEnvRow(idx)} title="Remove">&times;</button>
        </div>
      {/each}
      <button class="btn-link" onclick={addEnvRow}>+ Add variable</button>
    </div>
    <div class="form-actions">
      <button class="btn-cancel" onclick={cancelForm}>Cancel</button>
      <button class="btn-save" onclick={submitForm} disabled={formSaving}>
        {formSaving ? "Saving..." : formMode === "add" ? "Add" : "Save"}
      </button>
    </div>
  </div>
{:else}
  <!-- Server list + Add button -->
  <div class="header-row">
    <button class="btn-add" onclick={openAddForm}>+ Add</button>
  </div>

  {#if servers.length === 0}
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
          {#each servers as srv (srv.name + srv.source)}
            <tr class:disabled-row={srv.disabled} onclick={() => toggleExpand(srv.name)}>
              <td class="name-cell">{srv.name}</td>
              <td>
                <span class="badge" class:badge-blue={srv.scope === "user"} class:badge-dim={srv.scope === "project"}>
                  {srv.scope}
                </span>
              </td>
              <td class="cmd-cell" title="{shortenPath(srv.command)} {srv.args.map(a => shortenPath(a)).join(' ')}">
                {shortenPath(srv.command)}
              </td>
              <td>
                <button
                  class="toggle-btn"
                  class:toggle-on={!srv.disabled}
                  class:toggle-off={srv.disabled}
                  onclick={(e) => handleToggle(e, srv.name)}
                  title={srv.disabled ? "Enable" : "Disable"}
                >
                  {srv.disabled ? "off" : "on"}
                </button>
              </td>
            </tr>
            {#if expandedItem === srv.name}
              <tr class="detail-row">
                <td colspan="4">
                  <div class="detail-content">
                    <div class="detail-grid">
                      <span class="detail-label">Source</span>
                      <span>{srv.source}</span>
                      <span class="detail-label">Command</span>
                      <span class="mono">{shortenPath(srv.command)}</span>
                      {#if srv.args.length > 0}
                        <span class="detail-label">Args</span>
                        <span class="mono">{srv.args.map(a => shortenPath(a)).join(" ")}</span>
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
                    {#if srv.scope === "user" && srv.source === "claude-json"}
                      <div class="detail-actions">
                        <button class="btn-edit" onclick={() => openEditForm(srv)}>Edit</button>
                        {#if confirmDelete === srv.name}
                          <span class="confirm-msg">Delete?</span>
                          <button class="btn-delete-confirm" onclick={() => handleDelete(srv.name)}>Yes</button>
                          <button class="btn-cancel-sm" onclick={() => confirmDelete = null}>No</button>
                        {:else}
                          <button class="btn-delete" onclick={() => confirmDelete = srv.name}>Delete</button>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

<style>
  .error-msg {
    color: var(--accent-red);
    font-size: 0.6875rem;
    margin: 0 0 0.5rem;
  }
  .muted { color: var(--text-muted); font-size: 0.6875rem; }
  .header-row {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.375rem;
  }
  .btn-add {
    font-size: 0.625rem;
    font-family: inherit;
    color: var(--accent-blue);
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
  }
  .btn-add:hover { background: var(--bg-tertiary); }

  /* Table */
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.6875rem; }
  th {
    text-align: left;
    font-size: 0.5625rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 0.375rem 0.375rem;
  }
  td { padding: 0.375rem; border-top: 1px solid var(--border); }
  tr { cursor: pointer; transition: background 0.15s; }
  tr:hover { background: var(--bg-tertiary); }
  .disabled-row { opacity: 0.5; }
  .name-cell { font-weight: 500; color: var(--accent-blue); }
  .cmd-cell {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: "SF Mono", "Cascadia Code", monospace;
    font-size: 0.625rem;
    color: var(--text-secondary);
  }

  /* Toggle button */
  .toggle-btn {
    font-size: 0.5625rem;
    font-family: inherit;
    font-weight: 600;
    padding: 0.0625rem 0.3125rem;
    border-radius: 3px;
    border: none;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .toggle-on {
    color: var(--accent-green);
    background: rgba(34, 197, 94, 0.15);
  }
  .toggle-off {
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.06);
  }
  .toggle-btn:hover { opacity: 0.8; }

  /* Badge */
  .badge {
    font-size: 0.5625rem;
    font-weight: 500;
    padding: 0.0625rem 0.25rem;
    border-radius: 3px;
  }
  .badge-blue { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); }
  .badge-dim { background: rgba(255, 255, 255, 0.06); color: var(--text-muted); }

  /* Detail row */
  .detail-row td { border-top: none; padding: 0.25rem 0.375rem 0.5rem; }
  .detail-content { padding: 0.25rem 0.5rem; }
  .detail-grid {
    display: grid;
    grid-template-columns: 5rem 1fr;
    gap: 0.25rem 0.5rem;
    font-size: 0.625rem;
  }
  .detail-label { color: var(--text-muted); }
  .mono { font-family: "SF Mono", "Cascadia Code", monospace; font-size: 0.5625rem; word-break: break-all; }
  .detail-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
    padding-top: 0.375rem;
    border-top: 1px solid var(--border);
  }
  .btn-edit, .btn-delete, .btn-delete-confirm, .btn-cancel-sm {
    font-size: 0.5625rem;
    font-family: inherit;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: none;
  }
  .btn-edit { color: var(--accent-blue); }
  .btn-delete { color: var(--accent-red); }
  .btn-delete-confirm { color: #fff; background: var(--accent-red); border-color: var(--accent-red); }
  .btn-cancel-sm { color: var(--text-muted); }
  .confirm-msg { font-size: 0.5625rem; color: var(--accent-red); }

  /* Form */
  .form-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem;
  }
  .form-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 0.625rem;
  }
  .form-field {
    margin-bottom: 0.5rem;
  }
  .form-field label {
    display: block;
    font-size: 0.5625rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.25rem;
  }
  .hint { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .form-field input {
    width: 100%;
    font-size: 0.6875rem;
    font-family: inherit;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.375rem 0.5rem;
  }
  .form-field input:focus { outline: none; border-color: var(--accent-blue); }
  .form-field input:disabled { opacity: 0.5; }
  .env-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }
  .env-key { width: 35%; }
  .env-eq { color: var(--text-muted); font-size: 0.75rem; flex-shrink: 0; }
  .env-val { flex: 1; }
  .btn-icon-sm {
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .btn-icon-sm:hover { background: rgba(255, 255, 255, 0.08); color: var(--accent-red); }
  .btn-link {
    font-size: 0.5625rem;
    font-family: inherit;
    color: var(--accent-blue);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.125rem 0;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.375rem;
    margin-top: 0.75rem;
  }
  .btn-cancel, .btn-save {
    font-size: 0.6875rem;
    font-family: inherit;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--border);
  }
  .btn-cancel {
    background: none;
    color: var(--text-secondary);
  }
  .btn-save {
    background: var(--accent-blue);
    color: var(--bg-primary);
    border-color: var(--accent-blue);
    font-weight: 500;
  }
  .btn-save:disabled { opacity: 0.5; cursor: default; }
</style>
