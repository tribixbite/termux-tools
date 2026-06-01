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
      id: "setup",
      label: "Setup",
      commands: [
        { cmd: "./claude-edge-setup.sh", desc: "Interactive installer menu" },
        { cmd: "./claude-edge-setup.sh --all", desc: "Run every install step non-interactively" },
        { cmd: "install/modules/bun.sh", desc: "Install Bun via bun-on-termux" },
        { cmd: "install/modules/claude-code.sh", desc: "Install + byte-preserving patch Claude Code" },
        { cmd: "install/modules/adb.sh", desc: "Pair and connect ADB over WiFi" },
        { cmd: "install/modules/extension.sh", desc: "Build CRX + sideload into Edge" },
      ],
    },
    {
      id: "edge",
      label: "Edge Build",
      commands: [
        { cmd: "edge-fix/build.sh <edge.apks>", desc: "Unpack, patch, sign, zipalign the APK" },
        { cmd: "patch-manifest.py", desc: "Drop 56+ tracking permissions from the manifest" },
        { cmd: "replace-urls.list", desc: "Rewrite telemetry endpoints → 127.0.0.1" },
        { cmd: "edge-fix/config/", desc: "Permission + URL strip lists" },
        { cmd: "gh release download", desc: "Pull prebuilt smali/baksmali tooling" },
      ],
    },
    {
      id: "bridge",
      label: "CFC Bridge",
      commands: [
        { cmd: "npx claude-chrome-android", desc: "Start the WebSocket bridge server" },
        { cmd: "npx claude-chrome-android --mcp", desc: "MCP relay mode (spawned by Claude Code)" },
        { cmd: "npx claude-chrome-android --setup", desc: "Register MCP server + url-opener" },
        { cmd: "npx claude-chrome-android --stop", desc: "Stop a running bridge" },
        { cmd: "npx claude-chrome-android --version", desc: "Print bridge version" },
      ],
    },
    {
      id: "termux",
      label: "Termux Tooling",
      commands: [
        { cmd: "pip-tool-install <pkg>", desc: "Install C-ext Python CLIs into an isolated venv" },
        { cmd: "x86-on-termux/install-sysroot.sh", desc: "Run x86_64 binaries via qemu user emulation" },
        { cmd: "scripts/install-ghostty-termux.sh", desc: "Source-build the GTK4 Ghostty terminal" },
        { cmd: "scripts/migrate-termux.sh", desc: "Migrate a Termux environment to a new device" },
        { cmd: "android-secure-prefs-dump <pkg>", desc: "Decrypt EncryptedSharedPreferences (root)" },
      ],
    },
  ];

  let activeTab = $state("setup");
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
      Full reference in <code class="text-terminal-amber">docs/</code> &mdash; every module is self-contained and re-runnable
    </p>
  </div>
</section>
