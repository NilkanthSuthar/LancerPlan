import './styles.css';
import { loadTerm, loadTerms } from './lib/data.js';
import { DEFAULT_PREFS } from './lib/generate.js';
import { buildHash, decodeCourses, encodeCourses, parseHash, resolveCourses, storage } from './lib/state.js';
import { fmtLongDate } from './lib/time.js';
import { renderAbout } from './ui/about.js';
import { renderCourse } from './ui/course.js';
import { clear, h, toast } from './ui/dom.js';
import { renderGenerate } from './ui/generate.js';
import { renderPlan } from './ui/plan.js';
import { renderSearch } from './ui/search.js';

const view = document.getElementById('view');
const planKey = (termId) => `lp:plan:${termId}`;

export const app = {
  terms: [],
  termId: null,
  term: null,
  courses: [], // [{code, picks: {LEC: 'LEC1', ...}}]
  shared: false, // showing a plan from a link that differs from the saved one
  path: [],
  prefs: { ...DEFAULT_PREFS, ...storage.get('lp:prefs', {}) },
  ui: { query: '', subject: '', levels: null, week: 'all', results: null },

  link(path, courses = this.courses) {
    return buildHash(path, { term: this.termId, courses });
  },
  go(path) {
    location.hash = this.link(path);
  },

  /** Replace the plan, sync it to the URL (without a history entry) and storage. */
  setCourses(courses, { save = true } = {}) {
    this.courses = courses;
    if (save) {
      storage.set(planKey(this.termId), encodeCourses(courses));
      if (this.shared) {
        this.shared = false;
        toast('Saved as your plan.');
      }
    }
    history.replaceState(null, '', this.link(this.path));
    updateChrome();
  },
  has(code) {
    return this.courses.some((c) => c.code === code);
  },
  addCourse(code) {
    if (this.has(code)) return;
    const course = this.term.byCode.get(code);
    const picks = {};
    // only one choice? pick it
    for (const comp of course.components) {
      if (comp.sections.length === 1) picks[comp.type] = comp.sections[0].key;
    }
    this.setCourses([...this.courses, { code, picks }]);
    toast(`Added ${code}.`);
  },
  removeCourse(code) {
    this.setCourses(this.courses.filter((c) => c.code !== code));
  },
  pick(code, type, key) {
    if (!this.has(code)) this.courses = [...this.courses, { code, picks: {} }];
    this.setCourses(this.courses.map((c) => {
      if (c.code !== code) return c;
      const picks = { ...c.picks };
      if (key) picks[type] = key;
      else delete picks[type];
      return { ...c, picks };
    }));
  },
  setPrefs(prefs) {
    this.prefs = { ...this.prefs, ...prefs };
    storage.set('lp:prefs', this.prefs);
  },
  render,
};

function savedCourses(termId) {
  return resolveCourses(decodeCourses(storage.get(planKey(termId), '')), app.term.byCode);
}

async function route() {
  const { path, query } = parseHash(location.hash);
  app.path = path;
  const wantTerm = query.get('t');
  const termId = app.terms.some((t) => t.id === wantTerm) ? wantTerm
    : app.termId ?? storageTerm() ?? app.terms[0].id;
  if (termId !== app.termId || !app.term) {
    view.setAttribute('aria-busy', 'true');
    try {
      app.term = await loadTerm(termId);
    } catch (e) {
      clear(view).append(h('div', { class: 'empty' }, h('h1', null, 'Couldn’t load the timetable.'),
        h('p', null, `${e.message}. Check your connection and reload.`)));
      return;
    }
    view.removeAttribute('aria-busy');
    app.termId = termId;
    storage.set('lp:term', termId);
    app.ui.results = null;
    app.ui.week = 'all';
  }

  const saved = savedCourses(termId);
  if (query.has('c')) {
    const fromUrl = resolveCourses(decodeCourses(query.get('c')), app.term.byCode);
    const differs = encodeCourses(fromUrl) !== encodeCourses(saved);
    if (differs && saved.length && !app.shared && encodeCourses(fromUrl) !== encodeCourses(app.courses)) {
      app.shared = true;
    } else if (differs && !saved.length) {
      storage.set(planKey(termId), encodeCourses(fromUrl));
    } else if (!differs) {
      app.shared = false;
    }
    app.courses = fromUrl;
  } else {
    app.courses = saved;
    app.shared = false;
  }
  // keep the address bar shareable: always carry term + plan
  const canonical = app.link(path);
  if (location.hash !== canonical) history.replaceState(null, '', canonical);
  render();
}

