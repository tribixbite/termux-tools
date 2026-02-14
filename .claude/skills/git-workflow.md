# Git Workflow Conventions

## Commit Messages
Use conventional commits format:
```
<type>: <description>

[optional body]

— <model-version>
```

### Types
- `feat:` — new feature or capability
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code restructure without behavior change
- `test:` — adding/updating tests
- `chore:` — maintenance, deps, CI, configs
- `perf:` — performance improvement
- `style:` — formatting, whitespace (no logic change)

### Rules
- Do NOT mention "Claude" in commit messages
- Do NOT use "Co-Authored-By" header
- Sign with emdash + model version: `— opus-4-6`
- Keep subject line under 72 characters
- Use imperative mood: "add feature" not "added feature"
- Body explains **why**, not what (the diff shows what)

## Branch Naming
```
feat/<short-description>     # New features
fix/<short-description>      # Bug fixes
refactor/<short-description> # Refactoring
docs/<short-description>     # Documentation
chore/<short-description>    # Maintenance
```

## PR Workflow
```bash
# Create branch
git checkout -b feat/my-feature

# Work, commit, push
git add <specific-files>
git commit -m "feat: add my feature — opus-4-6"
git push -u origin feat/my-feature

# Create PR via gh CLI
gh pr create --title "feat: add my feature" --body "$(cat <<'EOF'
## Summary
- What this PR does

## Test plan
- [ ] Tests pass
- [ ] Manual verification

— opus-4-6
EOF
)"
```

## Pre-commit Checklist
1. `npx tsc --noEmit` or `bun run typecheck` — type check
2. `bun test` or `npm test` — run tests
3. `git diff --staged` — review changes
4. Stage specific files (avoid `git add -A`)
5. Commit with conventional message

## Rebase vs Merge
- Prefer rebase for feature branches onto main
- Never force-push to main/master
- Never rebase public/shared branches without permission
- `git pull --rebase` for syncing with remote

## Dangerous Operations (require explicit permission)
- `git push --force` / `git push --force-with-lease`
- `git reset --hard`
- `git rebase -i` on pushed commits
- `git branch -D` (uppercase D = force delete)
- Tag/version creation and pushing
