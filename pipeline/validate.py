"""Sanity checks on a parsed term. Any problem fails the build."""

import datetime as dt

VALID_DAYS = {"M", "T", "W", "TH", "F", "SA", "SU"}

# Fall 2026 undergrad alone has ~590 courses and ~1,260 sections. These bounds
# catch a parser that silently drops most of a PDF or explodes it.
MIN_COURSES, MAX_COURSES = 100, 5000
MIN_SECTIONS, MAX_SECTIONS = 300, 20000


def _date(s):
    return dt.date.fromisoformat(s)


def validate_term(term):
    errors = []
    courses = term["courses"]
    n_sections = sum(len(c["sections"]) for course in courses for c in course["components"])
    if not MIN_COURSES <= len(courses) <= MAX_COURSES:
        errors.append(f"{len(courses)} courses is outside the sane range {MIN_COURSES}-{MAX_COURSES}")
    if not MIN_SECTIONS <= n_sections <= MAX_SECTIONS:
        errors.append(f"{n_sections} sections is outside the sane range {MIN_SECTIONS}-{MAX_SECTIONS}")
    try:
        _date(term["generated"][:10])
    except (KeyError, ValueError):
        errors.append("missing or bad generated date")

    codes = set()
    timed = 0
    for course in courses:
        code = course["code"]
        if code in codes:
            errors.append(f"duplicate course {code}")
        codes.add(code)
        if not course["components"]:
            errors.append(f"{code} has no sections")
        keys = set()
        for comp in course["components"]:
            for s in comp["sections"]:
                where = f"{code} {s['key']}"
                if s["key"] in keys:
                    errors.append(f"duplicate section id {where}")
                keys.add(s["key"])
                if not s["meetings"]:
                    errors.append(f"{where} has no meetings")
                if s["credits"] is not None and not 0 <= s["credits"] <= 30:
                    errors.append(f"{where} has odd credits {s['credits']}")
                has_time = False
                for m in s["meetings"]:
                    if m["days"] is not None:
                        has_time = True
                        if not m["days"] or not set(m["days"]) <= VALID_DAYS:
                            errors.append(f"{where} has bad days {m['days']}")
                    if m["start"] is not None and not (0 <= m["start"] < m["end"] <= 24 * 60):
                        errors.append(f"{where} start {m['start']} is not before stop {m['end']}")
                    for key in ("startDate", "endDate"):
                        if m[key] is None:
                            continue
                        try:
                            _date(m[key])
                        except ValueError:
                            errors.append(f"{where} has bad {key} {m[key]!r}")
                    if m["startDate"] and m["endDate"]:
                        try:
                            if _date(m["startDate"]) > _date(m["endDate"]):
                                errors.append(f"{where} ends before it starts")
                        except ValueError:
                            pass
                    elif m["days"] is not None:
                        errors.append(f"{where} has a time but no date range")
                timed += has_time
    if n_sections and timed / n_sections < 0.5:
        errors.append(f"only {timed} of {n_sections} sections have times; layout probably changed")
    return errors
