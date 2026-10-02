"""Cut a small fixture out of a timetable PDF for the parser tests.

    python -m pipeline.fixture data/raw/fall_2026_ugrd_timetable.pdf out.json 50:120-300 [51:100-200 ...]

Each segment is <page number>:<top>-<bottom> in PDF points (page numbers as
printed, starting at 1). The fixture holds the body lines in those ranges,
in the same shape read_pdf returns, so tests don't need the whole PDF.
"""

import json
import sys

from .words import read_pdf


def cut(pdf, segments):
    header, lines = read_pdf(pdf)
    keep = []
    for seg in segments:
        page, span = seg.split(":")
        lo, hi = (float(x) for x in span.split("-"))
        keep += [l for l in lines if l["page"] == int(page) - 1 and lo <= l["top"] <= hi]
    return {"header": header, "lines": keep}


if __name__ == "__main__":
    pdf, out, *segments = sys.argv[1:]
    data = cut(pdf, segments)
    with open(out, "w") as f:
        json.dump(data, f, indent=1)
    print(f"{out}: {len(data['lines'])} lines")
