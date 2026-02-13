# Package Management on Termux (pacman-based)

## Important: This is pacman-based Termux
This Termux installation uses **pacman v7.0.0**, NOT apt/dpkg.
Do NOT use `apt install`, `dpkg`, or `apt-get` commands.

## System Packages

### Install
```bash
pkg install <name>                         # Preferred wrapper around pacman
pacman -S <name>                           # Direct pacman install
```

### Force install (common need)
Many installs on Termux hit filesystem conflicts. Use `--overwrite`:
```bash
pkg install <name> --overwrite='*'         # Force via pkg wrapper
pacman -S --overwrite='*' <name>           # Force via pacman directly
```

### Search
```bash
pkg search <term>                          # Search package names + descriptions
pacman -Ss <term>                          # Direct pacman search
```

### Update all packages
```bash
pkg upgrade                                # Update everything
pacman -Syu                                # Direct pacman update
```

### Package info
```bash
pkg show <name>                            # Package details
pacman -Qi <name>                          # Query installed package info
pacman -Ql <name>                          # List files in installed package
```

### Remove
```bash
pkg uninstall <name>                       # Remove package
pacman -R <name>                           # Direct pacman remove
pacman -Rns <name>                         # Remove with deps and config
```

## Repositories (7 total)
- **main** — core Termux packages
- **x11** — X11/GUI packages (Termux:X11)
- **root** — root-required packages
- **tur** — Termux User Repository (community)
- **tur-continuous** — TUR rolling builds
- **tur-multilib** — TUR multilib packages
- **gpkg** — glibc packages (for glibc-dependent binaries)

## Python Packages

### Preferred: uv (fast, isolated)
```bash
uv tool install <name>                     # CLI tools in isolated envs (preferred)
uv pip install <name>                      # Install into system Python
uv pip install --user <name>               # User-level install
```

### Fallback: pip
```bash
pip install <name>                         # Use uv instead when possible
pip install --break-system-packages <name> # Force if externally-managed error
```

## Node.js / Bun Packages

### Global tools
```bash
bun add -g <pkg>                           # Bun global install (preferred)
npm install -g <pkg>                       # npm global install
```

### Rust tools
```bash
cargo install <name>                       # Build from source
cargo binstall <name>                      # Pre-built binary (faster)
```

## Common Issues

### Filesystem conflicts during install
```
error: failed to commit transaction (conflicting files)
<package>: /path/to/file exists in filesystem
```
Fix: `pkg install <name> --overwrite='*'`

### PGP key errors
```bash
pacman-key --init
pacman-key --populate
```

### Broken packages after update
```bash
pkg install <name> --overwrite='*'         # Usually fixes it
```
