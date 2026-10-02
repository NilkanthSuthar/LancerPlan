import { componentSummary, courseCredits, LEVEL_NAMES, searchCourses } from '../lib/data.js';
import { clear, h, put } from './dom.js';

const PAGE = 40;

export function renderSearch(view, app) {
  const { term, ui } = app;
  const levels = term.sources.map((s) => s.level);
  const results = h('div', { class: 'results', id: 'results' });
  let shown = PAGE;

  const input = h('input', {
    type: 'search', id: 'q', class: 'search-input', value: ui.query, autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Code or title, e.g. COMP 1000', 'aria-label': 'Search courses',
    enterkeyhint: 'search',
    oninput: (e) => { ui.query = e.target.value; shown = PAGE; draw(); },
  });

  const subjects = [...term.subjects.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  const subjectSel = h('select', {
    'aria-label': 'Filter by subject',
    onchange: (e) => { ui.subject = e.target.value; shown = PAGE; draw(); },
  }, h('option', { value: '' }, 'All subjects'),
  subjects.map((s) => h('option', { value: s.code, selected: s.code === ui.subject }, `${s.code} · ${s.name}`)));

  const levelChips = levels.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by level' },
    levels.map((l) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(!ui.levels || ui.levels.includes(l)),
      onclick: (e) => {
        const cur = ui.levels ?? [...levels];
        let next = cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l];
        if (!next.length || next.length === levels.length) next = null;
        ui.levels = next;
        for (const b of e.currentTarget.parentElement.children) {
          b.setAttribute('aria-pressed', String(!next || next.includes(b.dataset.level)));
        }
        shown = PAGE;
        draw();
      },
      dataset: { level: l },
    }, LEVEL_NAMES[l] ?? l))) : null;

  const intro = h('section', { class: 'hero' },
    h('h1', null, `Plan your ${term.label} timetable`),
    h('p', null, 'Search courses, pick your lecture and lab sections, and see clashes instantly. Or add your courses and let LancerPlan find schedules that fit. Free, no sign-up, nothing leaves your phone.'));

  put(view, 
    app.courses.length ? null : intro,
    h('div', { class: 'search-bar' }, input, h('div', { class: 'filters' }, subjectSel, levelChips)),
    results,
  );

  function draw() {
    clear(results);
    const q = ui.query.trim();
    if (!q && !ui.subject && !ui.levels) {
      put(results, planTeaser(app));
      return;
    }
    const found = searchCourses(term, q, { subject: ui.subject, levels: ui.levels });
    put(results, h('p', { class: 'muted count', 'aria-live': 'polite' },
      found.length ? `${found.length} course${found.length === 1 ? '' : 's'}` : 'No courses match. Try a subject code like COMP, or part of a title.'));
    const list = h('ul', { class: 'course-list' });
    for (const c of found.slice(0, shown)) put(list, courseRow(app, c));
    put(results, list);
    if (found.length > shown) {
      put(results, h('button', { type: 'button', class: 'btn more', onclick: () => { shown += PAGE * 2; draw(); } },
        `Show more (${found.length - shown} left)`));
    }
  }
  draw();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

export function courseRow(app, c) {
  const added = app.has(c.code);
  const allFull = c.components.some((comp) => comp.sections.every((s) => s.full));
  const credits = courseCredits(c);
  return h('li', { class: 'course-row' },
    h('a', { class: 'course-link', href: app.link(['course', c.code]) },
      h('span', { class: 'code' }, c.code),
      h('span', { class: 'title' }, c.title),
      h('span', { class: 'meta' },
        credits ? `${credits.toFixed(credits % 1 ? 1 : 0)} cr · ` : '',
        componentSummary(c),
        c.levels[0] !== 'ugrd' ? ` · ${LEVEL_NAMES[c.levels[0]]}` : '',
        allFull ? h('span', { class: 'pill full' }, 'Full') : null)),
    h('button', {
      type: 'button', class: `add-btn${added ? ' added' : ''}`,
      'aria-label': added ? `Remove ${c.code} from plan` : `Add ${c.code} to plan`,
      title: added ? 'In your plan (tap to remove)' : 'Add to plan',
      onclick: (e) => {
        if (app.has(c.code)) app.removeCourse(c.code);
        else app.addCourse(c.code);
        const now = app.has(c.code);
        e.currentTarget.classList.toggle('added', now);
        e.currentTarget.setAttribute('aria-label', now ? `Remove ${c.code} from plan` : `Add ${c.code} to plan`);
      },
    }, h('span', { 'aria-hidden': 'true' })));
}

function planTeaser(app) {
  if (!app.courses.length) {
    return h('div', { class: 'tips' },
      h('h2', null, 'How it works'),
      h('ol', null,
        h('li', null, 'Search for a course and tap + to add it.'),
        h('li', null, 'Open ', h('a', { href: app.link(['plan']) }, 'My plan'), ' to pick sections, or let ', h('strong', null, 'Generate'), ' find clash-free combinations for you.'),
        h('li', null, 'Share the link with friends or export to Google/Apple Calendar.')),
      h('p', { class: 'muted' }, 'Your plan is saved in this browser and in the page link. There are no accounts.'));
  }
  return h('div', { class: 'tips' },
    h('h2', null, 'Your plan'),
    h('ul', { class: 'course-list compact' }, app.courses.map(({ code }) => courseRow(app, app.term.byCode.get(code)))),
    h('p', null, h('a', { class: 'btn primary', href: app.link(['plan']) }, 'Open my timetable →')));
}
