# New Project Scaffolding (TS/Bun Web Apps)

## Quick Start

### TypeScript + Bun project
```bash
mkdir my-project && cd my-project
bun init                                   # Creates package.json, tsconfig.json, index.ts
git init && git add -A && git commit -m "feat: initial scaffold"
```

### Vite + React + TypeScript
```bash
bun create vite my-app -- --template react-ts
cd my-app && bun install
```

### Hono API server
```bash
bun create hono my-api
cd my-api && bun install
```

## Standard Directory Structure
```
my-project/
├── src/
│   ├── index.ts                 # Entry point
│   ├── components/              # UI components (web apps)
│   ├── routes/                  # API routes (servers)
│   ├── lib/                     # Shared utilities
│   └── types/                   # TypeScript type definitions
├── test/                        # Test files
├── dist/                        # Build output (gitignored)
├── docs/
│   └── specs/
│       └── README.md            # Spec table of contents
├── .claude/
│   └── skills/                  # Project-specific skills (if needed)
├── CLAUDE.md                    # Project-specific Claude instructions
├── package.json
├── tsconfig.json
├── biome.json                   # Formatter/linter (or .prettierrc)
└── .gitignore
```

## Minimal CLAUDE.md Template
```markdown
# Project Name

## Build Commands
- `bun run dev`: Start dev server
- `bun run build`: Production build
- `bun test`: Run tests
- `bun run typecheck`: Type check

## Architecture
[Brief description of project structure and key patterns]
```

## tsconfig.json (Bun)
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
    "declaration": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

## biome.json (formatter + linter)
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  }
}
```

## .gitignore
```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
```

## package.json Scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/",
    "format": "biome format --write src/"
  }
}
```

## Git Setup
```bash
git init
git add -A
git commit -m "feat: initial project scaffold"
# Optional: create GitHub repo
gh repo create my-project --public --source=. --push
```
