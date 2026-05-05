# GLVND EGL Vendor on Termux + termux-x11 → ANGLE → Adreno

How to write a libglvnd EGL vendor that bridges Mesa's GLVND dispatch
into Android's ANGLE (Vulkan-backed) so wxGLCanvas / GTK-GL / SDL2-GL
applications running under termux-x11 can hit real GPU hardware
instead of llvmpipe software rendering.

This was developed for BambuStudio on a Galaxy S25 Ultra (Adreno 830);
the same pattern should work on any Adreno 6xx/7xx/8xx where
[`leegaos/vulkan-wrapper-android-leegaos-fork`][leegaos] (the
vulkan_wrapper Termux package) bridges Vulkan to the
`/vendor/lib64/hw/vulkan.adreno.so` driver.

[leegaos]: https://github.com/leegaos/vulkan-wrapper-android-leegaos-fork

Tested 2026-05-04. Reference implementation:
[`tribixbite/x2d` `runtime/libEGL_x2dadreno.c`][refimpl] + `runtime/build_egl_vendor.sh`.

[refimpl]: https://github.com/tribixbite/x2d/blob/main/runtime/libEGL_x2dadreno.c

---

## Why this exists (the failure mode you're avoiding)

If you `pkg install mesa libglvnd` and then point a wxGL/SDL/GTK app at
`DISPLAY=:1` on termux-x11, libglvnd loads Mesa as the EGL vendor.
Mesa probes for DRI (no), then tries zink (Vulkan→GL via libvulkan)
which often **crashes on the first GL surface use** because zink's
`kopper` swapchain code asserts when the X server has no DRI3/Present.

The two existing workarounds:

1. **`GALLIUM_DRIVER=llvmpipe LIBGL_ALWAYS_SOFTWARE=1`** — falls back to
   software rendering. Always works. Slow (8 fps for a Plater-sized
   viewport on Adreno 830).
2. **virgl_test_server_android + EPOXY_USE_ANGLE** — out-of-process
   GL→virgl→ANGLE→Vulkan→adreno. Faster (50-80 fps) but adds an IPC
   hop and a separate render server process.

The vendor approach below replaces both: in-process, ANGLE-Vulkan
direct, ~200 fps for typical workloads. No IPC, no software fallback.

---

## Architecture (call chain)

```
app (wxGLCanvas / GTK-GL / SDL2-GL)
    ↓
libGLdispatch.so + libEGL.so.1   ← libglvnd, dispatches EGL calls
    ↓ (per egl_vendor.d/*.json registration order)
libEGL_x2dadreno.so              ← OUR vendor: thin pass-through
    ↓ (dlopen + dlsym)
libEGL_angle.so + libGLESv2_angle.so   ← ANGLE on Android
    ↓
libvulkan.so → libvulkan_wrapper.so (leegaos)
    ↓
/vendor/lib64/hw/vulkan.adreno.so  ← real Qualcomm driver
    ↓
Adreno GPU
```

Plus our two intercepts that don't pass through to ANGLE unchanged:

- **`eglCreatePlatformWindowSurface(dpy, cfg, &xwindow, attribs)`**
  ANGLE on Android doesn't know how to render to an X11 Window XID,
  so we substitute an offscreen pbuffer with the same width/height
  and remember the XID↔pbuffer mapping in a static table.
- **`eglSwapBuffers(dpy, surf)`**
  Look up the XID for this surface, `glReadPixels` from the pbuffer,
  byte-swap RGBA→BGRA + flip rows, `XPutImage` to the X11 window,
  `XFlush`. ~7 ms per swap on a 400×300 surface, scaling roughly
  linearly with pixel count.

---

## Setup pieces (all you need to install)

### 1. Termux packages

```bash
pkg install \
    mesa libglvnd \
    angle-android \
    vulkan-loader vulkan-wrapper \
    clang libx11
```

