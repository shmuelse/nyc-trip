/* ניו יורק · חנוכה תשפ״ז — אפליקציית טיול סטטית (ללא שרת)
 * התוכנית נטענת מ־data/trip-data.js; שינויים ומסמכים נשמרים במכשיר בלבד.
 */
(() => {
  'use strict';

  /* ================= storage ================= */
  const LS = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { toast('לא ניתן לשמור במכשיר הזה'); return false; }
    },
    del(key) { try { localStorage.removeItem(key); } catch {} }
  };
  const K = { flightLive: 'nyc.flightLive', docs: 'nyc.docsMeta', trip: 'nyc.trip', checks: 'nyc.checks', priv: 'nyc.private', ui: 'nyc.ui', wx: 'nyc.wx', exp: 'nyc.expenses', expSet: 'nyc.expenses.settings', fx: 'nyc.fx' };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const EMPTY_TRIP = { title: 'ניו יורק · חנוכה תשפ״ז', subtitle: '', timezone: 'America/New_York', hanukkahFirstNight: '', home: '', flights: [], places: [], days: [], checklist: [], contacts: [], links: [] };
  // מטמון מקומי של הנתונים מהענן — לפתיחה מהירה וגם בלי קליטה
  let trip = LS.get(K.trip, null) || clone(window.TRIP_DATA || EMPTY_TRIP);
  let checks = LS.get(K.checks, {});
  let priv = LS.get(K.priv, [
    { label: 'מספר הזמנת רכב Hertz', value: '' },
    { label: 'מספר הזמנת טיסה (PNR)', value: '' },
    { label: 'קוד כניסה לדירה', value: '' }
  ]);
  let docsMeta = LS.get(K.docs, []);
  const ui = Object.assign({ view: 'today', day: null, docCat: 'הכל' }, LS.get(K.ui, {}));
  let editMode = false;
  let cloudState = 'loading'; // loading | signed-out | denied | ready | offline
  let tripEmpty = false;

  const cloudOn = () => !!(window.Cloud && window.Cloud.user && cloudState === 'ready');
  const cloudErr = (e) => { console.error(e); toast(e && e.code === 'permission-denied' ? 'אין הרשאה לשמור' : 'השמירה לענן נכשלה — ננסה שוב כשיהיה חיבור'); };
  const saveTrip = () => {
    trip.days.sort((a, b) => a.date.localeCompare(b.date));
    LS.set(K.trip, trip);
    tripEmpty = false;
    if (cloudOn()) Cloud.saveTrip(trip).catch(cloudErr);
  };
  const saveChecks = () => { LS.set(K.checks, checks); if (cloudOn()) Cloud.saveState('checks', checks).catch(cloudErr); };
  const savePriv = () => { LS.set(K.priv, priv); if (cloudOn()) Cloud.saveState('priv', priv).catch(cloudErr); };
  const saveUI = () => LS.set(K.ui, { view: ui.view, day: ui.day, docCat: ui.docCat });

  /* ================= documents (Firestore) ================= */
  const DB = {
    all: async () => docsMeta.slice(),
    put: (d) => { const { data, ...meta } = d; return Cloud.putDoc(meta, data); },
    update: (id, patch) => Cloud.updateDocMeta(id, patch),
    del: (id) => Cloud.delDoc(id)
  };

  /* ================= utils ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const TZ = () => trip.timezone || 'America/New_York';

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function partsIn(tz, date = new Date()) {
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).forEach(({ type, value }) => { p[type] = value; });
    return p;
  }
  function nyNow() {
    const p = partsIn(TZ());
    return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
  }
  /** local date+time in tz → epoch ms */
  function zonedEpoch(date, time, tz = TZ()) {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = (time || '00:00').split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const p = partsIn(tz, new Date(guess));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return guess - (asUTC - guess);
  }
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const dateObj = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
  const daysBetween = (a, b) => Math.round((dateObj(b) - dateObj(a)) / 864e5);
  const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const weekday = (s) => HEB_DAYS[dateObj(s).getUTCDay()];
  const dayNum = (s) => +s.split('-')[2];
  const fmtDate = (s) => { const [y, m, d] = s.split('-'); return `${+d}.${+m}`; };
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  function hanukkahNight(date) {
    if (!trip.hanukkahFirstNight) return 0;
    const n = daysBetween(trip.hanukkahFirstNight, date) + 1;
    return n >= 1 && n <= 8 ? n : 0;
  }
  const ORD = ['', 'הראשון', 'השני', 'השלישי', 'הרביעי', 'החמישי', 'השישי', 'השביעי', 'השמיני'];

  const placeById = (id) => trip.places.find((p) => p.id === id);
  const wazeUrl = (p) => p.lat && p.lng
    ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(p.address || p.name)}&navigate=yes`;
  const MODE_TO_GMAPS = { subway: 'transit', train: 'transit', bus: 'transit', ferry: 'transit', walk: 'walking', car: 'driving' };
  const gmapsUrl = (p, mode) => {
    const tm = MODE_TO_GMAPS[mode] || p.mode || 'transit';
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address || p.name)}&travelmode=${tm}`;
  };
  const MODE_ICON = { car: '🚗', walk: '🚶', subway: '🚇', train: '🚆', bus: '🚌', ferry: '⛴️', flight: '✈️' };
  const MODE_LABEL = { '': 'ללא', car: 'רכב', walk: 'ברגל', subway: 'סבוויי', train: 'רכבת / AirTrain', bus: 'אוטובוס', ferry: 'מעבורת', flight: 'טיסה' };
  const WAZE_SVG = '<svg class="waze-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c5 0 9 3.6 9 8.2 0 2.6-1.3 4.7-3.4 6.1.2 1.2-.6 2.4-1.9 2.4-1 0-1.8-.7-1.9-1.6-.6.1-1.2.1-1.8.1h-.9c-.2.9-1 1.6-1.9 1.6-1.1 0-1.9-.9-1.9-2-1.5-.6-2.7-1.6-3.4-2.9-.8 0-1.6-.6-1.6-1.5 0-.6.4-1.1.9-1.3C3.3 6.6 7.2 2.5 12 2.5zm-2.6 6.3a1 1 0 100 2 1 1 0 000-2zm5.4 0a1 1 0 100 2 1 1 0 000-2zM8.8 12.6c.6 1.2 1.8 1.9 3.2 1.9s2.6-.7 3.2-1.9"/></svg>';

  const navBtns = (p, mode) => `
    <a class="btn waze sm" href="${esc(wazeUrl(p))}" target="_blank" rel="noopener">${WAZE_SVG}Waze</a>
    <a class="btn maps sm" href="${esc(gmapsUrl(p, mode))}" target="_blank" rel="noopener">🗺️ ${mode === 'car' || (!mode && !p.mode) ? 'מפות' : 'מסלול בתח״צ'}</a>`;

  function dayIndexFor(date) { return trip.days.findIndex((d) => d.date === date); }
  function currentDayIndex() {
    const now = nyNow();
    const i = dayIndexFor(now.date);
    if (i >= 0) return i;
    if (!trip.days.length) return -1;
    return now.date < trip.days[0].date ? 0 : trip.days.length - 1;
  }

  /* ================= header clocks ================= */
  function renderClocks() {
    const f = (tz) => new Intl.DateTimeFormat('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    $('#clocks').innerHTML = `<div class="clock"><b>${f(TZ())}</b><span>ניו יורק</span></div><div class="clock"><b>${f('Asia/Jerusalem')}</b><span>ישראל</span></div>`;
  }

  /* ================= views ================= */
  const views = { today: renderToday, days: renderDays, places: renderPlaces, docs: renderDocs, expenses: renderExpenses, more: renderMore };

  function render() {
    $('#brandTitle').textContent = trip.title || 'הטיול';
    const first = trip.days[0], last = trip.days[trip.days.length - 1];
    $('#brandSub').textContent = first ? `${trip.subtitle || ''} · ${fmtDate(first.date)}–${fmtDate(last.date)}` : (trip.subtitle || '');
    document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
    $('#editToggle').setAttribute('aria-pressed', String(editMode));
    $('#editBanner').hidden = !editMode;
    clearInterval(render._cd);
    const v = $('#view');
    v.innerHTML = '';
    (views[ui.view] || renderToday)(v);
    window.dispatchEvent(new CustomEvent('app:rendered', { detail: { view: ui.view, edit: editMode } }));
  }

  function go(view, opts = {}) {
    ui.view = view;
    if (opts.day != null) ui.day = opts.day;
    saveUI();
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- TODAY ---------- */
  function menorahHTML(n) {
    let s = '<div class="menorah" aria-label="נר ' + n + '">';
    // left→right: candles 8..5, shamash, 4..1 ; lit from the right
    const order = [8, 7, 6, 5, 'S', 4, 3, 2, 1];
    order.forEach((c) => {
      if (c === 'S') s += '<i class="shamash"></i>';
      else s += `<i class="${c <= n ? 'lit' : ''}"></i>`;
    });
    return s + '</div>';
  }

  function renderToday(v) {
    const now = nyNow();
    const first = trip.days[0];
    const last = trip.days[trip.days.length - 1];
    const outbound = (trip.flights || [])[0];
    let html = '';

    if (!first) {
      v.innerHTML = `<div class="card empty"><b style="font-size:18px">התוכנית עדיין ריקה</b><br>${window.Cloud && Cloud.isOwner() ? 'אפשר לייבא קובץ תוכנית או גיבוי, או להוסיף ימים במצב עריכה.<div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn gold" data-action="import">📥 ייבוא</button><button class="btn" data-action="go" data-view="days">🗓️ לתוכנית</button></div>' : 'התוכנית תופיע כאן ברגע שבעל הטיול יעלה אותה.'}</div>`;
      return;
    }

    const landing = outbound ? zonedEpoch(outbound.date, outbound.arrive || '00:00') : zonedEpoch(first.date, '00:00');
    const phase = now.date < first.date || Date.now() < landing - 6 * 3600e3 ? 'before' : now.date > last.date ? 'after' : 'during';

    if (phase === 'before') {
      html += `<section class="hero">
        <div class="hero-kicker">${esc(trip.subtitle || '')}</div>
        <h1>${esc(trip.title)}</h1>
        <div class="hero-meta"><span class="chip gold">🕎 ${trip.days.length} ימים · ${fmtDate(first.date)}–${fmtDate(last.date)}</span>${outbound ? `<span class="chip">✈️ ${esc(outbound.code)} נוחתת ${esc(outbound.arrive)}</span>` : ''}</div>
        <div class="countdown" id="countdown"></div>
        <div class="small" style="opacity:.8;position:relative;z-index:1">עד הנחיתה ב־JFK (שעון ניו יורק)</div>
      </section>`;
    } else if (phase === 'during') {
      const di = dayIndexFor(now.date);
      const day = trip.days[di];
      const n = hanukkahNight(now.date);
      html += `<section class="hero t-${esc(day?.theme || '')}">
        <div class="hero-kicker">היום · ${esc(day?.label || weekday(now.date))} ${fmtDate(now.date)}</div>
        <h1>${esc(day?.title || 'יום חופשי')}</h1>
        <div class="hero-meta">${n ? `<span class="chip gold">🕎 נר ${ORD[n]} של חנוכה</span>` : ''}<span class="chip">יום ${di + 1} מתוך ${trip.days.length}</span></div>
        ${day && day.times && day.times.length ? `<div class="times-row">${day.times.map((t) => `<span class="time-badge">${esc(t.label)}<b class="ltr">${esc(t.time)}</b></span>`).join('')}</div>` : ''}
      </section>`;
      if (day) html += nextUpHTML(day, now);
    } else {
      html += `<section class="hero"><div class="hero-kicker">הטיול הסתיים</div><h1>ברוכים השבים הביתה 🏡</h1>
        <div class="hero-meta"><span class="chip gold">${trip.days.length} ימים בניו יורק</span></div></section>`;
    }

    // flight in progress / about to happen — show it first
    const activeF = (trip.flights || []).find((f) => { const m = flightModel(f); const dep = m.depBest || (m.arrBest && m.arrBest - 14 * 3600e3); const arr = m.arrBest; return dep && arr && Date.now() > dep - 6 * 3600e3 && Date.now() < arr + 2 * 3600e3; });
    if (activeF) html += `<div class="section-title"><h2>✈️ הטיסה שלכם</h2></div>${flightCard(activeF)}`;

    // tonight's menorah
    const tonight = hanukkahNight(now.date) || (phase === 'before' ? 1 : 0);
    if (tonight) {
      const label = phase === 'before' ? `הנר הראשון ידלק ב${weekday(trip.hanukkahFirstNight)} ${fmtDate(trip.hanukkahFirstNight)}` : `הלילה מדליקים ${tonight === 1 ? 'נר אחד' : tonight + ' נרות'}`;
      html += `<div class="card menorah-card dark" style="margin-top:12px">${menorahHTML(phase === 'before' ? 1 : tonight)}<div style="font-weight:700;margin-top:6px">${esc(label)}</div></div>`;
    }

    // weather
    html += `<div class="section-title"><h2>מזג אוויר בניו יורק</h2><span class="small">°C</span></div><div id="wx" class="weather-strip"><div class="muted small">טוען תחזית…</div></div>`;

    // quick waze
    const todayDay = trip.days[currentDayIndex()];
    const ids = [...new Set([trip.home, ...((phase === 'during' && todayDay?.waze?.length) ? todayDay.waze : ['ohel', 'hertz'])].filter(Boolean))];
    const quick = ids.map(placeById).filter(Boolean);
    if (quick.length) {
      html += `<div class="section-title"><h2>ניווט מהיר</h2><a href="#" data-action="go" data-view="places" class="small">כל היעדים ←</a></div>
        <div class="quick-waze">${quick.map((p) => `<a href="${esc(wazeUrl(p))}" target="_blank" rel="noopener"><span class="qi">${esc(p.icon || '📍')}</span><span>${esc(p.name)}<small>נווט ב־Waze</small></span></a>`).join('')}</div>`;
    }

    // flights
    if ((trip.flights || []).length) {
      html += `<div class="section-title"><h2>טיסות</h2></div>${trip.flights.map(flightCard).join('')}`;
    }

    // checklist progress + docs
    const { done, total } = checklistStats();
    html += `<div class="grid-2" style="margin-top:12px">
      <div class="card" data-action="go" data-view="more" style="cursor:pointer"><b>✅ רשימת הכנות</b><div class="small muted">${done} מתוך ${total} הושלמו</div><div class="progress"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div></div>
      <div class="card" data-action="go" data-view="docs" style="cursor:pointer"><b>📄 מסמכי הנסיעה</b><div class="small muted" id="docCount">ESTA, רכב, טיסות ועוד</div></div>
    </div>
    <div class="card" data-action="go" data-view="expenses" style="cursor:pointer"><b>💰 הוצאות הטיול</b><div class="small muted">${expenses.length ? `סה״כ ${fmtMoney(expTotal('ILS'), 'ILS')} · ${expenses.length} הוצאות` : 'עדיין לא נרשמו הוצאות — לחצו להוספה'}</div></div>`;

    v.innerHTML = html;

    if (phase === 'before') {
      const tick = () => {
        const ms = Math.max(0, landing - Date.now());
        const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
        const el = $('#countdown');
        if (el) el.innerHTML = [[d, 'ימים'], [h, 'שעות'], [m, 'דקות'], [s, 'שניות']].map(([x, l]) => `<div><b>${x}</b><span>${l}</span></div>`).join('');
      };
      tick();
      render._cd = setInterval(tick, 1000);
    }
    loadWeather();
    DB.all().then((docs) => { const el = $('#docCount'); if (el) el.textContent = docs.length ? `${docs.length} מסמכים שמורים` : 'עוד לא הועלו מסמכים — לחצו להוספה'; }).catch(() => {});
  }

  /* ---------- flights: schedule + live status (AeroDataBox) ---------- */
  const AIRPORTS = {
    TLV: { tz: 'Asia/Jerusalem', city: 'תל אביב' }, JFK: { tz: 'America/New_York', city: 'ניו יורק' },
    EWR: { tz: 'America/New_York', city: 'ניוארק' }, LGA: { tz: 'America/New_York', city: 'ניו יורק' }
  };
  const apt = (c) => AIRPORTS[c] || { tz: TZ(), city: c };
  let flightLive = LS.get(K.flightLive, {});
  let secrets = {};
  const fKey = (f) => `${f.code}_${f.departDate || f.date}`.replace(/\s/g, '');
  const parseUtc = (s) => (s ? Date.parse(String(s).replace(' ', 'T').replace(/Z?$/, 'Z')) : null);
  const tFmt = (ms, tz) => new Intl.DateTimeFormat('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  const dFmt = (ms, tz) => new Intl.DateTimeFormat('he-IL', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
  const STATUS_HE = { Expected: 'מתוכננת', CheckIn: 'צ׳ק־אין', Boarding: 'עלייה למטוס', GateClosed: 'השער נסגר', Departed: 'המריאה', EnRoute: 'בטיסה', Approaching: 'לקראת נחיתה', Delayed: 'מתעכבת', Arrived: 'נחתה', Canceled: 'בוטלה', CanceledUncertain: 'ייתכן שבוטלה', Diverted: 'הוסטה' };

  function flightModel(f) {
    const live = flightLive[fKey(f)]?.data || null;
    const ld = live?.departure || {}, la = live?.arrival || {};
    const depSched = parseUtc(ld.scheduledTime?.utc) || (f.depart ? zonedEpoch(f.departDate || f.date, f.depart, apt(f.from).tz) : null);
    const arrSched = parseUtc(la.scheduledTime?.utc) || (f.arrive ? zonedEpoch(f.arriveDate || f.date, f.arrive, apt(f.to).tz) : null);
    const depBest = parseUtc(ld.revisedTime?.utc) || parseUtc(ld.runwayTime?.utc) || depSched;
    const arrBest = parseUtc(la.revisedTime?.utc) || parseUtc(la.predictedTime?.utc) || parseUtc(la.runwayTime?.utc) || arrSched;
    const now = Date.now();
    let state = 'scheduled';
    if (depBest && now >= depBest) state = 'air';
    if (arrBest && now >= arrBest) state = 'landed';
    if (live?.status === 'Canceled') state = 'canceled';
    const progress = depBest && arrBest ? Math.min(1, Math.max(0, (now - depBest) / (arrBest - depBest))) : (state === 'landed' ? 1 : 0);
    const delayMin = depSched && depBest ? Math.round((depBest - depSched) / 6e4) : 0;
    const arrDelay = arrSched && arrBest ? Math.round((arrBest - arrSched) / 6e4) : 0;
    let label = live?.status ? (STATUS_HE[live.status] || live.status) : { scheduled: 'לפי לוח הזמנים', air: 'בטיסה (לפי לוח הזמנים)', landed: 'נחתה (לפי לוח הזמנים)', canceled: 'בוטלה' }[state];
    let tone = 'green';
    if (state === 'canceled' || live?.status === 'Diverted') tone = 'red';
    else if (Math.max(delayMin, arrDelay) >= 15 || live?.status === 'Delayed') { tone = 'orange'; if (!/מתעכבת/.test(label)) label += ` · באיחור ${Math.max(delayMin, arrDelay)} דק׳`; }
    else if (live && ['Expected', 'CheckIn', 'Boarding', 'GateClosed'].includes(live.status)) label += ' · בזמן';
    return { f, live, ld, la, depSched, arrSched, depBest, arrBest, state, progress, tone, label, updated: flightLive[fKey(f)]?.ts || null };
  }

  function flightCard(f) {
    const m = flightModel(f);
    const o = apt(f.from), d = apt(f.to);
    const timeCell = (best, sched, tz, kind) => {
      if (!best) return `<div class="ft-time muted">—</div>`;
      const changed = sched && Math.abs(best - sched) >= 6e4;
      return `<div class="ft-time ${m.tone}">${tFmt(best, tz)}</div>${changed ? `<div class="ft-old">${tFmt(sched, tz)}</div>` : ''}`;
    };
    const depLbl = m.state === 'scheduled' ? 'המראה מתוכננת' : 'המריאה';
    const arrLbl = m.state === 'landed' ? 'נחתה' : 'נחיתה משוערת';
    const loc = m.live?.location;
    const ago = m.updated ? Math.max(0, Math.round((Date.now() - m.updated) / 6e4)) : null;
    const q = encodeURIComponent(`${f.code} flight status`);
    return `<div class="card fcard" data-flight="${esc(fKey(f))}">
      <div class="fc-head">
        <div><div class="fc-title"><span class="ltr">${esc(f.code)}</span> · ${esc(f.airline || '')}</div><div class="small muted">${esc(o.city)} ← ${esc(d.city)}</div></div>
        <span class="fc-status ${m.tone}">${esc(m.label)}</span>
      </div>
      <div class="fc-route">
        <b class="ltr">${esc(f.from)}</b>
        <div class="fc-line"><i style="width:${(m.progress * 100).toFixed(1)}%"></i><span class="fc-plane" style="left:${(m.progress * 100).toFixed(1)}%">✈</span></div>
        <b class="ltr">${esc(f.to)}</b>
      </div>
      <div class="fc-cols">
        <div>
          <div class="fc-place">${esc(o.city)} · ${m.depBest ? dFmt(m.depBest, o.tz) : esc(fmtDate(f.departDate || f.date))}</div>
          <div class="fc-grid"><div><div class="fc-k">${depLbl}</div>${timeCell(m.depBest, m.depSched, o.tz)}</div>
            <div><div class="fc-k">טרמינל</div><div class="fc-v">${esc(m.ld.terminal || (f.from === 'JFK' ? (f.terminal || '').replace(/\D/g, '') : '') || '–')}</div></div>
            <div><div class="fc-k">שער</div><div class="fc-v">${esc(m.ld.gate || '–')}</div></div></div>
        </div>
        <div>
          <div class="fc-place">${esc(d.city)} · ${m.arrBest ? dFmt(m.arrBest, d.tz) : esc(fmtDate(f.arriveDate || f.date))}</div>
          <div class="fc-grid"><div><div class="fc-k">${arrLbl}</div>${timeCell(m.arrBest, m.arrSched, d.tz)}</div>
            <div><div class="fc-k">טרמינל</div><div class="fc-v">${esc(m.la.terminal || (f.to === 'JFK' ? (f.terminal || '').replace(/\D/g, '') : '') || '–')}</div></div>
            <div><div class="fc-k">שער</div><div class="fc-v">${esc(m.la.gate || '–')}</div></div></div>
        </div>
      </div>
      ${loc && m.state === 'air' ? `<div class="fc-live small">📡 גובה ${Math.round(loc.altitude?.feet || 0).toLocaleString('he-IL')} רגל · מהירות ${Math.round(loc.groundSpeed?.kt || 0)} קשר${m.live?.aircraft?.model ? ` · <span class="ltr">${esc(m.live.aircraft.model)}</span>` : ''}</div>` : ''}
      ${!m.depSched ? '<div class="small muted">שעת ההמראה עדיין לא ידועה — היא תתעדכן מהנתונים החיים, או במצב עריכה.</div>' : ''}
      <div class="fc-foot small muted">
        <span>${m.live ? `עודכן ${ago < 1 ? 'עכשיו' : `לפני ${ago} דק׳`} · מקור: AeroDataBox` : secrets.aeroKey ? 'הנתונים החיים יופיעו כיממה לפני הטיסה' : 'לפי לוח הזמנים · חיבור לנתונים חיים בלשונית עוד'}</span>
        <span class="btn-row">${secrets.aeroKey ? `<button class="btn sm" data-action="flight-refresh" data-k="${esc(fKey(f))}">↻</button>` : ''}<a class="btn sm" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Google</a><a class="btn sm" href="https://www.flightradar24.com/data/flights/${esc(f.code.toLowerCase())}" target="_blank" rel="noopener">מפה</a></span>
      </div>
    </div>`;
  }

  // window in which live data is worth fetching, and how often
  function liveDue(f, force) {
    if (!secrets.aeroKey) return false;
    const m = flightModel(f);
    const dep = m.depBest || (m.arrBest ? m.arrBest - 14 * 3600e3 : null);
    const arr = m.arrBest || (dep ? dep + 14 * 3600e3 : null);
    if (!dep) return false;
    const now = Date.now();
    if (now < dep - 30 * 3600e3 || now > arr + 3 * 3600e3) return false;
    if (m.live && ['Arrived', 'Canceled'].includes(m.live.status) && now > arr + 3600e3) return false;
    if (force) return true;
    const age = now - (m.updated || 0);
    const near = now > dep - 4 * 3600e3 && now < arr + 3600e3;
    return age > (near ? 20 : 120) * 6e4; // ~65 calls per flight — fits the free 400-unit monthly plan
  }
  const fetching = new Set();
  async function refreshFlights(force, onlyKey) {
    for (const f of trip.flights || []) {
      const k = fKey(f);
      if (onlyKey && k !== onlyKey) continue;
      if (fetching.has(k) || !liveDue(f, force)) continue;
      fetching.add(k);
      try {
        const date = f.departDate || f.date;
        const r = await fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(f.code.replace(/\s/g, ''))}/${date}?withAircraftImage=false&withLocation=true`, {
          headers: { 'X-RapidAPI-Key': secrets.aeroKey, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' }
        });
        if (r.status === 204) { if (force) toast(`${f.code}: עוד אין נתונים לתאריך הזה`); continue; }
        if (!r.ok) { toast(r.status === 429 ? 'הגעתם למכסת הבקשות של נתוני הטיסות' : r.status === 401 || r.status === 403 ? 'מפתח נתוני הטיסות לא תקין או שלא נרשמתם ל־AeroDataBox' : `שגיאה בנתוני טיסה (${r.status})`); continue; }
        const arr = await r.json();
        const list = Array.isArray(arr) ? arr : [arr];
        const pick = list.find((x) => x.departure?.airport?.iata === f.from) || list[0];
        if (!pick) continue;
        flightLive[k] = { ts: Date.now(), data: pick };
        LS.set(K.flightLive, flightLive);
        if (cloudOn()) Cloud.saveState('flightLive', flightLive).catch(() => {});
        if (force) toast(`${f.code} עודכנה`);
        remoteRender();
      } catch { if (force) toast('אין חיבור לנתוני הטיסות'); }
      finally { fetching.delete(k); }
    }
  }
  setInterval(() => { if (cloudState === 'ready' && document.visibilityState === 'visible') refreshFlights(false); }, 5 * 6e4);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cloudState === 'ready') refreshFlights(false); });

  function nextUpHTML(day, now) {
    const stops = day.stops || [];
    let cur = null, next = null;
    for (const s of stops) {
      const a = toMin(s.start), b = toMin(s.end) ?? a + 30;
      if (a <= now.min && now.min < b) cur = cur || s;
      else if (a > now.min && !next) next = s;
    }
    const block = (s, label) => {
      const p = placeById(s.place);
      return `<div class="card next-card">
        <div class="next-label">${label} · <span class="ltr">${esc(s.start)}${s.end ? '–' + esc(s.end) : ''}</span></div>
        <div class="next-title">${MODE_ICON[s.mode] || ''} ${esc(s.title)}</div>
        <div class="small">${esc(s.desc)}</div>
        ${p ? `<div class="btn-row" style="margin-top:6px">${navBtns(p, s.mode)}</div>` : ''}
      </div>`;
    };
    let html = '<div style="margin-top:12px">';
    if (cur) html += block(cur, 'עכשיו');
    if (next) html += block(next, 'הבא בתור');
    if (!cur && !next) html += '<div class="card"><b>סיימנו את התוכנית להיום 🌙</b><div class="small muted">ערב טוב ונרות שמחים</div></div>';
    html += `<button class="btn block" data-action="go" data-view="days" data-day="${dayIndexFor(day.date)}">לכל התוכנית של היום ←</button></div>`;
    return html;
  }

  /* ---------- weather (Open-Meteo, ללא מפתח) ---------- */
  const WMO = (c) => {
    if (c === 0) return ['☀️', 'בהיר'];
    if (c <= 2) return ['🌤️', 'מעונן חלקית'];
    if (c === 3) return ['☁️', 'מעונן'];
    if (c <= 48) return ['🌫️', 'ערפל'];
    if (c <= 57) return ['🌦️', 'טפטוף'];
    if (c <= 67) return ['🌧️', 'גשם'];
    if (c <= 77) return ['❄️', 'שלג'];
    if (c <= 82) return ['🌧️', 'ממטרים'];
    if (c <= 86) return ['🌨️', 'שלג'];
    return ['⛈️', 'סופה'];
  };
  async function loadWeather() {
    const el = $('#wx');
    if (!el) return;
    let cache = LS.get(K.wx, null);
    if (!cache || Date.now() - cache.ts > 3 * 3600e3) {
      try {
        const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.67&longitude=-73.94&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=America%2FNew_York&forecast_days=16');
        if (!r.ok) throw new Error(r.status);
        cache = { ts: Date.now(), data: await r.json() };
        LS.set(K.wx, cache);
      } catch {
        if (!cache) { el.innerHTML = '<div class="muted small">התחזית לא זמינה כרגע (אין חיבור?)</div>'; return; }
      }
    }
    const d = cache.data.daily;
    const tripDates = new Set(trip.days.map((x) => x.date));
    let idx = d.time.map((t, i) => (tripDates.has(t) ? i : -1)).filter((i) => i >= 0);
    let note = '';
    if (!idx.length) { idx = d.time.slice(0, 7).map((_, i) => i); note = '<div class="small muted" style="margin-top:6px">התחזית לימי הטיול תופיע כשיתקרבו (עד 16 יום מראש). כרגע: השבוע הקרוב.</div>'; }
    else if (idx.length < tripDates.size) note = '<div class="small muted" style="margin-top:6px">שאר ימי הטיול יופיעו כשהתחזית תתעדכן.</div>';
    const today = nyNow().date;
    const target = $('#wx');
    if (!target) return;
    target.innerHTML = idx.map((i) => {
      const [ic, label] = WMO(d.weather_code[i]);
      return `<div class="wx ${d.time[i] === today ? 'today' : ''}" title="${esc(label)}">
        <div>${weekday(d.time[i])} ${fmtDate(d.time[i])}</div><div class="wi">${ic}</div>
        <b>${Math.round(d.temperature_2m_max[i])}°</b> / ${Math.round(d.temperature_2m_min[i])}°
        <div class="rain">💧${d.precipitation_probability_max[i] ?? 0}%</div></div>`;
    }).join('');
    target.insertAdjacentHTML('afterend', note);
  }

  /* ---------- DAYS ---------- */
  function renderDays(v) {
    if (!trip.days.length) {
      v.innerHTML = `<div class="empty">אין ימים בתוכנית.</div>${editMode ? '<button class="btn gold block" data-action="add-day">➕ הוספת יום</button>' : ''}`;
      return;
    }
    if (ui.day == null || ui.day >= trip.days.length) ui.day = Math.max(0, currentDayIndex());
    const now = nyNow();
    const day = trip.days[ui.day];
    let html = `<div class="day-strip" id="dayStrip">${trip.days.map((d, i) => {
      const n = hanukkahNight(d.date);
      return `<button class="day-pill ${i === ui.day ? 'active' : ''} ${d.date === now.date ? 'today' : ''}" data-action="pick-day" data-day="${i}">
        <div class="dw">${weekday(d.date)}</div><div class="dn">${dayNum(d.date)}</div><div class="dc">${n ? '🕎 ' + n : '&nbsp;'}</div></button>`;
    }).join('')}${editMode ? '<button class="day-pill" data-action="add-day"><div class="dw">יום</div><div class="dn">＋</div><div class="dc">&nbsp;</div></button>' : ''}</div>`;

    const n = hanukkahNight(day.date);
    html += `<section class="hero t-${esc(day.theme || '')}">
      <div class="hero-kicker">${esc(day.label || weekday(day.date))} · ${fmtDate(day.date)} · יום ${ui.day + 1}</div>
      <h1>${esc(day.title)}</h1>
      <div class="hero-meta">${n ? `<span class="chip gold">🕎 נר ${ORD[n]}</span>` : ''}<span class="chip">${(day.stops || []).length} תחנות</span></div>
      ${day.times && day.times.length ? `<div class="times-row">${day.times.map((t) => `<span class="time-badge">${esc(t.label)}<b class="ltr">${esc(t.time)}</b></span>`).join('')}</div>` : ''}
    </section>
    ${editMode ? `<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-action="edit-day">✏️ עריכת היום</button><button class="btn sm danger" data-action="del-day">🗑️ מחיקת היום</button></div>` : ''}
    <p class="small muted" style="margin:12px 4px 0">כל השעות לפי שעון ניו יורק. השעות הן חלונות תכנון — לפני היציאה בדקו עבודות סוף שבוע, שירות ומעליות ב־MTA.</p>`;

    // timeline
    const isToday = day.date === now.date;
    html += '<div class="timeline">';
    (day.stops || []).forEach((s, i) => {
      const a = toMin(s.start), b = toMin(s.end) ?? (a ?? 0) + 30;
      const state = !isToday ? '' : now.min >= b ? 'past' : now.min >= a ? 'now' : '';
      const p = placeById(s.place);
      html += `<div class="stop ${s.highlight ? 'highlight' : ''} ${s.optional ? 'optional' : ''} ${state}">
        <div class="stop-time"><b>${esc(s.start)}</b>${s.end ? `<span>${esc(s.end)}</span>` : ''}</div>
        <span class="stop-dot"></span>
        <div class="stop-body">
          <div class="stop-head"><div class="stop-title">${esc(s.title)} ${state === 'now' ? '<span class="now-tag">עכשיו</span>' : ''}${s.optional ? ' <span class="chip gray">רשות</span>' : ''}</div><span class="stop-mode" title="${esc(MODE_LABEL[s.mode] || '')}">${MODE_ICON[s.mode] || ''}</span></div>
          ${s.desc ? `<p class="stop-desc">${esc(s.desc)}</p>` : ''}
          ${p ? `<div class="stop-place"><span class="pname">${esc(p.icon || '📍')} ${esc(p.name)}</span>${navBtns(p, s.mode)}</div>` : ''}
          ${editMode ? `<div class="edit-row"><button class="btn sm" data-action="edit-stop" data-i="${i}">✏️ עריכה</button><button class="btn sm danger" data-action="del-stop" data-i="${i}">🗑️</button></div>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
    if (editMode) html += '<button class="btn gold block" data-action="add-stop">➕ הוספת תחנה</button>';

    // day waze shortcuts
    const wz = (day.waze || []).map(placeById).filter(Boolean);
    if (wz.length) {
      html += `<div class="section-title"><h2>ניווט ב־Waze ליעדי היום</h2></div>
        <div class="quick-waze">${wz.map((p) => `<a href="${esc(wazeUrl(p))}" target="_blank" rel="noopener"><span class="qi">${esc(p.icon || '📍')}</span><span>${esc(p.name)}<small>נווט ב־Waze</small></span></a>`).join('')}</div>`;
    }
    if ((day.transport || []).length) {
      html += `<div class="section-title"><h2>איך מגיעים</h2></div><div class="card">${day.transport.map((t) => `
        <div class="transport-item"><div class="ti">${MODE_ICON[t.mode] || '➡️'}</div><div><b>${esc(t.label)}</b><p>${esc(t.text)}</p></div></div>`).join('')}</div>`;
    }
    if ((day.tips || []).length) {
      html += `<div class="section-title"><h2>טיפים ומרווחים</h2></div><div class="card"><ul class="tips">${day.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    }
    (day.notes || []).forEach((nt) => { html += `<div class="card note-card"><h3>📌 ${esc(nt.title)}</h3><p>${esc(nt.text)}</p></div>`; });
    if ((day.links || []).length) {
      html += `<div class="section-title"><h2>קישורים</h2></div><div class="links">${day.links.map((l) => `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener">🔗 ${esc(l.label)}</a>`).join('')}</div>`;
    }
    html += `<div class="btn-row" style="justify-content:space-between;margin-top:22px">
      <button class="btn" data-action="pick-day" data-day="${ui.day - 1}" ${ui.day === 0 ? 'disabled style="visibility:hidden"' : ''}>→ היום הקודם</button>
      <button class="btn" data-action="pick-day" data-day="${ui.day + 1}" ${ui.day === trip.days.length - 1 ? 'disabled style="visibility:hidden"' : ''}>היום הבא ←</button></div>`;
    v.innerHTML = html;
    const active = $('.day-pill.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  /* ---------- PLACES ---------- */
  function renderPlaces(v) {
    v.innerHTML = `<input class="search" id="placeSearch" type="search" placeholder="🔎 חיפוש יעד או כתובת…" value="${esc(ui.q || '')}">
      ${editMode ? '<button class="btn gold block" style="margin-top:10px" data-action="add-place">➕ יעד חדש</button>' : ''}
      <div id="placeList"></div>`;
    const draw = () => {
      const q = (ui.q || '').trim().toLowerCase();
      const list = trip.places.filter((p) => !q || (p.name + ' ' + p.address + ' ' + (p.note || '')).toLowerCase().includes(q));
      const groups = {};
      list.forEach((p) => { (groups[p.group || 'כללי'] ||= []).push(p); });
      const usage = (id) => trip.days.filter((d) => (d.stops || []).some((s) => s.place === id)).map((d) => `${weekday(d.date)} ${fmtDate(d.date)}`);
      $('#placeList').innerHTML = Object.keys(groups).length ? Object.entries(groups).map(([g, ps]) => `
        <div class="section-title"><h2>${esc(g)}</h2><span>${ps.length}</span></div>
        ${ps.map((p) => {
          const u = usage(p.id);
          return `<div class="card place"><div class="place-ico">${esc(p.icon || '📍')}</div><div>
            <div class="place-name">${esc(p.name)}</div>
            <div class="place-addr">${esc(p.address)}</div>
            ${p.note ? `<div class="place-note">${esc(p.note)}</div>` : ''}
            ${u.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${u.map((x) => `<span class="chip gray">${esc(x)}</span>`).join('')}</div>` : ''}
            <div class="btn-row">${navBtns(p, p.mode === 'driving' ? 'car' : '')}
              <button class="btn sm" data-action="copy" data-text="${esc(p.address)}">📋 העתקה</button>
              ${p.url ? `<a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">🔗 אתר</a>` : ''}
              ${editMode ? `<button class="btn sm" data-action="edit-place" data-id="${esc(p.id)}">✏️</button><button class="btn sm danger" data-action="del-place" data-id="${esc(p.id)}">🗑️</button>` : ''}
            </div></div></div>`;
        }).join('')}`).join('') : '<div class="empty">לא נמצאו יעדים</div>';
    };
    draw();
    $('#placeSearch').addEventListener('input', (e) => { ui.q = e.target.value; draw(); });
  }

  /* ---------- DOCS ---------- */
  const DOC_CATS = ['ESTA', 'טיסות', 'רכב', 'דירה', 'ביטוח', 'כרטיסים', 'דרכונים', 'אחר'];
  const guessCat = (name) => {
    const n = name.toLowerCase();
    if (/esta/.test(n)) return 'ESTA';
    if (/hertz|car|rental|רכב/.test(n)) return 'רכב';
    if (/elal|el al|ly\d|boarding|flight|ticket|טיס|כרטיס טיסה/.test(n)) return 'טיסות';
    if (/airbnb|apt|apartment|דיר/.test(n)) return 'דירה';
    if (/insur|ביטוח/.test(n)) return 'ביטוח';
    if (/passport|דרכון/.test(n)) return 'דרכונים';
    if (/nick|intrepid|zoo|ticket|כרטיס/.test(n)) return 'כרטיסים';
    return 'אחר';
  };
  const docIcon = (t) => (t || '').includes('pdf') ? '📕' : (t || '').startsWith('image/') ? '🖼️' : '📄';
  const thumbURLs = [];

  function renderDocs(v) {
    thumbURLs.splice(0).forEach((u) => URL.revokeObjectURL(u));
    v.innerHTML = `
      <div class="privacy"><span>🔒</span><div>המסמכים נשמרים בענן המשפחתי המאובטח (Firebase) — רק מי שאישרת יכול לראות אותם, והם <b>לא</b> נמצאים בגיט. מסמך שנפתח פעם אחת זמין גם בלי קליטה.</div></div>
      <div class="dropzone" id="dropzone" style="margin-top:12px">
        <b>📤 העלאת מסמכים</b>ESTA, אישור רכב, כרטיסי טיסה, ביטוח, הזמנות — PDF או צילום
        <div style="margin-top:12px"><button class="btn primary" data-action="upload">בחירת קבצים</button></div>
      </div>
      <div class="cat-filter" id="catFilter" style="margin-top:14px"></div>
      <div id="docList"><div class="muted small">טוען…</div></div>
      <div class="section-title"><h2>מספרי הזמנה ופרטים חשובים</h2><button class="btn sm" data-action="add-priv">➕ הוספה</button></div>
      <div class="card" id="privList"></div>`;

    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (ev) => addFiles(ev.dataTransfer.files));

    drawPriv();
    DB.all().then((docs) => {
      docs.sort((a, b) => (DOC_CATS.indexOf(a.category) - DOC_CATS.indexOf(b.category)) || b.added - a.added);
      const cats = ['הכל', ...DOC_CATS.filter((c) => docs.some((d) => d.category === c))];
      if (!cats.includes(ui.docCat)) ui.docCat = 'הכל';
      $('#catFilter').innerHTML = docs.length ? cats.map((c) => `<button class="${c === ui.docCat ? 'active' : ''}" data-action="doc-cat" data-cat="${esc(c)}">${esc(c)}${c !== 'הכל' ? ' · ' + docs.filter((d) => d.category === c).length : ''}</button>`).join('') : '';
      const list = docs.filter((d) => ui.docCat === 'הכל' || d.category === ui.docCat);
      $('#docList').innerHTML = list.length ? list.map((d) => {
        const thumb = docIcon(d.type);
        return `<div class="card doc"><div class="doc-thumb">${thumb}</div><div>
          <div class="doc-name">${esc(d.title || d.name)}</div>
          <div class="doc-meta"><span class="chip">${esc(d.category)}</span> ${fmtSize(d.size)}${d.note ? ' · ' + esc(d.note) : ''}${d.by ? ' · ' + esc(d.by.split('@')[0]) : ''}</div></div>
          <div class="btn-row"><button class="btn sm primary" data-action="open-doc" data-id="${d.id}">👁️ פתיחה</button>
          <button class="btn sm" data-action="share-doc" data-id="${d.id}">📤 שיתוף</button>
          <button class="btn sm" data-action="edit-doc" data-id="${d.id}">✏️</button>
          <button class="btn sm danger" data-action="del-doc" data-id="${d.id}">🗑️</button></div></div>`;
      }).join('') : `<div class="empty">${docs.length ? 'אין מסמכים בקטגוריה הזו' : 'עדיין אין מסמכים. התחילו מ־ESTA ומאישור הרכב 🙂'}</div>`;
    }).catch(() => { $('#docList').innerHTML = '<div class="empty">הדפדפן הזה לא מאפשר שמירת מסמכים (מצב גלישה פרטית?)</div>'; });
  }

  function drawPriv() {
    const el = $('#privList');
    if (!el) return;
    el.innerHTML = priv.length ? priv.map((p, i) => `<div class="kv"><div><div class="k">${esc(p.label)}</div><div class="v">${p.value ? esc(p.value) : '<span class="muted" style="font-weight:400;font-size:14px">—</span>'}</div></div>
      <div class="btn-row">${p.value ? `<button class="btn sm" data-action="copy" data-text="${esc(p.value)}">📋</button>` : ''}<button class="btn sm" data-action="edit-priv" data-i="${i}">✏️</button></div></div>`).join('')
      : '<div class="muted small">אין פרטים. הוסיפו מספרי הזמנה, קודים וכו׳.</div>';
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    if (!cloudOn()) { toast('צריך חיבור לאינטרנט כדי להעלות מסמכים'); return; }
    let ok = 0;
    for (const f of files) {
      if (f.size > 15 * 1048576) { toast(`${f.name} גדול מדי (עד 15MB)`); continue; }
      toast(`מעלה ${f.name}…`);
      try {
        const data = await f.arrayBuffer();
        await DB.put({ id: uid(), name: f.name, title: f.name.replace(/\.[^.]+$/, ''), type: f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : ''), size: f.size, category: guessCat(f.name), note: '', added: Date.now(), data });
        ok++;
      } catch (e) { toast('שגיאה בשמירת ' + f.name); }
    }
    if (ok) { toast(ok === 1 ? 'המסמך נשמר' : `${ok} מסמכים נשמרו`); if (ui.view === 'docs') render(); }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  async function getDoc(id) {
    toast('טוען מסמך…');
    try { return await Cloud.getDocData(id); } catch (e) { toast('לא ניתן לטעון — אין חיבור?'); return null; }
  }
  const docBlob = (d) => new Blob([d.data], { type: d.type || 'application/octet-stream' });

  async function openDoc(id) {
    const d = await getDoc(id);
    if (!d) return;
    const url = URL.createObjectURL(docBlob(d));
    const isImg = (d.type || '').startsWith('image/');
    const isPdf = (d.type || '').includes('pdf');
    modal({
      title: d.title || d.name,
      body: isImg ? `<img class="viewer-img" src="${url}" alt="">` : isPdf ? `<iframe class="viewer" src="${url}" title="${esc(d.name)}"></iframe><div class="small muted">אם המסמך לא מוצג במלואו, פתחו בחלון חדש.</div>` : '<div class="empty">תצוגה מקדימה לא זמינה לסוג הקובץ הזה</div>',
      actions: `<a class="btn primary" href="${url}" target="_blank" rel="noopener">↗️ חלון חדש</a><a class="btn" href="${url}" download="${esc(d.name)}">⬇️ הורדה</a><button class="btn" value="close">סגירה</button>`,
      onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000)
    });
  }

  async function shareDoc(id) {
    const d = await getDoc(id);
    if (!d) return;
    const file = new File([d.data], d.name, { type: d.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: d.title || d.name }); } catch {}
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = d.name; a.click();
      toast('השיתוף לא נתמך כאן — הקובץ הורד');
    }
  }


  /* ---------- EXPENSES ---------- */
  const EXP_CATS = [
    ['flights', '✈️', 'טיסות'], ['passports', '🛂', 'דרכונים ו־ESTA'], ['lodging', '🏠', 'לינה'], ['car', '🚗', 'רכב שכור'],
    ['fuel', '⛽', 'דלק, חניה ואגרות'], ['transit', '🚇', 'סבוויי ותח״צ'], ['attractions', '🎢', 'אטרקציות'], ['food', '🍽️', 'אוכל'],
    ['shopping', '🛍️', 'קניות ומתנות'], ['insurance', '🛡️', 'ביטוח'], ['phone', '📱', 'טלפון ואינטרנט'], ['other', '📦', 'אחר']
  ];
  const catOf = (id) => EXP_CATS.find((c) => c[0] === id) || EXP_CATS.at(-1);
  const CUR = { ILS: '₪', USD: '$' };
  let expenses = LS.get(K.exp, []);
  let expSet = Object.assign({ rate: 3.7, rateDate: '', manual: false, budget: 0, budgetCur: 'ILS', show: 'ILS' }, LS.get(K.expSet, {}));
  const saveExp = () => LS.set(K.exp, expenses);
  const saveExpSet = () => {
    LS.set(K.expSet, expSet);
    if (cloudOn()) { const { show, ...shared } = expSet; Cloud.saveState('expSettings', shared).catch(cloudErr); }
  };
  const toCur = (amount, from, to) => from === to ? amount : to === 'ILS' ? amount * expSet.rate : amount / expSet.rate;
  const fmtMoney = (n, cur) => `${CUR[cur]}${(Math.round(n * 100) / 100).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const expTotal = (cur, list = expenses) => list.reduce((s, e) => s + toCur(+e.amount || 0, e.currency, cur), 0);

  async function refreshRate() {
    if (expSet.manual) return;
    const today = new Date().toISOString().slice(0, 10);
    if (expSet.rateDate === today) return;
    try {
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=ILS');
      if (!r.ok) throw 0;
      const j = await r.json();
      if (j.rates && j.rates.ILS) { expSet.rate = j.rates.ILS; expSet.rateDate = j.date || today; saveExpSet(); if (ui.view === 'expenses') render(); }
    } catch {}
  }

  function renderExpenses(v) {
    const cur = expSet.show;
    const other = cur === 'ILS' ? 'USD' : 'ILS';
    const total = expTotal(cur);
    const filter = ui.expCat || 'all';
    const byCat = EXP_CATS.map(([id, ic, name]) => ({ id, ic, name, sum: expTotal(cur, expenses.filter((e) => e.category === id)), n: expenses.filter((e) => e.category === id).length })).filter((c) => c.n).sort((a, b) => b.sum - a.sum);
    const max = Math.max(1, ...byCat.map((c) => c.sum));
    const budget = expSet.budget ? toCur(+expSet.budget, expSet.budgetCur, cur) : 0;
    const pre = expenses.filter((e) => trip.days[0] && e.date < trip.days[0].date);
    const during = expenses.filter((e) => trip.days[0] && e.date >= trip.days[0].date);

    let html = `<section class="hero">
      <div class="hero-kicker">סה״כ הוצאות הטיול</div>
      <div class="money-big">${fmtMoney(total, cur)}</div>
      <div class="hero-meta"><span class="chip">≈ ${fmtMoney(expTotal(other), other)}</span><span class="chip">${expenses.length} הוצאות</span>${trip.days.length ? `<span class="chip">ממוצע ליום בטיול ${fmtMoney(expTotal(cur, during) / trip.days.length, cur)}</span>` : ''}</div>
      ${budget ? `<div style="position:relative;z-index:1;margin-top:14px"><div class="small" style="opacity:.85">תקציב ${fmtMoney(budget, cur)} · ${total <= budget ? `נשארו ${fmtMoney(budget - total, cur)}` : `חריגה של ${fmtMoney(total - budget, cur)}`}</div>
        <div class="progress" style="background:rgba(255,255,255,.2)"><i style="width:${Math.min(100, Math.round(total / budget * 100))}%;${total > budget ? 'background:#ff7a6b' : ''}"></i></div></div>` : ''}
      <div class="btn-row" style="position:relative;z-index:1;margin-top:14px">
        <button class="btn gold" data-action="add-exp">➕ הוצאה חדשה</button>
        <button class="btn sm" style="background:rgba(255,255,255,.15);color:#fff" data-action="exp-cur">הצג ב־${CUR[other]}</button>
        <button class="btn sm" style="background:rgba(255,255,255,.15);color:#fff" data-action="exp-settings">⚙️ שער ותקציב</button>
      </div>
    </section>
    <div class="small muted" style="margin:8px 4px 0">שער: $1 = ₪${(+expSet.rate).toFixed(3)} ${expSet.manual ? '(ידני)' : expSet.rateDate ? `(בנק אירופי, ${expSet.rateDate})` : '(ברירת מחדל — עדכנו בהגדרות)'} · ההוצאות משותפות לכל מי שקיבל גישה.</div>`;

    if (byCat.length) {
      html += `<div class="section-title"><h2>לפי קטגוריה</h2></div><div class="card">${byCat.map((c) => `
        <button class="cat-row ${filter === c.id ? 'active' : ''}" data-action="exp-filter" data-cat="${c.id}">
          <span class="cat-ic">${c.ic}</span>
          <span class="cat-main"><span class="cat-top"><b>${esc(c.name)}</b><span class="ltr">${fmtMoney(c.sum, cur)}</span></span>
          <span class="bar"><i style="width:${Math.max(2, Math.round(c.sum / max * 100))}%"></i></span>
          <span class="small muted">${c.n} · ${total ? Math.round(c.sum / total * 100) : 0}%</span></span>
        </button>`).join('')}</div>
        ${pre.length && during.length ? `<div class="grid-2"><div class="card"><div class="small muted">לפני הנסיעה</div><b style="font-size:20px">${fmtMoney(expTotal(cur, pre), cur)}</b></div><div class="card"><div class="small muted">במהלך הטיול</div><b style="font-size:20px">${fmtMoney(expTotal(cur, during), cur)}</b></div></div>` : ''}`;
    }

    const list = expenses.filter((e) => filter === 'all' || e.category === filter).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
    html += `<div class="section-title"><h2>${filter === 'all' ? 'כל ההוצאות' : esc(catOf(filter)[2])}</h2>${filter !== 'all' ? '<button class="btn sm" data-action="exp-filter" data-cat="all">הצג הכל ✕</button>' : ''}</div>`;
    if (!list.length) {
      html += `<div class="card empty">עוד לא נרשמו הוצאות.<br>אפשר להתחיל ממה שכבר שולם: כרטיסי טיסה, דרכונים, ESTA, הדירה והרכב.<div style="margin-top:12px"><button class="btn gold" data-action="add-exp">➕ הוצאה ראשונה</button></div></div>`;
    } else {
      let lastDate = null;
      html += '<div class="card">';
      list.forEach((e) => {
        if (e.date !== lastDate) { lastDate = e.date; html += `<div class="exp-date">${e.date ? `${weekday(e.date)} ${fmtDate(e.date)}${e.date.slice(0, 4) !== '2026' ? '.' + e.date.slice(2, 4) : ''}` : 'ללא תאריך'}</div>`; }
        const [, ic, cn] = catOf(e.category);
        html += `<button class="exp-row" data-action="edit-exp" data-id="${e.id}">
          <span class="cat-ic">${ic}</span>
          <span class="exp-main"><b>${esc(e.title || cn)}</b><span class="small muted">${esc(cn)}${e.pay ? ' · ' + esc(e.pay) : ''}${e.note ? ' · ' + esc(e.note) : ''}</span></span>
          <span class="exp-amt"><b class="ltr">${fmtMoney(+e.amount, e.currency)}</b>${e.currency !== cur ? `<span class="small muted ltr">≈${fmtMoney(toCur(+e.amount, e.currency, cur), cur)}</span>` : ''}</span>
        </button>`;
      });
      html += '</div>';
    }
    if (expenses.length) html += `<div class="btn-row" style="margin-top:12px"><button class="btn sm" data-action="exp-csv">📊 ייצוא לאקסל (CSV)</button></div>`;
    v.innerHTML = html;
    refreshRate();
  }

  function editExpense(id) {
    const e = id ? expenses.find((x) => x.id === id) : { title: '', category: ui.expCat && ui.expCat !== 'all' ? ui.expCat : 'food', amount: '', currency: nyNow().date >= (trip.days[0]?.date || '9') ? 'USD' : 'ILS', date: new Date().toISOString().slice(0, 10), pay: 'אשראי', note: '' };
    form({
      title: id ? 'עריכת הוצאה' : 'הוצאה חדשה',
      fields: [
        { type: 'row', fields: [{ name: 'amount', label: 'סכום', type: 'number', value: e.amount, dir: 'ltr' }, { name: 'currency', label: 'מטבע', type: 'select', value: e.currency, options: [['ILS', '₪ שקל'], ['USD', '$ דולר']] }] },
        { name: 'category', label: 'קטגוריה', type: 'select', value: e.category, options: EXP_CATS.map(([v, ic, l]) => [v, `${ic} ${l}`]) },
        { name: 'title', label: 'תיאור', value: e.title, placeholder: 'למשל: כרטיסים ל־Nickelodeon' },
        { type: 'row', fields: [{ name: 'date', label: 'תאריך', type: 'date', value: e.date }, { name: 'pay', label: 'אמצעי תשלום', type: 'select', value: e.pay, options: [['אשראי', 'אשראי'], ['מזומן', 'מזומן'], ['העברה', 'העברה / ביט'], ['', 'אחר']] }] },
        { name: 'note', label: 'הערה', value: e.note }
      ],
      onSave: (o) => {
        const amt = parseFloat(String(o.amount).replace(/,/g, ''));
        if (!(amt > 0)) { toast('חסר סכום'); return false; }
        const rec = { ...e, ...o, amount: amt };
        let saved;
        if (id) { Object.assign(e, rec); saved = e; } else { saved = { ...rec, id: uid(), created: Date.now() }; expenses.push(saved); }
        saveExp(); render(); toast('נשמר');
        if (cloudOn()) Cloud.putExpense(saved).catch(cloudErr);
      },
      onDelete: id ? () => { expenses = expenses.filter((x) => x.id !== id); saveExp(); render(); if (cloudOn()) Cloud.delExpense(id).catch(cloudErr); } : null
    });
    setTimeout(() => { const a = $('#f_amount'); if (a && !id) { a.setAttribute('inputmode', 'decimal'); a.setAttribute('step', '0.01'); a.focus(); } }, 50);
  }

  function expSettings() {
    form({
      title: 'שער חליפין ותקציב',
      fields: [
        { name: 'rate', label: 'שער: כמה ₪ שווה $1', type: 'number', value: expSet.rate, dir: 'ltr' },
        { name: 'manual', label: 'לקבע שער ידני (בלי עדכון אוטומטי)', type: 'checkbox', value: expSet.manual },
        { type: 'row', fields: [{ name: 'budget', label: 'תקציב כולל (רשות)', type: 'number', value: expSet.budget || '', dir: 'ltr' }, { name: 'budgetCur', label: 'מטבע התקציב', type: 'select', value: expSet.budgetCur, options: [['ILS', '₪'], ['USD', '$']] }] }
      ],
      onSave: (o) => {
        const r = parseFloat(o.rate);
        if (!(r > 0)) { toast('שער לא תקין'); return false; }
        const changed = r !== +expSet.rate;
        Object.assign(expSet, { rate: r, manual: o.manual || changed, budget: parseFloat(o.budget) || 0, budgetCur: o.budgetCur });
        if (!expSet.manual) expSet.rateDate = '';
        saveExpSet(); render();
      }
    });
    setTimeout(() => document.querySelectorAll('#modal input[type=number]').forEach((i) => i.setAttribute('step', 'any')), 30);
  }

  function exportExpCSV() {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const rows = [['תאריך', 'קטגוריה', 'תיאור', 'סכום', 'מטבע', 'סכום בש״ח', 'סכום בדולר', 'אמצעי תשלום', 'הערה']];
    expenses.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach((e) => rows.push([e.date, catOf(e.category)[2], e.title, e.amount, e.currency, toCur(+e.amount, e.currency, 'ILS').toFixed(2), toCur(+e.amount, e.currency, 'USD').toFixed(2), e.pay, e.note]));
    rows.push([]); rows.push(['', 'סה״כ', '', '', '', expTotal('ILS').toFixed(2), expTotal('USD').toFixed(2), `שער ${expSet.rate}`, '']);
    download(`nyc-trip-expenses-${nyNow().date}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* ---------- MORE ---------- */
  function checklistStats() {
    let done = 0, total = 0;
    (trip.checklist || []).forEach((g) => g.items.forEach((it) => { total++; if (checks[g.group + '|' + it]) done++; }));
    return { done, total };
  }

  function renderMore(v) {
    const { done, total } = checklistStats();
    let html = `<div class="section-title"><h2>✅ רשימת הכנות</h2><span>${done}/${total}</span></div>
      <div class="progress" style="margin:-4px 4px 12px"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>`;
    (trip.checklist || []).forEach((g, gi) => {
      html += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(g.group)}</b>
        <button class="btn sm" data-action="add-check" data-g="${gi}">➕</button></div>
        ${g.items.map((it, ii) => {
          const k = g.group + '|' + it;
          return `<label class="check ${checks[k] ? 'done' : ''}"><input type="checkbox" data-action="toggle-check" data-k="${esc(k)}" ${checks[k] ? 'checked' : ''}><span>${esc(it)}</span>${editMode ? `<button type="button" class="x" data-action="del-check" data-g="${gi}" data-i="${ii}">✕</button>` : ''}</label>`;
        }).join('')}</div>`;
    });
    if (editMode) html += '<button class="btn ghost block" data-action="add-check-group">➕ קבוצה חדשה ברשימה</button>';

    // hanukkah
    if (trip.hanukkahFirstNight) {
      const today = nyNow().date;
      html += `<div class="section-title"><h2>🕎 נרות חנוכה בטיול</h2></div><div class="card">`;
      for (let n = 1; n <= 8; n++) {
        const d = new Date(dateObj(trip.hanukkahFirstNight).getTime() + (n - 1) * 864e5).toISOString().slice(0, 10);
        const day = trip.days.find((x) => x.date === d);
        const note = n === 1 && weekday(d) === 'שישי' ? 'לפני הדלקת נרות שבת' : weekday(d) === 'שבת' ? 'אחרי הבדלה' : !day ? (d > (trip.days.at(-1)?.date || '') ? 'בבית / בדרך' : '') : '';
        html += `<div class="kv" style="${d === today ? 'background:var(--gold-soft);border-radius:10px;padding-inline:8px' : ''}"><div><div class="k">${weekday(d)} ${fmtDate(d)}${note ? ' · ' + note : ''}</div><div style="font-weight:700">נר ${ORD[n]}</div></div><div>${'🕯️'.repeat(n)}</div></div>`;
      }
      html += '<div class="small muted" style="margin-top:8px">הדלקה בטיסת החזור (נר שביעי) — לפי ההנחיה ההלכתית שתקבלו.</div></div>';
    }

    // contacts
    html += `<div class="section-title"><h2>📞 אנשי קשר</h2>${editMode ? '<button class="btn sm" data-action="add-contact">➕</button>' : ''}</div><div class="card">
      ${(trip.contacts || []).map((c, i) => {
        const digits = (c.phone || '').replace(/[^\d+]/g, '');
        return `<div class="kv"><div><div style="font-weight:700">${esc(c.name)}</div><div class="k">${c.phone ? `<span class="ltr">${esc(c.phone)}</span>` : 'אין מספר'}${c.note ? ' · ' + esc(c.note) : ''}</div></div>
          <div class="btn-row">${digits ? `<a class="btn sm primary" href="tel:${esc(digits)}">📞</a>${digits.length > 5 ? `<a class="btn sm" href="https://wa.me/${esc(digits.replace(/^\+/, ''))}" target="_blank" rel="noopener">💬</a>` : ''}` : ''}
          <button class="btn sm" data-action="edit-contact" data-i="${i}">✏️</button></div></div>`;
      }).join('')}</div>`;

    // flights
    html += `<div class="section-title"><h2>✈️ טיסות</h2>${editMode ? '<button class="btn sm" data-action="edit-flights">✏️</button>' : ''}</div>${(trip.flights || []).map(flightCard).join('')}`;
    html += `<div class="card small"><b>📡 נתוני טיסה חיים</b><div class="muted" style="margin:4px 0 8px">${secrets.aeroKey ? 'מחובר ל־AeroDataBox. הנתונים מתעדכנים אוטומטית: פעם בשעתיים מיממה לפני הטיסה, ופעם ב־20 דקות מ־4 שעות לפני ההמראה ועד אחרי הנחיתה. העדכון משותף לכל המשפחה.' : 'כדי לראות סטטוס אמת (המראה, נחיתה משוערת, טרמינל, שער, עיכובים, גובה ומהירות) צריך מפתח חינמי של AeroDataBox מ־RapidAPI.'}</div>
      ${window.Cloud && Cloud.isOwner() ? `<button class="btn sm" data-action="aero-key">${secrets.aeroKey ? 'החלפת מפתח' : 'הוספת מפתח'}</button> <a class="btn sm" href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox/pricing" target="_blank" rel="noopener">הרשמה ל־AeroDataBox</a>` : ''}</div>`;

    // links
    html += `<div class="section-title"><h2>🔗 קישורים שימושיים</h2>${editMode ? '<button class="btn sm" data-action="edit-links">✏️</button>' : ''}</div>
      <div class="links">${(trip.links || []).map((l) => `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener">🔗 ${esc(l.label)}</a>`).join('')}</div>`;

    // data
    const me = window.Cloud && Cloud.user;
    html += `<div class="section-title"><h2>👤 חשבון</h2></div>
      <div class="card"><div class="kv"><div><div style="font-weight:700">${esc(me?.displayName || '')}</div><div class="k ltr">${esc(me?.email || '')}</div></div><button class="btn sm" data-action="sign-out">התנתקות</button></div>
      <div class="small muted">${cloudState === 'ready' ? '☁️ מחובר — כל שינוי נשמר ומופיע אצל כל בני המשפחה.' : '📴 עובדים בלי חיבור — השינויים יישלחו כשהחיבור יחזור.'}</div></div>`;
    if (window.Cloud && Cloud.isOwner()) {
      html += `<div class="section-title"><h2>👥 שיתוף והרשאות</h2><button class="btn sm" data-action="add-member">➕ הוספה</button></div>
        <div class="card"><div id="accessList" class="small muted">טוען…</div>
        <p class="small muted" style="margin-bottom:0">רק חשבונות גוגל ברשימה (ואתה) יכולים להיכנס. שלחו להם את הקישור: <button class="btn sm" data-action="copy-link">📋 העתקת קישור</button></p></div>`;
    }
    html += `<div class="section-title"><h2>💾 גיבוי</h2></div>
      <div class="card">
        <div class="btn-row">
          <button class="btn sm" data-action="export-backup">🗂️ גיבוי מלא לקובץ</button>
          <button class="btn sm" data-action="export-trip">⬇️ ייצוא התוכנית בלבד</button>
          ${window.Cloud && Cloud.isOwner() ? '<button class="btn sm" data-action="import">📥 ייבוא גיבוי / תוכנית</button>' : ''}
        </div>
        <p class="small muted" style="margin-bottom:0">הגיבוי כולל מסמכים, הוצאות ומספרי הזמנה — שמרו אותו במקום פרטי ואל תעלו אותו לגיט.</p>
      </div>
      <div class="card small"><b>📲 התקנה כאפליקציה</b><div class="muted">באייפון: שיתוף ← ״הוסף למסך הבית״. באנדרואיד: תפריט ⋮ ← ״התקנת אפליקציה״. אחרי פתיחה ראשונה התוכנית זמינה גם בלי קליטה (למשל בסבוויי).</div></div>
      <div class="footer-note">נבנה במיוחד לטיול · חנוכה שמח 🕎<br>${document.body.classList.contains('ios') ? '<a href="../?design=classic">מעבר לעיצוב הקלאסי</a>' : '<a href="./?design=apple">מעבר לעיצוב בסגנון Apple</a>'}</div>`;
    v.innerHTML = html;
    drawAccess();
  }

  async function drawAccess() {
    const el = $('#accessList');
    if (!el || !window.Cloud) return;
    const list = await Cloud.getAccess();
    el.innerHTML = `<div class="kv"><div><div style="font-weight:700" class="ltr">${esc(Cloud.user?.email || '')}</div><div class="k">בעלים (את/ה)</div></div></div>` +
      (list.length ? list.map((em) => `<div class="kv"><div class="ltr" style="font-weight:600">${esc(em)}</div><button class="btn sm danger" data-action="del-member" data-email="${esc(em)}">הסרה</button></div>`).join('') : '<div class="muted" style="padding:8px 0">עוד לא הוספת אף אחד.</div>');
  }

  /* ================= modal & forms ================= */
  let modalClose = null;
  function modal({ title, body, actions, onClose }) {
    const dlg = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalActions').innerHTML = actions || '<button class="btn" value="close">סגירה</button>';
    modalClose = onClose || null;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  $('#modal').addEventListener('close', () => { if (modalClose) modalClose(); modalClose = null; $('#modalBody').innerHTML = ''; });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').close(); });

  function fieldHTML(f) {
    const id = 'f_' + f.name;
    const val = f.value ?? '';
    if (f.type === 'textarea') return `<div class="field"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>${f.hint ? `<div class="small muted">${esc(f.hint)}</div>` : ''}</div>`;
    if (f.type === 'select') return `<div class="field"><label for="${id}">${esc(f.label)}</label><select id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    if (f.type === 'checkbox') return `<div class="field inline"><input type="checkbox" id="${id}" name="${f.name}" ${val ? 'checked' : ''}><label for="${id}">${esc(f.label)}</label></div>`;
    if (f.type === 'checks') return `<div class="field"><label>${esc(f.label)}</label><div style="display:flex;flex-wrap:wrap;gap:6px">${f.options.map(([v, l]) => `<label class="chip gray" style="cursor:pointer"><input type="checkbox" name="${f.name}" value="${esc(v)}" ${(val || []).includes(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>`;
    if (f.type === 'row') return `<div class="field-row">${f.fields.map(fieldHTML).join('')}</div>`;
    return `<div class="field"><label for="${id}">${esc(f.label)}</label><input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.dir ? `dir="${f.dir}"` : ''}></div>`;
  }

  function form({ title, fields, onSave, onDelete, saveLabel = 'שמירה' }) {
    modal({
      title,
      body: fields.map(fieldHTML).join(''),
      actions: `<button class="btn gold" value="save" data-role="save">${saveLabel}</button><button class="btn" value="cancel">ביטול</button>${onDelete ? '<button class="btn danger" value="delete" data-role="delete" style="margin-inline-start:auto">מחיקה</button>' : ''}`
    });
    const f = $('#modalForm');
    const handler = (e) => {
      const sub = e.submitter && e.submitter.value;
      f.removeEventListener('submit', handler);
      if (sub === 'save') {
        const fd = new FormData(f);
        const out = {};
        const flat = fields.flatMap((x) => x.type === 'row' ? x.fields : [x]);
        flat.forEach((x) => {
          if (x.type === 'checkbox') out[x.name] = fd.has(x.name);
          else if (x.type === 'checks') out[x.name] = fd.getAll(x.name);
          else out[x.name] = (fd.get(x.name) ?? '').toString().trim();
        });
        if (onSave(out) === false) { e.preventDefault(); f.addEventListener('submit', handler); }
      } else if (sub === 'delete' && onDelete) {
        if (confirm('למחוק?')) onDelete();
      }
    };
    f.addEventListener('submit', handler);
    $('#modal').addEventListener('close', () => f.removeEventListener('submit', handler), { once: true });
  }

  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const pipes = (s, keys) => lines(s).map((l) => { const parts = l.split('|').map((x) => x.trim()); const o = {}; keys.forEach((k, i) => { o[k] = parts[i] || ''; }); if (parts.length > keys.length) o[keys.at(-1)] = parts.slice(keys.length - 1).join(' | '); return o; });
  const placeOptions = () => [['', '— ללא יעד —'], ...trip.places.map((p) => [p.id, `${p.icon || '📍'} ${p.name}`])];

  function editStop(i) {
    const day = trip.days[ui.day];
    const s = i == null ? { start: '', end: '', title: '', desc: '', place: '', mode: '' } : day.stops[i];
    form({
      title: i == null ? 'תחנה חדשה' : 'עריכת תחנה',
      fields: [
        { type: 'row', fields: [{ name: 'start', label: 'משעה', type: 'time', value: s.start }, { name: 'end', label: 'עד שעה', type: 'time', value: s.end }] },
        { name: 'title', label: 'כותרת', value: s.title },
        { name: 'desc', label: 'מה עושים', type: 'textarea', value: s.desc },
        { name: 'place', label: 'יעד (לניווט)', type: 'select', value: s.place, options: placeOptions() },
        { name: 'mode', label: 'איך מגיעים', type: 'select', value: s.mode, options: Object.entries(MODE_LABEL) },
        { name: 'highlight', label: 'להדגיש (שיא היום)', type: 'checkbox', value: s.highlight },
        { name: 'optional', label: 'רשות', type: 'checkbox', value: s.optional }
      ],
      onSave: (o) => {
        if (!o.title) { toast('חסרה כותרת'); return false; }
        const ns = { ...s, ...o };
        if (!ns.highlight) delete ns.highlight;
        if (!ns.optional) delete ns.optional;
        if (i == null) day.stops.push(ns); else day.stops[i] = ns;
        day.stops.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
        saveTrip(); render(); toast('נשמר');
      },
      onDelete: i == null ? null : () => { day.stops.splice(i, 1); saveTrip(); render(); }
    });
  }

  function editDay(isNew) {
    const last = trip.days.at(-1);
    const d = isNew ? { date: last ? new Date(dateObj(last.date).getTime() + 864e5).toISOString().slice(0, 10) : nyNow().date, label: '', title: '', theme: '', times: [], stops: [], transport: [], tips: [], notes: [], waze: [], links: [] } : trip.days[ui.day];
    form({
      title: isNew ? 'יום חדש' : 'עריכת היום',
      fields: [
        { type: 'row', fields: [{ name: 'date', label: 'תאריך', type: 'date', value: d.date }, { name: 'label', label: 'כינוי (למשל ״יום שני״)', value: d.label }] },
        { name: 'title', label: 'כותרת היום', value: d.title },
        { name: 'theme', label: 'עיצוב', type: 'select', value: d.theme, options: [['', 'לילה כחול'], ['arrival', 'הגעה'], ['shabbat', 'שבת'], ['harbor', 'נמל ומים'], ['park', 'פארק'], ['fun', 'כיף ואטרקציות'], ['intrepid', 'מוזיאון'], ['departure', 'יציאה']] },
        { name: 'times', label: 'זמנים חשובים (שורה לכל זמן: תיאור | שעה)', type: 'textarea', value: (d.times || []).map((t) => `${t.label} | ${t.time}`).join('\n') },
        { name: 'transport', label: 'איך מגיעים (שורה לכל קטע: אמצעי | כותרת | טקסט)', type: 'textarea', hint: 'אמצעי: car / walk / subway / train / bus / ferry', value: (d.transport || []).map((t) => `${t.mode} | ${t.label} | ${t.text}`).join('\n') },
        { name: 'tips', label: 'טיפים (שורה לכל טיפ)', type: 'textarea', value: (d.tips || []).join('\n') },
        { name: 'notes', label: 'הערה מודגשת (שורה ראשונה כותרת, השאר טקסט)', type: 'textarea', value: (d.notes || []).map((n) => `${n.title}\n${n.text}`).join('\n\n') },
        { name: 'links', label: 'קישורים (שורה לכל קישור: תיאור | כתובת)', type: 'textarea', value: (d.links || []).map((l) => `${l.label} | ${l.url}`).join('\n') },
        { name: 'waze', label: 'קיצורי Waze ליום', type: 'checks', value: d.waze || [], options: trip.places.map((p) => [p.id, p.name]) }
      ],
      onSave: (o) => {
        if (!o.date) { toast('חסר תאריך'); return false; }
        if (trip.days.some((x) => x !== d && x.date === o.date)) { toast('כבר קיים יום בתאריך הזה'); return false; }
        Object.assign(d, {
          date: o.date, label: o.label || weekday(o.date), title: o.title || 'יום בניו יורק', theme: o.theme,
          times: pipes(o.times, ['label', 'time']),
          transport: pipes(o.transport, ['mode', 'label', 'text']),
          tips: lines(o.tips),
          notes: o.notes.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => { const [t, ...r] = b.split('\n'); return { title: t.trim(), text: r.join('\n').trim() }; }),
          links: pipes(o.links, ['label', 'url']).filter((l) => l.url),
          waze: o.waze
        });
        if (isNew) trip.days.push(d);
        saveTrip();
        ui.day = trip.days.indexOf(d);
        saveUI(); render(); toast('נשמר');
      }
    });
  }

  function editPlace(id) {
    const p = id ? placeById(id) : { id: '', name: '', icon: '📍', address: '', group: 'מנהטן', note: '', url: '' };
    const groups = [...new Set(trip.places.map((x) => x.group).filter(Boolean))];
    form({
      title: id ? 'עריכת יעד' : 'יעד חדש',
      fields: [
        { type: 'row', fields: [{ name: 'icon', label: 'אייקון', value: p.icon }, { name: 'group', label: `קבוצה (${groups.join(' / ')})`, value: p.group }] },
        { name: 'name', label: 'שם', value: p.name },
        { name: 'address', label: 'כתובת (באנגלית, כפי שמחפשים ב־Waze)', value: p.address, dir: 'ltr' },
        { type: 'row', fields: [{ name: 'lat', label: 'קו רוחב (רשות)', value: p.lat || '', dir: 'ltr' }, { name: 'lng', label: 'קו אורך (רשות)', value: p.lng || '', dir: 'ltr' }] },
        { name: 'note', label: 'הערה', type: 'textarea', value: p.note },
        { name: 'url', label: 'אתר', value: p.url, dir: 'ltr', type: 'url' }
      ],
      onSave: (o) => {
        if (!o.name || !o.address) { toast('חסר שם או כתובת'); return false; }
        Object.assign(p, o);
        ['lat', 'lng', 'note', 'url'].forEach((k) => { if (!p[k]) delete p[k]; });
        if (!id) { p.id = 'p' + uid(); trip.places.push(p); }
        saveTrip(); render(); toast('נשמר');
      },
      onDelete: id ? () => delPlace(id) : null
    });
  }
  function delPlace(id) {
    const used = trip.days.some((d) => (d.stops || []).some((s) => s.place === id));
    if (used && !confirm('היעד משויך לתחנות בתוכנית. למחוק בכל זאת?')) return;
    trip.places = trip.places.filter((p) => p.id !== id);
    trip.days.forEach((d) => { (d.stops || []).forEach((s) => { if (s.place === id) s.place = ''; }); d.waze = (d.waze || []).filter((w) => w !== id); });
    saveTrip(); render();
  }

  function editPriv(i) {
    const p = i == null ? { label: '', value: '' } : priv[i];
    form({
      title: i == null ? 'פרט חדש' : 'עריכה',
      fields: [{ name: 'label', label: 'תיאור', value: p.label, placeholder: 'למשל: מספר הזמנת Hertz' }, { name: 'value', label: 'ערך', value: p.value, dir: 'ltr' }],
      onSave: (o) => { if (!o.label) return; if (i == null) priv.push(o); else priv[i] = o; savePriv(); drawPriv(); },
      onDelete: i == null ? null : () => { priv.splice(i, 1); savePriv(); drawPriv(); }
    });
  }

  function editContact(i) {
    trip.contacts ||= [];
    const c = i == null ? { name: '', phone: '', note: '' } : trip.contacts[i];
    form({
      title: i == null ? 'איש קשר חדש' : 'עריכת איש קשר',
      fields: [{ name: 'name', label: 'שם', value: c.name }, { name: 'phone', label: 'טלפון (עם קידומת, למשל +1…)', value: c.phone, type: 'tel', dir: 'ltr' }, { name: 'note', label: 'הערה', value: c.note }],
      onSave: (o) => { if (!o.name) return; if (i == null) trip.contacts.push(o); else trip.contacts[i] = o; saveTrip(); render(); },
      onDelete: i == null ? null : () => { trip.contacts.splice(i, 1); saveTrip(); render(); }
    });
  }

  function editFlights() {
    form({
      title: 'עריכת טיסות',
      fields: [{ name: 'f', label: 'שורה לכל טיסה: קוד | חברה | מ | אל | תאריך המראה | שעת המראה | תאריך נחיתה | שעת נחיתה | הערה (שעות מקומיות בכל שדה תעופה)', type: 'textarea', value: (trip.flights || []).map((f) => [f.code, f.airline, f.from, f.to, f.departDate || f.date, f.depart, f.arriveDate || f.date, f.arrive, f.note || ''].join(' | ')).join('\n') }],
      onSave: (o) => {
        trip.flights = pipes(o.f, ['code', 'airline', 'from', 'to', 'departDate', 'depart', 'arriveDate', 'arrive', 'note']).map((f) => ({ ...f, date: f.departDate, terminal: (trip.flights || []).find((x) => x.code === f.code)?.terminal || '' }));
        saveTrip(); render();
      }
    });
  }
  function editLinks() {
    form({
      title: 'קישורים שימושיים',
      fields: [{ name: 'l', label: 'שורה לכל קישור: תיאור | כתובת', type: 'textarea', value: (trip.links || []).map((l) => `${l.label} | ${l.url}`).join('\n') }],
      onSave: (o) => { trip.links = pipes(o.l, ['label', 'url']).filter((l) => l.url); saveTrip(); render(); }
    });
  }

  /* ================= import / export ================= */
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const b64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; };

  function exportTrip() {
    const header = '/*\n * נתוני הטיול. האפליקציה טוענת את הקובץ הזה כברירת מחדל.\n * שינויים שעושים במצב עריכה נשמרים במכשיר; כדי לעדכן את הגרסה בגיט,\n * ייצאו את הקובץ מתוך "עוד ← ייצוא קובץ נתונים" והחליפו את הקובץ הזה.\n * אין לשמור כאן מספרי דרכון, ESTA או מספרי הזמנה — הם נשמרים רק במכשיר.\n */\n';
    download('trip-data.js', header + 'window.TRIP_DATA = ' + JSON.stringify(trip, null, 2) + ';\n', 'text/javascript');
    toast('הקובץ ירד');
  }
  async function exportBackup() {
    let docs = [];
    toast('מכין גיבוי…');
    try { for (const m of docsMeta) { const d = await Cloud.getDocData(m.id); if (d) { const { uploadedAt, ...rest } = d; docs.push({ ...rest, data: b64(d.data) }); } } } catch { toast('חלק מהמסמכים לא נכללו (אין חיבור?)'); }
    const payload = { type: 'nyc-trip-backup', created: new Date().toISOString(), trip, checks, priv, expenses, expSet, docs };
    download(`nyc-trip-backup-${nyNow().date}.json`, JSON.stringify(payload), 'application/json');
    toast('הגיבוי ירד');
  }
  async function importFile(file) {
    try {
      let text = await file.text();
      let data;
      if (/^\s*(\/\*[\s\S]*?\*\/\s*)?window\.TRIP_DATA\s*=/.test(text)) {
        text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
        data = { trip: JSON.parse(text) };
      } else {
        data = JSON.parse(text);
        if (data.type !== 'nyc-trip-backup') data = { trip: data };
      }
      if (!data.trip || !Array.isArray(data.trip.days)) throw new Error('bad');
      const docsCount = (data.docs || []).length;
      if (!confirm(`לייבא?\nתוכנית: ${data.trip.days.length} ימים${docsCount ? `\nמסמכים: ${docsCount}` : ''}\nהתוכנית הנוכחית במכשיר תוחלף.`)) return;
      trip = data.trip; saveTrip();
      if (data.checks) { checks = data.checks; saveChecks(); }
      if (data.priv) { priv = data.priv; savePriv(); }
      if (data.expenses) { expenses = data.expenses; saveExp(); if (cloudOn()) for (const e of expenses) await Cloud.putExpense(e); }
      if (data.expSet) { expSet = Object.assign(expSet, data.expSet); saveExpSet(); }
      if (docsCount) {
        const existing = new Set(docsMeta.map((d) => d.id));
        for (const d of data.docs) if (!existing.has(d.id)) { const { uploadedAt, chunks, ...m } = d; await DB.put({ ...m, data: unb64(d.data) }); }
      }
      toast('הייבוא הושלם'); render();
    } catch (e) { toast('הקובץ לא זוהה כגיבוי או קובץ נתונים'); }
  }

  /* ================= events ================= */
  const actions = {
    'go': (el) => go(el.dataset.view, { day: el.dataset.day != null ? +el.dataset.day : undefined }),
    'pick-day': (el) => { const d = +el.dataset.day; if (d >= 0 && d < trip.days.length) { ui.day = d; saveUI(); render(); window.scrollTo({ top: 0 }); } },
    'add-stop': () => editStop(null),
    'edit-stop': (el) => editStop(+el.dataset.i),
    'del-stop': (el) => { if (confirm('למחוק את התחנה?')) { trip.days[ui.day].stops.splice(+el.dataset.i, 1); saveTrip(); render(); } },
    'add-day': () => editDay(true),
    'edit-day': () => editDay(false),
    'del-day': () => { if (confirm('למחוק את כל היום מהתוכנית?')) { trip.days.splice(ui.day, 1); ui.day = Math.max(0, ui.day - 1); saveTrip(); render(); } },
    'add-place': () => editPlace(null),
    'edit-place': (el) => editPlace(el.dataset.id),
    'del-place': (el) => { if (confirm('למחוק את היעד?')) delPlace(el.dataset.id); },
    'copy': async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('הועתק'); } catch { prompt('העתיקו:', el.dataset.text); } },
    'upload': () => $('#fileInput').click(),
    'doc-cat': (el) => { ui.docCat = el.dataset.cat; saveUI(); render(); },
    'open-doc': (el) => openDoc(el.dataset.id),
    'share-doc': (el) => shareDoc(el.dataset.id),
    'edit-doc': async (el) => {
      const d = docsMeta.find((x) => x.id === el.dataset.id);
      if (!d) return;
      form({
        title: 'פרטי המסמך',
        fields: [{ name: 'title', label: 'שם תצוגה', value: d.title || d.name }, { name: 'category', label: 'קטגוריה', type: 'select', value: d.category, options: DOC_CATS.map((c) => [c, c]) }, { name: 'note', label: 'הערה (למשל: של מי)', value: d.note }],
        onSave: (o) => { Object.assign(d, o); DB.update(d.id, o).catch(cloudErr); render(); }
      });
    },
    'del-doc': async (el) => { if (confirm('למחוק את המסמך? הוא יימחק לכל בני המשפחה.')) { docsMeta = docsMeta.filter((x) => x.id !== el.dataset.id); render(); DB.del(el.dataset.id).catch(cloudErr); } },
    'add-priv': () => editPriv(null),
    'edit-priv': (el) => editPriv(+el.dataset.i),
    'add-check': (el) => {
      const g = trip.checklist[+el.dataset.g];
      form({ title: 'פריט חדש · ' + g.group, fields: [{ name: 't', label: 'פריט' }], onSave: (o) => { if (o.t) { g.items.push(o.t); saveTrip(); render(); } } });
    },
    'del-check': (el) => { trip.checklist[+el.dataset.g].items.splice(+el.dataset.i, 1); saveTrip(); render(); },
    'add-check-group': () => form({ title: 'קבוצה חדשה', fields: [{ name: 'g', label: 'שם הקבוצה' }], onSave: (o) => { if (o.g) { (trip.checklist ||= []).push({ group: o.g, items: [] }); saveTrip(); render(); } } }),
    'add-contact': () => editContact(null),
    'edit-contact': (el) => editContact(+el.dataset.i),
    'edit-flights': editFlights,
    'edit-links': editLinks,
    'export-trip': exportTrip,
    'flight-refresh': (el) => refreshFlights(true, el.dataset.k),
    'aero-key': () => form({ title: 'מפתח AeroDataBox (RapidAPI)', fields: [{ name: 'k', label: 'X-RapidAPI-Key', value: '', dir: 'ltr', placeholder: secrets.aeroKey ? 'השאירו ריק כדי למחוק' : '' }], onSave: (o) => {
      secrets = { ...secrets, aeroKey: o.k.trim() };
      Cloud.saveState('secrets', secrets).then(() => { toast(o.k.trim() ? 'המפתח נשמר בענן המשפחתי' : 'המפתח נמחק'); render(); refreshFlights(true); }).catch(cloudErr);
    } }),
    'export-backup': exportBackup,
    'import': () => $('#importInput').click(),
    'add-exp': () => editExpense(null),
    'edit-exp': (el) => editExpense(el.dataset.id),
    'exp-filter': (el) => { ui.expCat = ui.expCat === el.dataset.cat ? 'all' : el.dataset.cat; render(); },
    'exp-cur': () => { expSet.show = expSet.show === 'ILS' ? 'USD' : 'ILS'; LS.set(K.expSet, expSet); render(); },
    'exp-settings': expSettings,
    'exp-csv': exportExpCSV,
    'sign-out': async () => { if (!confirm('להתנתק? הנתונים יימחקו מהמכשיר הזה (הם נשארים בענן).')) return; Object.values(K).forEach((k) => LS.del(k)); try { await Cloud.signOut(); } catch {} location.reload(); },
    'sign-in': async (el) => { el.disabled = true; try { await Cloud.signIn(); } catch (e) { toast('ההתחברות נכשלה: ' + (e.code || e.message)); el.disabled = false; } },
    'add-member': () => form({ title: 'הוספת בן משפחה', fields: [{ name: 'email', label: 'כתובת Gmail / חשבון גוגל', type: 'email', dir: 'ltr' }], onSave: (o) => {
      const em = o.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast('כתובת לא תקינה'); return false; }
      Cloud.getAccess().then((list) => { if (!list.includes(em)) list.push(em); return Cloud.setAccess(list); }).then(() => { toast('נוסף ✓'); drawAccess(); }).catch(cloudErr);
    } }),
    'del-member': (el) => { if (!confirm(`להסיר את ${el.dataset.email}?`)) return; Cloud.getAccess().then((l) => Cloud.setAccess(l.filter((x) => x !== el.dataset.email))).then(drawAccess).catch(cloudErr); },
    'copy-link': async () => { const u = location.origin + location.pathname; try { await navigator.clipboard.writeText(u); toast('הקישור הועתק'); } catch { prompt('הקישור:', u); } }
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.dataset.action === 'toggle-check') return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.action === 'toggle-check') {
      if (el.checked) checks[el.dataset.k] = true; else delete checks[el.dataset.k];
      saveChecks();
      el.closest('.check').classList.toggle('done', el.checked);
      const { done, total } = checklistStats();
      document.querySelectorAll('.progress i').forEach((i) => { i.style.width = (total ? Math.round(done / total * 100) : 0) + '%'; });
      const t = document.querySelector('.section-title span');
      if (t && ui.view === 'more') t.textContent = `${done}/${total}`;
    }
  });
  $('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
  $('#editToggle').addEventListener('click', () => { editMode = !editMode; render(); toast(editMode ? 'מצב עריכה — אפשר לשנות הכל' : 'מצב צפייה'); });
  $('#editDone').addEventListener('click', () => { editMode = false; render(); });
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });

  /* ================= boot ================= */
  /* ---------- auth gate + live sync ---------- */
  function gate(kind, email) {
    document.body.classList.add('gated');
    const msg = {
      loading: '<div class="spinner"></div><div class="muted">טוען…</div>',
      'signed-out': `<p>האפליקציה המשפחתית לטיול — תוכנית, מסמכים והוצאות.<br>כניסה עם חשבון גוגל שקיבל הרשאה.</p>
        <button class="btn google" data-action="sign-in"><svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>כניסה עם Google</button>
        <p class="small muted">באייפון: אם הכניסה לא נפתחת מהאפליקציה שעל מסך הבית, היכנסו פעם אחת דרך Safari.</p>`,
      denied: `<p>החשבון <b class="ltr">${esc(email || '')}</b> עדיין לא קיבל גישה לטיול.</p><p class="small muted">בקשו מבעל הטיול להוסיף את הכתובת הזו (עוד ← שיתוף והרשאות), ואז רעננו.</p>
        <div class="btn-row" style="justify-content:center"><button class="btn primary" onclick="location.reload()">רענון</button><button class="btn" data-action="sign-out">החלפת חשבון</button></div>`,
      error: `<p>לא הצלחנו להתחבר לשרת.</p><p class="small muted ltr">${esc(email || '')}</p><button class="btn primary" onclick="location.reload()">נסו שוב</button>`
    }[kind];
    $('#view').innerHTML = `<div class="gate"><div class="gate-mark">🕎</div><h1>${esc(trip.title || 'ניו יורק · חנוכה')}</h1>${msg}</div>`;
    window.dispatchEvent(new CustomEvent('app:rendered', { detail: { view: 'gate', edit: false } }));
  }

  let pendingRender = false;
  function remoteRender() {
    if (cloudState !== 'ready') return;
    const ae = document.activeElement;
    if ($('#modal').open || (ae && $('#view').contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) { pendingRender = true; return; }
    clearTimeout(remoteRender._t);
    remoteRender._t = setTimeout(render, 120);
  }
  $('#modal').addEventListener('close', () => { if (pendingRender) { pendingRender = false; setTimeout(remoteRender, 50); } });

  function startApp() {
    document.body.classList.remove('gated');
    cloudState = 'ready';
    render();
    Cloud.subscribe({
      trip: (t) => { if (t) { trip = t; tripEmpty = false; LS.set(K.trip, trip); } else { tripEmpty = true; trip = clone(EMPTY_TRIP); } remoteRender(); },
      checks: (v) => { checks = v || {}; LS.set(K.checks, checks); remoteRender(); },
      priv: (v) => { if (v) { priv = v; LS.set(K.priv, priv); remoteRender(); } },
      expSettings: (v) => { if (v) { Object.assign(expSet, v); LS.set(K.expSet, expSet); remoteRender(); } },
      flightLive: (v) => { if (v) { flightLive = v; LS.set(K.flightLive, flightLive); remoteRender(); } },
      secrets: (v) => { const had = !!secrets.aeroKey; secrets = v || {}; if (!had && secrets.aeroKey) setTimeout(() => refreshFlights(false), 1500); remoteRender(); },
      expenses: (list) => { expenses = list; saveExp(); remoteRender(); },
      docs: (list) => { docsMeta = list; LS.set(K.docs, docsMeta.map(({ uploadedAt, ...m }) => m)); remoteRender(); },
      error: (e) => { console.error(e); if (e.code === 'permission-denied') { cloudState = 'denied'; gate('denied', Cloud.user?.email); } }
    });
  }

  function initCloud() {
    if (initCloud.done) return; initCloud.done = true;
    Cloud.onAuth(async (user) => {
      if (!user) { cloudState = 'signed-out'; gate('signed-out'); return; }
      const p = await Cloud.probe();
      if (p === 'denied') { cloudState = 'denied'; gate('denied', user.email); return; }
      if (p.startsWith('error') && !LS.get(K.trip, null)) { gate('error', p); return; }
      startApp();
    });
  }

  renderClocks();
  setInterval(renderClocks, 15000);
  setInterval(() => { if ((ui.view === 'today' || ui.view === 'days') && !$('#modal').open && !editMode && cloudState === 'ready') render(); }, 60000);
  gate('loading');
  if (window.Cloud) initCloud(); else window.addEventListener('cloud-ready', initCloud);
  // אין חיבור בכלל (המודול לא נטען) — מציגים את המטמון המקומי לקריאה
  setTimeout(() => {
    if (!window.Cloud && LS.get(K.trip, null)) { cloudState = 'offline'; document.body.classList.remove('gated'); render(); toast('אין חיבור — מוצג המידע השמור במכשיר'); }
    else if (!window.Cloud) gate('error', 'network');
  }, 9000);

  if ('serviceWorker' in navigator && location.protocol === 'https:' && /github\.io$|localhost/.test(location.hostname)) {
    navigator.serviceWorker.register(window.SW_PATH || 'sw.js', window.SW_PATH ? { scope: '../' } : undefined).catch(() => {});
  }
})();
