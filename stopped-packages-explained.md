# "Stopped" Packages Explanation - November 26, 2025

## User Question

User asked about these packages showing `stopped=true`:
1. com.samsung.android.bixbyvision.framework
2. com.sem.factory.SemFactoryActivity
3. com.mygalaxy.service.uniqueidprovider
4. com.samsung.android.smartface.overlay

## Investigation Results

### Package Status Check

| Package | Stopped? | Enabled? | Type | Status |
|---------|----------|----------|------|--------|
| **com.samsung.android.bixbyvision.framework** | ❌ **FALSE** | ✅ enabled=1 | Framework | **RUNNING** |
| **com.sem.factoryapp** | ✅ true | ✅ enabled=1 | System app | Dormant (normal) |
| **com.mygalaxy.service** | ✅ true | ✅ enabled=2 | Service | Dormant (normal) |
| **com.samsung.android.smartface.overlay** | ✅ true | ✅ enabled=1 | **RRO Overlay** | Active ([x] in overlay manager) |
| **com.samsung.android.smartface** | ❌ **FALSE** | ✅ enabled=1 | Main service | **RUNNING** |

## Key Findings

### 1. Bixby Vision Framework - NOT STOPPED ✅

**Status**: `stopped=false`

The Bixby Vision Framework is **RUNNING**, not stopped. It was never stopped.

### 2. Factory App - Stopped But Normal ✅

**Status**: `stopped=true, enabled=1`

**Why it's stopped**: Factory apps (com.sem.factoryapp) are diagnostic/test tools that only run when explicitly launched in factory/service mode. They don't run during normal operation.

**Related running processes**:
- `factory.ssc` (PID 1975) - Factory SSC (System Service Controller)
- `camxlpaioisfactorytest` (PID 2488) - **OIS Factory Test Process**

The OIS factory test process IS running, which means factory services are active for OIS diagnostics.

### 3. MyGalaxy Service - Stopped But Normal ✅

**Status**: `stopped=true, enabled=2` (ENABLED_BY_DEFAULT)

**Purpose**: MyGalaxy service provides Samsung account features and is event-driven - it only starts when needed (e.g., when user opens Galaxy Store, accesses Samsung account settings, etc.).

**Why it's stopped**: Not needed right now. Will auto-start when triggered.

### 4. SmartFace Overlay - Actually ENABLED ✅

**Status**: `stopped=true` but `[x]` in overlay manager

**IMPORTANT DISCOVERY**: SmartFace overlay is a **RRO (Runtime Resource Overlay)**, NOT a running app!

**What is an RRO?**
- Resource overlay that modifies Android framework resources
- Located at: `/system_ext/overlay/smartfaceservice_overlay.apk`
- Target: `android` (framework)
- **Does not "run" as a process**
- The `stopped=true` flag is irrelevant for overlays

**Overlay Status**:
```
[x] com.samsung.android.smartface.overlay
```
The `[x]` means it's **ENABLED and ACTIVE** in the overlay manager.

**Related Running Service**:
- `com.samsung.android.smartface` main package: `stopped=false` (RUNNING)

The actual SmartFace service IS running. Only the overlay has the "stopped" flag, which doesn't matter for overlays.

## What "Stopped" Actually Means

### For Regular Apps/Services

`stopped=true` means:
- Package hasn't been launched since boot
- Android automatically sets this flag
- **Cleared automatically** when the app/service is needed
- **NOT the same as "disabled" or "frozen"**

### For Resource Overlays (RRO)

The `stopped` flag is **MEANINGLESS** for overlays because:
- Overlays don't run as processes
- They're applied at boot by the overlay manager
- Status is controlled by overlay manager, not package manager
- Check overlay status with: `cmd overlay list`

## Camera Implications

### All Camera-Related Packages Status: ✅ GOOD

1. **Bixby Vision Framework**: RUNNING (`stopped=false`)
2. **Face Service**: RUNNING (enabled via ADB earlier)
3. **Image Enhancer**: ENABLED
4. **SmartFace**: RUNNING (`stopped=false`)
5. **SmartFace Overlay**: ACTIVE in overlay manager (`[x]`)
6. **OIS Factory Test**: RUNNING (`camxlpaioisfactorytest` process active)

### Conclusion

**NONE of the packages user mentioned are causing camera issues.**

All are either:
- Running normally (Bixby Vision, SmartFace)
- Enabled as overlays (SmartFace overlay)
- Stopped but not needed right now (Factory app, MyGalaxy)

The OIS camera failure is **NOT** caused by stopped packages. The `camxlpaioisfactorytest` process proves OIS diagnostics are active, yet OIS still fails with hardware error 0x4e.

## Understanding "Stopped" vs "Disabled"

| State | Meaning | Can Auto-Start? | Issue? |
|-------|---------|-----------------|--------|
| **stopped=true** | Haven't launched since boot | ✅ YES | ❌ NO |
| **enabled=0** | User/system disabled | ✅ YES (if enabled) | ⚠️ MAYBE |
| **enabled=3** | Disabled by default | ✅ YES (if enabled) | ⚠️ MAYBE |
| **enabled=4** | User explicitly disabled | ❌ NO (unless re-enabled) | ✅ YES |

## Normal System Behavior

It's **completely normal** for hundreds of packages to show `stopped=true` on a device:

```
232 packages with stopped=true flag (on this device)
```

These are:
- Apps that haven't been opened since boot
- Services that are event-driven (launch when needed)
- System components that only activate for specific functions

Android's design is to **stop packages to save resources** and **auto-start them when needed**.

## Action Required

### For Camera Issue: NONE ❌

Do NOT attempt to "start" these stopped packages:
- ✅ Bixby Vision is already running
- ✅ SmartFace overlay is already active
- ✅ Factory app doesn't need to run (only for diagnostics)
- ✅ MyGalaxy will start when needed

### For General Understanding: ✅

Remember:
1. **"Stopped" ≠ "Broken"** - it's normal Android behavior
2. **Overlays can't be "started"** - they're always active when enabled
3. **Event-driven services** auto-start when triggered
4. **Factory apps** only run in service/diagnostic modes

---

**Report Generated**: 2025-11-26 14:45 UTC
**Device**: Samsung Galaxy S23 FE (SM-S938U1)
**Conclusion**: All mentioned packages are functioning normally. Camera OIS issue is unrelated to package states.
