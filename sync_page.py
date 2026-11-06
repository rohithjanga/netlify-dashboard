#!/usr/bin/env python3
"""Copy the dashboard page into public/index.html, wired to read its reports from S3.

The page's loader (REPORT_BLOCKS in its script) uses an embedded report block when
it holds data, and otherwise fetches window.DASHBOARD_REPORT_URLS[<block id>].
For the hosted site we want the second path, so this script:

  1. empties every block listed in the page's REPORT_BLOCKS — the site must show
     what is in S3, never a stale copy baked into the HTML;
  2. adds, before the page's own scripts,
       window.DASHBOARD_REPORT_URLS = { "dash-programs-data": "/api/reports/dash-programs", ... }
     which this site's report function serves from S3.

Blocks the loader does not know yet (tabs still on the hand export, and the IEO
tab's adapter block) are left as they are, so those tabs keep working unchanged.

Usage (from dashboard-site/):
  python3 sync_page.py ../../regitstrationNumbersHtmlTest/index-automation.html
then commit public/index.html; Netlify redeploys on push.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'public' / 'index.html'
REPORT_FUNCTION = '/api/reports/'


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1]).resolve()
    html = src.read_text(encoding='utf-8')

    m = re.search(r'var REPORT_BLOCKS = \{(.*?)\};', html, re.S)
    if not m:
        print(f'{src.name}: no REPORT_BLOCKS loader found — nothing reads from S3 in this page')
        return 1
    blocks = re.findall(r'"([a-z0-9-]+-data)"', m.group(1))
    if not blocks:
        print('REPORT_BLOCKS is empty')
        return 1

    for block in blocks:
        pat = re.compile(r'(<script id="' + re.escape(block) + r'" type="application/json">)(.*?)(</script>)', re.S)
        if len(pat.findall(html)) != 1:
            print(f'page must contain exactly one #{block} block')
            return 1
        html = pat.sub(lambda mm: mm.group(1) + '{}' + mm.group(3), html)

    urls = ',\n'.join(f'    "{b}": "{REPORT_FUNCTION}{b[:-len("-data")]}"' for b in blocks)
    inject = ('<script>\n'
              '  // Hosted on Netlify: tabs fetch their warehouse report through this site\'s\n'
              '  // /api/reports function (S3, read-only, server-side credentials). Written by sync_page.py.\n'
              '  window.DASHBOARD_REPORT_URLS = {\n' + urls + '\n  };\n</script>\n')
    old = re.search(r'window\.DASHBOARD_REPORT_URLS = \{.*?\};\n</script>\n', html, re.S)
    if old:   # re-running on an already-synced page: replace, don't stack
        start = html.rfind('<script>', 0, old.start())
        html = html[:start] + html[old.end():]
    first_script = re.search(r'<script(?![^>]*type="application/json")[^>]*>', html)
    html = html[:first_script.start()] + inject + html[first_script.start():]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(f'wrote {OUT.relative_to(HERE)} from {src.name} ({len(html):,} bytes)')
    for b in blocks:
        print(f'  #{b:<28} -> {REPORT_FUNCTION}{b[:-len("-data")]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
