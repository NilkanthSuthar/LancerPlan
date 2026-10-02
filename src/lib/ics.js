// iCalendar export: one weekly recurring event per meeting, from the first
// matching weekday on/after the section's start date until its end date.
// Times are local to Windsor (America/Toronto). Holidays and reading week
// are not excluded; the PDF doesn't list them.

import { DAY_INDEX, addDays, weekdayOf } from './time.js';

const TZID = 'America/Toronto';
const ICS_DAY = { M: 'MO', T: 'TU', W: 'WE', TH: 'TH', F: 'FR', SA: 'SA', SU: 'SU' };

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold to 75 octets per line (RFC 5545 3.1). */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** First date on/after `from` (ISO) whose weekday is one of `days`, or null if past `to`. */
export function firstOccurrence(from, to, days) {
  const wanted = new Set(days.map((d) => DAY_INDEX[d]));
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (to && d > to) return null;
    if (wanted.has(weekdayOf(d))) return d;
  }
  return null;
}

const compact = (iso) => iso.replace(/-/g, '');
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;

function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * @param {{code: string, title: string, type: string, section: object}[]} chosen
 * @param {{term: string, termLabel: string, now?: Date}} opts
 */
export function buildIcs(chosen, { term, termLabel, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LancerPlan//Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${termLabel} timetable`)}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...VTIMEZONE,
  ];
  const dtstamp = stamp(now);
  let events = 0;
  for (const { code, title, type, section } of chosen) {
    section.meetings.forEach((m, i) => {
      if (!m.days || !m.startDate || !m.endDate) return;
      const first = firstOccurrence(m.startDate, m.endDate, m.days);
      if (!first) return;
      // UNTIL must be UTC when DTSTART has a TZID. 04:59:59Z the next day is
      // just before midnight local time in both EST and EDT.
      const until = `${compact(addDays(m.endDate, 1))}T045959Z`;
      const label = section.id ? `${type} ${section.id}` : `${type} (unlabelled section)`;
      const desc = [
        `${code} ${title}`,
        `Section: ${label}`,
        `Dates: ${m.startDate} to ${m.endDate}`,
        'From the registrar timetable PDF via LancerPlan (unofficial). Check UWinsite for rooms and changes. Holidays and reading week are not excluded.',
      ].join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${term}-${code}-${section.key}-${i}@lancerplan`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=${TZID}:${compact(first)}T${hhmm(m.start)}`,
        `DTEND;TZID=${TZID}:${compact(first)}T${hhmm(m.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${m.days.map((d) => ICS_DAY[d]).join(',')};UNTIL=${until}`,
        `SUMMARY:${escapeText(`${code} ${type}${section.id ? ` ${section.id}` : ''}`)}`,
        `DESCRIPTION:${escapeText(desc)}`,
      );
      if (m.room) lines.push(`LOCATION:${escapeText(m.room)}`);
      lines.push('END:VEVENT');
      events++;
    });
  }
  lines.push('END:VCALENDAR');
  return { text: `${lines.map(fold).join('\r\n')}\r\n`, events };
}
