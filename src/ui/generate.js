import { TYPE_NAMES } from '../lib/data.js';
import { generate } from '../lib/generate.js';
import { encodeCourses } from '../lib/state.js';
import { DAY_SHORT, fmtTime } from '../lib/time.js';
import { calendar } from './calendar.js';
import { clear, h, put } from './dom.js';
import { eventsFor } from './plan.js';

const START_OPTS = [null, 480, 510, 540, 600, 660, 720];
const END_OPTS = [null, 840, 900, 960, 1020, 1080, 1140, 1200];
const WEEKDAYS = ['M', 'T', 'W', 'TH', 'F'];

export function renderGenerate(view, app) {
  const { term } = app;
  put(view, h('nav', { class: 'crumbs' }, h('a', { href: app.link(['plan']) }, '← My plan')),
    h('h1', null, 'Generate schedules'));
  if (!app.courses.length) {
    put(view, h('div', { class: 'card empty' }, h('p', null, 'Add some courses first, then come back here.'),
      h('p', null, h('a', { class: 'btn primary', href: app.link([]) }, 'Search courses'))));
    return;
  }
  put(view, h('p', { class: 'muted' },
    `Finds every clash-free combination of sections for your ${app.courses.length} course${app.courses.length === 1 ? '' : 's'} and ranks them by what you prefer.`));

  const p = app.prefs;
  const results = h('section', { class: 'gen-results', 'aria-live': 'polite' });
  const timeSelect = (opts, value, label, key, none) => h('label', { class: 'field' }, label,
    h('select', { onchange: (e) => { app.setPrefs({ [key]: e.target.value === '' ? null : Number(e.target.value) }); run(); } },
      opts.map((o) => h('option', { value: o ?? '', selected: o === value }, o == null ? none : fmtTime(o)))));
  const toggle = (label, key) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: !!p[key], onchange: (e) => { app.setPrefs({ [key]: e.target.checked }); run(); } }), label);

  const form = h('form', { class: 'card prefs', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'pref-grid' },
      timeSelect(START_OPTS, p.earliest, 'Start no earlier than', 'earliest', 'Any time'),
      timeSelect(END_OPTS, p.latest, 'Finish by', 'latest', 'Any time'),
      h('label', { class: 'field' }, 'Full sections',
        h('select', { onchange: (e) => { app.setPrefs({ full: e.target.value }); run(); } },
          [['avoid', 'Avoid (rank lower)'], ['allow', 'Don’t mind'], ['exclude', 'Leave out']]
            .map(([v, t]) => h('option', { value: v, selected: p.full === v }, t))))),
    h('fieldset', { class: 'days-off' }, h('legend', null, 'Days I’d like off'),
      h('div', { class: 'chips' }, WEEKDAYS.map((d) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(p.daysOff.includes(d)),
        onclick: (e) => {
          const next = app.prefs.daysOff.includes(d) ? app.prefs.daysOff.filter((x) => x !== d) : [...app.prefs.daysOff, d];
          app.setPrefs({ daysOff: next });
          e.currentTarget.setAttribute('aria-pressed', String(next.includes(d)));
          run();
        },
      }, DAY_SHORT[d])))),
    h('div', { class: 'toggles' },
      toggle('Fewer gaps between classes', 'minGaps'),
      toggle('Fewer days on campus', 'fewerDays'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!app.ui.lockPicks, onchange: (e) => { app.ui.lockPicks = e.target.checked; run(); } }),
        'Keep the sections I’ve already picked')));
  put(view, form, results);

  function run() {
    const locked = {};
    if (app.ui.lockPicks) for (const c of app.courses) locked[c.code] = c.picks;
    const sig = JSON.stringify([app.termId, encodeCourses(app.courses), app.prefs, locked]);
    if (app.ui.results?.sig !== sig) {
      const courses = app.courses.map((c) => term.byCode.get(c.code));
      app.ui.results = { sig, out: generate(courses, app.prefs, { locked, maxResults: 30 }) };
    }
    draw(app.ui.results.out);
  }

  function draw(out) {
    clear(results);
    if (out.problems.length) {
      put(results, h('div', { class: 'alert warn' }, out.problems.map((x) => h('p', null,
        `${x.code} ${(TYPE_NAMES[x.type] ?? x.type).toLowerCase()}: ${x.reason === 'all sections Full' ? 'every section is Full. Set “Full sections” to “Don’t mind” to include them.' : 'the section you picked isn’t available.'}`))));
      return;
    }
    if (!out.results.length) {
      put(results, h('div', { class: 'alert bad' },
        h('strong', null, out.capped ? 'No schedule found before the search limit.' : 'No clash-free schedule exists for these courses.'),
        h('p', null, 'Some of your courses always overlap. Try removing one, or untick “Keep the sections I’ve already picked”.')));
      return;
    }
    put(results, h('p', { class: 'muted small' },
      out.capped
        ? `Checked ${out.nodes.toLocaleString()} options and stopped early (${out.found.toLocaleString()} clash-free so far). Best ${out.results.length} shown. Keeping some picks narrows the search.`
        : `${out.found.toLocaleString()} clash-free schedule${out.found === 1 ? '' : 's'} found. Best ${Math.min(out.results.length, out.found)} shown.`));
    const list = h('ol', { class: 'gen-list' });
    out.results.forEach((r, i) => put(list, resultCard(app, r, i)));
    put(results, list);
  }

  run();
}

