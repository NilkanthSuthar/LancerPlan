import { componentSummary, courseCredits, LEVEL_NAMES, searchCourses } from '../lib/data.js';
import { clear, h, put } from './dom.js';

const PAGE = 40;

export function renderSearch(view, app) {
  const { term, ui } = app;
  const levels = term.sources.map((s) => s.level);
  const results = h('div', { id: 'results' });
  let shown = PAGE;

  const input = h('input', {
    type: 'search', id: 'q', class: 'search-input', value: ui.query, autocomplete: 'off', spellcheck: 'false',
    placeholder: 'COMP 1000, calculus, PSYC…', 'aria-label': 'Search courses', enterkeyhint: 'search',
    oninput: (e) => { ui.query = e.target.value; shown = PAGE; draw(); },
  });

  const seg = levels.length > 1 ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Level' },
    [['', 'All'], ...levels.map((l) => [l, LEVEL_NAMES[l] ?? l])].map(([v, label]) => h('button', {
      type: 'button', 'aria-pressed': String((ui.level ?? '') === v), dataset: { v },
      onclick: () => {
        ui.level = v || null;
        for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.v === v));
        shown = PAGE;
        draw();
      },
    }, label))) : null;

  put(view,
    app.courses.length ? null : [
      h('h1', null, `${term.label} timetable.`),
      h('p', { class: 'lede' }, 'Pick sections, see clashes, share the link. No sign-up.'),
    ],
    h('div', { class: 'search-bar' }, input, seg ? h('div', { class: 'filters' }, seg) : null),
    results);

  function setQuery(q) {
    ui.query = q;
    input.value = q;
    shown = PAGE;
    draw();
    window.scrollTo(0, 0);
  }

  function draw() {
    clear(results);
    const q = ui.query.trim();
    if (!q && !ui.level) {
      put(results, idle(app, setQuery));
      return;
    }
    const found = searchCourses(term, q, { levels: ui.level ? [ui.level] : null });
    put(results,
      h('p', { class: 'count', 'aria-live': 'polite' },
        found.length ? `${found.length} course${found.length === 1 ? '' : 's'}` : 'Nothing matches. Try a subject code like COMP.'),
      h('ul', { class: 'rows' }, found.slice(0, shown).map((c) => courseRow(app, c))),
      found.length > shown
        ? h('button', { type: 'button', class: 'btn more', onclick: () => { shown += PAGE * 2; draw(); } }, `Show ${Math.min(found.length - shown, PAGE * 2)} more`)
        : null);
  }
  draw();
  if (!matchMedia('(pointer: coarse)').matches) input.focus();
}

export function courseRow(app, c) {
  const credits = courseCredits(c);
  const fullComp = c.components.find((comp) => comp.sections.every((s) => s.full));
  const btn = h('button', {
    type: 'button', class: 'add', 'aria-pressed': String(app.has(c.code)),
    'aria-label': `${app.has(c.code) ? 'Remove' : 'Add'} ${c.code}`,
    onclick: () => {
      if (app.has(c.code)) app.removeCourse(c.code);
      else app.addCourse(c.code);
      const on = app.has(c.code);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${c.code}`);
      btn.textContent = on ? 'Added' : 'Add';
    },
  }, app.has(c.code) ? 'Added' : 'Add');
  return h('li', { class: 'row' },
    h('a', { class: 'row-main', href: app.link(['course', c.code]) },
      h('span', { class: 'code' }, c.code),
      h('span', { class: 'title' }, c.title),
      h('span', { class: 'meta' },
        [credits ? `${credits} cr` : null, componentSummary(c), c.levels[0] !== 'ugrd' ? LEVEL_NAMES[c.levels[0]].toLowerCase() : null]
          .filter(Boolean).join(' · '),
        fullComp ? h('span', { class: 'tag full' }, ` · ${fullComp.type.toLowerCase()} full`) : null)),
    btn);
}

function idle(app, setQuery) {
  const subjects = [...app.term.subjects.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  return [
    app.courses.length ? [
      h('h2', null, 'your plan'),
      h('ul', { class: 'rows' }, app.courses.map(({ code }) => courseRow(app, app.term.byCode.get(code)))),
      h('p', null, h('a', { class: 'btn primary more', href: app.link(['plan']) }, 'Open timetable')),
    ] : null,
    h('h2', null, `subjects · ${subjects.length}`),
    h('ul', { class: 'subjects' }, subjects.map((s) => h('li', null,
      h('button', { type: 'button', title: s.name, onclick: () => setQuery(s.code) }, s.code, h('span', null, s.count))))),
  ];
}
