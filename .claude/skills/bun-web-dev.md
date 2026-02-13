# Bun + TypeScript Web Development on Termux

## Overview
Bun is the preferred runtime and package manager for TypeScript/JavaScript web development on this Termux ARM64 environment. Use Bun over Node.js where possible for speed and DX.

## Project Setup

### New project
```bash
bun init                          # Interactive init with TypeScript
bun create vite my-app            # Vite + React/Vue/Svelte scaffold
bun create hono my-api            # Hono API scaffold
```

### Install dependencies
```bash
bun install                       # Install from bun.lockb / package.json
bun add <pkg>                     # Add dependency
bun add -d <pkg>                  # Add dev dependency
bun add -g <pkg>                  # Add global tool
```

### Termux-specific: copyfile backend
If `bun add` fails with EXDEV or link errors (common on Termux's sdcardfs):
```bash
bun add --backend=copyfile <pkg>
```
The `bun1` alias in .bashrc wraps this automatically for `bun1 add`.

## Development

### Dev server
```bash
bun run dev                       # Runs vite dev or custom script
bun --watch src/index.ts          # File watcher for scripts
bun --hot src/server.ts           # Hot-reload for Hono/Express servers
```

### Build
```bash
bun run build                     # Vite production build
bun build src/index.ts --outdir=dist --target=bun   # Bun bundler
bun build src/index.ts --outdir=dist --target=browser --minify  # Browser bundle
```

### Test
```bash
bun test                          # Built-in test runner (Jest-compatible)
bun test --watch                  # Watch mode
bun test --coverage               # Coverage report
```

## Vite Configuration
Standard Vite config for Bun projects:
```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 },
  build: { outDir: 'dist', sourcemap: true }
})
```

## TypeScript Config
Recommended `tsconfig.json` for Bun:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

## Deployment

### GitHub Pages (static)
```bash
bun run build
# Push dist/ to gh-pages branch or configure GitHub Actions
```

### Railway / Fly.io (server)
```bash
# Dockerfile with Bun
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "start"]
```

## Common Issues

### bun.lockb conflicts
```bash
rm bun.lockb && bun install       # Regenerate lockfile
```

### node_modules symlink issues on ARM64
```bash
bun install --backend=copyfile    # Use copy instead of hardlinks
```

### Binary compatibility
Some npm packages with native binaries may not have ARM64 builds. Use:
```bash
bun add <pkg> --backend=copyfile  # Sometimes helps with extraction
# Or fall back to: npm install <pkg>
```

### Glibc wrapper
Bun on Termux uses a glibc wrapper (`bun-glibc-2.38/`) at `~/.bun/bin/bun`. The shim resolves the correct binary path. If bun stops working after an update:
```bash
~/.bun/bin/bun --version          # Check if wrapper works
which bun                         # Should point to ~/.bun/bin/bun
```
