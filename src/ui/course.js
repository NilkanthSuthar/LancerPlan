import { sectionsClash } from '../lib/clash.js';
import {
  courseCredits, findSection, FLAG_NOTES, isPartTerm, LEVEL_NAMES, meetingText, TYPE_NAMES,
} from '../lib/data.js';
import { fmtDateRange } from '../lib/time.js';
import { h, put } from './dom.js';

export function renderCourse(view, app, course) {
  const entry = app.courses.find((c) => c.code === course.code);
  const credits = courseCredits(course, entry?.picks);
  const src = app.term.sources.find((s) => s.level === course.source);

  put(view, 
    h('nav', { class: 'crumbs' }, h('a', { href: app.link([]) }, '← Search')),
    h('header', { class: 'course-head' },
      h('div', null,
        h('h1', null, h('span', { class: 'code' }, course.code), ' ', course.title),
        h('p', { class: 'muted' },
          [course.dept || course.faculty, course.faculty && course.dept && course.dept !== course.faculty ? course.faculty : null,
            credits ? `${credits} credits` : null, course.levels.map((l) => LEVEL_NAMES[l]).join(', ')]
            .filter(Boolean).join(' · '))),
      h('button', {
        type: 'button', class: `btn ${entry ? '' : 'primary'}`,
        onclick: () => { if (entry) app.removeCourse(course.code); else app.addCourse(course.code); app.render(); },
      }, entry ? 'Remove from plan' : 'Add to plan')),
    entry ? h('p', { class: 'hint' }, 'Tap a section to choose it. ', h('a', { href: app.link(['plan']) }, 'See it on your timetable →')) : null,
  );

  for (const comp of course.components) {
    const picked = entry?.picks[comp.type];
    const others = chosenElsewhere(app, course.code, comp.type);
    const list = h('ul', { class: 'sections', role: 'list' });
    for (const s of comp.sections) {
      const clash = others.map((o) => ({ o, hit: sectionsClash(s, o.section) })).find((x) => x.hit);
      const isPicked = picked === s.key;
      put(list, h('li', null, h('button', {
        type: 'button',
        class: `section${isPicked ? ' picked' : ''}${clash ? ' clashing' : ''}`,
        'aria-pressed': String(isPicked),
        onclick: () => { app.pick(course.code, comp.type, isPicked ? null : s.key); app.render(); },
      },
      h('span', { class: 'sec-name' },
        s.id ? `${comp.type} ${s.id}` : `${comp.type} ?`,
        s.full ? h('span', { class: 'pill full' }, 'Full') : null,
        s.credits != null && comp.type !== 'LEC' ? h('span', { class: 'muted small' }, ` ${s.credits} cr`) : null),
      h('span', { class: 'sec-times' }, s.meetings.map((m) => h('span', { class: 'mt' },
        meetingText(m),
        isPartTerm(m, app.term) ? h('span', { class: 'dates' }, ` · ${fmtDateRange(m.startDate, m.endDate)}`) : null))),
      clash ? h('span', { class: 'sec-warn' }, `Clashes with ${clash.o.code} ${clash.o.type} ${clash.o.section.id ?? '?'}`) : null,
      s.flag ? h('span', { class: 'sec-flag' }, '⚠ ', FLAG_NOTES[s.flag]) : null)));
    }
    put(view, h('section', { class: 'component' },
      h('h2', null, TYPE_NAMES[comp.type] ?? comp.type, h('span', { class: 'muted small' }, ` · ${comp.sections.length} section${comp.sections.length === 1 ? '' : 's'}`)),
      course.components.length > 1 ? h('p', { class: 'muted small' }, `Pick one ${TYPE_NAMES[comp.type]?.toLowerCase() ?? comp.type} section.`) : null,
      list));
  }

  put(view, h('p', { class: 'muted small fineprint' },
    `Listed on page ${course.page} of the ${LEVEL_NAMES[course.source]?.toLowerCase() ?? ''} timetable PDF`,
    src ? [' (', h('a', { href: src.url, target: '_blank', rel: 'noopener' }, 'open PDF'), ')'] : null,
    '. Titles are cut to 30 characters in the PDF. Room and instructor aren’t published there; check UWinsite. ',
    h('a', { href: app.link(['about']) }, 'Spotted a mistake?')));
}

/** Chosen sections in the plan, other than this course's own pick for this component */
function chosenElsewhere(app, code, compType) {
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
