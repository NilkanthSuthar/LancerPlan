import { DAY_SHORT, DAYS, fmtTimeShort } from '../lib/time.js';
import { h, put } from './dom.js';

/**
 * Weekly grid. Events: {day, start, end, color, label, sub, note, clash, href}.
 * Overlapping events on a day share the column side by side.
 */
export function calendar(events, { mini = false } = {}) {
  const used = new Set(events.map((e) => e.day));
  const days = DAYS.filter((d) => DAYS.indexOf(d) < 5 || used.has(d));
  let lo = 8 * 60;
  let hi = 17 * 60;
  for (const e of events) {
    lo = Math.min(lo, Math.floor(e.start / 60) * 60);
    hi = Math.max(hi, Math.ceil(e.end / 60) * 60);
  }
  if (mini && events.length) {
    lo = Math.floor(Math.min(...events.map((e) => e.start)) / 60) * 60;
    hi = Math.ceil(Math.max(...events.map((e) => e.end)) / 60) * 60;
  }
  const hours = (hi - lo) / 60;
  const pct = (min) => `${((min - lo) / (hi - lo)) * 100}%`;

  const grid = h('div', {
    class: `cal${mini ? ' mini' : ''}`,
    style: { '--hours': hours, '--days': days.length },
    role: mini ? 'img' : 'table',
    'aria-label': mini ? 'Week preview' : 'Weekly timetable',
  });
  if (!mini) {
    put(grid, h('div', { class: 'cal-corner' }), days.map((d) => h('div', { class: 'cal-dayhead', role: 'columnheader' }, DAY_SHORT[d])));
  }
  const gutter = mini ? null : h('div', { class: 'cal-gutter', 'aria-hidden': 'true' });
  if (gutter) {
    for (let t = lo; t < hi; t += 60) put(gutter, h('span', { style: { top: pct(t) } }, fmtTimeShort(t).replace(':00', '')));
    put(grid, gutter);
  }
  for (const d of days) {
    const col = h('div', { class: 'cal-col', role: mini ? null : 'cell', 'aria-label': mini ? null : DAY_SHORT[d] });
    if (!mini) for (let t = lo + 60; t < hi; t += 60) put(col, h('i', { class: 'cal-line', style: { top: pct(t) } }));
    const dayEvents = layout(events.filter((e) => e.day === d));
    for (const e of dayEvents) {
      const style = {
        top: pct(e.start),
        height: `calc(${((e.end - e.start) / (hi - lo)) * 100}% - 2px)`,
        left: `${(e.lane / e.lanes) * 100}%`,
        width: `calc(${100 / e.lanes}% - 2px)`,
      };
      const tag = e.href && !mini ? 'a' : 'div';
      put(col, h(tag, {
        class: `ev c${e.color}${e.clash ? ' clash' : ''}${e.note ? ' part' : ''}`,
        style,
        href: tag === 'a' ? e.href : null,
        title: mini ? null : [e.label, e.sub, e.time, e.note, e.clash ? 'Clash!' : null].filter(Boolean).join('\n'),
      }, mini ? null : [
        // break "MATH-1720" after the dash in narrow columns
        h('b', null, ...e.label.split(/(?<=-)/).flatMap((part, i) => (i ? [h('wbr'), part] : [part]))),
        h('span', null, e.sub),
        h('span', { class: 'ev-time' }, e.time),
        e.note ? h('span', { class: 'ev-note' }, e.note) : null,
      ]));
    }
    put(grid, col);
  }
  return grid;
}

/** Assign each event a lane so overlapping events sit side by side. */
export function layout(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const e of cluster) {
      let i = lanes.findIndex((end) => end <= e.start);
      if (i === -1) i = lanes.push(0) - 1;
      lanes[i] = e.end;
      e.lane = i;
    }
    for (const e of cluster) e.lanes = lanes.length;
    out.push(...cluster);
    cluster = [];
  };
  for (const e of sorted) {
    const copy = { ...e };
    if (copy.start >= clusterEnd && cluster.length) flush();
    cluster.push(copy);
    clusterEnd = Math.max(clusterEnd, copy.end);
  }
  if (cluster.length) flush();
  return out;
}
