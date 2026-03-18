<script lang="ts">
  import { fetchAdbDevices, adbConnect, adbDisconnectDevice } from "../lib/api";
  import type { AdbDevice } from "../lib/types";

  let devices: AdbDevice[] = $state([]);
  let connecting = $state(false);
  /** Track which serials are currently being disconnected */
  let disconnectingSerials: Set<string> = $state(new Set());
  let error: string | null = $state(null);

  async function refresh() {
    try {
      devices = await fetchAdbDevices();
      error = null;
    } catch {
      error = "Failed to check ADB";
    }
  }

  async function handleConnect() {
    connecting = true;
    error = null;
    const scanTimeout = setTimeout(() => {
      connecting = false;
      error = "Connection scan timed out";
    }, 30_000);
    try {
      const result = await adbConnect();
      clearTimeout(scanTimeout);
      if (!result.ok) error = result.message ?? "Connection failed";
      setTimeout(refresh, 2000);
    } catch {
      clearTimeout(scanTimeout);
      error = "Connect request failed";
    } finally {
      connecting = false;
    }
  }

  async function handleDisconnectDevice(serial: string) {
    disconnectingSerials = new Set([...disconnectingSerials, serial]);
    try {
      const result = await adbDisconnectDevice(serial);
      if (!result.ok) error = result.message ?? "Disconnect failed";
      setTimeout(refresh, 1000);
    } catch {
      error = "Disconnect failed";
    } finally {
      const next = new Set(disconnectingSerials);
      next.delete(serial);
      disconnectingSerials = next;
    }
  }

  // Initial fetch + poll every 15s — cleaned up on component destroy
  $effect(() => {
    if (typeof window === "undefined") return;
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  });

  /** Extract short label from serial (e.g. "192.168.1.100:42555" → ":42555") */
  function shortSerial(serial: string): string {
    if (serial.length <= 20) return serial;
    const parts = serial.split(":");
    return parts[0].slice(0, 7) + "..." + parts[0].slice(-3) + (parts[1] ? ":" + parts[1] : "");
  }

  const onlineDevices = $derived(devices.filter((d) => d.state === "device"));
  const offlineDevices = $derived(devices.filter((d) => d.state !== "device"));
  const connected = $derived(onlineDevices.length > 0);
</script>

<div class="card compact-card">
  <div class="card-header">
    <span class="header-left">
      <span class="dot" class:dot-green={connected} class:dot-dim={!connected}></span>
      <span class="label">ADB</span>
    </span>

    {#if connected}
      <span class="device-list">
        {#each onlineDevices as dev}
          <span class="device-chip" title={dev.serial}>
            <span class="serial">{shortSerial(dev.serial)}</span>
            <button
              class="btn-chip danger"
              onclick={() => handleDisconnectDevice(dev.serial)}
              disabled={disconnectingSerials.has(dev.serial)}
              title="Disconnect {dev.serial}"
            >
              {disconnectingSerials.has(dev.serial) ? "…" : "×"}
            </button>
          </span>
        {/each}
      </span>
      <!-- Connect button to add more devices -->
      <button class="btn-icon primary" onclick={handleConnect} disabled={connecting} title="Connect another device">
        {connecting ? "…" : "+"}
      </button>
    {:else}
      <span class="offline-text">{connecting ? "scanning…" : "offline"}</span>
      <button class="btn-icon primary" onclick={handleConnect} disabled={connecting} title="Connect ADB (wireless scan)">
        {connecting ? "…" : "↻"}
      </button>
    {/if}
  </div>

  {#if offlineDevices.length > 0}
    <div class="stale-bar">
      {#each offlineDevices as dev}
        <span class="stale-chip" title="{dev.serial} ({dev.state})">
          <span class="stale-serial">{shortSerial(dev.serial)}</span>
          <span class="stale-state">{dev.state}</span>
          <button
            class="btn-chip dim"
            onclick={() => handleDisconnectDevice(dev.serial)}
            disabled={disconnectingSerials.has(dev.serial)}
            title="Remove stale device"
          >
            {disconnectingSerials.has(dev.serial) ? "…" : "×"}
          </button>
        </span>
      {/each}
    </div>
  {/if}

  {#if error}
    <div class="error-bar">{error}</div>
  {/if}
</div>

<style>
  .compact-card { padding: 0; overflow: hidden; }
  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }
  .label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .device-list {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .device-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--surface-elevated, rgba(255,255,255,0.05));
    flex-shrink: 0;
  }
  .serial {
    font-size: 0.625rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .btn-chip {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.625rem;
    line-height: 1;
    padding: 0.0625rem 0.1875rem;
    border-radius: 0.125rem;
    transition: background 0.15s, color 0.15s;
  }
  .btn-chip.danger {
    color: var(--text-muted);
  }
  .btn-chip.danger:hover {
    color: var(--accent-red);
    background: rgba(255, 80, 80, 0.1);
  }
  .btn-chip.dim {
    color: var(--text-muted);
  }
  .btn-chip.dim:hover {
    color: var(--accent-amber);
    background: rgba(255, 180, 50, 0.1);
  }
  .btn-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .offline-text {
    flex: 1;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }
  .stale-bar {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem 0.375rem;
    border-top: 1px solid var(--border-dim, rgba(255,255,255,0.06));
  }
  .stale-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.5625rem;
  }
  .stale-serial {
    color: var(--text-muted);
  }
  .stale-state {
    color: var(--accent-amber);
    font-style: italic;
  }
  .error-bar {
    padding: 0.25rem 0.75rem 0.5rem;
    font-size: 0.625rem;
    color: var(--accent-red);
  }
</style>
