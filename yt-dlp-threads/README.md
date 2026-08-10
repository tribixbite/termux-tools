# yt-dlp-threads

A [yt-dlp](https://github.com/yt-dlp/yt-dlp) extractor plugin for **Threads**
(`threads.com` / `threads.net`).

yt-dlp has no built-in Threads extractor — support has been requested for years
without a merged implementation ([#7523](https://github.com/yt-dlp/yt-dlp/issues/7523),
[#10133](https://github.com/yt-dlp/yt-dlp/issues/10133),
[#12021](https://github.com/yt-dlp/yt-dlp/issues/12021)) — and Threads serves
anonymous clients a JavaScript login wall with no media in the HTML.

## How it works

Meta server-renders the full post — including the CDN media URLs — for
link-preview crawlers. This plugin fetches the post page with a **Googlebot
User-Agent** to bypass the login wall, then extracts the progressive (muxed)
mp4 URL(s) from the embedded JSON. Handles canonical `@user/post/<id>` links,
`/share/<code>/` short links, and multi-video (carousel) posts.

> **Caveat:** this bypass is inherently fragile. If Meta stops serving crawlers
> the full payload or changes the embedded JSON keys, extraction will break.
> There is no cookie/auth support — only publicly viewable posts work.

## Install

Requires yt-dlp with plugin support (2023.01.02+).

**As a pip package** (installs into the same environment as yt-dlp):

```bash
pip install yt-dlp-threads
# or from source:
pip install git+https://github.com/tribixbite/yt-dlp-threads
```

**As a manual plugin** (no install): drop the `yt_dlp_plugins` folder into a
yt-dlp plugin directory, e.g.

```bash
mkdir -p ~/.config/yt-dlp/plugins/yt-dlp-threads
cp -r yt_dlp_plugins ~/.config/yt-dlp/plugins/yt-dlp-threads/
```

## Usage

```bash
yt-dlp "https://www.threads.com/@someone/post/ABC123"
yt-dlp -F "https://www.threads.com/share/xxxxxxxx/"   # list formats (hd/sd)
```

Verify it loaded: `yt-dlp --verbose <url>` prints `[debug] Extractor plugins: threads`.

## License

Unlicense (public domain).
