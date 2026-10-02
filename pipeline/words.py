"""Read a timetable PDF into lines of positioned words.

Everything PDF-specific lives here. The rest of the pipeline works on plain
dicts, so tests can use small fixture extracts instead of whole PDFs.
"""

import re

LINE_TOLERANCE = 1.5  # words whose tops differ by less than this share a line
HEADER_END = "Time Time Date Date"  # last line of the column header on every page

MONTHS = {m: i + 1 for i, m in enumerate(
    "January February March April May June July August September October November December".split())}


def group_lines(words, page=0):
    """Group words (dicts with text/x0/top) into lines sorted top to bottom."""
    lines = []
    for w in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        if lines and abs(lines[-1]["top"] - w["top"]) < LINE_TOLERANCE:
            lines[-1]["words"].append(w)
        else:
            lines.append({"page": page, "top": w["top"], "words": [w]})
    for line in lines:
        line["words"].sort(key=lambda w: w["x0"])
    return lines


def line_text(line):
    return " ".join(w["text"] for w in line["words"])


def split_header(lines):
    """Split one page's lines into (header lines, body lines)."""
    for i, line in enumerate(lines):
        if line_text(line).startswith(HEADER_END):
            return lines[: i + 1], lines[i + 1:]
    return lines, []


def parse_header(header_text):
    """Pull the term label and generation timestamp out of page header text."""
    term = re.search(r"(Fall|Winter|Summer|Spring|Intersession)\s+(\d{4})\s+Course Offerings", header_text)
    date = re.search(r"[A-Z][a-z]+day,\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})", header_text)
    clock = re.search(r"Course Offerings\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)", header_text)
    if not term or not date:
        raise ValueError("could not find term name or generation date in page header")
    month = MONTHS[date.group(1)]
    generated = f"{date.group(3)}-{month:02d}-{int(date.group(2)):02d}"
    if clock:
        h, m, s, ampm = clock.groups()
        h = int(h) % 12 + (12 if ampm == "PM" else 0)
        generated += f"T{h:02d}:{m}:{s}"
    return {"season": term.group(1), "year": int(term.group(2)), "generated": generated}


def read_pdf(path):
    """Return (header info, body lines across all pages) for a timetable PDF."""
    import pdfplumber

    body = []
    header = None
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            words = [
                {"text": w["text"], "x0": round(w["x0"], 1), "top": round(w["top"], 1),
                 "font": w["fontname"], "size": round(w["size"], 1)}
                for w in page.extract_words(x_tolerance=1.5, extra_attrs=["fontname", "size"])
            ]
            head, rest = split_header(group_lines(words, page=i))
            if header is None:
                header = parse_header("\n".join(line_text(l) for l in head))
            body.extend(rest)
    return header, body
