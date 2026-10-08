/* =========================================================
   Simply Connect – Master Reports page
   Pivot-tab reports (Code.gs ?mode=reports) shown with the SAME
   layout as the main dashboard: slicers (range / dates / dropdowns),
   KPI cards, donut + line + bar charts and a sortable table.
   Numbers come straight from the pivot tabs; when no slicer is
   active the sheet's own Grand Total / totals are used as-is.
   ========================================================= */
const ReportsPage = (() => {
  const LS_KEY = 'sc_reports_last_good';
  const ROW_CAP = 300;
  const COLORS = { violet: '#5240D6', amber: '#FDAC00', green: '#2FA352', rose: '#E5484D', peri: '#3F49B8', magenta: '#B23FA8', blue: '#2B83C6', brown: '#9A6A3A', slate: '#9AA0B4' };
  const PALETTE = [COLORS.violet, COLORS.amber, COLORS.magenta, COLORS.green, COLORS.peri, COLORS.rose, COLORS.blue, COLORS.brown, COLORS.slate];
  const ICON = {
    chart: '<path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    users: '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.6 6.1 20.5l1.2-6.5-4.8-4.6 6.6-.9L12 2.5z" fill="currentColor"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    check: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    target: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    arrow: '<path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    chevron: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 3v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    down: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const svg = n => `<svg viewBox="0 0 24 24" fill="none">${ICON[n]}</svg>`;

  let payload = null, activeId = null, loading = false, error = null;
  let model = null;   // parsed active report
  // slicer state (empty set = All)
  const S = { rowSets: [new Set(), new Set()], cols: new Set(), range: 'all', start: '', end: '', search: '', sortCol: -1, sortDir: 'desc', showAll: false };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const root = () => document.getElementById('rpRoot');

  // ---------------- parsing ----------------
  const NUM_RE = /^\(?-?\$?\s*\d[\d,]*(\.\d+)?\s*%?\)?$/;
  const isNumStr = s => NUM_RE.test(String(s).trim());
  function toNum(s) {
    let t = String(s == null ? '' : s).trim();
    if (!t || !isNumStr(t)) return null;
    const neg = /^\(.*\)$/.test(t) || /^-/.test(t.replace(/^\(/, ''));
    t = t.replace(/[()$,%\s-]/g, '');
    const n = parseFloat(t);
    return isNaN(n) ? null : (neg ? -n : n);
  }
  const isTotalLabel = s => /^\s*(grand\s*)?total\b/i.test(String(s || ''));
  const fmt = n => (n == null || isNaN(n)) ? '—' : (Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));

  function parseDateHeader(h, dmy) {
    const t = String(h || '').trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) { const a = +m[1], b = +m[2]; return dmy ? Date.UTC(+m[3], b - 1, a) : Date.UTC(+m[3], a - 1, b); }
    return null;
  }

  function parse(rows) {
    let g = (rows || []).map(r => r.map(c => String(c == null ? '' : c).trim()));
    while (g.length && g[g.length - 1].every(c => c === '')) g.pop();
    if (!g.length) return null;
    const width = Math.max(...g.map(r => r.length));
    g = g.map(r => { const x = r.slice(); while (x.length < width) x.push(''); return x; });
    let lastCol = width - 1;
    while (lastCol > 0 && g.every(r => r[lastCol] === '')) lastCol--;
    g = g.map(r => r.slice(0, lastCol + 1));
    const W = lastCol + 1;

    let hdr = 0, best = -1;
    for (let i = 0; i < Math.min(8, g.length); i++) {
      const filled = g[i].filter(c => c !== '').length;
      if (filled > best) { best = filled; hdr = i; }
    }
    const header = g[hdr];
    const title = g.slice(0, hdr).map(r => r.filter(Boolean).join(' · ')).filter(Boolean).join('  |  ');
    let body = g.slice(hdr + 1).filter(r => r.some(c => c !== ''));

    let totalRow = null;
    for (let i = body.length - 1; i >= 0; i--) {
      const lab = body[i].find(c => c !== '');
      if (isTotalLabel(lab)) { totalRow = body[i]; body = body.slice(0, i).concat(body.slice(i + 1)); break; }
    }

    const numeric = [], pct = [];
    for (let c = 0; c < W; c++) {
      const vals = body.map(r => r[c]).filter(v => v !== '');
      if (!vals.length) { numeric.push(false); pct.push(false); continue; }
      const nums = vals.filter(isNumStr).length;
      numeric.push(nums / vals.length >= 0.6);
      pct.push(nums > 0 && vals.filter(v => /%$/.test(v)).length / vals.length >= 0.6);
    }
    let labelCols = 0;
    while (labelCols < W - 1 && !numeric[labelCols]) labelCols++;
    if (labelCols === 0) labelCols = 1;

    let carry = '';
    body.forEach(r => { if (r[0] !== '') carry = r[0]; else if (labelCols > 1 && r.slice(1, labelCols).some(Boolean)) r[0] = carry; });

    let totalCol = -1;
    for (let c = W - 1; c >= labelCols; c--) { if (/^\s*(grand\s*)?total\b/i.test(header[c])) { totalCol = c; break; } }
    const dataCols = [];
    for (let c = labelCols; c < W; c++) if (numeric[c] && c !== totalCol) dataCols.push(c);

    // date columns?
    const heads = dataCols.map(c => header[c]);
    const dmy = heads.some(h => { const m = String(h).match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{4}$/); return m && +m[1] > 12; });
    const dates = {}; let nDates = 0;
    dataCols.forEach(c => { const d = parseDateHeader(header[c], dmy); if (d != null) { dates[c] = d; nDates++; } });
    const hasDates = nDates >= 2 && nDates >= dataCols.length * 0.6;
    const ds = Object.values(dates);
    const minDate = hasDates ? Math.min(...ds) : null, maxDate = hasDates ? Math.max(...ds) : null;

    const labelHeads = [];
    for (let i = 0; i < Math.min(labelCols, 2); i++) labelHeads.push(header[i] || ('Column ' + (i + 1)));
    const labelOptions = labelHeads.map((_, i) => Array.from(new Set(body.map(r => r[i]).filter(Boolean))));

    return { title, header, body, totalRow, labelCols, numeric, pct, totalCol, dataCols, W, dates, hasDates, minDate, maxDate, labelHeads, labelOptions };
  }

  const dayStr = ms => new Date(ms).toISOString().slice(0, 10);
  const shortDate = ms => { const d = new Date(ms); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };

  // ---------------- slicer logic ----------------
  function resetSlicers() {
    S.rowSets.forEach(s => s.clear()); S.cols.clear();
    S.range = 'all'; S.search = ''; S.sortCol = -1; S.sortDir = 'desc'; S.showAll = false;
    S.start = model && model.hasDates ? dayStr(model.minDate) : '';
    S.end = model && model.hasDates ? dayStr(model.maxDate) : '';
  }
  function applyRange(range) {
    S.range = range;
    if (!model || !model.hasDates) return;
    const max = model.maxDate, day = 86400000;
    let from = model.minDate;
    if (range === 'daily') from = max;
    else if (range === 'weekly') from = max - 6 * day;
    else if (range === 'monthly') from = max - 29 * day;
    S.start = dayStr(Math.max(from, model.minDate)); S.end = dayStr(max);
  }
  function view() {
    const m = model;
    const startMs = S.start ? Date.parse(S.start) : null, endMs = S.end ? Date.parse(S.end) : null;
    const dateActive = m.hasDates && ((startMs != null && startMs > m.minDate) || (endMs != null && endMs < m.maxDate));
    const cols = m.dataCols.filter(c => {
      if (S.cols.size && !S.cols.has(m.header[c])) return false;
      if (m.hasDates && m.dates[c] != null) { if (startMs != null && m.dates[c] < startMs) return false; if (endMs != null && m.dates[c] > endMs) return false; }
      return true;
    });
    const colsFiltered = S.cols.size > 0 || dateActive;
    const rowsFiltered = S.rowSets.some((s, i) => i < m.labelHeads.length && s.size > 0);
    const q = S.search.toLowerCase();
    const rows = m.body.filter(r => {
      for (let i = 0; i < m.labelHeads.length; i++) if (S.rowSets[i].size && !S.rowSets[i].has(r[i])) return false;
      return !q || r.slice(0, m.labelCols).join(' ').toLowerCase().includes(q);
    });
    const sumCols = cols.filter(c => !m.pct[c]);
    const avgMode = sumCols.length === 0 && cols.some(c => m.pct[c]);
    const useCols = avgMode ? cols.filter(c => m.pct[c]) : sumCols;
    const rowTotal = r => {
      if (!colsFiltered && !avgMode && m.totalCol >= 0) { const v = toNum(r[m.totalCol]); if (v != null) return v; }
      let s = 0, n = 0; useCols.forEach(c => { const v = toNum(r[c]); if (v != null) { s += v; n++; } });
      return n ? (avgMode ? s / n : s) : null;
    };
    const colTotal = c => {
      if (!rowsFiltered && !q && !avgMode && m.totalRow) { const v = toNum(m.totalRow[c]); if (v != null) return v; }
      let s = 0, n = 0; rows.forEach(r => { const v = toNum(r[c]); if (v != null) { s += v; n++; } });
      return avgMode ? (n ? s / n : 0) : s;
    };
    const rowLabel = r => r.slice(0, m.labelCols).filter(Boolean).join(' · ') || '—';
    const rowsT = rows.map(r => ({ label: rowLabel(r), total: rowTotal(r) })).filter(x => x.total != null);
    const colsT = useCols.map(c => ({ label: m.header[c] || '—', total: colTotal(c), idx: c }));
    let grand = null;
    if (!colsFiltered && !rowsFiltered && !q && !avgMode && m.totalRow && m.totalCol >= 0) grand = toNum(m.totalRow[m.totalCol]);
    if (grand == null) { if (avgMode) grand = rowsT.length ? rowsT.reduce((a, x) => a + x.total, 0) / rowsT.length : null; else { let s = 0, any = false; rowsT.forEach(x => { s += x.total; any = true; }); grand = any ? s : null; } }
    const active = colsFiltered || rowsFiltered || !!q;
    return { cols, rows, rowsT, colsT, grand, avgMode, active, rowLabel, rowTotal };
  }

  // ---------------- data loading ----------------
  function feedBase() { return (window.SC_CONFIG && window.SC_CONFIG.feedUrl) || localStorage.getItem('sc_dashboard_feed_url') || ''; }
  async function fetchReports(force) {
    const base = feedBase();
    if (!base) throw new Error('Live data URL set nahi hai (config.js ya Connect data).');
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const url = base + (base.includes('?') ? '&' : '?') + 'mode=reports&_=' + Date.now() + (force ? '&nocache=1' : '');
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (json.ok === false) throw new Error(json.error || 'Feed returned an error');
        if (!json.reports) throw new Error('Feed mein reports nahi aaye — naya Code.gs deploy (New version) karein.');
        return json;
      } catch (e) { last = e; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
    }
    throw last;
  }
  async function load(force) {
    loading = true; error = null; paintShell();
    try {
      payload = await fetchReports(force);
      try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) { /* too big */ }
    } catch (e) {
      error = e.message;
      if (!payload) { try { payload = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (x) { payload = null; } }
    }
    loading = false;
    if (payload && !payload.reports.some(r => r.id === activeId)) {
      const first = payload.reports.find(r => r.found) || payload.reports[0];
      activeId = first && first.id; selectReport(activeId, false);
    } else if (payload) selectReport(activeId, false);
    paintShell();
  }
  function show() { if (!payload && !loading) load(false); else { paintShell(); } }

  function selectReport(id, repaint = true) {
    activeId = id;
    const r = payload && payload.reports.find(x => x.id === id);
    model = r && r.found ? parse(r.rows) : null;
    resetSlicers();
    if (repaint) paintShell();
  }

  // ---------------- rendering: shell (head + tabs + filter bar) ----------------
  function paintShell() {
    const el = root(); if (!el) return;
    const reports = (payload && payload.reports) || [];
    const active = reports.find(r => r.id === activeId);
    const upd = payload && payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : '';
    let h = `<div class="hourlyHead"><div><h2 class="hourlyHead__title">Master Reports</h2>
      <p class="hourlyHead__sub">Spreadsheet ke pivot tabs se seedha data — wahi dashboard layout, wahi slicers.${upd ? ' · Updated ' + esc(upd) : ''}</p></div>
      <button class="btn" id="rpRefresh" type="button">${svg('refresh')}${loading ? 'Loading…' : 'Refresh'}</button></div>`;
    if (error) h += `<div class="rp-note rp-note--warn">${esc(error)}${payload ? ' (purana saved data dikh raha hai)' : ''}</div>`;
    if (!payload) { el.innerHTML = h + `<div class="rp-note">${loading ? 'Reports load ho rahe hain…' : 'Abhi koi data nahi.'}</div>`; $('#rpRefresh', el).addEventListener('click', () => load(true)); return; }

    h += `<div class="rp-tabs" role="tablist">${reports.map(r =>
      `<button class="rp-tab${r.id === activeId ? ' is-on' : ''}${r.found ? '' : ' is-missing'}" data-rp="${esc(r.id)}" role="tab" title="${r.found ? esc(r.sheet) : 'Tab nahi mila'}">${esc(r.title)}</button>`).join('')}</div>`;

    if (active && !active.found) h += `<div class="rp-note rp-note--warn"><b>${esc(active.title)}</b> — spreadsheet mein is naam ka tab nahi mila. Tab ka naam check karein, ya <code>Code.gs</code> ki <code>REPORT_TABS</code> mein sahi naam add karein.</div>`;
    else if (active && !model) h += `<div class="rp-note">Ye tab khali hai.</div>`;
    else if (model) {
      h += `<div class="filters"><div class="filters__row" id="rpFilters"></div></div><div id="rpBody"></div>`;
    }
    el.innerHTML = h;
    $('#rpRefresh', el).addEventListener('click', () => load(true));
    $$('.rp-tab', el).forEach(b => b.addEventListener('click', () => selectReport(b.dataset.rp)));
    if (model) { buildFilters(); paintBody(); }
  }

  function ddLabelUpdate(host, set) {
    const btn = $('.dd__btn', host), val = $('.val', btn);
    if (!set.size) { btn.classList.remove('is-on'); val.textContent = 'All'; }
    else { btn.classList.add('is-on'); val.textContent = set.size === 1 ? Array.from(set)[0] : set.size + ' selected'; }
  }
  function buildDd(host, label, options, set, onChange) {
    host.className = 'dd';
    host.innerHTML = `<button class="dd__btn" type="button"><span class="lbl">${esc(label)}:</span><span class="val">All</span>${svg('chevron')}</button>`;
    ddLabelUpdate(host, set);
    $('.dd__btn', host).addEventListener('click', e => {
      e.stopPropagation();
      const had = $('.dd__panel', host);
      $$('.dd__panel').forEach(p => p.remove());
      if (had) return;
      const panel = document.createElement('div');
      panel.className = 'dd__panel';
      panel.innerHTML = `<input class="dd__search" placeholder="Search ${esc(label.toLowerCase())}…" /><div class="dd__list"></div><div class="dd__foot"><button data-act="all" type="button">Select all</button><button data-act="none" type="button">Clear</button></div>`;
      host.appendChild(panel);
      const list = $('.dd__list', panel);
      const draw = f => {
        const opts = options.filter(o => !f || o.toLowerCase().includes(f.toLowerCase()));
        list.innerHTML = opts.length ? opts.map(o => `<label class="dd__opt"><input type="checkbox" value="${esc(o)}" ${set.has(o) ? 'checked' : ''}/><span>${esc(o)}</span></label>`).join('') : '<div class="dd__empty">No matches</div>';
        $$('input', list).forEach(cb => cb.addEventListener('change', () => { if (cb.checked) set.add(cb.value); else set.delete(cb.value); ddLabelUpdate(host, set); onChange(); }));
      };
      draw('');
      const inp = $('.dd__search', panel); inp.addEventListener('input', () => draw(inp.value)); inp.focus();
      $('[data-act="all"]', panel).addEventListener('click', () => { options.forEach(o => set.add(o)); draw(inp.value); ddLabelUpdate(host, set); onChange(); });
      $('[data-act="none"]', panel).addEventListener('click', () => { set.clear(); draw(inp.value); ddLabelUpdate(host, set); onChange(); });
      panel.addEventListener('click', e2 => e2.stopPropagation());
    });
  }

  function buildFilters() {
    const bar = $('#rpFilters'); if (!bar) return;
    const m = model;
    let h = '';
    if (m.hasDates) {
      h += `<span class="filters__label">Range</span><div class="seg" id="rpRange">${['daily', 'weekly', 'monthly', 'all'].map(r => `<button data-range="${r}" aria-pressed="${S.range === r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}</div>
        <div class="dates">${svg('calendar')}<input type="date" id="rpStart" value="${S.start}" min="${dayStr(m.minDate)}" max="${dayStr(m.maxDate)}" /><i>–</i><input type="date" id="rpEnd" value="${S.end}" min="${dayStr(m.minDate)}" max="${dayStr(m.maxDate)}" /></div>`;
    }
    m.labelHeads.forEach((_, i) => { h += `<div id="rpDdRow${i}"></div>`; });
    h += `<div id="rpDdCols"></div><div class="filters__grow"></div>
      <button class="btn btn--ghost" id="rpReset" type="button">Reset</button>
      <button class="btn" id="rpCsv" type="button">${svg('down')}Export CSV</button>`;
    bar.innerHTML = h;
    m.labelHeads.forEach((lh, i) => buildDd($('#rpDdRow' + i), lh, m.labelOptions[i], S.rowSets[i], paintBody));
    const colOpts = m.dataCols.map(c => m.header[c]).filter(Boolean);
    buildDd($('#rpDdCols'), m.hasDates ? 'Dates' : 'Columns', colOpts, S.cols, paintBody);

    $$('#rpRange button', bar).forEach(b => b.addEventListener('click', () => {
      applyRange(b.dataset.range);
      $$('#rpRange button', bar).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const s = $('#rpStart', bar), e = $('#rpEnd', bar); if (s) s.value = S.start; if (e) e.value = S.end;
      paintBody();
    }));
    const onDate = () => { S.start = $('#rpStart', bar).value; S.end = $('#rpEnd', bar).value; S.range = ''; $$('#rpRange button', bar).forEach(x => x.setAttribute('aria-pressed', 'false')); paintBody(); };
    if ($('#rpStart', bar)) { $('#rpStart', bar).addEventListener('change', onDate); $('#rpEnd', bar).addEventListener('change', onDate); }
    $('#rpReset', bar).addEventListener('click', () => { resetSlicers(); buildFilters(); paintBody(); });
    $('#rpCsv', bar).addEventListener('click', exportCsv);
  }

  // ---------------- rendering: body (KPIs, charts, table) ----------------
  function paintBody() {
    const host = $('#rpBody'); if (!host || !model) return;
    const m = model, v = view();
    const top = v.rowsT.slice().sort((a, b) => b.total - a.total)[0];
    const peak = v.colsT.slice().sort((a, b) => b.total - a.total)[0];
    const sum = v.avgMode ? null : v.grand;
    const nRows = v.rowsT.length;
    const avg = v.avgMode ? v.grand : (nRows && v.grand != null ? v.grand / nRows : null);
    const activeRows = v.rowsT.filter(x => x.total > 0).length;
    const share = (!v.avgMode && top && v.grand) ? top.total / v.grand * 100 : null;
    const f = x => v.avgMode ? (x == null ? '—' : x.toFixed(1) + '%') : fmt(x);
    const short = s => { s = String(s || ''); return s.length > 15 ? s.slice(0, 14) + '…' : s; };
    const kp = [
      { k: 1, ico: 'chart', label: v.avgMode ? 'Average' : (m.totalRow && !v.active ? 'Grand Total' : 'Total'), value: f(v.grand) },
      { k: 2, ico: 'users', label: m.header[0] || 'Rows', value: fmt(nRows) },
      { k: 3, ico: 'star', label: 'Top', value: top ? f(top.total) + `<small title="${esc(top.label)}">${esc(short(top.label))}</small>` : '—' },
      { k: 4, ico: 'trend', label: v.avgMode ? 'Average per row' : 'Avg per row', value: avg == null ? '—' : (v.avgMode ? avg.toFixed(1) + '%' : fmt(avg)) },
      { k: 5, ico: 'calendar', label: 'Peak column', value: peak ? f(peak.total) + `<small title="${esc(peak.label)}">${esc(short(peak.label))}</small>` : '—' },
      { k: 6, ico: 'check', label: 'Active rows', value: fmt(activeRows) + `<small>${nRows ? Math.round(activeRows / nRows * 100) : 0}%</small>` },
      { k: 7, ico: 'layers', label: 'Columns shown', value: fmt(v.cols.length) },
      { k: 8, ico: 'target', label: 'Top row share', value: share == null ? '—' : share.toFixed(1) + '%' },
    ];
    const hasTrend = v.colsT.length >= 2;
    let h = `<section class="kpis">${kp.map(it => `<div class="kpi kpi--${it.k}"><div class="kpi__top"><div class="kpi__ico">${svg(it.ico)}</div><div class="kpi__go">${svg('arrow')}</div></div>
      <div class="kpi__label">${esc(it.label)}</div><div class="kpi__row"><div class="kpi__value">${it.value}</div></div></div>`).join('')}</section>`;
    h += `<div class="grid">
      <div class="card ${hasTrend ? 'c8' : 'c12'}"><div class="card__head"><div><div class="card__title">${hasTrend ? 'Trend by column' : 'Top rows'}</div><div class="card__sub">${hasTrend ? 'Total per column for the selected slicers' : 'Highest totals first'}</div></div></div><div class="chart" id="rpChartMain"></div></div>
      <div class="card c4"><div class="card__head"><div><div class="card__title">Share of Total</div><div class="card__sub">Top 5 rows vs the rest</div></div></div><div class="donutbox"><div class="chart" id="rpDonut"></div><div class="dlist" id="rpDonutList"></div></div></div>
      ${hasTrend ? `<div class="card c12"><div class="card__head"><div><div class="card__title">Top rows</div><div class="card__sub">Highest totals first — tallest bar highlighted</div></div></div><div class="chart" id="rpChartBars"></div></div>` : ''}
      <div class="card c12" id="rpTableCard"></div></div>`;
    host.innerHTML = h;

    const sortedRows = v.rowsT.slice().sort((a, b) => b.total - a.total);
    const topN = sortedRows.slice(0, 12);
    const barOpts = { labels: topN.map(x => short(x.label)), series: [{ values: topN.map(x => x.total), color: 'var(--amber-pale)', perBarColor: i => i === 0 ? COLORS.green : 'var(--amber-pale)' }], format: x => v.avgMode ? x.toFixed(1) + '%' : fmt(x), height: 260 };
    const emptyMsg = '<div class="rp-note">Chart ke liye data nahi — slicers check karein.</div>';
    if (typeof Charts !== 'undefined') {
      if (hasTrend) {
        const cols = v.colsT.slice(0, 60);
        Charts.lineChart($('#rpChartMain'), { labels: cols.map(c => m.hasDates && m.dates[c.idx] != null ? shortDate(m.dates[c.idx]) : c.label), series: [{ name: 'Total', values: cols.map(c => c.total), color: COLORS.violet }], height: 260, format: barOpts.format });
        if (topN.length) Charts.barChart($('#rpChartBars'), barOpts); else $('#rpChartBars').innerHTML = emptyMsg;
      } else if (topN.length) Charts.barChart($('#rpChartMain'), barOpts); else $('#rpChartMain').innerHTML = emptyMsg;

      const top5 = sortedRows.slice(0, 5), rest = sortedRows.slice(5).reduce((a, x) => a + x.total, 0);
      const dd = top5.map((x, i) => ({ label: x.label, value: x.total, color: PALETTE[i % PALETTE.length] }));
      if (rest > 0 && !v.avgMode) dd.push({ label: 'Others', value: rest, color: COLORS.slate });
      const pos = dd.filter(d => d.value > 0), tot = pos.reduce((a, d) => a + d.value, 0);
      if (pos.length && !v.avgMode) {
        Charts.donutChart($('#rpDonut'), { data: pos, centerLabel: 'Total', centerValue: fmt(v.grand) });
        $('#rpDonutList').innerHTML = pos.map(d => `<div><i style="background:${d.color}"></i><span>${esc(d.label)}</span><b>${fmt(d.value)}</b><small>${Math.round(d.value / tot * 100)}%</small></div>`).join('');
      } else { $('#rpDonut').innerHTML = '<div class="rp-note">Share chart sirf count/total reports ke liye hai.</div>'; }
    }
    paintTable(v);
  }

  function paintTable(v) {
    const m = model, host = $('#rpTableCard'); if (!host) return;
    let rows = v.rows.slice();
    if (S.sortCol >= 0) {
      const c = S.sortCol, dir = S.sortDir === 'asc' ? 1 : -1;
      rows.sort((a, b) => { const na = toNum(a[c]), nb = toNum(b[c]); if (na != null && nb != null) return (na - nb) * dir; return String(a[c]).localeCompare(String(b[c])) * dir; });
    }
    const shown = S.showAll ? rows : rows.slice(0, ROW_CAP);
    const showCols = [];
    for (let c = 0; c < m.labelCols; c++) showCols.push(c);
    v.cols.forEach(c => showCols.push(c));
    if (m.totalCol >= 0) showCols.push(m.totalCol);
    const maxes = {}; v.cols.forEach(c => { if (!m.pct[c]) maxes[c] = Math.max(1, ...m.body.map(r => toNum(r[c]) || 0)); });
    const th = showCols.map(c => `<th data-c="${c}" class="${c < m.labelCols ? '' : 'r'}"${S.sortCol === c ? ` data-dir="${S.sortDir}"` : ''}>${esc(m.header[c]) || '&nbsp;'}</th>`).join('');
    const tr = r => '<tr>' + showCols.map(c => {
      if (c < m.labelCols) return `<td class="${c === 0 ? 'grow' : ''}"><b>${esc(r[c])}</b></td>`;
      const n = toNum(r[c]);
      const heat = (n != null && maxes[c]) ? ` style="background:color-mix(in srgb, var(--amber) ${Math.round(Math.min(1, n / maxes[c]) * 45)}%, transparent)"` : '';
      return `<td class="r${c === m.totalCol ? ' rp-tot' : ''}"${heat}>${esc(r[c])}</td>`;
    }).join('') + '</tr>';
    let foot = '';
    if (m.totalRow && !v.active) foot = `<tfoot><tr>${showCols.map(c => `<td class="${c < m.labelCols ? '' : 'r'}">${esc(m.totalRow[c])}</td>`).join('')}</tr></tfoot>`;
    else if (v.colsT.length && !v.avgMode) {
      const byIdx = {}; v.colsT.forEach(x => { byIdx[x.idx] = x.total; });
      foot = `<tfoot><tr>${showCols.map((c, i) => c < m.labelCols ? `<td>${i === 0 ? 'Total (filtered)' : ''}</td>` : (c === m.totalCol ? `<td class="r">${fmt(v.grand)}</td>` : `<td class="r">${byIdx[c] != null ? fmt(byIdx[c]) : ''}</td>`)).join('')}</tr></tfoot>`;
    }
    host.innerHTML = `<div class="card__head"><div><div class="card__title">${esc(((payload.reports.find(r => r.id === activeId) || {}).title) || 'Report')}</div><div class="card__sub">Pivot tab ka poora data — column header par click karke sort karein</div></div></div>
      <div class="tbl-tools"><input class="tbl-search" id="rpSearch" placeholder="Search…" value="${esc(S.search)}" /><span class="tbl-count">${rows.length} rows</span></div>
      <div class="tbl-wrap"><table class="tbl rp-table"><thead><tr>${th}</tr></thead><tbody>${shown.map(tr).join('') || '<tr><td colspan="' + showCols.length + '" class="mut">No rows match the slicers.</td></tr>'}</tbody>${foot}</table></div>
      ${rows.length > shown.length ? `<div class="pager"><button id="rpMore" type="button">Show all ${rows.length} rows</button></div>` : ''}`;
    const inp = $('#rpSearch', host);
    inp.addEventListener('input', () => { S.search = inp.value; const pos = inp.selectionStart; paintBody(); const n = $('#rpSearch'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
    const more = $('#rpMore', host); if (more) more.addEventListener('click', () => { S.showAll = true; paintTable(view()); });
    $$('thead th', host).forEach(t => t.addEventListener('click', () => {
      const c = +t.dataset.c;
      if (S.sortCol === c) S.sortDir = S.sortDir === 'desc' ? 'asc' : 'desc'; else { S.sortCol = c; S.sortDir = 'desc'; }
      paintTable(view());
    }));
  }

  function exportCsv() {
    const r = payload && payload.reports.find(x => x.id === activeId); if (!r || !r.found || !model) return;
    const v = view(), m = model;
    const cols = []; for (let c = 0; c < m.labelCols; c++) cols.push(c); v.cols.forEach(c => cols.push(c)); if (m.totalCol >= 0) cols.push(m.totalCol);
    const lines = [cols.map(c => m.header[c]), ...v.rows.map(row => cols.map(c => row[c]))];
    if (m.totalRow && !v.active) lines.push(cols.map(c => m.totalRow[c]));
    const csv = lines.map(row => row.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = r.title.replace(/[^\w]+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const pg = document.getElementById('page-reports'); if (pg && !pg.hidden && model) paintBody(); }, 250); });

  return { show, load, parse };
})();
if (typeof window !== 'undefined') window.ReportsPage = ReportsPage;
