# API Key & Secret Management

## Storage

### Local development (Termux)
Secrets live in `~/.secrets`, sourced by `.bashrc`:
```bash
# ~/.bashrc
[[ -f ~/.secrets ]] && source ~/.secrets
```

```bash
# ~/.secrets (NOT tracked in git)
export API_KEY="sk-..."
export DATABASE_URL="postgres://..."
```

### Per-project
Use `.env` files (gitignored):
```bash
# .env (add to .gitignore FIRST)
API_KEY=sk-...
DATABASE_URL=postgres://...
```

Load in code:
```typescript
// Bun reads .env automatically
const key = process.env.API_KEY;

// Or explicit: import { config } from 'dotenv'; config();
```

## .gitignore (always include)
```
.env
.env.local
.env.*.local
*.secrets
credentials.json
*.keystore
*.pem
*.key
```

## Rules
- NEVER commit secrets to git — even in "test" or "temp" commits
- NEVER hardcode secrets in source files
- NEVER log secrets (even in debug mode)
- NEVER pass secrets as CLI arguments (visible in `ps`)
- Use environment variables or secret files

## Rotation
When a key is exposed:
1. Immediately rotate at the provider dashboard
2. Update `~/.secrets` or `.env` with new key
3. Verify with a test API call
4. Check git history: `git log -p -S 'sk-proj-'` to confirm no leaks

## Platform-specific

### Anthropic API
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### OpenAI
```bash
export OPENAI_API_KEY="sk-proj-..."
```

### Google / Gemini
```bash
export GOOGLE_API_KEY="AIza..."
export GEMINI_API_KEY="AIza..."
```

### Android Keystore
```bash
export RELEASE_KEYSTORE="$HOME/.android/release.keystore"
export RELEASE_KEYSTORE_PASSWORD="..."
export RELEASE_KEY_ALIAS="..."
export RELEASE_KEY_PASSWORD="..."
```

## Checking for Leaks
```bash
# Scan git history for common secret patterns
git log --all -p | grep -iE 'sk-proj-|sk-ant-|AIzaSy|password\s*=' | head -20

# Scan tracked files
git ls-files -z | xargs -0 grep -lE 'sk-proj-|sk-ant-|AIzaSy' 2>/dev/null

# Check for private keys
git ls-files -z | xargs -0 grep -rlE 'PRIVATE KEY|BEGIN RSA' 2>/dev/null
```
