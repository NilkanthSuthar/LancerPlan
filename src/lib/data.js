// Loading term data and the derived lookups the UI needs.

import { fmtDays, fmtRange } from './time.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const cache = new Map();

export const TYPE_NAMES = { LEC: 'Lecture', LAB: 'Lab', TUT: 'Tutorial', PR1: 'Practicum 1', PR2: 'Practicum 2', PRA: 'Practicum' };
export const LEVEL_NAMES = { ugrd: 'Undergrad', grad: 'Graduate', law: 'Law' };
export const FLAG_NOTES = {
  unlabelled: 'The PDF lists this section’s times without a section number. Find the number in UWinsite.',
  'number-inferred': 'The PDF lists this section without its label; the number is inferred from the ones around it. Confirm in UWinsite.',
  'extra-meetings': 'Some of these meeting times appear in the PDF without a section label and were attached to this section. Confirm in UWinsite.',
};

export async function loadTerms() {
  const r = await fetch(`${BASE}data/terms.json`);
  if (!r.ok) throw new Error(`terms.json: HTTP ${r.status}`);
  return (await r.json()).terms;
}

export async function loadTerm(id) {
  if (cache.has(id)) return cache.get(id);
  const r = await fetch(`${BASE}data/${id}.json`);
  if (!r.ok) throw new Error(`${id}.json: HTTP ${r.status}`);
  const term = indexTerm(await r.json());
  cache.set(id, term);
  return term;
}

export function indexTerm(term) {
  term.byCode = new Map(term.courses.map((c) => [c.code, c]));
  term.subjects = new Map();
  for (const c of term.courses) {
    const s = term.subjects.get(c.subject) ?? { code: c.subject, depts: new Map(), count: 0 };
    s.count++;
    const d = c.dept || c.faculty;
    if (d) s.depts.set(d, (s.depts.get(d) ?? 0) + 1);
    term.subjects.set(c.subject, s);
    c.search = searchKeys(c);
  }
  for (const s of term.subjects.values()) {
    s.name = [...s.depts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }
  let lo = null;
  let hi = null;
  for (const c of term.courses) {
    for (const comp of c.components) {
      for (const s of comp.sections) {
        for (const m of s.meetings) {
          if (m.startDate && (!lo || m.startDate < lo)) lo = m.startDate;
          if (m.endDate && (!hi || m.endDate > hi)) hi = m.endDate;
        }
      }
    }
  }
  term.firstDate = lo;
  term.lastDate = hi;
  computeUsualRange(term);
  return term;
}

const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function searchKeys(c) {
  return {
    code: norm(c.code),
    subject: c.subject,
    words: c.title.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean),
    title: c.title.toUpperCase(),
  };
}

/** Rank courses for a query. Lower rank = better match. */
export function searchCourses(term, query, { subject = '', levels = null } = {}) {
  const q = query.trim().toUpperCase();
  const qn = norm(q);
  const tokens = q.split(/[^A-Z0-9]+/).filter(Boolean);
  const out = [];
  for (const c of term.courses) {
    if (subject && c.subject !== subject) continue;
    if (levels && !c.levels.some((l) => levels.includes(l))) continue;
    let rank;
    if (!qn) rank = 5;
    else if (c.search.code === qn) rank = 0;
    else if (c.search.code.startsWith(qn)) rank = 1;
    else if (tokens.length === 1 && c.subject === tokens[0]) rank = 2;
    else if (tokens.every((t) => c.search.words.some((w) => w.startsWith(t)))) rank = 3;
    else if (c.search.title.includes(q) || c.search.code.includes(qn)) rank = 4;
    else continue;
    out.push({ c, rank });
  }
  out.sort((a, b) => a.rank - b.rank || (a.c.code < b.c.code ? -1 : 1));
  return out.map((x) => x.c);
}

export function findSection(course, key) {
  for (const comp of course.components) {
    const s = comp.sections.find((x) => x.key === key);
    if (s) return { comp, section: s };
  }
  return null;
}

export function sectionLabel(section, type) {
  const name = TYPE_NAMES[type] ?? type;
  return section.id ? `${name} ${section.id}` : `${name} (no number in PDF)`;
}

export function meetingText(m) {
  if (m.days) return `${fmtDays(m.days)} ${fmtRange(m.start, m.end)}`;
  if (m.noDays) return `${fmtRange(m.start, m.end)}, day not listed`;
  if (m.dayText) return `${m.dayText}, no time listed`;
  return 'No scheduled time';
}

export function isTimed(section) {
  return section.meetings.some((m) => m.days);
}

/** A course's credit value: the highest credits on its chosen sections, else on any section. */
export function courseCredits(course, picks = {}) {
  const picked = Object.values(picks)
    .map((k) => findSection(course, k)?.section.credits)
    .filter((x) => x != null);
  if (picked.length) return Math.max(...picked);
  const all = course.components.flatMap((c) => c.sections.map((s) => s.credits)).filter((x) => x != null);
  return all.length ? Math.max(...all) : 0;
}

export function componentSummary(course) {
  return course.components
    .map((c) => {
      const n = c.sections.length;
      const name = (TYPE_NAMES[c.type] ?? c.type).toLowerCase();
      return `${n} ${name}${n === 1 ? '' : name.endsWith('s') ? '' : 's'}`;
    })
    .join(' · ');
}

/** Dates differ from the term's usual full-term range */
export function isPartTerm(m, term) {
  return m.startDate && m.endDate && term.usual && (m.startDate !== term.usual[0] || m.endDate !== term.usual[1]);
}

export function computeUsualRange(term) {
  const counts = new Map();
  for (const c of term.courses) {
    for (const comp of c.components) {
      for (const s of comp.sections) {
        for (const m of s.meetings) {
          if (!m.startDate) continue;
          const k = `${m.startDate}|${m.endDate}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  term.usual = top ? top[0].split('|') : null;
}
