import { describe, expect, it } from 'vitest';
import { datesOverlap, findClashes, meetingsClash, sectionsClash } from './clash.js';
import { generate, scoreSchedule } from './generate.js';
import { buildIcs, escapeText, firstOccurrence, fold } from './ics.js';
import { buildHash, decodeCourses, encodeCourses, parseHash, resolveCourses } from './state.js';
import { fmtRange, fmtTime, mondayOf } from './time.js';

const FULL_TERM = { startDate: '2026-09-10', endDate: '2026-12-09' };
const FIRST_HALF = { startDate: '2026-09-10', endDate: '2026-10-30' };
const SECOND_HALF = { startDate: '2026-11-02', endDate: '2026-12-17' };

const mt = (days, start, end, dates = FULL_TERM) => ({ days, start, end, ...dates });
const sec = (key, meetings, extra = {}) => ({
  key, id: key.replace(/^[A-Z]+/, ''), full: false, credits: 3, meetings, ...extra,
});

describe('time formatting', () => {
  it('formats 12-hour times', () => {
    expect(fmtTime(510)).toBe('8:30 AM');
    expect(fmtTime(720)).toBe('12:00 PM');
    expect(fmtTime(0)).toBe('12:00 AM');
    expect(fmtRange(510, 590)).toBe('8:30–9:50 AM');
    expect(fmtRange(690, 770)).toBe('11:30 AM–12:50 PM');
  });
  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-09-10')).toBe('2026-09-07');
    expect(mondayOf('2026-09-07')).toBe('2026-09-07');
    expect(mondayOf('2026-09-13')).toBe('2026-09-07');
  });
});

describe('clash detection', () => {
  it('needs a shared day and overlapping times', () => {
    expect(meetingsClash(mt(['T', 'TH'], 510, 590), mt(['TH'], 570, 650))).toBe(true);
    expect(meetingsClash(mt(['T', 'TH'], 510, 590), mt(['M', 'W'], 510, 590))).toBe(false);
    // back to back is fine
    expect(meetingsClash(mt(['M'], 510, 590), mt(['M'], 590, 670))).toBe(false);
  });
  it('is date-aware: first and second half of term never clash', () => {
    const a = mt(['M'], 600, 680, FIRST_HALF);
    const b = mt(['M'], 600, 680, SECOND_HALF);
    expect(datesOverlap(a, b)).toBe(false);
    expect(meetingsClash(a, b)).toBe(false);
    expect(meetingsClash(a, mt(['M'], 600, 680))).toBe(true);
  });
  it('ignores untimed meetings', () => {
    expect(meetingsClash({ days: null, ...FULL_TERM }, mt(['M'], 0, 1440))).toBe(false);
  });
  it('reports the overlapping window', () => {
    const chosen = [
      { code: 'A', type: 'LEC', section: sec('LEC1', [mt(['T', 'TH'], 510, 590)]) },
      { code: 'B', type: 'LEC', section: sec('LEC1', [mt(['TH', 'F'], 570, 650, FIRST_HALF)]) },
      { code: 'C', type: 'LEC', section: sec('LEC1', [mt(['W'], 510, 590)]) },
    ];
    const clashes = findClashes(chosen);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ days: ['TH'], start: 570, end: 590, from: '2026-09-10', to: '2026-10-30' });
    expect(sectionsClash(chosen[0].section, chosen[2].section)).toBeNull();
  });
});

