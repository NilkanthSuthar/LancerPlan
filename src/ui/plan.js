import { findClashes, meetingsClash } from '../lib/clash.js';
import {
  courseCredits, findSection, FLAG_NOTES, isPartTerm, isTimed, meetingText, sectionLabel, TYPE_NAMES,
} from '../lib/data.js';
import { buildIcs } from '../lib/ics.js';
import { addDays, DAY_SHORT, fmtDate, fmtDateRange, fmtRange, mondayOf } from '../lib/time.js';
import { calendar } from './calendar.js';
import { h, toast, put } from './dom.js';

/** Chosen sections in plan order: [{code, title, type, section, color}] */
export function chosenSections(app) {
  const out = [];
  app.courses.forEach((c, i) => {
    const course = app.term.byCode.get(c.code);
    for (const comp of course.components) {
      const key = c.picks[comp.type];
      const f = key && findSection(course, key);
      if (f) out.push({ code: c.code, title: course.title, type: comp.type, section: f.section, color: i % 8 });
    }
  });
  return out;
}

export function eventsFor(chosen, term, week = 'all') {
  const events = [];
  const all = chosen.flatMap((ch) => ch.section.meetings.filter((m) => m.days).map((m) => ({ ch, m })));
  const weekEnd = week === 'all' ? null : addDays(week, 6);
  for (const { ch, m } of all) {
    if (weekEnd && !(m.startDate <= weekEnd && week <= m.endDate)) continue;
    for (const day of m.days) {
      // per day: an MTWTH meeting clashing on Monday shouldn't light up Tuesday
      const clash = all.some((o) => o.ch !== ch && o.m.days.includes(day) && meetingsClash(m, o.m));
      events.push({
        day, start: m.start, end: m.end, color: ch.color, clash,
        label: ch.code,
        sub: `${ch.type} ${ch.section.id ?? '?'}`,
        time: fmtRange(m.start, m.end),
        note: isPartTerm(m, term) ? fmtDateRange(m.startDate, m.endDate) : null,
      });
    }
  }
  return events;
}

export function renderPlan(view, app) {
  const { term } = app;
  const chosen = chosenSections(app);
  const clashes = findClashes(chosen);
  const credits = app.courses.reduce((sum, c) => sum + courseCredits(term.byCode.get(c.code), c.picks), 0);
  const missing = [];
  for (const c of app.courses) {
    const course = term.byCode.get(c.code);
    for (const comp of course.components) if (!c.picks[comp.type]) missing.push({ code: c.code, type: comp.type });
  }

  put(view, h('header', { class: 'plan-head' },
    h('div', null,
      h('h1', null, `My ${term.label} plan`),
      h('p', { class: 'stats' },
        h('span', null, `${app.courses.length} course${app.courses.length === 1 ? '' : 's'}`),
        h('span', null, `${fmtCredits(credits)} credits`),
        clashes.length ? h('span', { class: 'bad' }, `${clashes.length} clash${clashes.length === 1 ? '' : 'es'}`) : app.courses.length ? h('span', { class: 'good' }, 'No clashes') : null)),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary', href: app.link(['generate']), 'aria-disabled': app.courses.length ? null : 'true' }, '✨ Generate'),
      h('button', { type: 'button', class: 'btn', disabled: !app.courses.length, onclick: () => share(app) }, 'Share'),
      h('button', { type: 'button', class: 'btn', disabled: !chosen.length, onclick: () => exportIcs(app, chosen) }, 'Export .ics'),
      h('button', {
        type: 'button', class: 'btn ghost', disabled: !app.courses.length,
        onclick: () => { if (confirm('Remove every course from this plan?')) { app.setCourses([]); app.render(); } },
      }, 'Clear'))));

  if (!app.courses.length) {
    put(view, h('div', { class: 'empty card' },
      h('h2', null, 'No courses yet'),
      h('p', null, 'Search for your courses and tap + to add them. They’ll show up here on a weekly timetable.'),
      h('p', null, h('a', { class: 'btn primary', href: app.link([]) }, 'Search courses'))));
    return;
  }

  if (clashes.length) {
    put(view, h('div', { class: 'alert bad', role: 'alert' },
      h('strong', null, 'Time clashes'),
      h('ul', null, clashes.map((c) => h('li', null,
        `${c.first.code} ${c.first.type} ${c.first.section.id ?? '?'} and ${c.second.code} ${c.second.type} ${c.second.section.id ?? '?'}: `,
        `${c.days.map((d) => DAY_SHORT[d]).join(', ')} ${fmtRange(c.start, c.end)}`,
        c.from && c.to ? ` (${fmtDateRange(c.from, c.to)})` : ''))),
      h('p', { class: 'small' }, 'Pick different sections below or try ', h('a', { href: app.link(['generate']) }, 'Generate'), '.')));
  }
  if (missing.length) {
    put(view, h('div', { class: 'alert warn' },
      `Still to pick: ${missing.map((m) => `${m.code} ${(TYPE_NAMES[m.type] ?? m.type).toLowerCase()}`).join(', ')}.`));
  }

  const layout = h('div', { class: 'plan-layout' });
  const calWrap = h('section', { class: 'cal-wrap', 'aria-label': 'Weekly timetable' });
  const partTerm = chosen.some((ch) => ch.section.meetings.some((m) => m.days && isPartTerm(m, term)));
  if (partTerm && term.firstDate) {
    const weeks = [];
    for (let w = mondayOf(term.firstDate); w <= term.lastDate; w = addDays(w, 7)) weeks.push(w);
    put(calWrap, h('label', { class: 'week-pick' }, 'Show ',
      h('select', { onchange: (e) => { app.ui.week = e.target.value; app.render(); } },
        h('option', { value: 'all', selected: app.ui.week === 'all' }, 'all weeks'),
        weeks.map((w) => h('option', { value: w, selected: app.ui.week === w }, `week of ${fmtDate(w)}`)))),
    h('span', { class: 'muted small' }, ' Some sections run for part of the term.'));
  }
  put(calWrap, calendar(eventsFor(chosen, term, app.ui.week)));
  put(layout, calWrap);

  const side = h('section', { class: 'picks', 'aria-label': 'Courses and sections' });
  app.courses.forEach((c, i) => put(side, courseCard(app, c, i)));
  const untimed = untimedItems(chosen);
  if (untimed.length) {
    put(side, h('div', { class: 'card untimed' },
      h('h2', null, 'Not on the calendar'),
      h('p', { class: 'muted small' }, 'Online, co-op, independent study, or no time listed in the PDF.'),
      h('ul', null, untimed.map((u) => h('li', null, h('b', null, `${u.code} ${u.type} ${u.id ?? '?'}`), ` · ${u.text}`)))));
  }
  put(layout, side);
  put(view, layout);
}

