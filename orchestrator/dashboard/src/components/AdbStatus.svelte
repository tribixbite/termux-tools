<script lang="ts">
  import { fetchAdbDevices, adbConnect, adbDisconnect } from "../lib/api";
  import type { AdbDevice } from "../lib/types";

  let devices: AdbDevice[] = $state([]);
  let connecting = $state(false);
  let disconnecting = $state(false);
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
    try {
      const result = await adbConnect();
      if (!result.ok) error = result.message ?? "Connection failed";
      // Refresh after attempt (the script may take a moment)
      setTimeout(refresh, 2000);
    } catch {
      error = "Connect request failed";
    } finally {
      connecting = false;
    }
  }

  async function handleDisconnect() {
    disconnecting = true;
    try {
      await adbDisconnect();
      setTimeout(refresh, 1000);
    } catch {
      error = "Disconnect failed";
    } finally {
      disconnecting = false;
    }
  }

  // Initial fetch + poll every 15s
  if (typeof window !== "undefined") {
    refresh();
    setInterval(refresh, 15_000);
  }

  /** Extract short label from serial (e.g. "192.168.1.100:42555" → "192...100:42555") */
  function shortSerial(serial: string): string {
    if (serial.length <= 20) return serial;
    const parts = serial.split(":");
    return parts[0].slice(0, 7) + "..." + parts[0].slice(-3) + (parts[1] ? ":" + parts[1] : "");
  }

  const connected = $derived(devices.some((d) => d.state === "device"));
</script>

<div class="card compact-card">
  <div class="card-header">
    <span class="header-left">
      <span class="dot" class:dot-green={connected} class:dot-dim={!connected}></span>
      <span class="label">ADB</span>
    </span>

    {#if connected}
      <span class="device-info">
        {#each devices.filter(d => d.state === "device") as dev}
          <span class="serial" title={dev.serial}>{shortSerial(dev.serial)}</span>
        {/each}
      </span>
      <button class="btn-icon danger" onclick={handleDisconnect} disabled={disconnecting} title="Disconnect ADB">
        {disconnecting ? "..." : "⊘"}
      </button>
    {:else}
      <span class="offline-text">{connecting ? "scanning..." : "offline"}</span>
      <button class="btn-icon primary" onclick={handleConnect} disabled={connecting} title="Connect ADB (wireless scan)">
        {connecting ? "..." : "↻"}
      </button>
    {/if}
  </div>

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
  .device-info {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .serial {
    font-size: 0.625rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .offline-text {
    flex: 1;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }
  .error-bar {
    padding: 0.25rem 0.75rem 0.5rem;
    font-size: 0.625rem;
    color: var(--accent-red);
  }
</style>
