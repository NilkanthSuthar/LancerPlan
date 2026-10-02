// Find clash-free section combinations for a set of courses and rank them.
//
// Each (course, component) is a variable; its values are sections. Sections
// with identical times and dates are interchangeable for scheduling, so they
// are collapsed into one value first (the result lists the alternatives).
// Depth-first search with clash pruning, most-constrained variable first,
// best-looking sections first, capped by node count and time.

import { dayNumber, DAYS } from './time.js';

const DAY_BIT = Object.fromEntries(DAYS.map((d, i) => [d, 1 << i]));

export const DEFAULT_PREFS = {
  earliest: null, // minutes; penalise classes starting before this
  latest: null, // minutes; penalise classes ending after this
  daysOff: [], // day codes the student would like free
  fewerDays: false, // prefer fewer days on campus
  minGaps: true, // prefer compact days
  full: 'avoid', // 'allow' | 'avoid' | 'exclude'
};

const W = { early: 2, late: 2, dayOff: 400, day: 150, gap: 1, full: 300 };
const GAP_GRACE = 10; // minutes between classes that don't count as a gap

function compile(section) {
  const ms = [];
  for (const m of section.meetings) {
    if (!m.days) continue;
    let bits = 0;
    for (const d of m.days) bits |= DAY_BIT[d];
    ms.push({
      bits,
      days: m.days,
      start: m.start,
      end: m.end,
      sd: m.startDate ? dayNumber(m.startDate) : -Infinity,
      ed: m.endDate ? dayNumber(m.endDate) : Infinity,
    });
  }
  return ms;
}

function signature(section) {
  return section.meetings
    .filter((m) => m.days)
    .map((m) => `${m.days.join('')}|${m.start}|${m.end}|${m.startDate}|${m.endDate}`)
    .sort()
    .join(';');
}

function clashes(a, b) {
  for (const x of a) {
    for (const y of b) {
      if (x.bits & y.bits && x.start < y.end && y.start < x.end && x.sd <= y.ed && y.sd <= x.ed) return true;
    }
  }
  return false;
}

function soloPenalty(value, prefs) {
  let p = 0;
  for (const m of value.meetings) {
    const n = m.days.length;
    if (prefs.earliest != null && m.start < prefs.earliest) p += (prefs.earliest - m.start) * W.early * n;
    if (prefs.latest != null && m.end > prefs.latest) p += (m.end - prefs.latest) * W.late * n;
    for (const d of m.days) if (prefs.daysOff.includes(d)) p += W.dayOff;
  }
  if (value.full && prefs.full === 'avoid') p += W.full;
  return p;
}

/** Score a complete schedule (lower is better) and describe it. */
export function scoreSchedule(values, prefs) {
  const byDay = DAYS.map(() => []);
  let full = 0;
  let penalty = 0;
  for (const v of values) {
    if (v.full) full++;
    for (const m of v.meetings) {
      for (const d of m.days) byDay[DAYS.indexOf(d)].push(m);
    }
  }
  let days = 0;
  let gaps = 0;
  let earliest = Infinity;
  let latest = -Infinity;
  const daysUsed = [];
  byDay.forEach((list, i) => {
    if (!list.length) return;
    days++;
    daysUsed.push(DAYS[i]);
    list.sort((a, b) => a.start - b.start);
    let end = list[0].end;
    for (const m of list) {
      earliest = Math.min(earliest, m.start);
      latest = Math.max(latest, m.end);
      if (prefs.earliest != null && m.start < prefs.earliest) penalty += (prefs.earliest - m.start) * W.early;
      if (prefs.latest != null && m.end > prefs.latest) penalty += (m.end - prefs.latest) * W.late;
      if (m.start - end > GAP_GRACE) gaps += m.start - end;
      end = Math.max(end, m.end);
    }
    if (prefs.daysOff.includes(DAYS[i])) penalty += W.dayOff;
  });
  if (prefs.fewerDays) penalty += days * W.day;
  if (prefs.minGaps) penalty += gaps * W.gap;
  if (prefs.full === 'avoid') penalty += full * W.full;
  return {
    score: penalty,
    stats: {
      days,
      daysUsed,
      earliest: Number.isFinite(earliest) ? earliest : null,
      latest: Number.isFinite(latest) ? latest : null,
      gapMinutes: gaps,
      full,
    },
  };
}

