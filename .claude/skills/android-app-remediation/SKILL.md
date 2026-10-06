---
name: android-app-remediation
description: Analyze and modify locally supplied or installed Android apps to change game progression and play restrictions, reduce telemetry, remediate unwanted behavior, or enable supported offline operation. Use for APK inspection, targeted patching, rebuilding, signing, and ADB verification, including starting in a blank repository. Does not imply publishing the app or changing remote services.
---

# Android app remediation

Deliver a reproducible, locally signed Android build that implements the user's requested behavior, with evidence from the actual installed artifact. Support a blank working folder without assuming this skill's originating app, repository, SDK, engine, device, or companion tools exist.

## Establish the target and workspace

- Read applicable repository instructions and existing working notes. Inspect Git status before editing; preserve unrelated work. In a blank folder, initialize Git if needed and create a concise `WORKING.md` plus ignore rules before importing binaries.
- Identify the app from supplied APKs or installed package metadata. If several packages plausibly match, ask which one; do not patch a guess. Record package ID, version name/code, signing certificate fingerprint, ABI, SDK requirements, and source APK hashes.
- Translate the request into observable outcomes: free level entry, changed starting balance, existing-save progression, repeatable card refills, no analytics uploads, fewer permissions, no forced prompts, or offline cold start. An analysis-only request authorizes investigation, not deployment. Preserve explicitly requested online features when reducing telemetry.
- Distinguish a new-profile default from an existing-profile migration, unlock eligibility from owned content, and access to levels from completing the campaign. Clarify consequential ambiguity while continuing independent inspection. Do not equate “everything unlocked” with marking all levels completed.
- Keep immutable input APKs under an ignored `original/`, extracted evidence under ignored `analysis/`, and generated outputs under ignored `build/`, or use the project's existing equivalents. Keep signing keys, private app data, account identifiers, traffic captures, and proprietary extracts out of commits.
- Track facts, hypotheses, requested outcomes, test results, artifact hashes, and concrete remaining tasks in the working Markdown. Prefer one maintained patch/build implementation over successive `fixed` or `v2` scripts.

## Acquire evidence without losing user state

Record the current foreground activity and any device settings a test will change. Use an explicit ADB serial for every device command. Verify the model and connection rather than reusing a historical port or assuming root.

For an installed app, use `pm path` to enumerate **all** base and split APKs; pull each and retain its filename, digest, and package provenance. A base APK alone may omit executable code, ABI libraries, resources, or asset packs. Inspect dynamic features and downloaded assets separately; inability to read private app data is not evidence that it is empty.

Capture existing relevant logcat with timestamps before considering clearing it. Establish a baseline for the requested behavior and record whether secure keyguard, an account prompt, missing downloads, or an offline error blocks observation. `am start` reporting success is not proof that the UI loaded or gameplay worked.

Preserve the original app and user data. A signature mismatch does not justify uninstalling the original. Never clear data or reboot without explicit permission for that instance; never restart Android's framework as a routine workaround. If backup access is unavailable, report that rather than claiming a backup exists. Do not replace or edit an existing save merely to make a test easier.

## Locate the controlling implementation

Start with APK entry lists, manifest inspection, resource names, strings, and targeted metadata searches. Choose tooling from evidence:

| App implementation | Useful inspection route |
| --- | --- |
| Java/Kotlin, DEX | Locate relevant classes across **all** `classes*.dex`; inspect targeted JADX output or Smali. Trace providers, services, receivers, startup code, and call sites. |
| Unity Mono | Inspect managed assemblies and serialized assets; identify runtime configuration sources. |
| Unity IL2CPP | Match metadata version and native ABI; map managed method tokens through the owning codegen module into `libil2cpp.so`. Inspect Unity assets and native control flow together. |
| Flutter, React Native, WebView, other native engines | Identify Dart AOT libraries, JS/Hermes bundles, packaged web assets, or native libraries first. Use the matching format/toolchain; changing the Android wrapper may not affect core logic. |

