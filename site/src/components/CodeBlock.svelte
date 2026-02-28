<script lang="ts">
  /** Interactive code block with copy-to-clipboard. Svelte 5 island. */

  interface Props {
    code: string;
    lang?: string;
    title?: string;
  }

  let { code, lang = "bash", title = "" }: Props = $props();

  let copyState: "idle" | "copied" = $state("idle");
  let buttonText = $derived(copyState === "copied" ? "Copied!" : "Copy");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      copyState = "copied";
      setTimeout(() => (copyState = "idle"), 2000);
    } catch {
      // Fallback for older browsers / non-HTTPS
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      copyState = "copied";
      setTimeout(() => (copyState = "idle"), 2000);
    }
  }
</script>

<div class="group relative overflow-hidden rounded-lg border border-terminal-border bg-terminal-surface">
  {#if title}
    <div class="flex items-center justify-between border-b border-terminal-border px-4 py-2">
      <span class="font-[family-name:var(--font-mono)] text-xs text-terminal-dim">{title}</span>
      <button
        onclick={handleCopy}
        class="rounded px-2 py-1 font-[family-name:var(--font-mono)] text-xs transition-colors
          {copyState === 'copied'
            ? 'bg-terminal-green/20 text-terminal-green'
            : 'text-terminal-dim hover:bg-terminal-border hover:text-terminal-text'}"
      >
        {buttonText}
      </button>
    </div>
  {:else}
    <button
      onclick={handleCopy}
      class="absolute right-2 top-2 rounded px-2 py-1 font-[family-name:var(--font-mono)] text-xs opacity-0 transition-all group-hover:opacity-100
        {copyState === 'copied'
          ? 'bg-terminal-green/20 text-terminal-green opacity-100'
          : 'text-terminal-dim hover:bg-terminal-border hover:text-terminal-text'}"
    >
      {buttonText}
    </button>
  {/if}
  <pre class="overflow-x-auto p-4 font-[family-name:var(--font-mono)] text-sm leading-relaxed"><code class="language-{lang} text-terminal-text">{code}</code></pre>
</div>