/**
 * @param {{code: string, components: {type: string, sections: object[]}[]}[]} courses
 * @param {object} prefs see DEFAULT_PREFS
 * @param {{locked?: Record<string, Record<string, string>>, maxResults?: number,
 *          maxNodes?: number, timeBudgetMs?: number}} opts
 *   locked: code -> type -> section key that must be used
 */
export function generate(courses, prefs = DEFAULT_PREFS, opts = {}) {
  prefs = { ...DEFAULT_PREFS, ...prefs };
  const { locked = {}, maxResults = 30, maxNodes = 200000, timeBudgetMs = 1500 } = opts;
  const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const t0 = clock();

  const vars = [];
  const problems = [];
  let combinations = 1;
  for (const course of courses) {
    for (const comp of course.components) {
      let secs = comp.sections;
      const lockKey = locked[course.code]?.[comp.type];
      if (lockKey) secs = secs.filter((s) => s.key === lockKey);
      else if (prefs.full === 'exclude') secs = secs.filter((s) => !s.full);
      if (!secs.length) {
        problems.push({ code: course.code, type: comp.type, reason: lockKey ? 'locked section missing' : 'all sections Full' });
        continue;
      }
      const groups = new Map();
      for (const s of secs) {
        const sig = signature(s);
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(s);
      }
      const values = [...groups.values()].map((group) => {
        group.sort((a, b) => a.full - b.full); // open sections first
        return {
          code: course.code,
          type: comp.type,
          key: group[0].key,
          alternatives: group.slice(1).map((s) => s.key),
          full: group.every((s) => s.full),
          meetings: compile(group[0]),
          credits: group[0].credits,
        };
      });
      for (const v of values) v.solo = soloPenalty(v, prefs);
      values.sort((a, b) => a.solo - b.solo);
      combinations *= values.length;
      vars.push({ code: course.code, type: comp.type, values });
    }
  }
  if (problems.length) {
    return { results: [], problems, nodes: 0, found: 0, capped: false, combinations };
  }
  vars.sort((a, b) => a.values.length - b.values.length);

  const best = [];
  const chosen = [];
  let nodes = 0;
  let found = 0;
  let capped = false;

  const keep = (scored) => {
    if (best.length === maxResults && scored.score >= best[best.length - 1].score) return;
    let i = best.length;
    while (i > 0 && best[i - 1].score > scored.score) i--;
    best.splice(i, 0, scored);
    if (best.length > maxResults) best.pop();
  };

  const dfs = (depth) => {
    if (capped) return;
    if (depth === vars.length) {
      found++;
      const { score, stats } = scoreSchedule(chosen, prefs);
      keep({ score, stats, values: [...chosen] });
      return;
    }
    for (const v of vars[depth].values) {
      if (++nodes > maxNodes || ((nodes & 1023) === 0 && clock() - t0 > timeBudgetMs)) {
        capped = true;
        return;
      }
      if (chosen.some((c) => clashes(c.meetings, v.meetings))) continue;
      chosen.push(v);
      dfs(depth + 1);
      chosen.pop();
      if (capped) return;
    }
  };
  dfs(0);

  const results = best.map(({ score, stats, values }) => {
    const picks = {};
    const alternatives = {};
    for (const v of values) {
      (picks[v.code] ??= {})[v.type] = v.key;
      if (v.alternatives.length) (alternatives[v.code] ??= {})[v.type] = v.alternatives;
    }
    return { score, stats, picks, alternatives };
  });
  return { results, problems, nodes, found, capped, combinations, ms: Math.round(clock() - t0) };
}
