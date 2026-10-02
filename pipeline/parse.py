"""Turn positioned lines from a timetable PDF into courses, components and sections.

Layout facts this relies on (all in PDF points, page width 612):
  * columns are fixed x bands (see BANDS)
  * stop time and both dates wrap onto a line just above and just below the
    row they belong to (about +/-5pt), e.g. "03:50" / "PM" and "2026-" / "09-10"
  * a course header row starts with a code like COMP-1000 at x=72
  * section rows start with the word "Section"
  * some rows carry meeting data but no "Section ..." label; see resolve_orphans
"""

import re

BANDS = {
    "section": (72, 150),
    "credits": (150, 195),
    "activity": (195, 222),
    "days": (222, 262),
    "start": (262, 315),
    "stop": (315, 355),
    "start_date": (355, 398),
    "end_date": (398, 435),
    "room": (435, 498),
    "professor": (498, 10_000),
}
WRAP_DISTANCE = 7.5  # max vertical gap between a row and its wrapped fragments
# columns that wrap onto the lines above/below a row (days only for long codes like MTWTHFSA)
WRAP_BANDS = ("days", "stop", "start_date", "end_date", "room", "professor")
TITLE_X = 195  # course titles start here

DAY_TOKENS = ["TH", "SA", "SU", "M", "T", "W", "F"]
DAY_ORDER = ["M", "T", "W", "TH", "F", "SA", "SU"]
CODE_RE = re.compile(r"^[A-Z]{3,5}-")
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LAB_TITLE = "Laboratory"


class ParseError(ValueError):
    pass


# ---------------------------------------------------------------- small parsers

def tokenize_days(code):
    """'MTWTH' -> ['M', 'T', 'W', 'TH']. Two-letter codes are matched first."""
    days, i = [], 0
    while i < len(code):
        for tok in DAY_TOKENS:
            if code.startswith(tok, i):
                days.append(tok)
                i += len(tok)
                break
        else:
            raise ParseError(f"bad day code {code!r}")
    if len(set(days)) != len(days):
        raise ParseError(f"repeated day in {code!r}")
    return days


def parse_time(clock, ampm):
    """'08:30', 'PM' -> minutes after midnight."""
    m = TIME_RE.match(clock or "")
    if not m or ampm not in ("AM", "PM"):
        raise ParseError(f"bad time {clock!r} {ampm!r}")
    h, mins = int(m.group(1)), int(m.group(2))
    if not (1 <= h <= 12 and 0 <= mins < 60):
        raise ParseError(f"bad time {clock!r} {ampm!r}")
    return (h % 12 + (12 if ampm == "PM" else 0)) * 60 + mins


def in_band(word, band):
    lo, hi = BANDS[band]
    return lo <= word["x0"] < hi


def band_text(words, band):
    return [w["text"] for w in words if in_band(w, band)]


# ---------------------------------------------------------------- line kinds

def classify(line):
    words = line["words"]
    first = words[0]
    if first["text"] == "Section" and first["x0"] < 80:
        return "section"
    if first["x0"] < 80 and CODE_RE.match(first["text"]):
        return "course"
    if first["x0"] < 80:
        return "heading"
    if any(in_band(w, "start") for w in words):
        return "meeting"
    if all(any(in_band(w, b) for b in WRAP_BANDS) for w in words):
        return "fragment"
    raise ParseError(f"unrecognised line on page {line['page'] + 1}: {' '.join(w['text'] for w in words)!r}")


def parse_course_header(words):
    """COMP-1000 (-) Key Concepts... -> ('COMP-1000', 'Key Concepts...')."""
    code_parts = []
    for w in words:
        if w["x0"] >= TITLE_X or w["text"].startswith("("):
            break
        code_parts.append(w["text"])
    code = "".join(code_parts)
    if not re.match(r"^[A-Z]{3,5}-[0-9A-Z]{4}[A-Z]?$", code):
        raise ParseError(f"bad course code {code!r}")
    title = " ".join(w["text"] for w in words if w["x0"] >= TITLE_X).strip()
    return code, title


# ---------------------------------------------------------------- rows

def attach_fragments(lines):
    """Pair each section/meeting row with the wrapped fragment lines around it.

    Returns a list of rows: dicts with kind, the row's own words and the
    fragment words above and below. Fragment pairs with no row between them
    (a meeting that only has dates) become rows of their own.
    """
    rows, fragments = [], []
    for line in lines:
        kind = classify(line)
        if kind == "fragment":
            fragments.append(line)
        else:
            rows.append({"kind": kind, "page": line["page"], "top": line["top"],
                         "words": line["words"], "above": [], "below": []})

    anchors = [r for r in rows if r["kind"] in ("section", "meeting")]
    leftovers = []
    for frag in fragments:
        best = None
        for r in anchors:
            if r["page"] != frag["page"]:
                continue
            d = abs(r["top"] - frag["top"])
            if d <= WRAP_DISTANCE and (best is None or d < abs(best["top"] - frag["top"])):
                best = r
        if best is None:
            leftovers.append(frag)
        else:
            (best["above"] if frag["top"] < best["top"] else best["below"]).append(frag)

    # A fragment pair with nothing between them: a row with dates and no
    # days/times, whose own (empty) line simply isn't there.
    leftovers.sort(key=lambda f: (f["page"], f["top"]))
    i = 0
    while i < len(leftovers):
        a = leftovers[i]
        b = leftovers[i + 1] if i + 1 < len(leftovers) else None
        if b and b["page"] == a["page"] and 0 < b["top"] - a["top"] <= 2 * WRAP_DISTANCE:
            rows.append({"kind": "meeting", "page": a["page"], "top": (a["top"] + b["top"]) / 2,
                         "words": [], "above": [a], "below": [b]})
            i += 2
        else:
            raise ParseError(f"stray fragment on page {a['page'] + 1}: "
                             f"{' '.join(w['text'] for w in a['words'])!r}")
    rows.sort(key=lambda r: (r["page"], r["top"]))
    return rows


