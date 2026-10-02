# LancerPlan

A free, unofficial timetable planner for University of Windsor students.
Search courses, pick your lecture and lab sections, see a clash-free weekly
timetable, let it generate schedules that fit your preferences, then share the
link or export to your calendar. No sign-up, no server, nothing sent anywhere.

**Live site:** https://nilkanthsuthar.github.io/LancerPlan/

> LancerPlan is a student project. It is **not affiliated with or endorsed by
> the University of Windsor**. Registration happens in UWinsite; always confirm
> sections there.

## Where the data comes from

Only the public timetable PDFs on the Registrar's
[timetable information page](https://www.uwindsor.ca/registrar/541/timetable-information)
(undergraduate, graduate and law). Nothing is taken from UWinsite or anything
behind a login. The PDFs are kept in [`data/raw/`](data/raw/) with their source
URLs in [`data/raw/sources.json`](data/raw/sources.json), so every build is
reproducible.

Things the PDFs don't give us, or give us oddly:

- **Full** is a snapshot from when the PDF was generated.
- Titles are cut to 30 characters. Rooms and instructors are blank.
- Stop times, dates and long day codes wrap onto the lines above and below a
  row; the parser stitches them back together.
- Some rows have meeting times but no `Section N` label. If they sit between
  consecutively numbered sections they're treated as extra meetings of the
  section above; if they come before the first label or exactly fill a gap in
  the numbering they're treated as their own sections. Either way the section
  is flagged in the data and marked in the app.
- Two sections only clash if their days, times **and** date ranges overlap, so
  first-half and second-half courses can share a slot.

## How it works

```
data/raw/*.pdf ──► pipeline/ (Python + pdfplumber) ──► data/<term>.json ──► Vite site
```

- `pipeline/words.py` reads positioned words from the PDF.
- `pipeline/parse.py` turns lines into courses → components (LEC/LAB/TUT/…) → sections → meetings.
- `pipeline/validate.py` fails the build on bad data (times, days, dates, duplicate IDs, counts out of range).
- `src/` is a plain JavaScript app: search, course pages, the weekly calendar,
  date-aware clash detection, the schedule generator and `.ics` export.

The plan lives in the URL (`#/plan?t=fall-2026&c=COMP-1000.LEC1.LAB51,MATH-1720`)
and in `localStorage`. Opening someone else's link never overwrites your saved
plan unless you choose to keep it.

## Development

Needs Python 3.12+ and Node 22+.

```bash
pip install -r requirements.txt
npm install
npm run data      # parse data/raw/*.pdf into data/*.json
npm run dev       # http://localhost:5173/LancerPlan/
```

Tests:

```bash
python -m pytest -q pipeline
npm test
```

Parser tests use small fixtures cut from the real PDFs (`pipeline/tests/fixtures/`).
To add one: `python -m pipeline.fixture <pdf> out.json <page>:<top>-<bottom>`.

## Adding a new term

1. `python -m pipeline.fetch` lists the timetable PDFs currently on the registrar page.
2. `python -m pipeline.fetch winter_2027` downloads that term's undergrad, grad and law PDFs into `data/raw/` and records their URLs.
   (Or download them yourself and drop them into `data/raw/` keeping the registrar's file names.)
3. `npm run data` to check it parses and validates, then commit and push.

GitHub Actions runs the tests, rebuilds the data from the PDFs and deploys to
GitHub Pages. Re-running step 2 picks up a newer copy of a PDF the registrar has
updated.

## Reporting a mistake

Open an issue with the term, course code, section, and what's different from
the PDF or UWinsite. Each course page says which PDF page it came from.
