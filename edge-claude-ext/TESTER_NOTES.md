Browser-side component of a two-part system. Connects to a local WebSocket server on the same device (127.0.0.1:18963). No external servers contacted.

FULL TEST (requires Node.js 18+):
1. Install Node.js (nodejs.org)
2. Run: npx claude-chrome-android@latest
   Starts WebSocket server on localhost:18963 (~214KB download)
3. Install extension, open popup — status changes to "Connected"
4. Dashboard shows live stats (requests, uptime, tabs)
5. Tests tab → "Run All" runs built-in suite (WS, health, tabs, nav, screenshots)

WITHOUT BRIDGE:
1. Install extension, open popup — shows "Disconnected" (expected)
2. All tabs (Dashboard, Tests, Logs, Tabs) render and navigate
3. No console errors except expected WebSocket connection refusal

PERMISSIONS:
- tabs: read/navigate tabs on behalf of CLI
- activeTab: capture screenshots, read page content
- scripting: inject content scripts for page accessibility trees
- host_permissions (http://127.0.0.1/*): localhost bridge only, never external

No analytics, telemetry, or user data collected. All communication stays on localhost. Source: https://github.com/tribixbite/termux-tools
