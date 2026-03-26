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
      id: "core",
      label: "Core",
      commands: [
        { cmd: "tmx boot", desc: "Start daemon + boot all sessions in dependency order" },
        { cmd: "tmx status", desc: "Show daemon uptime, sessions, memory, battery" },
        { cmd: "tmx health", desc: "Run health checks on all sessions now" },
        { cmd: "tmx config", desc: "Validate and display parsed tmx.toml" },
        { cmd: "tmx upgrade", desc: "Rebuild, shutdown, and let watchdog auto-restart" },
        { cmd: "tmx shutdown", desc: "Gracefully stop daemon (sessions orphaned)" },
      ],
    },
    {
      id: "sessions",
      label: "Sessions",
      commands: [
        { cmd: "tmx go <name>", desc: "Send 'go' to a Claude session waiting for input" },
        { cmd: "tmx open <path>", desc: "Open a new Claude session dynamically" },
        { cmd: "tmx close <name>", desc: "Stop and remove a dynamic session" },
        { cmd: "tmx start <name>", desc: "Start a stopped session (fuzzy-matches names)" },
        { cmd: "tmx stop <name>", desc: "Stop a running session" },
        { cmd: "tmx restart <name>", desc: "Stop + start a session" },
      ],
    },
    {
      id: "monitoring",
      label: "Monitoring",
      commands: [
        { cmd: "tmx memory", desc: "System memory + per-session RSS + pressure level" },
        { cmd: "tmx tabs", desc: "Open Termux tabs for all running tmux sessions" },
        { cmd: "tmx recent", desc: "List recent Claude projects from history.jsonl" },
        { cmd: "tmx send <n> <text>", desc: "Send raw text to a session's tmux pane" },
      ],
    },
    {
      id: "api",
      label: "REST API",
      commands: [
        { cmd: "GET /api/status", desc: "Full daemon state (sessions, memory, battery)" },
        { cmd: "GET /api/events", desc: "SSE stream for real-time state updates" },
        { cmd: "POST /api/start/:name", desc: "Start a session via HTTP" },
        { cmd: "POST /api/stop/:name", desc: "Stop a session via HTTP" },
        { cmd: "GET /api/recent", desc: "Recent Claude projects from history" },
        { cmd: "POST /api/open/:name", desc: "Open/register a session via HTTP" },
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
      Dashboard at <code class="text-terminal-amber">http://localhost:18970</code> &mdash; REST API on the same port
    </p>
  </div>
</section>