`angle-android` lands in `$PREFIX/opt/angle-android/{gl,vulkan,vulkan-null}/`.
We use the **vulkan/** flavour (ANGLE backed by real Vulkan, which the
wrapper bridges to Adreno).

`vulkan-wrapper` registers an ICD JSON at
`$PREFIX/share/vulkan/icd.d/wrapper_icd.aarch64.json` pointing at
`$PREFIX/lib/libvulkan_wrapper.so`. That's the leegaos fork.

### 2. Vendor JSON (`$PREFIX/share/glvnd/egl_vendor.d/40_x2dadreno.json`)

```json
{
    "file_format_version" : "1.0.0",
    "ICD" : {
        "library_path" : "/data/data/com.termux/files/usr/lib/libEGL_x2dadreno.so"
    }
}
```

The `40_` prefix wins over Mesa's `50_mesa.json` alphabetically.
libglvnd loads vendors in lexical order and the **first vendor whose
`getPlatformDisplay` returns non-NULL** owns the display.

### 3. Vendor library at `$PREFIX/lib/libEGL_x2dadreno.so`

Build from `runtime/libEGL_x2dadreno.c`:

```bash
clang -shared -fPIC -O2 -fvisibility=hidden \
    -o $PREFIX/lib/libEGL_x2dadreno.so libEGL_x2dadreno.c \
    -ldl -lpthread -lX11 -Wl,--export-dynamic
```

Verify: `nm -D $PREFIX/lib/libEGL_x2dadreno.so | grep __egl_Main`
should print `T __egl_Main` — that's the GLVND-required entry point.

### 4. Runtime env (one shell line)

```bash
export __EGL_VENDOR_LIBRARY_FILENAMES=$PREFIX/share/glvnd/egl_vendor.d/40_x2dadreno.json
export X2D_ANGLE_DIR=$PREFIX/opt/angle-android/vulkan
export VK_ICD_FILENAMES=$PREFIX/share/vulkan/icd.d/wrapper_icd.aarch64.json
export LD_LIBRARY_PATH=$PREFIX/opt/angle-android/vulkan${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export LIBGL_DRI3_DISABLE=1   # tells anyone-still-using-libGL to skip DRI3
```

Run any GL/EGL app with these in the env — wxGLCanvas, GTK4 GL,
SDL2-with-GL, etc. — and they get hardware Adreno via ANGLE.

---

## The two non-obvious bugs you'll hit if you write this from scratch

These cost a day of debugging the first time around. Skip them.

### Bug #1: ANGLE on Android only accepts `EGL_DEFAULT_DISPLAY`

The naïve vendor does this in `getPlatformDisplay`:

```c
EGLDisplay r = angle_eglGetDisplay((EGLNativeDisplayType)nativeDisplay);
```

where `nativeDisplay` is the X11 `Display*` libglvnd just handed us.

**This appears to succeed** — `angle_eglGetDisplay` returns a non-NULL
handle. But subsequent `eglInitialize(handle)` returns
`EGL_FALSE` with `EGL_BAD_DISPLAY` (0x3008). The display is poisoned:
ANGLE stored the X11 `Display*` as the "native handle" internally,
and its initialization path can't deal with a non-Android-native
handle.

**Fix:** force the ANGLE-Vulkan platform with `EGL_DEFAULT_DISPLAY`:

```c
EGLAttrib angle_attribs[] = {
    EGL_PLATFORM_ANGLE_TYPE_ANGLE,
    EGL_PLATFORM_ANGLE_TYPE_VULKAN_ANGLE,
    EGL_NONE,
};
r = angle_eglGetPlatformDisplay(EGL_PLATFORM_ANGLE_ANGLE,
                                 EGL_DEFAULT_DISPLAY, angle_attribs);
```

Capture the X11 `Display*` for our own use (we need it in
`eglSwapBuffers` for `XPutImage`) but don't pass it to ANGLE.

### Bug #2: libglvnd's static-dispatch via cached ANGLE pointers fails for many EGL funcs

The naïve `getProcAddress` returns ANGLE's bare function pointer:

```c
return dlsym(g_angle, procName);   // <-- WRONG for many funcs
```

libglvnd caches that pointer in its static dispatch table at vendor
load time, then calls it later from inside `libEGL.so.1`'s stub
functions. **For a subset of EGL functions (Initialize / QueryString
/ ChooseConfig / BindAPI / CreatePbufferSurface confirmed; likely
others) this dispatch path returns `EGL_BAD_DISPLAY` at call time.**
Direct `dlopen+dlsym+call` of the same ANGLE function from a small
test program works correctly — the failure is specific to libglvnd's
cross-library dispatch path.

The exact root cause appears to be a bionic linker namespace quirk
with cross-library function-pointer calls into ANGLE — the call site
needs to live in a library that holds the `g_angle` dlopen handle.

**Fix:** wrap *every* EGL function with a thin pass-through whose
call site lives in your vendor library:

```c
#define ANGLE_FWD2(NAME, RET, T1, T2) \
    static RET my_##NAME(T1 a, T2 b) { \
        static RET (*f)(T1, T2) = NULL; \
        if (!f) { load_angle(); f = dlsym(g_angle, #NAME); } \
        return f ? f(a, b) : (RET)0; \
    }

ANGLE_FWD2(eglDestroyContext, EGLBoolean, EGLDisplay, EGLContext)
ANGLE_FWD2(eglSwapInterval,   EGLBoolean, EGLDisplay, EGLint)
/* ... 30+ more ... */
```

Then in `getProcAddress`, return `(void*)my_eglDestroyContext` etc.
instead of the bare ANGLE pointer.

---

## Verifying it works

### Probe 1 — does GL_VERSION reflect Adreno?

Compile a minimal `EGL → context → GL_VERSION` probe:

```c
EGLDisplay dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
eglInitialize(dpy, NULL, NULL);
EGLConfig cfg; EGLint nc;
EGLint a[] = { EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
               EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_NONE };