function resultCard(app, r, i) {
  const { term } = app;
  const chosen = [];
  app.courses.forEach((c, ci) => {
    const course = term.byCode.get(c.code);
    for (const comp of course.components) {
      const key = r.picks[c.code]?.[comp.type];
      const section = comp.sections.find((s) => s.key === key);
      if (section) chosen.push({ code: c.code, title: course.title, type: comp.type, section, color: ci % 8 });
    }
  });
  const s = r.stats;
  const chips = [
    `${s.days} day${s.days === 1 ? '' : 's'}: ${s.daysUsed.map((d) => DAY_SHORT[d]).join(' ')}`,
    s.earliest != null ? `${fmtTime(s.earliest)} – ${fmtTime(s.latest)}` : 'No timed classes',
    s.gapMinutes ? `${fmtGap(s.gapMinutes)} of gaps a week` : 'No gaps',
    s.full ? `${s.full} Full section${s.full === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return h('li', { class: 'card gen-card' },
    h('header', null, h('b', null, `#${i + 1}`), h('ul', { class: 'stat-chips' }, chips.map((c) => h('li', null, c)))),
    calendar(eventsFor(chosen, term), { mini: true }),
    h('ul', { class: 'gen-picks' }, app.courses.map((c) => {
      const course = term.byCode.get(c.code);
      return h('li', null, h('b', null, c.code), ' ', course.components.map((comp) => {
        const key = r.picks[c.code][comp.type];
        const sec = comp.sections.find((x) => x.key === key);
        const alts = r.alternatives[c.code]?.[comp.type];
        return h('span', { class: 'gp' }, `${comp.type} ${sec.id ?? '?'}`, sec.full ? h('span', { class: 'pill full' }, 'Full') : null,
          alts ? h('span', { class: 'muted small' }, ` (or ${alts.map((k) => comp.sections.find((x) => x.key === k).id ?? '?').join(', ')})`) : null);
      }));
    })),
    h('button', {
      type: 'button', class: 'btn primary',
      onclick: () => {
        app.setCourses(app.courses.map((c) => ({ code: c.code, picks: { ...r.picks[c.code] } })));
        app.go(['plan']);
      },
    }, 'Use this schedule'));
}

function fmtGap(min) {
  const hrs = Math.floor(min / 60);
  const m = min % 60;
  return hrs ? `${hrs}h${m ? ` ${m}m` : ''}` : `${m}m`;
}
