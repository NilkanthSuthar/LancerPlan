"""Download timetable PDFs listed on the registrar's public timetable page.

    python -m pipeline.fetch              # list what's published
    python -m pipeline.fetch winter_2027  # download that term's ugrd/grad/law PDFs into data/raw/
    python -m pipeline.fetch --current    # download every current or upcoming term (used by the daily refresh)

A file is only rewritten when its bytes changed, so an unchanged registrar page
leaves the repo untouched. Only the public registrar page is used; nothing
behind a login.
"""

import datetime as dt
import json
import re
import sys
import urllib.request
from urllib.parse import urljoin

from .build import NAME_RE, RAW, REGISTRAR_PAGE, term_key

UA = {"User-Agent": "Mozilla/5.0 (timetable planner data refresh)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def published():
    html = get(REGISTRAR_PAGE).decode("utf-8", "replace")
    links = {}
    for href in re.findall(r'href="([^"]+\.pdf)"', html):
        name = href.rsplit("/", 1)[-1]
        if NAME_RE.match(name):
            links[name] = urljoin(REGISTRAR_PAGE, href)
    return links


def current_term_key(today=None):
    """Winter runs Jan-Apr, summer May-Aug, fall Sep-Dec."""
    today = today or dt.date.today()
    season = "winter" if today.month <= 4 else "summer" if today.month <= 8 else "fall"
    return term_key(season, today.year)


def download(wanted):
    """Save PDFs whose bytes changed. Returns the names that changed."""
    sources_file = RAW / "sources.json"
    sources = json.loads(sources_file.read_text()) if sources_file.exists() else {}
    changed = []
    for name, url in sorted(wanted.items()):
        data = get(url)
        if not data.startswith(b"%PDF"):
            print(f"{name}: not a PDF (broken link?), skipped")
            continue
        path = RAW / name
        existed = path.exists()
        if existed and path.read_bytes() == data:
            print(f"{name}: unchanged")
            continue
        path.write_bytes(data)
        sources[name] = {"url": url, "retrieved": dt.date.today().isoformat()}
        changed.append(name)
        print(f"{name}: {'updated' if existed else 'new'}, {len(data):,} bytes")
    if changed:
        sources_file.write_text(json.dumps(sources, indent=2, sort_keys=True) + "\n")
    return changed


def main(argv):
    links = published()
    if not argv:
        for name in sorted(links):
            print(name)
        return 0
    if argv[0] == "--current":
        now = current_term_key()
        wanted = {n: u for n, u in links.items()
                  if term_key(*NAME_RE.match(n).groups()[:2]) >= now}
    else:
        prefix = argv[0].lower().replace("-", "_")
        wanted = {n: u for n, u in links.items() if n.startswith(prefix + "_")}
    if not wanted:
        print("nothing published for that term")
        return 0 if argv[0] == "--current" else 1
    changed = download(wanted)
    print(f"{len(changed)} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
