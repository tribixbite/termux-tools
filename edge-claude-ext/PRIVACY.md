# Privacy Policy — Claude Code Browser Bridge

**Last updated:** 2026-02-27

## Overview

Claude Code Browser Bridge is a browser extension that connects the Claude Code CLI to Microsoft Edge on Android via a local WebSocket connection. It does not collect, store, or transmit any user data to external servers.

## Data Collection

**This extension collects no personal data.**

- No analytics or telemetry
- No cookies or tracking
- No user accounts or authentication with external services
- No data sent to any server other than `127.0.0.1` (localhost)

## How It Works

The extension communicates exclusively over a local WebSocket connection (`ws://127.0.0.1:18963`) with a bridge process running on the same device in Termux. All data stays on your device.

When Claude Code requests browser actions (reading a page, taking a screenshot, clicking an element), the extension:
1. Receives the request from the local bridge via WebSocket
2. Executes the action in the browser
3. Returns the result to the local bridge via WebSocket

No data leaves your device through this extension.

## Permissions

- **activeTab**: Required to interact with the current tab's content
- **scripting**: Required to inject content scripts for page interaction
- **tabs**: Required to list and manage browser tabs
- **webRequest**: Required to monitor network requests when requested by Claude Code
- **host_permissions (`<all_urls>`)**: Required so Claude Code can interact with any web page you navigate to

## Third-Party Services

This extension does not integrate with any third-party services. It only communicates with a locally running bridge process on `127.0.0.1`.

## Open Source

The full source code is available at: https://github.com/tribixbite/termux-tools/tree/main/edge-claude-ext

## Contact

For questions or concerns, open an issue at: https://github.com/tribixbite/termux-tools/issues
