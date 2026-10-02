import json
from pathlib import Path

import pytest

from pipeline.parse import ParseError, classify, parse_lines, parse_time, tokenize_days
from pipeline.validate import validate_term
from pipeline.words import group_lines, parse_header, split_header

FIXTURES = Path(__file__).parent / "fixtures"


def load(name, level="ugrd"):
    data = json.loads((FIXTURES / f"{name}.json").read_text())
    return {c["code"]: c for c in parse_lines(data["lines"], level)}


def sections(course, comp_type=None):
    return {s["key"]: s for comp in course["components"]
            if comp_type in (None, comp["type"]) for s in comp["sections"]}


def hm(m):
    return f"{m['start'] // 60:02d}:{m['start'] % 60:02d}-{m['end'] // 60:02d}:{m['end'] % 60:02d}"


# ---------------------------------------------------------------- days and times

@pytest.mark.parametrize("code,days", [
    ("M", ["M"]), ("TTH", ["T", "TH"]), ("MWF", ["M", "W", "F"]),
    ("MTWTH", ["M", "T", "W", "TH"]), ("THF", ["TH", "F"]), ("SA", ["SA"]),
    ("SU", ["SU"]), ("MTWTHFSA", ["M", "T", "W", "TH", "F", "SA"]), ("TSA", ["T", "SA"]),
])
def test_tokenize_days(code, days):
    assert tokenize_days(code) == days


@pytest.mark.parametrize("bad", ["X", "MX", "TT", "S", "H"])
def test_tokenize_days_rejects_junk(bad):
    with pytest.raises(ParseError):
        tokenize_days(bad)


@pytest.mark.parametrize("clock,ampm,mins", [
    ("08:30", "AM", 510), ("12:00", "PM", 720), ("12:20", "PM", 740),
    ("12:00", "AM", 0), ("01:00", "PM", 780), ("11:50", "PM", 1430),
])
def test_parse_time(clock, ampm, mins):
    assert parse_time(clock, ampm) == mins


@pytest.mark.parametrize("clock,ampm", [("13:00", "PM"), ("8:3", "AM"), ("08:30", None), ("08:60", "AM")])
def test_parse_time_rejects_junk(clock, ampm):
    with pytest.raises(ParseError):
        parse_time(clock, ampm)


# ---------------------------------------------------------------- page header

def test_header_is_split_off_and_parsed():
    def w(text, x0, top):
        return {"text": text, "x0": x0, "top": top}
    words = [
        w("Note:Theseapplications", 72, 300), w("Monday,", 417, 352), w("September", 456, 352),
        w("28,", 505, 352), w("2026", 520, 352), w("Fall", 72, 361.6), w("2026", 96, 361.6),
        w("Course", 126, 361.6), w("Offerings", 171, 361.6), w("02:30:22", 487, 362.8), w("PM", 526, 362.8),
        w("Time", 275, 414), w("Time", 320, 414), w("Date", 361, 414), w("Date", 406, 414),
        w("Faculty", 72, 440), w("of", 110, 440), w("Law", 125, 440),
    ]
    head, body = split_header(group_lines(words))
    assert [l["words"][0]["text"] for l in body] == ["Faculty"]
    info = parse_header("\n".join(" ".join(x["text"] for x in l["words"]) for l in head))
    assert info == {"season": "Fall", "year": 2026, "generated": "2026-09-28T14:30:22"}


# ---------------------------------------------------------------- courses

def test_lecture_and_lab_entries_merge_into_one_course():
    c = load("comp1000_lec_lab")["COMP-1000"]
    assert c["title"] == "Key Concepts in Computer Scie"
    assert c["dept"] == "Computer Science"  # the faculty heading is pages earlier
    assert [comp["type"] for comp in c["components"]] == ["LEC", "LAB"]
    lec = sections(c, "LEC")["LEC1"]
    assert lec["full"] is True and lec["credits"] == 3.0
    (m,) = lec["meetings"]
    assert m["days"] == ["T", "TH"] and hm(m) == "08:30-09:50"  # stop time rebuilt from wrapped lines
    assert (m["startDate"], m["endDate"]) == ("2026-09-10", "2026-12-09")
    labs = sections(c, "LAB")
    assert list(labs) == ["LAB51", "LAB52", "LAB53", "LAB54", "LAB55"]
    assert labs["LAB51"]["credits"] is None
    assert hm(labs["LAB55"]["meetings"][0]) == "20:30-21:50"
    assert [labs[k]["full"] for k in labs] == [True, True, False, False, False]


def test_half_term_dates():
    cs = load("dram_half_term")
    first = cs["DRAM-4510"]["components"][0]["sections"][0]["meetings"][0]
    second = cs["DRAM-3210"]["components"][0]["sections"][0]["meetings"][0]
    assert (first["startDate"], first["endDate"]) == ("2026-09-10", "2026-10-30")
    assert (second["startDate"], second["endDate"]) == ("2026-11-02", "2026-12-17")
    assert first["days"] == ["M", "T", "W", "TH"]


