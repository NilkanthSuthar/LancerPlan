import { LEVEL_NAMES } from '../lib/data.js';
import { fmtLongDate } from '../lib/time.js';
import { h, put } from './dom.js';

const REPO = 'https://github.com/NilkanthSuthar/LancerPlan';

export function renderAbout(view, app) {
  const t = app.term;
  const issue = `${REPO}/issues/new?title=${encodeURIComponent('Data mistake: ')}&body=${encodeURIComponent(
    `Term: ${t.label}\nCourse code and section:\nWhat LancerPlan shows:\nWhat the registrar PDF (or UWinsite) says:\n`)}`;

  put(view, h('article', { class: 'prose' },
    h('h1', null, 'About LancerPlan'),
    h('p', { class: 'callout' },
      h('strong', null, 'LancerPlan is an unofficial student project. '),
      'It is not affiliated with, endorsed by, or connected to the University of Windsor. ',
      'Registration happens in UWinsite. Always confirm your sections there.'),

    h('h2', null, 'Where the data comes from'),
    h('p', null, 'Only from the public timetable PDFs on the ',
      h('a', { href: t.registrar, target: '_blank', rel: 'noopener' }, 'Office of the Registrar’s timetable page'),
      '. Nothing is taken from UWinsite or anything behind a login.'),
    h('ul', null, t.sources.map((s) => h('li', null,
      h('a', { href: s.url, target: '_blank', rel: 'noopener' }, `${t.label} ${LEVEL_NAMES[s.level] ?? s.level} timetable (PDF)`),
      `, generated ${fmtLongDate(s.generated)}`))),
    h('p', null, 'What that means in practice:'),
    h('ul', null,
      h('li', null, '“Full” is a snapshot from when the PDF was generated. Seats change constantly.'),
      h('li', null, 'Course titles are cut to 30 characters in the PDF.'),
      h('li', null, 'Rooms and instructors aren’t published in the PDF, so they aren’t shown.'),
      h('li', null, 'A few rows in the PDF have times but no section label. LancerPlan keeps them and marks them with ⚠, but the section number may be missing or inferred.'),
      h('li', null, 'Calendar exports don’t skip holidays or reading week.')),

    h('h2', null, 'Your privacy'),
    h('p', null, 'No accounts, no tracking, no server. Your plan is saved in your browser (localStorage) and in the page link, which is how sharing works. Nothing you do here is sent anywhere.'),

    h('h2', null, 'Found a mistake?'),
    h('p', null, 'If a course or section looks wrong, compare it with the PDF (each course page tells you which page it’s on) and ',
      h('a', { href: issue, target: '_blank', rel: 'noopener' }, 'open an issue on GitHub'),
      ' with the course code, section, and what’s different. The code is open source at ',
      h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'github.com/NilkanthSuthar/LancerPlan'), '.'),

    h('h2', null, 'Tips'),
    h('ul', null,
      h('li', null, 'Search accepts codes with or without the dash: “comp1000”, “COMP 1000”.'),
      h('li', null, 'Two sections only clash if their days, times and date ranges all overlap, so a first-half and a second-half course can share a slot.'),
      h('li', null, 'Add LancerPlan to your home screen for one-tap access.'))));
}
