// Two meetings clash only if they share a day, their times overlap AND their
// date ranges overlap (a first-half-term section never clashes with a
// second-half one in the same slot).

export function datesOverlap(a, b) {
  if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) return true;
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function meetingsClash(a, b) {
  if (!a.days || !b.days) return false;
  if (!(a.start < b.end && b.start < a.end)) return false;
  if (!a.days.some((d) => b.days.includes(d))) return false;
  return datesOverlap(a, b);
}

/** First clashing pair of meetings between two sections, or null */
export function sectionsClash(s1, s2) {
  for (const a of s1.meetings) {
    for (const b of s2.meetings) {
      if (meetingsClash(a, b)) return { a, b };
    }
  }
  return null;
}

/**
 * All clashes among chosen sections.
 * @param {{code: string, type: string, section: object}[]} chosen
 */
export function findClashes(chosen) {
  const out = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const hit = sectionsClash(chosen[i].section, chosen[j].section);
      if (hit) {
        const days = hit.a.days.filter((d) => hit.b.days.includes(d));
        out.push({
          first: chosen[i],
          second: chosen[j],
          days,
          start: Math.max(hit.a.start, hit.b.start),
          end: Math.min(hit.a.end, hit.b.end),
          from: maxDate(hit.a.startDate, hit.b.startDate),
          to: minDate(hit.a.endDate, hit.b.endDate),
        });
      }
    }
  }
  return out;
}

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
