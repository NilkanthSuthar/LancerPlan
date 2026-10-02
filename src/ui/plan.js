import { findClashes, meetingsClash } from '../lib/clash.js';
import {
  courseCredits, findSection, FLAG_NOTES, isPartTerm, isTimed, meetingText, TYPE_SHORT,
} from '../lib/data.js';
import { buildIcs } from '../lib/ics.js';
import { addDays, DAY_SHORT, fmtDate, fmtDateRange, fmtRange, mondayOf } from '../lib/time.js';
import { calendar } from './calendar.js';
import { h, put, toast } from './dom.js';
import { sectionList } from './sections.js';

const short = (type) => TYPE_SHORT[type] ?? type.toLowerCase();

/** Chosen sections in plan order: [{code, title, type, section, color}] */
export function chosenSections(app, courses = app.courses, picksFor = (c) => c.picks) {
  const out = [];
  courses.forEach((c, i) => {
    const course = app.term.byCode.get(c.code);
    for (const comp of course.components) {
      const key = picksFor(c)?.[comp.type];
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
        sub: `${short(ch.type)} ${ch.section.id ?? '?'}`,
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
    for (const comp of term.byCode.get(c.code).components) {
      if (!c.picks[comp.type]) missing.push(`${c.code} ${short(comp.type)}`);
    }
  }

  if (!app.courses.length) {
    put(view, h('div', { class: 'empty' },
      h('h1', null, 'Nothing here yet.'),
      h('p', null, 'Add courses from search and they’ll land on a weekly timetable.'),
      h('a', { class: 'btn primary', href: app.link([]) }, 'Search courses')));
    return;
  }

  put(view, h('header', { class: 'plan-head' },
    h('h1', null, term.label),
    h('p', { class: 'stats' },
      `${app.courses.length} course${app.courses.length === 1 ? '' : 's'} · ${fmtCredits(credits)} cr · `,
      clashes.length ? h('span', { class: 'signal' }, `${clashes.length} clash${clashes.length === 1 ? '' : 'es'}`) : 'no clashes')),
  h('div', { class: 'actions' },
    h('a', { class: 'btn primary', href: app.link(['generate']) }, 'Generate'),
    h('button', { type: 'button', class: 'btn', onclick: () => share(app) }, 'Share'),
    h('button', { type: 'button', class: 'btn', disabled: !chosen.length, onclick: () => exportIcs(app, chosen) }, 'Export .ics')));

  if (clashes.length) {
    put(view, h('div', { class: 'notice', role: 'alert' },
      h('b', null, 'Clashes'),
      h('ul', null, clashes.map((c) => h('li', null,
        `${c.first.code} ${short(c.first.type)} ${c.first.section.id ?? '?'} × ${c.second.code} ${short(c.second.type)} ${c.second.section.id ?? '?'} — `,
        `${c.days.map((d) => DAY_SHORT[d]).join('/')} ${fmtRange(c.start, c.end)}`,
        c.from && c.to && (c.from !== term.usual?.[0] || c.to !== term.usual?.[1]) ? `, ${fmtDateRange(c.from, c.to)}` : '')))));
  }
  if (missing.length) {
    put(view, h('div', { class: 'notice' }, 'Still to pick: ', h('span', { class: 'mono small' }, missing.join(', '))));
  }

  const calWrap = h('section', { 'aria-label': 'Weekly timetable' });
  const partTerm = chosen.some((ch) => ch.section.meetings.some((m) => m.days && isPartTerm(m, term)));
  if (partTerm && term.firstDate) {
    const weeks = [];
    for (let w = mondayOf(term.firstDate); w <= term.lastDate; w = addDays(w, 7)) weeks.push(w);
    put(calWrap, h('div', { class: 'week-pick' },
      h('span', null, 'some sections run part of the term'),
      h('select', { class: 'plain', 'aria-label': 'Week', onchange: (e) => { app.ui.week = e.target.value; app.render(); } },
        h('option', { value: 'all', selected: app.ui.week === 'all' }, 'All weeks'),
        weeks.map((w) => h('option', { value: w, selected: app.ui.week === w }, `Week of ${fmtDate(w)}`)))));
  }
  put(calWrap, calendar(eventsFor(chosen, term, app.ui.week)));

  const side = h('section', { class: 'picks', 'aria-label': 'Courses and sections' });
  app.courses.forEach((c, i) => put(side, courseBlock(app, c, i)));
  const untimed = untimedItems(chosen);
  if (untimed.length) {
    put(side, h('div', { class: 'untimed' },
      h('h2', null, 'not on the calendar'),
      h('ul', null, untimed.map((u) => h('li', null, h('b', null, `${u.code} ${short(u.type)} ${u.id ?? '?'}`), ` — ${u.text}`)))));
  }
  put(side, h('div', { class: 'picks-foot' },
    h('button', {
      type: 'button', class: 'link-btn',
      onclick: () => { if (confirm('Remove every course from this plan?')) { app.setCourses([]); app.render(); } },
    }, 'Clear plan')));

  put(view, h('div', { class: 'plan-layout' }, calWrap, side));
}

function untimedItems(chosen) {
  const out = [];
  for (const ch of chosen) {
    const timed = isTimed(ch.section);
    for (const m of ch.section.meetings) {
      if (m.days) continue;
      out.push({
        code: ch.code, type: ch.type, id: ch.section.id,
        text: timed ? 'also has a part with no set time' : meetingText(m).toLowerCase(),
      });
    }
  }
  return out;
}

function courseBlock(app, entry, index) {
  const course = app.term.byCode.get(entry.code);
  const credits = courseCredits(course, entry.picks);
  return h('article', { class: `pc c${index % 8}` },
    h('div', { class: 'pc-head' },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('a', { href: app.link(['course', course.code]) }, h('b', null, course.code), course.title),
      h('span', { class: 'mono small muted' }, credits ? `${fmtCredits(credits)}` : ''),
      h('button', {
        type: 'button', class: 'x', 'aria-label': `Remove ${course.code}`, title: 'Remove',
        onclick: () => { app.removeCourse(course.code); app.render(); },
      }, '×')),
    course.components.map((comp) => {
      const id = `${course.code}:${comp.type}`;
      const open = app.ui.open === id;
      const key = entry.picks[comp.type];
      const picked = key ? findSection(course, key)?.section : null;
      return [
        h('button', {
          type: 'button', class: `line-btn${picked ? '' : ' unpicked'}`, 'aria-expanded': String(open),
          onclick: () => { app.ui.open = open ? null : id; app.render(); },
        },
        h('span', { class: 'k' }, short(comp.type)),
        h('span', { class: 'v' }, picked ? (picked.id ?? '?') : 'pick'),
        h('span', null, picked ? picked.meetings.map(meetingText).join(' + ') : `${comp.sections.length} options`,
          picked?.full ? h('span', { class: 'tag full' }, ' full') : null),
        h('span', { class: 'chg' }, open ? 'close' : picked ? 'change' : '')),
        picked?.flag && !open ? h('p', { class: 'pc-note' }, FLAG_NOTES[picked.flag]) : null,
        open ? sectionList(app, course, comp, (k) => {
          app.ui.open = null;
          app.pick(course.code, comp.type, k);
          app.render();
        }) : null,
      ];
    }));
}

const fmtCredits = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

async function share(app) {
  const url = location.href;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: `${app.term.label} timetable`, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied.');
  } catch {
    prompt('Copy this link:', url);
  }
}

function exportIcs(app, chosen) {
  const { text, events } = buildIcs(chosen, { term: app.termId, termLabel: app.term.label });
  if (!events) {
    toast('Nothing to export. No section has a set time.');
    return;
  }
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `lancerplan-${app.termId}.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`${events} weekly event${events === 1 ? '' : 's'} exported. Holidays aren’t excluded.`);
}

