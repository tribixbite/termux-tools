<script lang="ts">
  import ConversationViewer from "./ConversationViewer.svelte";

  interface Props {
    sessionName: string;
    onclose: () => void;
  }
  let { sessionName, onclose }: Props = $props();

  /** Close on Escape key */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }

  /** Close on backdrop click */
  function handleBackdrop(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("drawer-backdrop")) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="drawer-backdrop" onclick={handleBackdrop}>
  <div class="drawer-panel">
    <div class="drawer-header">
      <h3 class="drawer-title">{sessionName}</h3>
      <button class="drawer-close" onclick={onclose} title="Close (Esc)">&times;</button>
    </div>
    <div class="drawer-body">
      <ConversationViewer {sessionName} />
    </div>
  </div>
</div>

<style>
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    display: flex;
    justify-content: flex-end;
  }
  .drawer-panel {
    width: min(420px, 90vw);
    height: 100%;
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    animation: slide-in 0.2s ease-out;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
  }
  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .drawer-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .drawer-close {
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.125rem;
    cursor: pointer;
    border-radius: 4px;
    font-family: inherit;
  }
  .drawer-close:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  .drawer-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Mobile: full width */
  @media (max-width: 480px) {
    .drawer-panel { width: 100vw; }
  }
</style>