Do not decompile an entire large application when a string search or targeted class extraction can answer the question. Discover tools already present; optional neighboring repositories are conveniences, not dependencies. Verify unfamiliar formats or tool options against local help/source or authoritative documentation before relying on them.

Build an evidence chain for each proposed change:

1. Visible behavior or reproducible trigger.
2. Owning class, method, configuration entry, or asset.
3. Read/write callers and the condition that causes the restriction or unwanted behavior.
4. Runtime source of truth, including overrides and persistence.
5. Expected effect, dependencies, and an observable acceptance test.

Follow data through serialized defaults, bundled JSON, downloaded configuration, runtime caches, and saves. A correct edit to a default asset may be overwritten immediately at startup. An SDK name or domain string alone does not prove active telemetry. A feature flag alone does not prove that required content or backend functionality is present.

## Choose the appropriate change

### Game, level, economy, and progression changes

- Identify the actual restriction: entry currency, replenishing lives, finite stock cards, paid refills, daily quota, timer, tutorial gate, chapter threshold, inventory ownership, or a server decision. Test the exhausted/expired state, not just the initial free allowance.
- Prefer validated configuration changes when configuration controls the behavior. Preserve unrelated reward multipliers, board rules, resource types, asset IDs, and serialization invariants unless the user requested changing them.
- Trace sentinel values and units before editing: zero may disable a feature rather than unlock it; `-1` may be special; levels can be zero- or one-based; timer values may be minutes, ticks, or absolute timestamps. Avoid oversized integer values that overflow or require an enormous allocation.
- To remove play costs, trace both display pricing and the actual transaction. Check rounding, minimum charges, discounts, free-item consumption, and alternative multiplier modes. Free repeatable refills can remove a stock restriction without constructing an impractically large deck; say explicitly how the player refills.
- For starting balances, patch initialization rather than the balance getter. Test both a fresh profile and an existing save without erasing the latter. If migration is requested, use the real schema and versioning, preserve unrelated fields, and prevent the migration from reapplying on every launch.
- Verify content ownership and rendering as well as eligibility. Do not fabricate purchase receipts, server-success responses, or placeholder game state to disguise unavailable content. Report server-authoritative or absent content separately from local changes.

### Privacy, telemetry, advertising, and unwanted prompts

- Inventory initialization paths, automatic manifest providers/receivers, scheduled jobs, identifiers, event producers, queues, persistence, and transports. Separate analytics/crash reporting/ads from required downloads, authentication, cloud saves, and user-initiated connections.
- Prefer disabling optional SDK initialization and event production at their existing integration points. Check that callers tolerate the change and do not wait indefinitely, retry forever, fill a disk queue, or crash when a dependency is absent.
- Use narrowly scoped permission/component changes where supported by evidence. Remove `INTERNET` only for a deliberately offline variant; it would also remove legitimate networking. Domain blocking alone may leave alternate endpoints and queued data intact.
- For privacy claims, compare matched baseline and modified scenarios using available per-app network evidence, such as a user-approved capture/proxy or device-supported UID accounting. Include startup, ordinary use, background/resume, and relevant scheduled work. Capture time and coverage matter; “no matching log messages” is not “no telemetry.”
- If encryption, device privileges, or unavailable tooling prevents attribution, state the limit of observation. Do not disable TLS certificate validation or general platform protections as a privacy fix. Avoid collecting unrelated apps' traffic or exposing credentials in reports.
- Remove specific prompts, ads, or coercive navigation through their real lifecycle and callbacks. Verify navigation, foreground/background behavior, accessibility, and intended features still work; do not replace asynchronous operations with misleading fake-success results.

### Offline operation

Trace startup, authentication, configuration, save/load, asset delivery, and gameplay separately. Prefer a working built-in local backend or offline path when present. Determine which levels and assets are actually bundled or already available and whether a fresh install needs downloads.

