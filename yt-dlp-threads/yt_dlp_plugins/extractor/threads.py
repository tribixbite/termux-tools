"""yt-dlp extractor plugin for Threads (threads.com / threads.net).

Threads has no upstream yt-dlp extractor (long-open requests: yt-dlp #7523,
#10133, #12021). Anonymous browser/API clients get a JS login wall with no
media. The trick this plugin uses: Meta server-renders the full post — CDN
media URLs and all — for link-preview crawlers, so we fetch the page with a
Googlebot User-Agent to bypass the wall, then pull the progressive (muxed)
mp4 URL(s) out of the embedded JSON.

Caveat: this bypass is inherently fragile. If Meta stops serving crawlers the
full payload, or reshuffles the embedded JSON keys, extraction will break.
"""

import re

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import ExtractorError, url_or_none

_GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'


class ThreadsIE(InfoExtractor):
    IE_NAME = 'threads'
    _VALID_URL = r'''(?x)
        https?://(?:www\.)?threads\.(?:net|com)/
        (?:
            (?:@[^/?#]+/post|t)/(?P<id>[\w-]+)
            |share/(?P<share>[\w-]+)
        )'''
    _TESTS = [{
        'url': 'https://www.threads.com/@hunterreesepena/post/Dbrbb0Ujh2w',
        'info_dict': {
            'id': 'Dbrbb0Ujh2w',
            'ext': 'mp4',
            'uploader_id': 'hunterreesepena',
        },
        'params': {'skip_download': True},
    }, {
        # /share/<code>/ short links resolve to the same post
        'url': 'https://www.threads.com/share/_srJIVx6G/',
        'only_matching': True,
    }, {
        'url': 'https://www.threads.net/@zuck/post/C8Xw3vLxabc',
        'only_matching': True,
    }]

    @staticmethod
    def _unesc(s):
        return s.replace('\\/', '/').replace('\\u0026', '&').replace('&amp;', '&')

    def _findall(self, pattern, webpage):
        # Deduplicate while preserving document order.
        out, seen = [], set()
        for m in re.finditer(pattern, webpage):
            u = url_or_none(self._unesc(m.group(1)))
            if u and u not in seen:
                seen.add(u)
                out.append(u)
        return out

    def _build_formats(self, hd_url, sd_url):
        formats = []
        headers = {'Referer': 'https://www.threads.com/'}
        if hd_url:
            formats.append({
                'url': hd_url, 'ext': 'mp4', 'format_id': 'hd',
                'quality': 2, 'http_headers': headers,
            })
        if sd_url:
            formats.append({
                'url': sd_url, 'ext': 'mp4', 'format_id': 'sd',
                'quality': 1, 'http_headers': headers,
            })
        return formats

    def _real_extract(self, url):
        mobj = self._match_valid_url(url)
        matched_id = mobj.group('id') or mobj.group('share')

        # Crawler UA de-walls the page into the full server-rendered post.
        webpage = self._download_webpage(
            url, matched_id, note='Downloading post webpage (crawler UA)',
            headers={'User-Agent': _GOOGLEBOT_UA})

        hd = self._findall(r'"(?:playable_url_quality_hd|browser_native_hd_url)":"(https:[^"]+?)"', webpage)
        sd = self._findall(r'"(?:playable_url|browser_native_sd_url)":"(https:[^"]+?)"', webpage)
        if not hd and not sd:
            fallback = self._findall(r'"url":"(https:\\?/\\?/[^"]+?\.mp4[^"]*?)"', webpage)
            sd = fallback

        n = max(len(hd), len(sd))
        if not n:
            raise ExtractorError(
                'No video found. The post may be image-only, private/login-gated, '
                'deleted, or Threads changed its page layout.', expected=True)

        # Metadata from Open Graph tags (yt-dlp decodes the &#064; entity → @).
        og_title = self._og_search_title(webpage, default='') or ''
        description = self._og_search_description(webpage, default=None)
        thumbnail = self._og_search_thumbnail(webpage, default=None)
        uploader = re.sub(r'\s*\(@[\w.]+\)\s*on Threads.*$', '', og_title).strip() or None
        uploader_id = self._search_regex(
            r'\(@([\w.]+)\)', og_title, 'uploader id', default=None)
        # Prefer the canonical post shortcode for the id (a /share/<code> URL
        # otherwise yields the share code). og:url carries the real permalink;
        # fall back to the escaped "permalink" JSON field, then the matched id.
        canonical_url = self._og_search_property('url', webpage, default='') or ''
        real_id = (
            self._search_regex(r'/post/([\w-]+)', canonical_url, 'post id', default=None)
            or self._search_regex(
                r'"permalink":"[^"]*?/post/([\w-]+)', webpage, 'post id', default=None)
            or matched_id)

        def entry(idx, hd_url, sd_url):
            return {
                'id': real_id if n == 1 else f'{real_id}_{idx + 1}',
                'title': (description or f'Threads video {real_id}').split('\n')[0][:100],
                'description': description,
                'uploader': uploader,
                'uploader_id': uploader_id,
                'uploader_url': f'https://www.threads.com/@{uploader_id}' if uploader_id else None,
                'thumbnail': thumbnail,
                'webpage_url': url,
                'formats': self._build_formats(hd_url, sd_url),
            }

        entries = [
            entry(i, hd[i] if i < len(hd) else None, sd[i] if i < len(sd) else None)
            for i in range(n)
        ]
        if n == 1:
            return entries[0]
        return self.playlist_result(
            entries, playlist_id=real_id, playlist_title=uploader and f'{uploader} — Threads post')
