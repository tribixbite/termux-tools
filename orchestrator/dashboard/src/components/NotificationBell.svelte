<script lang="ts">
  /**
   * NotificationBell — header bell icon with unread badge and dropdown panel.
   * Loads initial data via REST, subscribes to SSE "notification" events
   * through the shared SseClient for real-time updates.
   */
  import { fetchNotifications } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import type { NotificationRecord, NotificationType } from "../lib/types";

  const STORAGE_KEY = "lastSeenNotification";
  const MAX_SHOWN = 20;

  /** Notification list, newest first */
  let notifications: NotificationRecord[] = $state([]);
  /** Whether the dropdown is currently open */
  let open = $state(false);
  /** Timestamp string of the last notification the user has seen */
  let lastSeen: string = $state(
    typeof window !== "undefined"
      ? localStorage.getItem(STORAGE_KEY) ?? ""
      : "",
  );

  /** Count of notifications newer than lastSeen */
  let unreadCount = $derived(
    lastSeen
      ? notifications.filter((n) => n.timestamp > lastSeen).length
      : notifications.length,
  );

  /** Resolve a notification type to a colored dot CSS class */
  function dotClass(type: NotificationType): string {
    switch (type) {
      case "session_start":
        return "dot-green";
      case "session_stop":
      case "session_error":
        return "dot-red";
      case "battery_low":
      case "memory_pressure":
        return "dot-yellow";
      case "daemon_start":
      case "daemon_stop":
        return "dot-blue";
      default:
        return "dot-blue";
    }
  }

  /** Format a timestamp into a human-readable relative string */
  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  /** Truncate text to a max length with ellipsis */
  function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "\u2026";
  }

  /** Toggle dropdown open/close; on open, mark all as seen */
  function toggle(): void {
    open = !open;
    if (open && notifications.length > 0) {
      // Mark everything as seen by recording the newest timestamp
      lastSeen = notifications[0].timestamp;
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, lastSeen);
      }
    }
  }

  /** Close the dropdown when clicking outside */
  function handleClickOutside(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest(".notification-bell")) {
      open = false;
    }
  }

  // -- Watch shared store for new notifications pushed via SSE ----------------

  $effect(() => {
    const latest = store.lastNotification;
    if (!latest) return;
    // Avoid duplicates — check if we already have this notification
    if (notifications.some((n) => n.id === latest.id)) return;
    notifications = [latest, ...notifications].slice(0, MAX_SHOWN);
  });

  // -- Lifecycle: initial fetch + outside-click handler ----------------------

  $effect(() => {
    if (typeof window === "undefined") return;

    // Register global click listener for outside-click dismissal
    document.addEventListener("click", handleClickOutside);

    // Load initial notifications from REST endpoint
    fetchNotifications({ limit: MAX_SHOWN })
      .then((records) => {
        notifications = records;
      })
      .catch(() => {
        // Silently ignore — component will show empty state
      });

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  });
</script>

<div class="notification-bell">
  <button
    class="bell-btn"
    onclick={toggle}
    title="Notifications"
    aria-label="Notifications"
  >
    <!-- Bell icon (SVG) -->
    <svg
      class="bell-icon"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z" />
    </svg>
    {#if unreadCount > 0}
      <span class="unread-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
    {/if}
  </button>

  {#if open}
    <div class="dropdown">
      <div class="dropdown-header">Notifications</div>
      {#if notifications.length === 0}
        <div class="empty-state">No notifications yet</div>
      {:else}
        <div class="dropdown-list">
          {#each notifications as notif (notif.id)}
            <div class="notif-item">
              <span class="notif-dot {dotClass(notif.type)}"></span>
              <div class="notif-body">
                <div class="notif-title">{truncate(notif.title, 48)}</div>
                <div class="notif-content">{truncate(notif.content, 64)}</div>
                <div class="notif-time">{relativeTime(notif.timestamp)}</div>
              </div>
            </div>
          {/each}
        </div>
        <div class="dropdown-footer">
          <!-- Placeholder for future "view all" page link -->
          <span class="view-all">View all</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .notification-bell {
    position: relative;
    display: inline-flex;
    align-items: center;
    /* Contain the absolutely-positioned .unread-badge which extends
       beyond the button box via transform — prevents 6px horizontal
       overflow on the header's flex container. */
    overflow: visible;
    /* Reserve space so the badge doesn't push parent's scrollWidth */
    margin-right: 6px;
  }

  .bell-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.375rem;
    border-radius: 6px;
    transition: background 0.15s, color 0.15s;
  }
  .bell-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .bell-icon {
    display: block;
  }

  /* Red unread count badge, top-right of the bell button */
  .unread-badge {
    position: absolute;
    top: 0;
    right: 0;
    transform: translate(40%, -30%);
    min-width: 1rem;
    height: 1rem;
    padding: 0 0.25rem;
    border-radius: 9999px;
    background: var(--accent-red);
    color: #fff;
    font-size: 0.5625rem;
    font-weight: 700;
    line-height: 1rem;
    text-align: center;
    pointer-events: none;
  }

  /* Dropdown panel */
  .dropdown {
    position: absolute;
    top: calc(100% + 0.375rem);
    right: 0;
    width: 280px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 50;
    overflow: hidden;
  }

  .dropdown-header {
    padding: 0.5rem 0.75rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dropdown-list {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .empty-state {
    padding: 1.5rem 0.75rem;
    text-align: center;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  /* Individual notification item */
  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
  }
  .notif-item:last-child {
    border-bottom: none;
  }
  .notif-item:hover {
    background: var(--bg-tertiary);
  }

  /* Colored type indicator dot */
  .notif-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 0.25rem;
  }
  .dot-green  { background: var(--accent-green); }
  .dot-red    { background: var(--accent-red); }
  .dot-yellow { background: var(--accent-yellow); }
  .dot-blue   { background: var(--accent-blue); }

  .notif-body {
    min-width: 0;
    flex: 1;
  }

  .notif-title {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notif-content {
    font-size: 0.625rem;
    color: var(--text-secondary);
    margin-top: 0.125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notif-time {
    font-size: 0.5625rem;
    color: var(--text-muted);
    margin-top: 0.125rem;
  }

  .dropdown-footer {
    padding: 0.375rem 0.75rem;
    border-top: 1px solid var(--border);
    text-align: center;
    flex-shrink: 0;
  }

  .view-all {
    font-size: 0.625rem;
    color: var(--accent-blue);
    cursor: pointer;
  }
  .view-all:hover {
    text-decoration: underline;
  }

  @media (max-width: 768px) {
    .dropdown {
      width: 260px;
      max-height: 360px;
    }
    .notif-title { font-size: 0.625rem; }
    .notif-content { font-size: 0.5625rem; }
    .notif-time { font-size: 0.5rem; }
  }
</style>