A disabled network loop does not recreate a server. Avoid claiming full offline support from an installed APK, a home screen, a single level, or a warmed cache. Keep missing content and online-only events explicit. If a requested behavior cannot be implemented from available client code/data, document the concrete missing dependency and complete the supported scope.

## Implement reproducible patches

- Patch original inputs into separate generated outputs. Guard supported inputs with hashes plus expected bytes/schema; fail closed on an unexpected app version, layout, or method body. Do not scan-and-replace common byte sequences without proving ownership and uniqueness.
- Prefer the smallest semantic change that satisfies the request. Preserve control flow and valid data operations instead of indiscriminately making checks return true. For Smali edits, account for registers, invoke signatures, labels, exceptions, and verifier constraints.
- For native edits, confirm file offset versus virtual address, architecture/instruction mode, branch range, calling convention, live registers, stack layout, return type, relocations, and instruction boundaries. Linear disassembly is not a recovered control-flow graph. Avoid whole-method stubs where a validated data or branch change suffices.
- Validate metadata layouts for the actual format/version. Never reuse the originating game's addresses, Unity path IDs, structure offsets, object hashes, field order, or enum values for another app.
- For serialized asset changes, use a compatible writer or a proven size-preserving edit. Preserve lengths, alignment, object tables, references, and unrelated fields. JSON may permit trailing whitespace; compressed bundles and other containers may require rebuilding sizes and checksums. Reopen the result and verify it rather than assuming a successful write is enough.
- Test meaningful invariants: input rejection, exact intended changes, unchanged neighboring fields, correct computed values, and output reparsing. When practical, execute isolated original/patched native blocks or use an emulator, checking side effects as well as the intended return value. Do not execute arbitrary extracted code without understanding its dependencies.
- Run type checking and relevant tests for new tooling, plus compiler/assembler validation. Review the resulting artifact, not just the source script. Compare all changed ZIP entries, and verify unrelated DEX/native/assets are preserved or account for legitimate rebuild differences.

## Package, sign, and install

Choose the delivery mode explicitly. A separate package is the usual way to preserve the original when its signing key is unavailable; subsequent updates must retain the clone's package and signing key. A renamed clone also changes identity-dependent integrations, so test it as a distinct app.

For a clone, preserve component **class names** while changing the application package identity. Resolve relative class names before renaming. Audit all globally registered provider authorities, custom permissions, app-specific metadata, deep links, shared-user declarations, and native package-name assumptions. Third-party provider authorities may collide even when they do not contain the original package name. Signature-bound login and attestation integrations may no longer work; identify actual effects rather than blindly bypassing checks.

Use a toolchain compatible with the host architecture and target Android version. Preserve necessary splits, native libraries, assets, and resource tables; do not blindly merge dynamic features. Remove stale signing metadata when repackaging, align using the target's applicable ZIP/native-library requirements, sign the final bytes with a persistent local key, and verify signatures plus alignment afterward. Make no changes after signing. Do not reuse a debug password as a distribution-secret recommendation.

Record output path, package/version, file size, SHA-256, signer fingerprint, and build inputs. Rebuild from preserved originals. Install as an update only when package and signing identity match. If install fails, diagnose the exact failure before retrying; do not uninstall, clear data, or change unrelated device security settings to force it through. Distribution, tagging, version bumps, or uploading require the user's corresponding request.

## Verify the actual result

Use the installed artifact and fresh timestamps/process IDs. Minimum coverage depends on the requested change:

| Change | Evidence to collect |
| --- | --- |
| Starting resources / progression | Exact value where accessible; correct fresh-profile behavior; existing-save preservation; earned/spent state survives process restart. A rounded “100M” label is not an exact balance check. |
| Entries, turns, refills, boosters | Exhaust starter allowances; repeat actions; test retries and relevant multiplier modes; observe the balance and usable controls. Preserve intended move validity. |
| Cooldown removal | Repeat the action before the old waiting period expires; verify both availability and actual resulting state. |
| Unlocks | Ownership/eligibility plus visible asset rendering and use; sample later content and document the coverage boundary. |
| Telemetry/privacy | Compare equivalent baseline/modified network and runtime scenarios; verify desired networking still works, background behavior, and any retained queue/retry activity. |
| Offline mode | Cold start without app network access, level entry/completion where feasible, save/restart, and relevant menus. Distinguish fresh from cached assets. |