function untimedItems(chosen) {
  const out = [];
  for (const ch of chosen) {
    const timed = isTimed(ch.section);
    for (const m of ch.section.meetings) {
      if (m.days) continue;
      out.push({
        code: ch.code, type: ch.type, id: ch.section.id,
        text: `${timed ? 'plus a part with no set time' : meetingText(m)}${m.startDate ? `, ${fmtDateRange(m.startDate, m.endDate)}` : ''}`,
      });
    }
  }
  return out;
}

function courseCard(app, entry, index) {
  const course = app.term.byCode.get(entry.code);
  const credits = courseCredits(course, entry.picks);
  return h('article', { class: `card course-card c${index % 8}` },
    h('header', null,
      h('a', { href: app.link(['course', course.code]) }, h('b', null, course.code), ' ', h('span', null, course.title)),
      h('span', { class: 'muted small' }, credits ? `${fmtCredits(credits)} cr` : ''),
      h('button', {
        type: 'button', class: 'icon-btn remove', 'aria-label': `Remove ${course.code}`, title: 'Remove',
        onclick: () => { app.removeCourse(course.code); app.render(); },
      }, '×')),
    course.components.map((comp) => {
      const key = entry.picks[comp.type];
      const picked = key ? findSection(course, key)?.section : null;
      const id = `pick-${course.code}-${comp.type}`;
      return h('div', { class: 'pick-row' },
        h('label', { for: id }, TYPE_NAMES[comp.type] ?? comp.type),
        h('select', {
          id, class: key ? '' : 'unpicked',
          onchange: (e) => { app.pick(course.code, comp.type, e.target.value || null); app.render(); },
        },
        h('option', { value: '' }, `Choose ${(TYPE_NAMES[comp.type] ?? comp.type).toLowerCase()}…`),
        comp.sections.map((s) => h('option', { value: s.key, selected: s.key === key },
          `${s.id ?? '?'} · ${s.meetings.map(meetingText).join(' + ')}${s.full ? ' · Full' : ''}${s.flag ? ' ⚠' : ''}`))),
        picked?.flag ? h('p', { class: 'sec-flag' }, '⚠ ', FLAG_NOTES[picked.flag]) : null,
        picked?.full ? h('p', { class: 'muted small' }, `${sectionLabel(picked, comp.type)} was Full when the PDF was made. Seats may have opened since.`) : null);
    }));
}

const fmtCredits = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

async function share(app) {
  const url = location.href;
  const text = `My ${app.term.label} timetable on LancerPlan`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Paste it anywhere to share this timetable.');
  } catch {
    prompt('Copy this link to share your timetable:', url);
  }
}

function exportIcs(app, chosen) {
  const { text, events } = buildIcs(chosen, { term: app.termId, termLabel: app.term.label });
  if (!events) {
    toast('Nothing to export: none of your sections have scheduled times.');
    return;
  }
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `lancerplan-${app.termId}.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Exported ${events} weekly event${events === 1 ? '' : 's'}. Open the file to add them to your calendar.`);
}