eglChooseConfig(dpy, a, &cfg, 1, &nc);
eglBindAPI(EGL_OPENGL_ES_API);
EGLint p[] = { EGL_WIDTH, 64, EGL_HEIGHT, 64, EGL_NONE };
EGLSurface s = eglCreatePbufferSurface(dpy, cfg, p);
EGLint c[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
EGLContext x = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, c);
eglMakeCurrent(dpy, s, s, x);
printf("GL_VERSION  = %s\n", glGetString(GL_VERSION));
printf("GL_RENDERER = %s\n", glGetString(GL_RENDERER));
```

Expected output:

```
GL_VERSION  = OpenGL ES 3.2.0 (ANGLE 2.1.24923 git hash: f09a19cebdaf)
GL_RENDERER = ANGLE (Qualcomm, Vulkan 1.3.284 (Adreno (TM) 830 …))
```

If `GL_RENDERER` says `llvmpipe`, your vendor JSON isn't being
loaded — check the `40_*` prefix and `__EGL_VENDOR_LIBRARY_FILENAMES`.

If `eglInitialize` returns false: you're hitting Bug #1.
If `eglChooseConfig` etc. return `EGL_BAD_DISPLAY`: Bug #2.

### Probe 2 — does swap actually paint to X11?

Reference: `runtime/probes/probe_vendor_window.c` in x2d. Creates an
X11 window, runs a GLES2 fragment shader, calls `eglSwapBuffers`,
holds for a few seconds. Take an `import -display :1 -window root
out.png` and you should see your shader output painted at the window
position.

---

## Performance reference (Adreno 830, 2026-05)

| Backend | Plater-sized viewport (~1080×2400) | 400×300 probe |
|--------:|:----------------------------------:|:-------------:|
| llvmpipe (sw) | 8 fps | ~30 fps |
| virgl + ANGLE-GL (out-of-process) | 50-80 fps | ~120 fps |
| **GLVND vendor + ANGLE-Vulkan (in-process)** | **~25-30 fps** ¹ | **~200 fps** |

¹ The Plater number is extrapolated from the probe; full-viewport
glReadPixels + XPutImage is the bottleneck, not GPU rendering. PBO-
backed async readback could lift this 2-3× but isn't implemented yet.

---

## Files to grep when something breaks

- `$PREFIX/include/glvnd/libeglabi.h` — vendor ABI
- `$PREFIX/include/EGL/eglext_angle.h` — ANGLE-specific platform enums
- `nm -D $PREFIX/opt/angle-android/vulkan/libEGL_angle.so` — ANGLE's
  exported EGL functions (35+ for ABI 1.5)
- `vulkaninfo --summary` — confirm GPU0 = Adreno 830, not lavapipe
- `$TMPDIR/x2d_egl_vendor.log` — the reference vendor's own debug log

---

## Related Termux package work

- termux/termux-packages#23042 — `EPOXY_USE_ANGLE` + virgl coverage
- termux/termux-packages#21642 — Mesa↔libllvm version coupling that
  silently breaks every EGL call when out of sync
- termux/termux-packages#28671 — turnip (native Adreno Vulkan)
  Mesa-side draft for Adreno 8xx; would let us drop the wrapper ICD
  if/when it lands

---

## Hard-won shorthands

- "Vendor JSON ignored": you forgot the `40_` prefix or have stale
  `__EGL_VENDOR_LIBRARY_FILENAMES` overriding it. `unset` it and re-test.
- "EGL_BAD_DISPLAY": Bug #1 (during init) or Bug #2 (after init).
- "GL_RENDERER says llvmpipe": vendor isn't loaded. Truncate the log
  file and re-run — if no entry appears, the JSON path/permissions
  are wrong.
- "The .so loads but `__egl_Main` not exported": you forgot
  `-Wl,--export-dynamic` or `-fvisibility=default` on the function.
- "Process aborts on first GL call": you're getting the zink path,
  not our vendor. Check the env order — `__EGL_VENDOR_LIBRARY_FILENAMES`
  must be set before any libEGL.so.1 call (i.e. at shell-export time,
  not after the process has started).