Make incremental tests and inspect failures before proceeding. Do not repeatedly patch around an unexplained crash. If a gate depends on unavailable data, signing identity, locked-screen access, or an inaccessible server, record the blocker, preserve the last verified state/artifact, and ask only for information or access needed to continue.

Screenshots must be below 2000 pixels in **both** dimensions and below 4 MB before visual inspection; resize/compress immediately after capture and verify dimensions/file size. Map tap coordinates to the current device orientation and resolution. Never blindly repeat coordinates from another app or screenshot. Store evidence without publishing private screen contents.

Restore starting app/task focus and any temporary input, connectivity, or display settings. Do not clear app data to test a new profile; use an isolated clone/emulator/test profile where feasible, or report fresh-profile testing as unverified.

## Finish and preserve knowledge

Update the working Markdown with requested versus implemented behavior, direct evidence, unresolved limitations, reproduction/build commands, tested artifact identity, and specific `# TODO` items. Record hard-won project facts in the project's existing memory file; do not turn one device/version's quirks into universal rules.

Inspect staged changes and make a conventional commit for the completed work when working in a repository, following local commit conventions. Exclude original APKs, signing material, captures, private saves, and generated proprietary output unless explicitly requested and appropriate. Do not push automatically.

Return the APK path when one was built, the concrete behavior changed, what was actually tested, and any remaining feature/content/privacy limits. Never summarize partial coverage as “all limits removed,” “zero telemetry,” or “fully offline” without supporting evidence.

## Termux-specific adaptations (only when applicable)

- Wireless ADB can rotate ports. Inspect `adb devices -l`; for an explicitly self-hosted device, rediscover loopback ports with `nmap -sT -p 30000-65535 --open -n 127.0.0.1` and probe candidates with bounded `adb connect` calls. An open port is not proof it is ADB; confirm the device identity. Do not scan other hosts without scope.
- Check actual executable architecture before selecting Android build tools. Maven/SDK `aapt2` and `zipalign` may be x86_64 on an ARM64 host; use known-compatible native tools or a verified wrapper. Treat historical paths as candidates, not guarantees.
- Use a clean task-specific directory under the writable Termux temporary directory; `/tmp` may be unavailable. Avoid placing Python scratch scripts directly beside unrelated temporary modules that can shadow imports.
- For glibc programs launched through Proot, unset inherited bionic `LD_PRELOAD` at the handoff and supply a working resolver binding when required. Do not change global runtime settings for a single patch task.
- Prefer `rg`/`rg --files` over wrapped `grep`/`find`; check tool help and host behavior. Capture a long build's real exit status instead of hiding it behind `tail` or `head`.
- Do not upgrade the device toolchain as a speculative fix. Reuse compatible installed tools or isolate additional dependencies; confirm the active package manager before installing anything.

### Local tool discovery and working candidates

These are candidates verified on the originating Termux host on 2026-10-05, not prerequisites for another machine. Resolve paths from the user's home directory rather than assuming the new repository is beside `termux-tools`. Check existence, executable architecture, version/help, and a small relevant operation before starting a long job.