describe('url state', () => {
  const data = new Map([
    ['COMP-1000', { code: 'COMP-1000', components: [
      { type: 'LEC', sections: [{ key: 'LEC1' }] },
      { type: 'LAB', sections: [{ key: 'LAB51' }, { key: 'LAB52' }] },
    ] }],
    ['NURS-1000', { code: 'NURS-1000', components: [
      { type: 'PR1', sections: [{ key: 'PR151' }] },
      { type: 'LEC', sections: [{ key: 'LECx1' }] },
    ] }],
  ]);
  it('round-trips through encode/decode', () => {
    const plan = [{ code: 'COMP-1000', picks: { LEC: 'LEC1', LAB: 'LAB52' } }, { code: 'NURS-1000', picks: { PR1: 'PR151', LEC: 'LECx1' } }];
    const str = encodeCourses(plan);
    expect(str).toBe('COMP-1000.LEC1.LAB52,NURS-1000.PR151.LECx1');
    expect(resolveCourses(decodeCourses(str), data)).toEqual(plan);
  });
  it('drops unknown courses, sections and junk', () => {
    const out = resolveCourses(decodeCourses('COMP-1000.LAB99.LEC1,FAKE-0000,<script>,COMP-1000.LAB51'), data);
    expect(out).toEqual([{ code: 'COMP-1000', picks: { LEC: 'LEC1' } }]);
  });
  it('keeps courses with nothing picked', () => {
    expect(resolveCourses(decodeCourses('COMP-1000'), data)).toEqual([{ code: 'COMP-1000', picks: {} }]);
  });
  it('builds and parses hashes', () => {
    const h = buildHash(['plan'], { term: 'fall-2026', courses: [{ code: 'COMP-1000', picks: { LEC: 'LEC1' } }, { code: 'NURS-1000', picks: {} }] });
    expect(h).toBe('#/plan?t=fall-2026&c=COMP-1000.LEC1,NURS-1000');
    const p = parseHash(h);
    expect(p.path).toEqual(['plan']);
    expect(p.query.get('c')).toBe('COMP-1000.LEC1,NURS-1000');
    expect(parseHash('').path).toEqual([]);
  });
});

describe('schedule generation', () => {
  const course = (code, components) => ({ code, components: components.map(([type, sections]) => ({ type, sections })) });
  const A = course('A', [
    ['LEC', [sec('LEC1', [mt(['M', 'W'], 510, 590)]), sec('LEC2', [mt(['T', 'TH'], 600, 680)])]],
    ['LAB', [sec('LAB51', [mt(['M'], 600, 710)]), sec('LAB52', [mt(['F'], 600, 710)]), sec('LAB53', [mt(['F'], 600, 710)], { full: true })]],
  ]);
  const B = course('B', [['LEC', [sec('LEC1', [mt(['M', 'W'], 510, 590)]), sec('LEC2', [mt(['M', 'W'], 780, 860)])]]]);

  it('lists only clash-free combinations', () => {
    const { results, found, capped } = generate([A, B], { minGaps: false, full: 'allow' });
    expect(capped).toBe(false);
    // A.LEC1 clashes with B.LEC1; LAB52/53 are the same slot and collapse into one value
    expect(found).toBe(6);
    for (const r of results) {
      expect(!(r.picks.A.LEC === 'LEC1' && r.picks.B.LEC === 'LEC1')).toBe(true);
    }
  });
  it('collapses identical sections and prefers the open one', () => {
    const { results } = generate([A], { full: 'avoid' });
    const fri = results.find((r) => r.picks.A.LAB !== 'LAB51');
    expect(fri.picks.A.LAB).toBe('LAB52');
    expect(fri.alternatives.A.LAB).toEqual(['LAB53']);
  });
  it('ranks by preferences', () => {
    const offFriday = generate([A, B], { daysOff: ['F'], minGaps: false }).results[0];
    expect(offFriday.stats.daysUsed).not.toContain('F');
    const late = generate([A, B], { earliest: 600, minGaps: false }).results[0];
    expect(late.stats.earliest).toBeGreaterThanOrEqual(600);
    const compact = generate([A, B], { minGaps: true }).results[0];
    const all = generate([A, B], { minGaps: false, full: 'allow' }).results;
    expect(compact.stats.gapMinutes).toBe(Math.min(...all.map((r) => r.stats.gapMinutes)));
  });
  it('can exclude Full sections and respects locked picks', () => {
    const solo = course('C', [['LEC', [sec('LEC1', [mt(['M'], 600, 680)], { full: true })]]]);
    const r = generate([solo], { full: 'exclude' });
    expect(r.results).toHaveLength(0);
    expect(r.problems[0]).toMatchObject({ code: 'C', reason: 'all sections Full' });
    const locked = generate([A, B], {}, { locked: { A: { LEC: 'LEC2' } } });
    expect(locked.results.every((x) => x.picks.A.LEC === 'LEC2')).toBe(true);
  });
  it('uses date-aware clashes', () => {
    const half = course('H', [['LEC', [sec('LEC1', [mt(['M'], 510, 590, FIRST_HALF)])]]]);
    const half2 = course('J', [['LEC', [sec('LEC1', [mt(['M'], 510, 590, SECOND_HALF)])]]]);
    expect(generate([half, half2]).found).toBe(1);
  });
  it('stops at the node cap on big inputs', () => {
    const many = Array.from({ length: 8 }, (_, i) => course(`X${i}`, [['LEC', Array.from({ length: 12 }, (_, j) => sec(`LEC${j + 1}`, [mt([['M', 'T', 'W', 'TH', 'F'][j % 5]], 480 + 60 * Math.floor(j / 5), 530 + 60 * Math.floor(j / 5))]))]]));
    const r = generate(many, {}, { maxNodes: 5000 });
    expect(r.capped).toBe(true);
    expect(r.nodes).toBeLessThanOrEqual(5001);
    expect(r.results.length).toBeGreaterThan(0);
  });
  it('scores gaps and days', () => {
    const v = (days, start, end) => ({ full: false, meetings: [{ days, start, end }] });
    const { stats } = scoreSchedule([v(['M'], 480, 540), v(['M'], 600, 660), v(['W'], 480, 540)], { daysOff: [], minGaps: true });
    expect(stats).toMatchObject({ days: 2, gapMinutes: 60, earliest: 480, latest: 660 });
  });
});

