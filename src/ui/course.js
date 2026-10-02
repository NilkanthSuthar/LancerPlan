import { courseCredits, LEVEL_NAMES, TYPE_NAMES } from '../lib/data.js';
import { h, put } from './dom.js';
import { sectionList } from './sections.js';

export function renderCourse(view, app, course) {
  const entry = app.courses.find((c) => c.code === course.code);
  const credits = courseCredits(course, entry?.picks);
  const src = app.term.sources.find((s) => s.level === course.source);
  const dept = course.dept || course.faculty;

  put(view,
    h('a', { class: 'back', href: app.link([]) }, '← search'),
    h('header', { class: 'course-head' },
      h('h1', null, h('span', { class: 'code' }, course.code), course.title),
      h('p', { class: 'meta' },
        [dept, credits ? `${credits} credits` : null, course.levels[0] !== 'ugrd' ? LEVEL_NAMES[course.levels[0]] : null]
          .filter(Boolean).join(' · ')),
      h('button', {
        type: 'button', class: `btn${entry ? '' : ' primary'}`,
        onclick: () => { if (entry) app.removeCourse(course.code); else app.addCourse(course.code); app.render(); },
      }, entry ? 'Remove from plan' : 'Add to plan')));

  for (const comp of course.components) {
    put(view,
      h('h2', null, `${(TYPE_NAMES[comp.type] ?? comp.type).toLowerCase()} · ${comp.sections.length}`),
      sectionList(app, course, comp, (key) => { app.pick(course.code, comp.type, key); app.render(); }));
  }

  put(view, h('p', { class: 'fine' },
    `Page ${course.page} of the ${(LEVEL_NAMES[course.source] ?? '').toLowerCase()} timetable`,
    src ? [' (', h('a', { href: src.url, target: '_blank', rel: 'noopener' }, 'pdf'), ')'] : null,
    '. Titles are cut at 30 characters there. ',
    h('a', { href: app.link(['about']) }, 'Report a mistake'), '.'));
}
