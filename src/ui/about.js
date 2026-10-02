import { LEVEL_NAMES } from '../lib/data.js';
import { fmtLongDate } from '../lib/time.js';
import { h, put } from './dom.js';

const REPO = 'https://github.com/NilkanthSuthar/LancerPlan';

export function renderAbout(view, app) {
  const t = app.term;
  const issue = `${REPO}/issues/new?title=${encodeURIComponent('Data mistake: ')}&body=${encodeURIComponent(
    `Term: ${t.label}\nCourse and section:\nLancerPlan shows:\nThe PDF / UWinsite says:\n`)}`;
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

  put(view, h('article', { class: 'prose' },
    h('h1', null, 'About.'),
    h('p', { class: 'first' },
      'A timetable planner for University of Windsor students. Unofficial: not affiliated with or endorsed by the university. Register in UWinsite.'),

    h('h2', null, 'data'),
    h('p', null, 'Parsed from the public timetable PDFs on the ', ext(t.registrar, 'registrar’s site'),
      '. Nothing from UWinsite or behind a login.'),
    h('ul', null, t.sources.map((s) => h('li', null,
      ext(s.url, `${t.label} ${(LEVEL_NAMES[s.level] ?? s.level).toLowerCase()}`), `, generated ${fmtLongDate(s.generated)}`))),
    h('ul', null,
      h('li', null, '“Full” is as of that date. Seats change.'),
      h('li', null, 'Titles are cut at 30 characters. Rooms and instructors aren’t listed.'),
      h('li', null, 'A few rows in the PDF have times but no section label. They’re kept and marked; confirm those in UWinsite.'),
      h('li', null, 'Sections only clash if their days, times and dates overlap.'),
      h('li', null, 'Calendar exports don’t skip holidays or reading week.')),

    h('h2', null, 'privacy'),
    h('p', null, 'No accounts, no tracking, no server. Your plan lives in this browser and in the link.'),

    h('h2', null, 'mistakes'),
    h('p', null, ext(issue, 'Open an issue'), ' with the course, section and what’s off. Each course page says which PDF page it came from. Source: ',
      ext(REPO, 'github.com/NilkanthSuthar/LancerPlan'), '.')));
}
