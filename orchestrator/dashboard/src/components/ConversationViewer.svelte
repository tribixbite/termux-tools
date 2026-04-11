<script lang="ts">
  import { fetchConversation, sendToSession, branchSession } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import type { ConversationPage, ConversationEntry, ConversationBlock } from "../lib/types";
  import PromptLibrary from "./PromptLibrary.svelte";

  /** Session name (operad) to load conversation for */
  interface Props {
    sessionName: string;
  }
  let { sessionName }: Props = $props();

  let page: ConversationPage | null = $state(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let error: string | null = $state(null);
  let selectedSessionId = $state("");
  let scrollContainer: HTMLElement | undefined = $state(undefined);

  // Prompt input state
  let promptText = $state("");
  let sending = $state(false);

  // Expanded blocks (keyed by entry uuid + block index)
  let expandedBlocks = $state(new Set<string>());

  // Prompt library dropdown
  let showLibrary = $state(false);

  // Message recall (arrow key history)
  let sentMessages: string[] = $state([]);
  let recallIndex = $state(-1);
  let savedDraft = $state("");
  const RECALL_STORAGE_KEY = `tmx-recall-${sessionName}`;

  // Template pills for quick prompts
  const TEMPLATE_PILLS = [
    "review this code",
    "explain the bug",
    "write tests for",
    "refactor to be more",
    "summarize changes",
    "create PR description",
    "fix failing test",
    "add error handling to",
  ];

  /** Claude status from SSE store */
  const claudeStatus = $derived(
    store.daemon?.sessions.find(s => s.name === sessionName)?.claude_status ?? null
  );

  /** Format timestamp to short time string */
  function fmtTime(ts: string): string {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }

  /** Format cost badge */
  function fmtCost(usage: ConversationEntry["usage"]): string {
    if (!usage) return "";
    const cost = (usage.input * 15 + usage.output * 75 + usage.cache_read * 1.5 + usage.cache_create * 18.75) / 1_000_000;
    if (cost < 0.001) return "";
    if (cost < 0.01) return "<1c";
    return `${Math.round(cost * 100)}c`;
  }

  function toggleBlock(key: string) {
    if (expandedBlocks.has(key)) {
      expandedBlocks.delete(key);
    } else {
      expandedBlocks.add(key);
    }
    expandedBlocks = new Set(expandedBlocks);
  }

  async function loadConversation(sessionId?: string) {
    loading = true;
    error = null;
    try {
      page = await fetchConversation(sessionName, {
        session_id: sessionId || undefined,
        limit: 20,
      });
      if (!selectedSessionId && page.session_id) {
        selectedSessionId = page.session_id;
      }
      requestAnimationFrame(() => {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      });
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    if (!page?.has_more || !page.oldest_uuid || loadingMore) return;
    loadingMore = true;
    try {
      const older = await fetchConversation(sessionName, {
        session_id: selectedSessionId || undefined,
        before: page.oldest_uuid,
        limit: 20,
      });
      page = {
        ...older,
        entries: [...older.entries, ...page.entries],
      };
    } catch (e: any) {
      error = e.message;
    } finally {
      loadingMore = false;
    }
  }

  function handleSessionChange(e: Event) {
    selectedSessionId = (e.target as HTMLSelectElement).value;
    expandedBlocks = new Set();
    loadConversation(selectedSessionId);
  }

  async function sendPrompt() {
    const text = promptText.trim();
    if (!text || sending) return;
    sending = true;
    try {
      await sendToSession(sessionName, text);
      // Add to recall history (keep last 50)
      sentMessages = [...sentMessages.filter(m => m !== text), text].slice(-50);
      try {
        localStorage.setItem(RECALL_STORAGE_KEY, JSON.stringify(sentMessages));
      } catch { /* quota exceeded */ }
      promptText = "";
      recallIndex = -1;
      savedDraft = "";
      setTimeout(() => loadConversation(selectedSessionId), 1000);
    } catch (e: any) {
      error = `Send failed: ${e.message}`;
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
      return;
    }

    // Message recall: ArrowUp/ArrowDown when input is empty or in recall mode
    if (e.key === "ArrowUp" && (promptText === "" || recallIndex >= 0)) {
      e.preventDefault();
      if (recallIndex < 0) {
        savedDraft = promptText;
      }
      const newIdx = Math.min(recallIndex + 1, sentMessages.length - 1);
      if (newIdx >= 0 && newIdx < sentMessages.length) {
        recallIndex = newIdx;
        promptText = sentMessages[sentMessages.length - 1 - newIdx];
      }
      return;
    }
    if (e.key === "ArrowDown" && recallIndex >= 0) {
      e.preventDefault();
      recallIndex--;
      if (recallIndex < 0) {
        promptText = savedDraft;
      } else {
        promptText = sentMessages[sentMessages.length - 1 - recallIndex];
      }
      return;
    }
    if (e.key === "Escape" && recallIndex >= 0) {
      e.preventDefault();
      recallIndex = -1;
      promptText = savedDraft;
      return;
    }
  }

  /** Handle scroll — load more when scrolled to top */
  function handleScroll() {
    if (!scrollContainer || !page?.has_more) return;
    if (scrollContainer.scrollTop < 100) {
      loadMore();
    }
  }

  /** Insert template/library text into prompt */
  function insertPrompt(text: string) {
    promptText = promptText ? `${promptText} ${text}` : text;
    showLibrary = false;
  }

  /** Branch from an assistant message */
  async function handleBranch(entry: ConversationEntry) {
    if (!page?.session_id) return;
    try {
      const result = await branchSession(sessionName, page.session_id);
      if (result.ok && result.name) {
        error = null;
        // Could open new tab — for now just notify
        alert(`Branched session: ${result.name}`);
      }
    } catch (e: any) {
      error = `Branch failed: ${e.message}`;
    }
  }

  // Live conversation updates from SSE
  $effect(() => {
    const delta = store.conversationDeltas?.[sessionName];
    if (!delta || !page || delta.entries.length === 0) return;

    // Dedup: only add entries with UUIDs not already present
    const existingUuids = new Set(page.entries.map(e => e.uuid));
    const newEntries = delta.entries.filter(e => !existingUuids.has(e.uuid));
    if (newEntries.length === 0) return;

    page = {
      ...page,
      entries: [...page.entries, ...newEntries],
    };

    // Auto-scroll if near bottom
    requestAnimationFrame(() => {
      if (!scrollContainer) return;
      const distFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (distFromBottom < 100) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    });
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    // Load recall history from localStorage
    try {
      const stored = localStorage.getItem(RECALL_STORAGE_KEY);
      if (stored) sentMessages = JSON.parse(stored);
    } catch { /* ignore */ }
    loadConversation();
  });
</script>

<div class="conversation-viewer">
  <!-- Session picker -->
  {#if page?.session_list && page.session_list.length > 1}
    <div class="session-picker">
      <select value={selectedSessionId} onchange={handleSessionChange}>
        {#each page.session_list as session (session.id)}
          <option value={session.id}>
            {session.id.slice(0, 8)} — {new Date(session.last_modified).toLocaleDateString()}
          </option>
        {/each}
      </select>
    </div>
  {/if}

  <!-- Template pills row -->
  <div class="template-row">
    {#each TEMPLATE_PILLS as pill}
      <button class="template-pill" onclick={() => insertPrompt(pill)}>{pill}</button>
    {/each}
    <button
      class="template-pill library-btn"
      class:active={showLibrary}
      onclick={() => showLibrary = !showLibrary}
      title="Prompt Library"
    >&#x1F4D6;</button>
  </div>

  <!-- Prompt library dropdown -->
  {#if showLibrary}
    <div class="library-dropdown">
      <PromptLibrary compact onselect={insertPrompt} />
    </div>
  {/if}

  <!-- Message list -->
  <div class="messages" bind:this={scrollContainer} onscroll={handleScroll}>
    {#if loading}
      <div class="center-msg">Loading...</div>
    {:else if error}
      <div class="center-msg error">{error}</div>
    {:else if !page || page.entries.length === 0}
      <div class="center-msg">No conversation history</div>
    {:else}
      {#if loadingMore}
        <div class="load-more">Loading older messages...</div>
      {:else if page.has_more}
        <button class="load-more-btn" onclick={loadMore}>Load older</button>
      {/if}

      {#each page.entries as entry (entry.uuid)}
        {#if entry.type === "user"}
          <div class="msg msg-user">
            <div class="msg-content user-content">{entry.content}</div>
            <div class="msg-meta">{fmtTime(entry.timestamp)}</div>
          </div>
        {:else if entry.type === "assistant"}
          <div class="msg msg-assistant">
            {#if entry.blocks && entry.blocks.length > 0}
              {#each entry.blocks as block, idx (`${entry.uuid}-${idx}`)}
                {#if block.type === "text"}
                  <div class="block-text">{block.text}</div>
                {:else if block.type === "thinking"}
                  <button
                    class="block-thinking"
                    onclick={() => toggleBlock(`${entry.uuid}-${idx}`)}
                  >
                    <span class="block-label">thinking {expandedBlocks.has(`${entry.uuid}-${idx}`) ? "▾" : "▸"}</span>
                    {#if expandedBlocks.has(`${entry.uuid}-${idx}`)}
                      <pre class="thinking-text">{block.text}</pre>
                    {/if}
                  </button>
                {:else if block.type === "tool_use"}
                  <span class="block-tool-pill">{block.tool_name}</span>
                {:else if block.type === "tool_result"}
                  <button
                    class="block-tool-result"
                    onclick={() => toggleBlock(`${entry.uuid}-${idx}`)}
                  >
                    <span class="block-label">result {expandedBlocks.has(`${entry.uuid}-${idx}`) ? "▾" : "▸"}</span>
                    {#if expandedBlocks.has(`${entry.uuid}-${idx}`)}
                      <pre class="result-text">{block.tool_result}</pre>
                    {/if}
                  </button>
                {/if}
              {/each}
            {:else if entry.content}
              <div class="block-text">{entry.content}</div>
            {/if}
            <div class="msg-meta">
              {fmtTime(entry.timestamp)}
              {#if entry.model}
                <span class="model-badge">{entry.model.replace("claude-", "").slice(0, 10)}</span>
              {/if}
              {#if fmtCost(entry.usage)}
                <span class="cost-badge">{fmtCost(entry.usage)}</span>
              {/if}
              <button class="branch-btn" onclick={() => handleBranch(entry)} title="Branch from here">&#x2387;</button>
            </div>
          </div>
        {:else if entry.type === "tool_result"}
          <div class="msg msg-tool-result">
            {#each (entry.blocks ?? []) as block, idx (`${entry.uuid}-${idx}`)}
              {#if block.type === "tool_result"}
                <button
                  class="block-tool-result"
                  onclick={() => toggleBlock(`${entry.uuid}-${idx}`)}
                >
                  <span class="block-label">tool result {expandedBlocks.has(`${entry.uuid}-${idx}`) ? "▾" : "▸"}</span>
                  {#if expandedBlocks.has(`${entry.uuid}-${idx}`)}
                    <pre class="result-text">{block.tool_result}</pre>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Recall indicator -->
  {#if recallIndex >= 0}
    <div class="recall-hint">history {recallIndex + 1}/{sentMessages.length} (Esc to cancel)</div>
  {/if}

  <!-- Prompt input bar -->
  <div class="prompt-bar">
    {#if claudeStatus === "working"}
      <div class="prompt-disabled">Working...</div>
    {:else}
      <textarea
        class="prompt-input"
        placeholder="Send a message..."
        bind:value={promptText}
        onkeydown={handleKeydown}
        rows="1"
        disabled={sending}
      ></textarea>
      <button
        class="send-btn"
        onclick={sendPrompt}
        disabled={!promptText.trim() || sending}
        title="Send (Enter)"
      >&#x2191;</button>
    {/if}
  </div>
</div>

<style>
  .conversation-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /* Session picker */
  .session-picker {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .session-picker select {
    width: 100%;
    font-size: 0.6875rem;
    font-family: inherit;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.375rem 0.5rem;
  }

  /* Template pills */
  .template-row {
    display: flex;
    gap: 0.25rem;
    padding: 0.375rem 0.75rem;
    overflow-x: auto;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }
  .template-row::-webkit-scrollbar { display: none; }
  .template-pill {
    flex-shrink: 0;
    font-size: 0.5625rem;
    font-family: inherit;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.1875rem 0.5rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .template-pill:hover {
    background: rgba(88, 166, 255, 0.1);
    color: var(--accent-blue);
    border-color: var(--accent-blue);
  }
  .library-btn { font-size: 0.6875rem; padding: 0.125rem 0.375rem; }
  .library-btn.active {
    background: rgba(88, 166, 255, 0.15);
    border-color: var(--accent-blue);
    color: var(--accent-blue);
  }

  /* Library dropdown */
  .library-dropdown {
    max-height: 240px;
    overflow-y: auto;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  /* Message list */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  .center-msg {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.75rem;
    padding: 2rem 0;
  }
  .center-msg.error { color: var(--accent-red); }
  .load-more {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.625rem;
    padding: 0.25rem;
  }
  .load-more-btn {
    align-self: center;
    font-size: 0.625rem;
    color: var(--accent-blue);
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.25rem 0.75rem;
    cursor: pointer;
    font-family: inherit;
  }
  .load-more-btn:hover { background: var(--bg-tertiary); }

  /* Messages */
  .msg { max-width: 90%; }
  .msg-user {
    align-self: flex-end;
  }
  .msg-assistant, .msg-tool-result {
    align-self: flex-start;
  }
  .msg-tool-result {
    max-width: 90%;
    padding: 0.125rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .user-content {
    background: rgba(88, 166, 255, 0.12);
    color: var(--text-primary);
    border-radius: 8px 8px 2px 8px;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .msg-assistant {
    background: var(--bg-tertiary);
    border-radius: 8px 8px 8px 2px;
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .msg-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.5625rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }
  .model-badge, .cost-badge {
    font-size: 0.5rem;
    padding: 0.0625rem 0.25rem;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
  }
  .cost-badge { color: var(--accent-green); }

  /* Branch button */
  .branch-btn {
    font-size: 0.625rem;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 0.125rem;
    opacity: 0.4;
    font-family: inherit;
  }
  .branch-btn:hover { opacity: 1; color: var(--accent-purple, #a78bfa); }

  /* Content blocks */
  .block-text {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .block-thinking {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    color: var(--text-muted);
    padding: 0.25rem 0;
  }
  .block-label {
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .thinking-text {
    font-size: 0.625rem;
    line-height: 1.3;
    color: var(--text-muted);
    margin-top: 0.25rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    max-height: 8rem;
    overflow-y: auto;
  }
  .block-tool-pill {
    display: inline-block;
    font-size: 0.5625rem;
    font-weight: 500;
    color: var(--accent-purple, #a78bfa);
    background: rgba(167, 139, 250, 0.1);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: "SF Mono", "Cascadia Code", monospace;
  }
  .block-tool-result {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    color: var(--text-muted);
    padding: 0.125rem 0;
  }
  .result-text {
    font-size: 0.5625rem;
    line-height: 1.3;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.375rem;
    margin-top: 0.25rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 10rem;
    overflow-y: auto;
    font-family: "SF Mono", "Cascadia Code", monospace;
  }

  /* Recall hint */
  .recall-hint {
    font-size: 0.5625rem;
    color: var(--text-muted);
    padding: 0.125rem 0.75rem;
    background: var(--bg-tertiary);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  /* Prompt bar */
  .prompt-bar {
    flex-shrink: 0;
    display: flex;
    align-items: flex-end;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .prompt-disabled {
    flex: 1;
    font-size: 0.6875rem;
    color: var(--text-muted);
    padding: 0.375rem 0;
    font-style: italic;
  }
  .prompt-input {
    flex: 1;
    font-size: 0.75rem;
    font-family: inherit;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.375rem 0.5rem;
    resize: none;
    min-height: 1.75rem;
    max-height: 5rem;
    line-height: 1.3;
    field-sizing: content;
  }
  .prompt-input:focus { outline: none; border-color: var(--accent-blue); }
  .prompt-input::placeholder { color: var(--text-muted); }
  .send-btn {
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-blue);
    color: var(--bg-primary);
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .send-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .send-btn:not(:disabled):hover { opacity: 0.85; }

  /* Mobile */
  @media (max-width: 768px) {
    .messages { padding: 0.5rem; gap: 0.5rem; }
    .msg { max-width: 95%; }
    .user-content, .block-text { font-size: 0.6875rem; }
    .prompt-input { font-size: 0.6875rem; }
    .template-pill { font-size: 0.5rem; }
  }
</style>
