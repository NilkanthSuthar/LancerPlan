// Plan <-> URL. A plan is a term plus an ordered list of courses, each with
// the section picked for each component (LEC/LAB/...), e.g.
//   t=fall-2026&c=COMP-1000.LEC1.LAB51,MATH-1720
// Section keys are the activity code followed by the section id (LEC1, LAB51,
// LECx1 for a section the PDF didn't label), so they are URL-safe as is.
// Keys are matched to components using the term data (an activity code like
// PR1 makes "PR151" ambiguous on its own).

const CODE_RE = /^[A-Z]{3,5}-[0-9A-Z]{4,5}$/;
const KEY_RE = /^[A-Z][A-Z0-9]{1,3}x?\d+[A-Z]?$/;

/** @param {{code: string, picks: Record<string, string>}[]} courses */
export function encodeCourses(courses) {
  return courses
    .map((c) => [c.code, ...Object.values(c.picks).filter(Boolean)].join('.'))
    .join(',');
}

export function decodeCourses(str) {
  if (!str) return [];
  const seen = new Set();
  const out = [];
  for (const part of str.split(',')) {
    const [code, ...keys] = part.split('.');
    if (!CODE_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, keys: keys.filter((k) => KEY_RE.test(k)) });
  }
  return out;
}

/** Match decoded keys to components, dropping anything not in this term's data. */
export function resolveCourses(decoded, courseByCode) {
  const out = [];
  for (const c of decoded) {
    const course = courseByCode.get(c.code);
    if (!course) continue;
    const picks = {};
    for (const comp of course.components) {
      const key = c.keys.find((k) => comp.sections.some((s) => s.key === k));
      if (key) picks[comp.type] = key;
    }
    out.push({ code: c.code, picks });
  }
  return out;
}

/** "#/course/COMP-1000?t=fall-2026&c=..." -> { path: ['course', 'COMP-1000'], query } */
export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  return { path, query: new URLSearchParams(queryPart) };
}

export function buildHash(path, { term, courses } = {}) {
  const q = new URLSearchParams();
  if (term) q.set('t', term);
  const c = courses ? encodeCourses(courses) : '';
  if (c) q.set('c', c);
  // URLSearchParams escapes commas; they're safe in a fragment and easier to read
  const qs = q.toString().replace(/%2C/g, ',');
  return `#/${path.map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
}

// localStorage can be missing or throw (private mode, blocked storage)
export const storage = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