describe('ics export', () => {
  const chosen = [
    { code: 'COMP-1000', title: 'Key Concepts, in CS; intro', type: 'LEC', section: sec('LEC1', [mt(['T', 'TH'], 510, 590)]) },
    { code: 'COMP-1000', title: 'Key Concepts', type: 'LAB', section: sec('LAB51', [mt(['T'], 960, 1040), { days: null, start: null, end: null, ...FULL_TERM }]) },
    { code: 'DRAM-3210', title: 'Half', type: 'LEC', section: sec('LEC1', [mt(['M', 'T', 'W', 'TH'], 600, 710, SECOND_HALF)]) },
  ];
  const { text, events } = buildIcs(chosen, { term: 'fall-2026', termLabel: 'Fall 2026', now: new Date('2026-10-02T12:00:00Z') });
  const lines = text.split('\r\n');

  it('creates one weekly event per timed meeting', () => {
    expect(events).toBe(3);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(3);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('BEGIN:VTIMEZONE');
  });
  it('starts on the first matching weekday and ends with the section', () => {
    // Sep 10 2026 is a Thursday, so a TTH lecture starts that day, a Tuesday lab on Sep 15
    expect(text).toContain('DTSTART;TZID=America/Toronto:20260910T083000');
    expect(text).toContain('DTEND;TZID=America/Toronto:20260910T095000');
    expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261210T045959Z');
    expect(text).toContain('DTSTART;TZID=America/Toronto:20260915T160000');
    // Nov 2 2026 is a Monday
    expect(text).toContain('DTSTART;TZID=America/Toronto:20261102T100000');
    expect(text).toContain('BYDAY=MO,TU,WE,TH;UNTIL=20261218T045959Z');
  });
  it('escapes text and folds long lines', () => {
    expect(text).toContain('Key Concepts\\, in CS\\; intro');
    expect(escapeText('a\nb')).toBe('a\\nb');
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const long = 'DESCRIPTION:' + 'x'.repeat(200);
    expect(fold(long).split('\r\n ').join('')).toBe(long);
  });
  it('has unique UIDs', () => {
    const uids = lines.filter((l) => l.startsWith('UID:'));
    expect(new Set(uids).size).toBe(uids.length);
  });
  it('finds first occurrences', () => {
    expect(firstOccurrence('2026-09-10', '2026-12-09', ['M'])).toBe('2026-09-14');
    expect(firstOccurrence('2026-09-10', '2026-09-12', ['M'])).toBeNull();
  });
});
