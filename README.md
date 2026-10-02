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

## Keeping the data fresh

Nothing to do by hand. `.github/workflows/refresh.yml` runs every morning:

1. Downloads the current and upcoming terms' PDFs from the registrar page
   (`python -m pipeline.fetch --current`). Files are only rewritten when their
   bytes change.
2. If something changed, runs the parser tests and validation, commits the new
   PDFs to `data/raw/` and starts a deploy.
3. If the parser or validation fails, nothing is committed and the site keeps
   the last good data. The failed run triggers GitHub's usual email; that's the
   only time anyone needs to look.

New terms (e.g. Winter 2027) show up the day after the registrar posts them.
The site shows the newest 3 terms; older PDFs stay in the repo. GitHub pauses
scheduled workflows after 60 days without activity, so the same workflow
re-enables itself every run and pushes an empty commit if the repo has been
quiet for 50 days.

To pull a term manually: `python -m pipeline.fetch winter_2027`, then
`npm run data` to check it, then commit and push. To run the refresh now:
Actions → refresh timetable data → Run workflow.

## Reporting a mistake

Open an issue with the term, course code, section, and what's different from
the PDF or UWinsite. Each course page says which PDF page it came from.
