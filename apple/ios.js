/* שכבת iOS: כותרת גדולה, סרגל ניווט שמתכווץ בגלילה, ווידג׳ט שעון עולמי. */
(() => {
  'use strict';
  const TITLES = { today: 'היום', days: 'תוכנית', places: 'יעדים', docs: 'מסמכים', expenses: 'הוצאות', more: 'עוד', gate: '' };
  const nav = document.getElementById('navbar');
  const navTitle = document.getElementById('navTitle');
  const editBtn = document.getElementById('editToggle');
  const fmt = (tz) => new Intl.DateTimeFormat('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const offsetH = () => {
    const p = (tz) => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', day: 'numeric' }).formatToParts(new Date()).forEach((x) => (o[x.type] = +x.value)); return o.day * 24 + o.hour; };
    return p('America/New_York') - p('Asia/Jerusalem');
  };
  const longDate = () => new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  function clockWidget() {
    const d = offsetH();
    return `<div class="ios-group world">
      <div class="world-row"><div><div class="w-sub">היום, ${d} שע׳</div><div class="w-city">ניו יורק</div></div><div class="w-time ltr" data-tz="America/New_York">${fmt('America/New_York')}</div></div>
      <div class="world-row"><div><div class="w-sub">היום</div><div class="w-city">ישראל</div></div><div class="w-time ltr" data-tz="Asia/Jerusalem">${fmt('Asia/Jerusalem')}</div></div>
    </div>`;
  }

  window.addEventListener('app:rendered', (e) => {
    const { view, edit } = e.detail;
    const view$ = document.getElementById('view');
    const title = TITLES[view] ?? '';
    navTitle.textContent = title;
    editBtn.textContent = edit ? 'סיום' : 'עריכה';
    editBtn.classList.toggle('done', !!edit);
    document.body.dataset.view = view;
    if (title) {
      const sub = view === 'today' ? `<div class="large-sub">${longDate()}</div>` : '';
      view$.insertAdjacentHTML('afterbegin', `${sub}<h1 class="large-title">${title}</h1>${view === 'today' ? clockWidget() : ''}`);
    }
    onScroll();
  });

  setInterval(() => document.querySelectorAll('.w-time[data-tz]').forEach((el) => { el.textContent = fmt(el.dataset.tz); }), 15000);

  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 38); }
  window.addEventListener('scroll', onScroll, { passive: true });
})();
