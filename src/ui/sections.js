import { sectionsClash } from '../lib/clash.js';
import { findSection, FLAG_NOTES, isPartTerm, meetingText } from '../lib/data.js';
import { fmtDateRange } from '../lib/time.js';
import { h } from './dom.js';

/** Sections chosen in the plan, except this course's own pick for this component. */
export function chosenElsewhere(app, code, compType) {
  const out = [];
  for (const c of app.courses) {
    const course = app.term.byCode.get(c.code);
    for (const [type, key] of Object.entries(c.picks)) {
      if (c.code === code && type === compType) continue;
      const f = findSection(course, key);
      if (f) out.push({ code: c.code, type, section: f.section });
    }
  }
  return out;
}

/**
 * Tappable list of one component's sections. Shows Full, clashes with the
 * rest of the plan and data flags. onPick(key | null) is called on tap.
 */
export function sectionList(app, course, comp, onPick) {
  const entry = app.courses.find((c) => c.code === course.code);
  const picked = entry?.picks[comp.type];
  const others = chosenElsewhere(app, course.code, comp.type);
  return h('ul', { class: 'opts' }, comp.sections.map((s) => {
    const clash = others.find((o) => sectionsClash(s, o.section));
    const on = picked === s.key;
    return h('li', null, h('button', {
      type: 'button', class: 'opt', 'aria-pressed': String(on),
      onclick: () => onPick(on ? null : s.key),
    },
    h('span', { class: 'id' }, s.id ?? '?'),
    h('span', { class: 'when' }, s.meetings.map((m) => h('span', null,
      meetingText(m),
      isPartTerm(m, app.term) ? h('span', { class: 'dates' }, ` · ${fmtDateRange(m.startDate, m.endDate)}`) : null))),
    h('span', { class: 'side' }, s.full ? h('span', { class: 'tag full' }, 'full') : null),
    clash ? h('span', { class: 'note signal' }, `clashes with ${clash.code} ${clash.type.toLowerCase()} ${clash.section.id ?? '?'}`) : null,
    s.flag ? h('span', { class: 'note' }, FLAG_NOTES[s.flag]) : null));
  }));
}