def _joined(row, band):
    """Text in one band, read top to bottom across the row and its fragments."""
    parts = []
    for line in row["above"]:
        parts += band_text(line["words"], band)
    parts += band_text(row["words"], band)
    for line in row["below"]:
        parts += band_text(line["words"], band)
    return parts


def parse_meeting(row):
    """Days, times, dates, room and professor for one row."""
    where = f"page {row['page'] + 1}"
    days_txt = _joined(row, "days")
    days_txt = ["".join(days_txt)] if days_txt else []
    start_txt = band_text(row["words"], "start")
    stop_txt = _joined(row, "stop")
    sdate = "".join(_joined(row, "start_date"))
    edate = "".join(_joined(row, "end_date"))
    meeting = {"days": None, "start": None, "end": None,
               "startDate": sdate or None, "endDate": edate or None}
    for key in ("startDate", "endDate"):
        if meeting[key] is not None and not DATE_RE.match(meeting[key]):
            raise ParseError(f"bad date {meeting[key]!r} on {where}")
    if days_txt and not start_txt and not stop_txt:
        # A day with no time (e.g. a thesis section listed as "F"): keep the
        # day for display, but it can't go on the calendar.
        meeting["dayText"] = days_txt[0]
        tokenize_days(days_txt[0])
    elif days_txt or start_txt or stop_txt:
        if len(start_txt) != 2 or len(stop_txt) != 2:
            raise ParseError(f"incomplete meeting on {where}: days={days_txt} start={start_txt} stop={stop_txt}")
        meeting["start"] = parse_time(*start_txt)
        meeting["end"] = parse_time(*stop_txt)
        if days_txt:
            meeting["days"] = tokenize_days(days_txt[0])
        else:
            # A time with no day (seen once, BIOL-4914A): keep the time, but it
            # can't go on the calendar.
            meeting["noDays"] = True
    room = " ".join(_joined(row, "room")) or None
    prof = " ".join(_joined(row, "professor")) or None
    if room:
        meeting["room"] = room
    if prof:
        meeting["professor"] = prof
    return meeting


def parse_section_label(words):
    """'Section 28 Full 15.00 LEC' -> id, full, credits, activity."""
    sec = band_text(words, "section")
    if len(sec) < 2:
        raise ParseError(f"bad section label {' '.join(w['text'] for w in words)!r}")
    sid = sec[1]
    if not re.match(r"^[0-9]+[A-Z]?$", sid):
        raise ParseError(f"bad section id {sid!r}")
    extra = sec[2:]
    full = bool(extra) and extra[0].startswith("Ful")
    if extra and not full:
        raise ParseError(f"unexpected text in section column: {extra}")
    cred = band_text(words, "credits")
    credits = float(cred[0]) if cred else None
    act = band_text(words, "activity")
    if len(act) != 1 or not re.match(r"^[A-Z][A-Z0-9]{1,3}$", act[0]):
        raise ParseError(f"bad activity {act} for section {sid}")
    return {"id": sid, "full": full, "credits": credits, "activity": act[0]}


# ---------------------------------------------------------------- entries

def build_entries(lines):
    """Group rows under their course header rows, tracking faculty/department."""
    entries, faculty, dept = [], None, None
    current = None
    for row in attach_fragments(lines):
        kind = row["kind"]
        if kind == "heading":
            name = " ".join(w["text"] for w in row["words"])
            if row["words"][0].get("size", 11) >= 11.5:
                faculty, dept = name, None
            else:
                dept = name
            continue
        if kind == "course":
            code, title = parse_course_header(row["words"])
            current = {"code": code, "title": title, "faculty": faculty, "dept": dept,
                       "page": row["page"] + 1, "rows": []}
            entries.append(current)
            continue
        if current is None:
            raise ParseError(f"row before any course header on page {row['page'] + 1}")
        item = {"meeting": parse_meeting(row)}
        if kind == "section":
            item["label"] = parse_section_label(row["words"])
        current["rows"].append(item)
    return entries


def _same_meeting(a, b):
    keys = ("days", "start", "end", "startDate", "endDate", "room", "professor")
    return all(a.get(k) == b.get(k) for k in keys)