| Task | Local candidate and usage |
| --- | --- |
| APK inspection/packaging | `~/git/termux-tools/edge-fix/tools/APKEditor.jar`; run Java with its help to select the operation. Its ARSCLib classes also support targeted binary-manifest editing from Kotlin. Inspect the installed API before copying an example. |
| DEX assembly/disassembly | Standalone `baksmali-3.0.9-fat.jar` and `smali-3.0.9-fat.jar` in that tools directory; both currently report `3.0.9-dev`. Use `java -jar ... d` / `a` with verified arguments. Prefer a targeted round-trip and test ART loading, especially interface/static-method cases. |
| Source/manifest inspection | `jadx` and `apktool` are on PATH. For resource/manifest-only apktool work, `d -s` skips Smali processing; it does not mean that only the manifest is decoded. |
| Resource compiler | `~/git/Embeddy/tools/aapt2-arm64/aapt2` is a native ARM64 candidate. `$PREFIX/bin/aapt2` is currently a script executing x86_64 `aapt2.elf` under QEMU, not a native binary. For AGP, select a verified executable via `android.aapt2FromMavenOverride`. |
| Signing and ELF work | PATH includes native ARM64 `zipalign`, `apksigner`, `keytool`, `java`, `kotlinc`, `clang`, `readelf`, and `llvm-objdump`. Probe the required operation; a PATH entry alone is not a successful build test. |
| Device/evidence | PATH includes `adb`, `nmap`, and ImageMagick `magick`; use ImageMagick to resize and verify screenshot dimensions/size before viewing. |
| Optional dynamic/network inspection | `frida`, `frida-ps`, `mitmdump`, and `tshark` are discoverable here; operational attach/capture capability is unverified. Check runtime imports, client/server compatibility, device privileges and capture scope. Do not assume root, a running Frida server, or a trusted proxy certificate. |

For Unity/ELF inspection, the originating project's Python 3.12 virtual environment successfully imports `UnityPy==1.25.3`, `pyelftools==0.32`, and `capstone==5.0.7`; its strict checks use `mypy==1.15.0`. In a new folder, create a project-local environment with a verified interpreter (`python3.12 -m venv --system-site-packages .venv` worked here), install only needed dependencies, and test imports with that environment's Python. System-site packages are a local convenience; record versions because they are inherited. Do not assume default `python3` has the same modules or blindly pin these versions for a newer app format. Record the selected versions in the new project's dependency file.

Additional local references, when present:

- `~/git/termux-tools/.claude/skills/android-termux-build.md`, `smali-dex-patching.md`, `edge-merge-apk.md`, and `termux-screenshots.md` describe earlier workflows. Read only the relevant files and distinguish their evidence from universal requirements.
- `~/git/termux-tools/edge-fix/scripts/` contains manifest and DEX helpers. Review source and test on a copy before reuse. Some recipes stub methods, redirect URLs, or assume a particular browser; they are not generic safe fixes and must not override the user's instructions.
- `~/git/solit/` contains a working Unity/IL2CPP example (`inspect_metadata.py`, `inspect_native.py`, `patch_assets.py`, `OfflineManifest.kt`, and `build_offline.sh`). Treat it as reference implementation only: its metadata records, hashes and offsets target one game build. The new repository must remain independently reproducible.
- Do not require a `beambam` checkout: it was absent here; `beambam-boo` is a different discovered directory, not a verified substitute toolchain.

Local-reference traps to check explicitly:

- The Edge merge notes report resource/theme and component regressions and also retain an older conflicting repair recipe. Prefer preserving splits when compatible with the requested result; sign every split consistently and install the complete set with `adb install-multiple -r`. Validate package/version/split dependencies, resource qualifiers, and component coverage. Do not transplant a base resource table into an arbitrary merged app.
- Equal byte length does **not** establish a valid DEX string edit: check MUTF-8/UTF-16 lengths, sorted string identifiers, offsets, SHA-1 signature and Adler-32 checksum. The local direct-string helper's padding claim does not prove ordering remains valid. Reparse and test any changed DEX; do not rely on raw `sed` replacements.
- Use absolute Termux interpreter shebangs for scripts that must run when `LD_PRELOAD` is missing. For JavaScript/TypeScript helpers, use the project's Bun workflow and check `bun --version`; a leaked `BUN_BINARY_PATH` can invoke a different bundled executable. Do not infer these runtime failures from old notes without checking the current environment.
