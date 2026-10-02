"""Build data/<term>.json for every term with PDFs in data/raw/.

    python -m pipeline.build          # parse, validate, write
    python -m pipeline.build --check  # parse and validate only

PDFs are named like the registrar's files: <season>_<year>_<level>_timetable.pdf
(level is ugrd, grad or law). data/raw/sources.json records where each came from.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from .parse import ParseError, parse_lines
from .validate import validate_term
from .words import read_pdf

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
REGISTRAR_PAGE = "https://www.uwindsor.ca/registrar/541/timetable-information"
FILE_URL = "https://www.uwindsor.ca/registrar/sites/uwindsor.ca.registrar/files/{name}"
NAME_RE = re.compile(r"^(fall|winter|summer)_(\d{4})_(ugrd|grad|law)_timetable\.pdf$")
LEVEL_ORDER = ["ugrd", "grad", "law"]
SEASON_ORDER = {"winter": 0, "summer": 1, "fall": 2}
MAX_TERMS = 3  # newest terms on the site; older PDFs stay in the repo but aren't published


def term_key(season, year):
    return int(year) * 10 + SEASON_ORDER[season]


def merge_course(into, other, level):
    """Same code listed in two PDFs (e.g. undergrad and law): keep one copy."""
    if level not in into["levels"]:
        into["levels"].append(level)
    for comp in other["components"]:
        target = next((c for c in into["components"] if c["type"] == comp["type"]), None)
        if target is None:
            into["components"].append(comp)
            continue
        for s in comp["sections"]:
            same = next((t for t in target["sections"] if t["key"] == s["key"]), None)
            if same is None:
                target["sections"].append(s)
            elif same["meetings"] != s["meetings"]:
                raise ParseError(f"{into['code']} {s['key']} differs between PDFs")


def build_term(term_id, files, sources):
    courses, generated, label = {}, None, None
    src_out = []
    for level, path in sorted(files, key=lambda f: LEVEL_ORDER.index(f[0])):
        header, lines = read_pdf(path)
        label = f"{header['season']} {header['year']}"
        generated = max(generated or "", header["generated"])
        try:
            parsed = parse_lines(lines, level)
        except ParseError as e:
            raise ParseError(f"{path.name}: {e}") from e
        for c in parsed:
            c["source"] = level
            if c["code"] in courses:
                merge_course(courses[c["code"]], c, level)
            else:
                courses[c["code"]] = c
        src_out.append({"level": level, "file": path.name,
                        "url": sources.get(path.name, {}).get("url", FILE_URL.format(name=path.name)),
                        "generated": header["generated"]})
    ordered = sorted(courses.values(), key=lambda c: c["code"])
    return {"term": term_id, "label": label, "generated": generated,
            "registrar": REGISTRAR_PAGE, "sources": src_out, "courses": ordered}


def summarize(term):
    secs = [s for c in term["courses"] for comp in c["components"] for s in comp["sections"]]
    timed = sum(1 for s in secs if any(m["days"] for m in s["meetings"]))
    acts = {}
    for c in term["courses"]:
        for comp in c["components"]:
            acts[comp["type"]] = acts.get(comp["type"], 0) + len(comp["sections"])
    flags = {}
    for s in secs:
        if s.get("flag"):
            flags[s["flag"]] = flags.get(s["flag"], 0) + 1
    return (f"{term['label']}: {len(term['courses'])} courses, "
            f"{len({c['subject'] for c in term['courses']})} subjects, {len(secs)} sections "
            f"({', '.join(f'{v} {k}' for k, v in sorted(acts.items()))}), {timed} timed, "
            f"{len(secs) - timed} untimed; flagged: {flags or 'none'}")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate without writing files")
    args = ap.parse_args(argv)

    sources_file = RAW / "sources.json"
    sources = json.loads(sources_file.read_text()) if sources_file.exists() else {}
    terms = {}
    for pdf in sorted(RAW.glob("*.pdf")):
        m = NAME_RE.match(pdf.name)
        if not m:
            print(f"skipping {pdf.name}: name doesn't match <season>_<year>_<level>_timetable.pdf")
            continue
        season, year, level = m.groups()
        terms.setdefault(f"{season}-{year}", []).append((level, pdf))
    if not terms:
        print("no timetable PDFs in data/raw/")
        return 1

    newest = sorted(terms, key=lambda t: -term_key(*t.split("-")))
    for old in newest[MAX_TERMS:]:
        print(f"{old}: older than the newest {MAX_TERMS} terms, not published")
    index, failed = [], False
    for term_id in newest[:MAX_TERMS]:
        files = terms[term_id]
        try:
            term = build_term(term_id, files, sources)
        except ParseError as e:
            print(f"{term_id}: parse error: {e}")
            failed = True
            continue
        errors = validate_term(term)
        print(summarize(term))
        for e in errors:
            print(f"  ERROR {e}")
        if errors:
            failed = True
            continue
        season, year = term_id.split("-")
        index.append({"id": term_id, "label": term["label"], "generated": term["generated"],
                      "levels": [s["level"] for s in term["sources"]],
                      "sort": term_key(season, year)})
        if not args.check:
            (OUT / f"{term_id}.json").write_text(json.dumps(term, separators=(",", ":")) + "\n")

    if failed:
        return 1
    index.sort(key=lambda t: -t["sort"])
    for t in index:
        del t["sort"]
    if not args.check:
        (OUT / "terms.json").write_text(json.dumps({"terms": index}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