function storageTerm() {
  const t = storage.get('lp:term');
  return app.terms.some((x) => x.id === t) ? t : null;
}

function render() {
  updateChrome();
  const [page, arg] = app.path;
  // re-rendering in place (picking a section, etc.) shouldn't jump the page
  const y = window.scrollY;
  view.style.minHeight = `${view.offsetHeight}px`;
  clear(view);
  requestAnimationFrame(() => {
    view.style.minHeight = '';
  });
  if (!page) renderSearch(view, app);
  else if (page === 'course' && app.term.byCode.has(arg)) renderCourse(view, app, app.term.byCode.get(arg));
  else if (page === 'plan') renderPlan(view, app);
  else if (page === 'generate') renderGenerate(view, app);
  else if (page === 'about') renderAbout(view, app);
  else {
    view.append(h('div', { class: 'empty' }, h('h1', null, 'Not found.'),
      h('p', null, arg ? `${arg} isn’t in the ${app.term.label} timetable.` : 'That page doesn’t exist.'),
      h('p', null, h('a', { href: app.link([]) }, 'Search courses'))));
  }
  document.title = titleFor(page, arg);
  window.scrollTo(0, y);
}

function titleFor(page, arg) {
  const base = 'LancerPlan';
  if (page === 'course' && arg) return `${arg} · ${base}`;
  if (page === 'plan') return `My ${app.term.label} plan · ${base}`;
  if (page === 'generate') return `Generate schedules · ${base}`;
  if (page === 'about') return `About · ${base}`;
  return `${base} · UWindsor timetable planner`;
}

function updateChrome() {
  const sel = document.getElementById('term');
  if (sel.options.length !== app.terms.length) {
    clear(sel).append(...app.terms.map((t) => h('option', { value: t.id }, t.label)));
  }
  sel.value = app.termId;
  const page = app.path[0] || 'search';
  for (const a of document.querySelectorAll('[data-nav]')) {
    const target = a.dataset.nav === 'search' ? [] : [a.dataset.nav];
    a.href = app.link(target);
    const active = a.dataset.nav === page || (a.dataset.nav === 'search' && page === 'course') ||
      (a.dataset.nav === 'plan' && page === 'generate');
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const count = document.getElementById('plan-count');
  count.hidden = !app.courses.length;
  count.textContent = app.courses.length;
  document.querySelector('.brand').href = app.link([]);

  const t = app.term;
  const asof = document.getElementById('asof');
  clear(asof).append(
    `Timetable data as of ${fmtLongDate(t.generated)}, from the `,
    h('a', { href: t.registrar, target: '_blank', rel: 'noopener' }, 'registrar'),
    '. ',
    h('a', { href: app.link(['about']) }, 'About'),
  );

  const banner = clear(document.getElementById('banner'));
  if (app.shared) {
    banner.append(h('div', { class: 'banner' },
      h('span', null, 'Viewing a shared plan.'),
      h('button', { type: 'button', onclick: () => { app.setCourses(app.courses); render(); } }, 'Keep it'),
      h('a', { href: buildHash(app.path, { term: app.termId, courses: savedCourses(app.termId) }), onclick: () => { app.shared = false; } }, 'Back to mine')));
  }
}

async function start() {
  try {
    app.terms = await loadTerms();
  } catch (e) {
    clear(view).append(h('div', { class: 'empty' }, h('h1', null, 'Couldn’t load the timetable.'), h('p', null, String(e.message))));
    return;
  }
  document.getElementById('term').addEventListener('change', (e) => {
    const termId = e.target.value;
    location.hash = buildHash(app.path[0] === 'course' ? [] : app.path, { term: termId });
  });
  window.addEventListener('hashchange', () => {
    route().then(() => {
      if (!app.path.length) return;
      window.scrollTo(0, 0);
    });
  });
  await route();
}

start();
