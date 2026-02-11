# X11 Playwright Testing Skill

Use this skill for testing web applications using Playwright via Termux X11 on Android. Covers browser automation, screenshots, UI testing, and MCP server integration.

## Prerequisites

```bash
# Required packages
pkg install termux-x11-nightly chromium x11-repo

# Playwright (Node.js)
npm install -g mcp-server-playwright
npm install playwright-core

# Python alternative
pip install playwright
```

## X11 Environment Setup

### Start X11 display

```bash
# Start termux-x11 in a tmux session
tmux new-session -d -s termux-x11
tmux send-keys -t termux-x11 "termux-x11 :1 -legacy-drawing -xstartup 'xfce4-session'" Enter

# Verify display is running
export DISPLAY=:1
xdpyinfo | head -5
```

### Environment variables

```bash
# Required for all Playwright operations
export DISPLAY=:1

# Android platform workaround — Playwright skips browser install on Android
# Point to system chromium instead
export PLAYWRIGHT_BROWSERS_PATH=/data/data/com.termux/files/usr/lib
```

## Playwright MCP Server

### Start the MCP server

```bash
# In a tmux session with DISPLAY set
tmux new-session -d -s playwright
tmux send-keys -t playwright "sleep 3 && DISPLAY=:1 mcp-server-playwright --port 8989 --browser chromium --executable-path /data/data/com.termux/files/usr/bin/chromium-browser" Enter
```

### Claude Code MCP config

Add to `~/.claude/settings.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "mcp-server-playwright",
      "args": ["--browser", "chromium", "--executable-path", "/data/data/com.termux/files/usr/bin/chromium-browser"],
      "env": {
        "DISPLAY": ":1"
      }
    }
  }
}
```

## Browser Launch Patterns

### Node.js / playwright-core

```javascript
const { chromium } = require('playwright-core');

const browser = await chromium.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: false,  // requires X11 display
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox'
  ]
});

const page = await browser.newPage();
await page.goto('http://localhost:3000');
```

### Python

```python
from playwright.sync_api import sync_playwright
import os

os.environ['DISPLAY'] = ':1'

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path='/data/data/com.termux/files/usr/bin/chromium-browser',
        headless=False,
        args=[
            '--no-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage'
        ]
    )
    page = browser.new_page()
    page.goto('http://localhost:3000')
```

## Common Test Patterns

### Screenshot capture

```javascript
// Full page
await page.screenshot({ path: 'fullpage.png', fullPage: true });

// Element
await page.locator('#my-element').screenshot({ path: 'element.png' });

// Viewport only
await page.screenshot({ path: 'viewport.png' });
```

### Navigate and interact

```javascript
await page.goto('http://localhost:3000');
await page.waitForLoadState('networkidle');

// Click
await page.click('button#submit');

// Fill form
await page.fill('input[name="email"]', 'test@example.com');
await page.fill('input[name="password"]', 'password123');
await page.click('button[type="submit"]');

// Wait for navigation
await page.waitForURL('**/dashboard');
```

### Assert content

```javascript
// Text content
await expect(page.locator('h1')).toHaveText('Dashboard');

// Visibility
await expect(page.locator('.modal')).toBeVisible();

// Count elements
await expect(page.locator('.list-item')).toHaveCount(5);

// URL
expect(page.url()).toContain('/dashboard');
```

### Test responsive viewport

```javascript
// Mobile
await page.setViewportSize({ width: 375, height: 812 });
await page.screenshot({ path: 'mobile.png' });

// Tablet
await page.setViewportSize({ width: 768, height: 1024 });
await page.screenshot({ path: 'tablet.png' });

// Desktop
await page.setViewportSize({ width: 1920, height: 1080 });
await page.screenshot({ path: 'desktop.png' });
```

## Test Script Template

```javascript
// test-webapp.js
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: false,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    // Navigate
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    console.log('Page loaded:', page.url());

    // Screenshot baseline
    await page.screenshot({ path: 'screenshots/home.png' });

    // Interact
    await page.click('nav a[href="/about"]');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/about.png' });

    console.log('All tests passed');
  } catch (err) {
    console.error('Test failed:', err.message);
    await page.screenshot({ path: 'screenshots/error.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
```

### Run the test

```bash
DISPLAY=:1 node test-webapp.js
```

## tmux Session Management

```bash
# Check running X11 sessions
tmux ls | grep -E 'termux-x11|playwright'

# Attach to debug
tmux attach -t playwright

# Restart playwright server
tmux send-keys -t playwright C-c
tmux send-keys -t playwright "DISPLAY=:1 mcp-server-playwright --port 8989 --browser chromium --executable-path /data/data/com.termux/files/usr/bin/chromium-browser" Enter

# Kill and recreate
tmux kill-session -t playwright
tmux new-session -d -s playwright
```

## Troubleshooting

### "Cannot open display" error
```bash
# Verify X11 is running
tmux ls | grep termux-x11
export DISPLAY=:1
xdpyinfo
```

### Chromium crashes on launch
```bash
# Add sandbox bypass flags
chromium-browser --no-sandbox --disable-gpu --disable-dev-shm-usage
```

### Playwright can't find browser
```bash
# Use explicit executable path, don't rely on browser install
chromium.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser'
})
```

### MCP server not responding
```bash
# Check if port is in use
ss -tlnp | grep 8989

# Restart the tmux session
tmux kill-session -t playwright
tmux new-session -d -s playwright
tmux send-keys -t playwright "sleep 2 && DISPLAY=:1 mcp-server-playwright --port 8989 --browser chromium --executable-path /data/data/com.termux/files/usr/bin/chromium-browser" Enter
```

### Screenshots are blank/black
```bash
# Wait for page to fully render
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);  // extra buffer for animations
```

## Related Files

| File | Purpose |
|------|---------|
| `tasker/startup.sh` | Boot-time X11 + Playwright MCP setup |
| `~/.claude/settings.json` | MCP server configuration |
| `.mcp.json` | Project-level MCP config |