def _dedupe(meetings):
    out = []
    for m in meetings:
        if not any(_same_meeting(m, o) for o in out):
            out.append(m)
    return out


def _num(sid):
    return int(sid) if sid and sid.isdigit() else None


def resolve_orphans(entry):
    """Turn an entry's rows into sections.

    Some rows in the PDF have days/times/dates but no "Section N" label. They
    show up in two ways, which the section numbering tells apart:
      * between consecutively numbered sections (S1 o o S2): extra meetings of
        the section above, e.g. a lecture with a separate evening slot
      * before the first label (o S2) or exactly filling a numbering gap
        (S55 o o o o S60): sections whose label is missing from the PDF
    Any other orphan after a label is treated as an extra meeting. Every
    section touched by this gets a "flag" so the app can say so.
    """
    rows = entry["rows"]
    labels = [r["label"] for r in rows if "label" in r]
    default_act = "LAB" if entry["title"] == LAB_TITLE else (labels[0]["activity"] if labels else "LEC")
    default_credits = next((l["credits"] for l in labels if l["activity"] == default_act), None)

    def unlabelled(meeting, sid=None):
        return {"id": sid, "full": False, "credits": default_credits, "activity": default_act,
                "meetings": [meeting], "flag": "number-inferred" if sid else "unlabelled"}

    # split into runs: leading orphans, then (label, following orphans) pairs
    leading, groups = [], []
    for r in rows:
        if "label" in r:
            groups.append([r, []])
        elif groups:
            groups[-1][1].append(r["meeting"])
        else:
            leading.append(r["meeting"])

    sections = []
    leading = _dedupe_adjacent(leading)
    if leading:
        first = _num(labels[0]["id"]) if labels else None
        k = len(leading)
        start = first - k if first else None
        infer = start in (1, 51)
        for i, m in enumerate(leading):
            sections.append(unlabelled(m, str(start + i) if infer else None))

    for gi, (row, orphans) in enumerate(groups):
        sec = dict(row["label"])
        sec["meetings"] = [row["meeting"]]
        sections.append(sec)
        if not orphans:
            continue
        orphans = _dedupe_adjacent(orphans)
        a = _num(sec["id"])
        b = _num(groups[gi + 1][0]["label"]["id"]) if gi + 1 < len(groups) else None
        if a is not None and b is not None and b - a - 1 == len(orphans):
            for i, m in enumerate(orphans):
                sections.append(unlabelled(m, str(a + 1 + i)))
            continue
        before = len(sec["meetings"])
        sec["meetings"] = _dedupe(sec["meetings"] + orphans)
        if len(sec["meetings"]) > before:
            sec["flag"] = "extra-meetings"

    for s in sections:
        s["meetings"] = _dedupe(s["meetings"])
    return sections


def _dedupe_adjacent(meetings):
    out = []
    for m in meetings:
        if not out or not _same_meeting(out[-1], m):
            out.append(m)
    return out


# ---------------------------------------------------------------- courses

def section_key(sec, n_unlabelled):
    if sec["id"] is None:
        return f"{sec['activity']}x{n_unlabelled}"
    return f"{sec['activity']}{sec['id']}"


def build_courses(entries, level):
    """Merge entries with the same code (lecture + 'Laboratory' entries) into courses."""
    courses = {}
    for e in entries:
        c = courses.get(e["code"])
        if c is None:
            c = courses[e["code"]] = {
                "code": e["code"], "subject": e["code"].split("-")[0],
                "title": e["title"], "faculty": e["faculty"], "dept": e["dept"],
                "levels": [level], "components": {}, "page": e["page"],
            }
        elif c["title"] == LAB_TITLE and e["title"] != LAB_TITLE:
            c["title"] = e["title"]
        unl = sum(1 for comp in c["components"].values() for s in comp if s["id"] is None)
        for sec in resolve_orphans(e):
            if sec["id"] is None:
                unl += 1
            key = section_key(sec, unl)
            comp = c["components"].setdefault(sec["activity"], [])
            if any(s["key"] == key for s in comp):
                raise ParseError(f"duplicate section {key} in {e['code']}")
            sec["key"] = key
            comp.append(sec)
    return list(courses.values())


def finalize(course):
    """Convert to the JSON shape used by the app."""
    order = {"LEC": 0, "LAB": 1, "TUT": 2}
    comps = []
    for act in sorted(course["components"], key=lambda a: (order.get(a, 9), a)):
        secs = []
        for s in course["components"][act]:
            out = {"key": s["key"], "id": s["id"], "full": s["full"], "credits": s["credits"],
                   "meetings": s["meetings"]}
            if s.get("flag"):
                out["flag"] = s["flag"]
            secs.append(out)
        comps.append({"type": act, "sections": secs})
    return {"code": course["code"], "subject": course["subject"], "title": course["title"],
            "faculty": course["faculty"], "dept": course["dept"], "levels": course["levels"],
            "page": course["page"], "components": comps}


def parse_lines(lines, level):
    return [finalize(c) for c in build_courses(build_entries(lines), level)]
