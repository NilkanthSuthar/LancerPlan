export const DAYS = ['M', 'T', 'W', 'TH', 'F', 'SA', 'SU'];
export const DAY_SHORT = { M: 'Mon', T: 'Tue', W: 'Wed', TH: 'Thu', F: 'Fri', SA: 'Sat', SU: 'Sun' };
export const DAY_LONG = {
  M: 'Monday', T: 'Tuesday', W: 'Wednesday', TH: 'Thursday', F: 'Friday', SA: 'Saturday', SU: 'Sunday',
};
// JS getUTCDay() index for each day code
export const DAY_INDEX = { SU: 0, M: 1, T: 2, W: 3, TH: 4, F: 5, SA: 6 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 510 -> "8:30 AM" */
export function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 510 -> "8:30", 780 -> "1:00" (for tight spaces where AM/PM is obvious) */
export function fmtTimeShort(min) {
  const h = Math.floor(min / 60);
  return `${((h + 11) % 12) + 1}:${String(min % 60).padStart(2, '0')}`;
}

export function fmtRange(start, end) {
  const a = fmtTime(start);
  const b = fmtTime(end);
  // "8:30–9:50 AM" when both share AM/PM
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)}–${b}`;
  return `${a}–${b}`;
}

/** "2026-09-10" -> "Sep 10" */
export function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function fmtDateRange(a, b) {
  return a && b ? `${fmtDate(a)} – ${fmtDate(b)}` : '';
}

/** "2026-09-28T02:30:45" -> "September 28, 2026" */
export function fmtLongDate(iso) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDays(days) {
  return days.map((d) => DAY_SHORT[d]).join(' ');
}

/** ISO date -> days since epoch, for arithmetic */
export function dayNumber(iso) {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
}

export function isoFromDayNumber(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Monday on or before the given date */
export function mondayOf(iso) {
  const n = dayNumber(iso);
  return isoFromDayNumber(n - ((weekdayOf(iso) + 6) % 7));
}

export function addDays(iso, k) {
  return isoFromDayNumber(dayNumber(iso) + k);
}
