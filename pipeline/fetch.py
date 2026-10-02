"""Download timetable PDFs listed on the registrar's public timetable page.

    python -m pipeline.fetch              # list what's published
    python -m pipeline.fetch winter_2027  # download that term's ugrd/grad/law PDFs into data/raw/

Only the public registrar page is used; nothing behind a login.
"""

import datetime as dt
import json
import re
import sys
import urllib.request
from urllib.parse import urljoin

from .build import NAME_RE, RAW, REGISTRAR_PAGE

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


def main(argv):
    links = published()
    if not argv:
        for name in sorted(links):
            print(name)
        return 0
    prefix = argv[0].lower().replace("-", "_")
    wanted = {n: u for n, u in links.items() if n.startswith(prefix + "_")}
    if not wanted:
        print(f"nothing published for {prefix}")
        return 1
    sources_file = RAW / "sources.json"
    sources = json.loads(sources_file.read_text()) if sources_file.exists() else {}
    for name, url in sorted(wanted.items()):
        data = get(url)
        if not data.startswith(b"%PDF"):
            print(f"{name}: not a PDF (broken link?), skipped")
            continue
        (RAW / name).write_bytes(data)
        sources[name] = {"url": url, "retrieved": dt.date.today().isoformat()}
        print(f"{name}: {len(data):,} bytes")
    sources_file.write_text(json.dumps(sources, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