def test_untimed_sections_and_odd_codes():
    cs = load("untimed_codes")
    assert set(cs) == {"ARSC-4990A", "ARSC-4990B", "ARTX-4XXX"}
    ex = sections(cs["ARTX-4XXX"])["LEC28"]
    assert ex["full"] is True and ex["credits"] == 15.0
    (m,) = ex["meetings"]
    assert m["days"] is None and m["start"] is None
    assert (m["startDate"], m["endDate"]) == ("2026-09-10", "2026-12-09")


def test_rows_between_consecutive_sections_are_extra_meetings():
    c = load("geng2190_extra_meetings")["GENG-2190"]
    secs = sections(c)
    assert list(secs) == [f"LEC{i}" for i in range(1, 7)]
    s1 = secs["LEC1"]
    assert s1["flag"] == "extra-meetings"
    assert [(m["days"], hm(m)) for m in s1["meetings"]] == [
        (["T"], "14:30-16:20"), (["TH"], "18:30-20:20"), (["M", "W"], "14:30-15:50")]


def test_unlabelled_row_before_first_label_is_its_own_section():
    c = load("math1270_unlabelled_tut")["MATH-1270"]
    lec = sections(c, "LEC")
    assert list(lec) == ["LEC1", "LEC2"]
    assert lec["LEC1"]["flag"] == "number-inferred"
    assert lec["LEC1"]["meetings"][0]["days"] == ["M", "W"]
    assert "flag" not in lec["LEC2"]
    # tutorials are listed inside the lecture entry, not a separate one
    assert list(sections(c, "TUT")) == ["TUT51", "TUT52"]


def test_orphans_filling_a_numbering_gap_across_a_page_break():
    c = load("nurs2531_gap_page_break")["NURS-2531"]
    secs = sections(c)
    assert list(secs) == [f"LEC{i}" for i in range(51, 67)]
    inferred = [k for k, s in secs.items() if s.get("flag") == "number-inferred"]
    assert inferred == ["LEC51", "LEC52", "LEC53", "LEC54", "LEC56", "LEC57", "LEC58", "LEC59", "LEC62"]
    assert len(secs["LEC55"]["meetings"]) == 1  # not 9 meetings glued together
    assert hm(secs["LEC54"]["meetings"][0]) == "17:40-20:30"


def test_course_with_no_section_labels():
    c = load("math2250_no_labels")["MATH-2250"]
    lec = sections(c, "LEC")
    assert list(lec) == ["LECx1"]
    assert lec["LECx1"]["id"] is None and lec["LECx1"]["flag"] == "unlabelled"
    assert list(sections(c, "LAB")) == ["LAB51"]


def test_row_with_only_dates_becomes_an_untimed_meeting():
    s = sections(load("acct2550_dates_only_row")["ACCT-2550"])["LEC3"]
    assert [m["days"] for m in s["meetings"]] == [["T"], None]
    assert s["meetings"][1]["startDate"] == "2026-09-10"


def test_time_without_day_is_kept_but_unscheduled():
    (m,) = sections(load("biol4914a_time_no_day")["BIOL-4914A"])["LEC1"]["meetings"]
    assert m["days"] is None and m["noDays"] is True and hm(m) == "16:00-18:00"


def test_day_without_time_is_kept_but_unscheduled():
    (m,) = sections(load("winter_grad_mech8970_day_no_time", "grad")["MECH-8970"])["LEC1"]["meetings"]
    assert m["days"] is None and m["dayText"] == "F"


def test_day_codes_that_wrap_above_and_below():
    (m,) = sections(load("summer_dram4000_days_wrap")["DRAM-4000"])["LEC1"]["meetings"]
    assert m["days"] == ["M", "T", "W", "TH", "F", "SA"] and hm(m) == "09:00-12:00"
    assert (m["startDate"], m["endDate"]) == ("2026-06-01", "2026-06-13")


def test_unknown_line_fails_loudly():
    line = {"page": 0, "top": 100, "words": [{"text": "???", "x0": 150, "top": 100}]}
    with pytest.raises(ParseError):
        classify(line)


# ---------------------------------------------------------------- validation

def term_with(courses):
    return {"generated": "2026-09-28", "courses": courses}


def test_validation_passes_real_fixtures_but_flags_low_counts():
    courses = list(load("comp1000_lec_lab").values())
    errors = validate_term(term_with(courses))
    assert any("courses is outside" in e for e in errors)
    assert not any("start" in e or "bad" in e for e in errors)


def test_validation_catches_bad_data():
    c = load("comp1000_lec_lab")["COMP-1000"]
    m = c["components"][0]["sections"][0]["meetings"][0]
    m["end"] = m["start"]
    m["days"] = ["X"]
    c["components"][1]["sections"][1]["key"] = "LAB51"
    errors = validate_term(term_with([c]))
    assert any("not before stop" in e for e in errors)
    assert any("bad days" in e for e in errors)
    assert any("duplicate section id" in e for e in errors)
