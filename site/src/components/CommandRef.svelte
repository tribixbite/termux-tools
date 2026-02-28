<script lang="ts">
  /**
   * Tabbed command reference — Svelte 5 island.
   * Hydrated with client:idle since it's below the fold.
   */

  interface Command {
    cmd: string;
    desc: string;
  }

  interface Tab {
    id: string;
    label: string;
    commands: Command[];
  }

  const tabs: Tab[] = [
    {
      id: "switching",
      label: "Switching",
      commands: [
        { cmd: "tm <search>", desc: "Fuzzy-search switch to session/window" },
        { cmd: "tmgo <search>", desc: "Send 'go' to session without switching" },
        { cmd: "tmb0-5", desc: "Jump to window 0–5" },
        { cmd: "tn / tp", desc: "Next / previous window" },
        { cmd: "tl", desc: "Last (most recent) window" },
        { cmd: "tw", desc: "Interactive window picker" },
      ],
    },
    {
      id: "management",
      label: "Sessions",
      commands: [
        { cmd: "tmbs", desc: "List all tmux sessions" },
        { cmd: "tmbi", desc: "Show session info" },
        { cmd: "tmbr", desc: "Restart all sessions" },
        { cmd: "tmbk", desc: "Kill boot session" },
        { cmd: "tmba <repo>", desc: "Add repo (temporary)" },
        { cmd: "tmbp <repo>", desc: "Add repo (permanent)" },
      ],
    },
    {
      id: "panes",
      label: "Panes",
      commands: [
        { cmd: "tsh", desc: "Split horizontally (left/right)" },
        { cmd: "tsv", desc: "Split vertically (top/bottom)" },
        { cmd: "tz", desc: "Zoom / unzoom pane" },
        { cmd: "tkp", desc: "Kill current pane" },
        { cmd: "t1-4", desc: "Select pane by number" },
        { cmd: "tu / tdown", desc: "Navigate up / down" },
      ],
    },
    {
      id: "automation",
      label: "Automation",
      commands: [
        { cmd: "tsend <text>", desc: "Send text to current window" },
        { cmd: "tsendw N <text>", desc: "Send text to window N" },
        { cmd: "td", desc: "Detach from session" },
        { cmd: "tnw", desc: "New window" },
        { cmd: "trn <name>", desc: "Rename window" },
        { cmd: "tk", desc: "Kill current window" },
      ],
    },
  ];

  let activeTab = $state("switching");
  let visibleCommands = $derived(
    tabs.find((t) => t.id === activeTab)?.commands ?? []
  );
</script>

<section id="commands" class="px-4 py-16 sm:px-6 lg:px-8">
  <div class="mx-auto max-w-3xl">
    <h2 class="mb-8 font-[family-name:var(--font-mono)] text-2xl font-bold text-terminal-bright sm:text-3xl">
      <span class="text-terminal-green">#</span> Command Reference
    </h2>

    <!-- Tab buttons -->
    <div class="mb-6 flex flex-wrap gap-2">
      {#each tabs as tab}
        <button
          onclick={() => (activeTab = tab.id)}
          class="rounded-md px-3 py-1.5 font-[family-name:var(--font-mono)] text-xs transition-colors
            {activeTab === tab.id
              ? 'bg-terminal-green/15 text-terminal-green border border-terminal-green/30'
              : 'border border-terminal-border text-terminal-dim hover:border-terminal-dim hover:text-terminal-text'}"
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Command table -->
    <div class="overflow-hidden rounded-lg border border-terminal-border bg-terminal-surface">
      <table class="w-full">
        <tbody>
          {#each visibleCommands as { cmd, desc }}
            <tr class="border-b border-terminal-border/50 last:border-0">
              <td class="whitespace-nowrap px-4 py-2.5 font-[family-name:var(--font-mono)] text-sm text-terminal-green">
                {cmd}
              </td>
              <td class="px-4 py-2.5 text-sm text-terminal-dim">
                {desc}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="mt-4 text-center font-[family-name:var(--font-mono)] text-xs text-terminal-dim">
      No more <code class="text-terminal-amber">Ctrl+b</code> — all commands are direct shell aliases
    </p>
  </div>
</section>
