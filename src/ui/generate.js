import { TYPE_SHORT } from '../lib/data.js';
import { generate } from '../lib/generate.js';
import { encodeCourses } from '../lib/state.js';
import { DAY_SHORT, fmtTime } from '../lib/time.js';
import { calendar } from './calendar.js';
import { clear, h, put } from './dom.js';
import { chosenSections, eventsFor } from './plan.js';

const START_OPTS = [null, 480, 510, 540, 600, 660, 720];
const END_OPTS = [null, 840, 900, 960, 1020, 1080, 1140, 1200];
const WEEKDAYS = ['M', 'T', 'W', 'TH', 'F'];
const short = (type) => TYPE_SHORT[type] ?? type.toLowerCase();

export function renderGenerate(view, app) {
  put(view, h('a', { class: 'back', href: app.link(['plan']) }, '← plan'), h('h1', null, 'Generate.'));
  if (!app.courses.length) {
    put(view, h('div', { class: 'empty' }, h('p', null, 'Add courses first.'),
      h('a', { class: 'btn primary', href: app.link([]) }, 'Search courses')));
    return;
  }
  put(view, h('p', { class: 'lede' }, `Every clash-free combination of your ${app.courses.length} courses, best first.`));

  const p = app.prefs;
  const results = h('section', { 'aria-live': 'polite' });
  const timeSelect = (opts, value, label, key) => h('label', { class: 'field' }, label,
    h('select', { class: 'plain', onchange: (e) => { app.setPrefs({ [key]: e.target.value === '' ? null : Number(e.target.value) }); run(); } },
      opts.map((o) => h('option', { value: o ?? '', selected: o === value }, o == null ? 'Any time' : fmtTime(o)))));
  const check = (label, checked, onchange) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e) => { onchange(e.target.checked); run(); } }), label);

  const days = h('div', { class: 'seg', role: 'group', 'aria-label': 'Days off' }, WEEKDAYS.map((d) => h('button', {
    type: 'button', 'aria-pressed': String(p.daysOff.includes(d)),
    onclick: (e) => {
      const next = app.prefs.daysOff.includes(d) ? app.prefs.daysOff.filter((x) => x !== d) : [...app.prefs.daysOff, d];
      app.setPrefs({ daysOff: next });
      e.currentTarget.setAttribute('aria-pressed', String(next.includes(d)));
      run();
    },
  }, DAY_SHORT[d])));

  put(view, h('form', { class: 'prefs', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'pref-row' },
      timeSelect(START_OPTS, p.earliest, 'start after', 'earliest'),
      timeSelect(END_OPTS, p.latest, 'done by', 'latest'),
      h('label', { class: 'field' }, 'full sections',
        h('select', { class: 'plain', onchange: (e) => { app.setPrefs({ full: e.target.value }); run(); } },
          [['avoid', 'Avoid if possible'], ['allow', 'Don’t mind'], ['exclude', 'Leave out']]
            .map(([v, t]) => h('option', { value: v, selected: p.full === v }, t))))),
    h('div', { class: 'field' }, 'days off', days),
    h('div', { class: 'checks' },
      check('Fewer gaps', !!p.minGaps, (v) => app.setPrefs({ minGaps: v })),
      check('Fewer days on campus', !!p.fewerDays, (v) => app.setPrefs({ fewerDays: v })),
      check('Keep my picks', !!app.ui.lockPicks, (v) => { app.ui.lockPicks = v; }))),
  results);

  function run() {
    const locked = {};
    if (app.ui.lockPicks) for (const c of app.courses) locked[c.code] = c.picks;
    const sig = JSON.stringify([app.termId, encodeCourses(app.courses), app.prefs, locked]);
    if (app.ui.results?.sig !== sig) {
      const courses = app.courses.map((c) => app.term.byCode.get(c.code));
      app.ui.results = { sig, out: generate(courses, app.prefs, { locked, maxResults: 30 }) };
      app.ui.genShown = 5;
      app.ui.genOpen = 0;
    }
    draw(app.ui.results.out);
  }

  function draw(out) {
    clear(results);
    if (out.problems.length) {
      put(results, h('div', { class: 'notice' }, out.problems.map((x) => h('p', null,
        `${x.code} ${short(x.type)}: ${x.reason === 'all sections Full' ? 'every section is full. Set full sections to “Don’t mind”.' : 'your picked section isn’t available.'}`))));
      return;
    }
    if (!out.results.length) {
      put(results, h('div', { class: 'notice' },
        h('b', null, 'No clash-free schedule.'),
        h('p', null, 'Some of these courses always overlap. Drop one, or untick “Keep my picks”.')));
      return;
    }
    put(results, h('p', { class: 'results-head' },
      out.capped
        ? `${out.found.toLocaleString()}+ schedules (search capped) · best first`
        : `${out.found.toLocaleString()} schedule${out.found === 1 ? '' : 's'} · best first`));
    const list = h('ol', { class: 'gen-list' });
    out.results.slice(0, app.ui.genShown).forEach((r, i) => put(list, resultRow(app, r, i, () => draw(out))));
    put(results, list);
    if (out.results.length > app.ui.genShown) {
      put(results, h('button', {
        type: 'button', class: 'btn more',
        onclick: () => { app.ui.genShown += 10; draw(out); },
      }, 'Show more'));
    }
  }

  run();
}

function summary(stats) {
  const used = stats.daysUsed;
  const off = WEEKDAYS.filter((d) => !used.includes(d));
  return [
    used.map((d) => DAY_SHORT[d]).join(' '),
    stats.earliest != null ? `${fmtTime(stats.earliest)}–${fmtTime(stats.latest)}` : null,
    stats.gapMinutes ? `${fmtGap(stats.gapMinutes)} gaps/wk` : 'no gaps',
    off.length ? `${off.map((d) => DAY_SHORT[d]).join(' ')} off` : null,
    stats.full ? `${stats.full} full` : null,
  ].filter(Boolean).join(' · ');
}

function resultRow(app, r, i, redraw) {
  const open = app.ui.genOpen === i;
  const picksLine = app.courses.map((c) => {
    const p = r.picks[c.code];
    return `${c.code} ${Object.entries(p).map(([t, k]) => `${short(t)} ${keyId(app, c.code, k)}`).join(' ')}`;
  }).join(' · ');

  const li = h('li', null,
    h('button', {
      type: 'button', class: 'gen-row', 'aria-expanded': String(open),
      onclick: () => { app.ui.genOpen = open ? null : i; redraw(); },
    },
    h('span', { class: 'rank' }, String(i + 1).padStart(2, '0')),
    h('span', { class: 'sum' }, summary(r.stats)),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '−' : '+'),
    h('span', { class: 'picks-line' }, picksLine)));

  if (open) {
    const chosen = chosenSections(app, app.courses, (c) => r.picks[c.code]);
    const alts = Object.entries(r.alternatives).flatMap(([code, byType]) =>
      Object.entries(byType).map(([t, keys]) => `${code} ${short(t)} ${keys.map((k) => keyId(app, code, k)).join('/')}`));
    put(li, h('div', { class: 'gen-detail' },
      calendar(eventsFor(chosen, app.term)),
      alts.length ? h('p', { class: 'alts mono' }, `Same times: ${alts.join(' · ')}`) : null,
      h('div', null, h('button', {
        type: 'button', class: 'btn primary',
        onclick: () => {
          app.setCourses(app.courses.map((c) => ({ code: c.code, picks: { ...r.picks[c.code] } })));
          app.go(['plan']);
        },
      }, 'Use this'))));
  }
  return li;
}

function keyId(app, code, key) {
  const course = app.term.byCode.get(code);
  for (const comp of course.components) {
    const s = comp.sections.find((x) => x.key === key);
    if (s) return s.id ?? '?';
  }
  return '?';
}

function fmtGap(min) {
  const hrs = Math.floor(min / 60);
  const m = min % 60;
  return hrs ? `${hrs}h${m ? `${m}m` : ''}` : `${m}m`;
}

