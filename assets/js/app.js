/* =========================================================
   Simply Connect – Performance Dashboard app logic
   ========================================================= */
(() => {
  'use strict';

  const DATA_URL_KEY = 'sc_dashboard_feed_url';
  const DEFAULT_FEED = null; // set via config.js (window.SC_CONFIG.feedUrl)

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const int = n => Math.round(n).toLocaleString('en-US');
  const pct = (n, d = 1) => (isFinite(n) ? n.toFixed(d) : '0.0') + '%';
  const hms = s => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
  };
  const hmsShort = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; };

  const COLORS = {
    violet: '#5240D6', peri: '#3F49B8', magenta: '#B23FA8', rose: '#E5484D',
    amber: '#FDAC00', green: '#2FA352', blue: '#2B83C6', brown: '#9A6A3A', slate: '#9AA0B4',
  };
  const RESULT_COLOR = {
    'Answered': COLORS.green, 'Abandoned': COLORS.rose, 'Overflow - Time': COLORS.amber,
    'Stranded - Unavailable': COLORS.violet, 'Stranded': COLORS.peri, 'Transferred': COLORS.magenta, 'Escaped': COLORS.slate,
  };
  const PALETTE = [COLORS.violet, COLORS.amber, COLORS.magenta, COLORS.green, COLORS.peri, COLORS.rose, COLORS.blue, COLORS.brown, COLORS.slate];

  // Tracks whether a live feed has ever loaded successfully. Several UI
  // events (window resize, theme toggle) can fire before/after a failed
  // load — without this guard they call renderAll() while state.start/end
  // are still null, which crashes (see prevPeriod/getTime in data.js).
  let dataLoaded = false;

  // ---------------- State ----------------
  const state = {
    granularity: 'weekly', // daily | weekly | monthly
    start: null, end: null,
    queues: new Set(), agents: new Set(), results: new Set(),
    teams: new Set(), providers: new Set(), services: new Set(),
    compare: true,
    theme: localStorage.getItem('sc_theme') || 'light',
    trendMetric: 'volume', // volume | result
    tablePage: { agents: 1, queues: 1, sales: 1, closers: 1, leads: 1 },
    tableSort: { agents: { key: 'perf', dir: 'desc' }, queues: { key: 'calls', dir: 'desc' }, sales: { key: 'd', dir: 'desc' }, closers: { key: 'points', dir: 'desc' }, leads: { key: 'points', dir: 'desc' } },
    tableSearch: { agents: '', queues: '', sales: '', closers: '', leads: '' },
    hourlyTZ: 'ct', // ct | pkt
    hourlyDay: 'today', // today | yesterday
    hourlyMetric: 'sales', // sales | answered | rgu | missed | rate
    hourlyMode: 'hourly', // hourly | cumulative
    hourlyPin: null, // CT hour pinned in the compare chart
    page: 'overview', // overview | hourly | closerperf | leadperf
  };

  // ---------------- Boot ----------------
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    applyTheme(state.theme, false);
    wireStaticUI();
    const feedUrl = (window.SC_CONFIG && window.SC_CONFIG.feedUrl) || localStorage.getItem(DATA_URL_KEY) || DEFAULT_FEED;
    await bootLoad(feedUrl);
  }

  async function bootLoad(feedUrl, forceFresh = false) {
    dataLoaded = false;
    if (!feedUrl) {
      showBoot(true);
      showNotConnected();
      clearStage();
      showBoot(false);
      return;
    }

    // Instant paint: if we already have a last-good copy in localStorage,
    // show it immediately instead of waiting on the network — this is what
    // makes "refresh" feel instant instead of sitting on the loading screen.
    // The live fetch below still runs right after, in the background, and
    // silently re-renders with fresh numbers the moment it lands. Skipped
    // when the user explicitly hit Refresh (forceFresh) — then we show an
    // active "Refreshing…" state instead of quietly reusing old numbers.
    const cached = DataEngine.loadLastGood();
    const paintedFromCache = !!cached && !forceFresh;
    if (paintedFromCache) {
      showRefreshingBanner(cached.savedAt);
      dataLoaded = true;
      setupFilterDefaults();
      populateFilterOptions();
      renderAll();
      showBoot(false);
    } else if (forceFresh && cached) {
      showRefreshingBanner(cached.savedAt, true);
    } else {
      showBoot(true);
    }

    try {
      await DataEngine.load(feedUrl, forceFresh);
      showSourceBanner('live', feedUrl);
    } catch (err) {
      console.error(err);
      if (cached) {
        // Dashboard is already showing (or can fall back to) the cached
        // numbers — don't blank it, just flag that this refresh didn't land.
        if (!paintedFromCache) { dataLoaded = true; setupFilterDefaults(); populateFilterOptions(); renderAll(); showBoot(false); }
        showStaleBanner(err.message, feedUrl, cached.savedAt);
        return;
      }
      showFatal(err.message, feedUrl);
      clearStage();
      showBoot(false);
      return;
    }
    dataLoaded = true;
    setupFilterDefaults();
    populateFilterOptions();
    renderAll();
    showBoot(false);
  }

  function showBoot(on) {
    const b = $('#boot');
    if (!b) return;
    if (on) { b.classList.remove('is-off'); } else { setTimeout(() => b.classList.add('is-off'), 250); }
  }

  // Wipe stale numbers off the page while there's no valid live data loaded.
  function clearStage() {
    ['#kpiRow', '#salesTiles', '#queueBars', '#teamBars', '#heatmap', '#dataHealth'].forEach(sel => { const el2 = $(sel); if (el2) el2.innerHTML = ''; });
    ['agents', 'sales'].forEach(id => { const w = $(`#tbl_${id}`); if (w) w.innerHTML = ''; const c = $(`#count_${id}`); if (c) c.textContent = ''; const p = $(`#pager_${id}`); if (p) p.innerHTML = ''; });
  }

  function showNotConnected() {
    $('#dataBanner').innerHTML = `
      <div class="banner">
        ${icon('plug')}
        <div><b>No live data connected yet.</b> Paste your Google Apps Script Web App URL to pull real numbers from your spreadsheet — nothing is shown until it's connected.</div>
        <button class="btn btn--amber" id="btnConnectNow">${icon('plug')} Connect data</button>
      </div>`;
    const b = $('#btnConnectNow'); if (b) b.addEventListener('click', () => openConnectPanel());
  }

  function showFatal(msg, url) {
    $('#dataBanner').innerHTML = `
      <div class="banner banner--err">
        ${icon('alert')}
        <div><b>Couldn't load live data.</b> ${escapeHtml(msg)}. Check the Apps Script deployment (access must be "Anyone with the link") and your sheet's tab/column names, then retry.</div>
        <button class="btn btn--ghost" id="btnRefresh">${icon('refresh')} Retry</button>
      </div>`;
    const rb = $('#btnRefresh'); if (rb) rb.addEventListener('click', () => bootLoad(url, true));
  }

  function showRefreshingBanner(savedAt, active) {
    $('#dataBanner').innerHTML = `
      <div class="banner">
        ${icon('refresh')}
        <div>${active
          ? `<b>Refreshing…</b> pulling the latest numbers straight from the sheet (bypassing any cache).`
          : `<b>Showing your last data</b> (${savedAt ? timeAgo(new Date(savedAt).toISOString()) : 'cached'}) while the live sheet loads in the background…`}</div>
      </div>`;
  }

  function showStaleBanner(msg, url, savedAt) {
    $('#dataBanner').innerHTML = `
      <div class="banner banner--err">
        ${icon('alert')}
        <div><b>Live refresh failed</b> (${escapeHtml(msg)}) — showing the last data pulled ${savedAt ? timeAgo(new Date(savedAt).toISOString()) : 'earlier'}. This usually clears up on its own; hit retry in a moment.</div>
        <button class="btn btn--ghost" id="btnRefresh">${icon('refresh')} Retry</button>
      </div>`;
    const rb = $('#btnRefresh'); if (rb) rb.addEventListener('click', () => bootLoad(url, true));
  }

  function showSourceBanner(kind, url) {
    const el2 = $('#dataBanner');
    el2.innerHTML = `<div class="banner banner--ok">${icon('check')}<div><b>Connected.</b> Live data from your Google Sheet${DataEngine.generatedAt ? ' · updated ' + timeAgo(DataEngine.generatedAt) : ''}.</div>
      <button class="btn btn--ghost" id="btnRefresh">${icon('refresh')} Refresh</button></div>`;
    const rb = $('#btnRefresh'); if (rb) rb.addEventListener('click', () => bootLoad((window.SC_CONFIG && window.SC_CONFIG.feedUrl) || localStorage.getItem(DATA_URL_KEY), true));
  }
  function timeAgo(iso) {
    try {
      const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    } catch (e) { return ''; }
  }

  // ---------------- Filters setup ----------------
  function setupFilterDefaults() {
    const { min, max } = DataEngine.bounds;
    state.start = min; state.end = max;
    $('#dateStart').value = DataEngine.fmtDate(min);
    $('#dateEnd').value = DataEngine.fmtDate(max);
    $('#dateStart').min = DataEngine.fmtDate(min); $('#dateStart').max = DataEngine.fmtDate(max);
    $('#dateEnd').min = DataEngine.fmtDate(min); $('#dateEnd').max = DataEngine.fmtDate(max);
  }

  function populateFilterOptions() {
    buildDropdown('queues', 'Queue', DataEngine.distinctQueues(), q => DataEngine.calls.filter(c => c.queue === q).length);
    buildDropdown('agents', 'Agent', DataEngine.distinctAgents(), a => DataEngine.calls.filter(c => c.agent === a).length);
    buildDropdown('results', 'Result', DataEngine.distinctResults(), r => DataEngine.calls.filter(c => c.result === r).length);
    buildDropdown('teams', 'Team', DataEngine.distinctTeams(), t => DataEngine.sales.filter(s => s.team === t).length);
    buildDropdown('providers', 'Provider', DataEngine.distinctProviders(), p => DataEngine.sales.filter(s => s.provider === p).length);
    buildDropdown('services', 'Service', DataEngine.distinctServices(), s2 => DataEngine.sales.filter(s => s.services === s2).length);
  }

  // ---------------- Filtered data (memoized per render) ----------------
  function currentFilter() {
    return {
      start: state.start, end: state.end,
      queues: state.queues, agents: state.agents, results: state.results,
      teams: state.teams, providers: state.providers, services: state.services,
    };
  }

  function renderAll() {
    const f = currentFilter();
    const calls = DataEngine.filterCalls(f);
    const sales = DataEngine.filterSales(f);
    const pf = DataEngine.prevPeriod(f);
    const pCalls = DataEngine.filterCalls(pf);
    const pSales = DataEngine.filterSales(pf);

    renderKpis(calls, sales, pCalls, pSales);
    renderServiceLevel(calls);
    renderResultBars(calls);
    renderTrend(calls);
    renderResultCluster(calls);
    renderQueueLeaderboard(calls);
    renderAgentTable(calls, sales);
    renderClosersTable(sales);
    renderLeadsTable(sales);
    renderClosersPreview(sales);
    renderLeadsPreview(sales);
    renderHeatmap(calls);
    renderSalesKpis(sales, pSales);
    renderSalesByProvider(sales);
    renderSalesByTeam(sales);
    renderSalesTable(sales);
    renderDataHealth(calls, sales);
    renderDailyReport(DataEngine.dailyReport(calls, sales));
    renderHourly(calls, sales);
    updateFilterChipStates();
    if (WC.open) renderWeeklyCompare();
  }

  // ---------------- KPIs ----------------
  function deltaChip(cur, prev) {
    const d = DataEngine.pctDelta(cur, prev);
    if (d === null) return `<span class="chip chip--flat">—</span>`;
    const up = d >= 0;
    const cls = Math.abs(d) < 0.5 ? 'chip--flat' : (up ? 'chip--up' : 'chip--dn');
    const sign = d > 0 ? '+' : '';
    return `<span class="chip ${cls}">${sign}${d.toFixed(0)}%</span>`;
  }

  function renderKpis(calls, sales, pCalls, pSales) {
    const total = calls.length, pTotal = pCalls.length;
    const answered = calls.filter(c => c.result === 'Answered');
    const pAnswered = pCalls.filter(c => c.result === 'Answered').length;
    const abandoned = calls.filter(c => c.result === 'Abandoned').length;
    const pAbandoned = pCalls.filter(c => c.result === 'Abandoned').length;
    const aht = answered.length ? answered.reduce((a, c) => a + c.talk + c.hold + c.wrap, 0) / answered.length : 0;
    const pAnsweredRows = pCalls.filter(c => c.result === 'Answered');
    const pAht = pAnsweredRows.length ? pAnsweredRows.reduce((a, c) => a + c.talk + c.hold + c.wrap, 0) / pAnsweredRows.length : 0;
    const totalSales = sales.length, pTotalSales = pSales.length;
    const rgus = sales.reduce((a, s) => a + (s.rgu || 1), 0);
    const pRgus = pSales.reduce((a, s) => a + (s.rgu || 1), 0);
    const points = sales.reduce((a, s) => a + (s.total || 0), 0);
    const pPoints = pSales.reduce((a, s) => a + (s.total || 0), 0);
    const conv = total ? (totalSales / total) * 100 : 0;
    const pConv = pTotal ? (pTotalSales / pTotal) * 100 : 0;

    const items = [
      { k: 1, ico: 'phone', label: 'Total Calls', value: int(total), delta: deltaChip(total, pTotal) },
      { k: 2, ico: 'check', label: 'Answered Calls', value: int(answered.length) + ` <small>${pct(total ? answered.length / total * 100 : 0, 0)}</small>`, delta: deltaChip(answered.length, pAnswered) },
      { k: 3, ico: 'clock', label: 'Avg Handling Time', value: hms(aht), delta: deltaChip(aht, pAht) },
      { k: 4, ico: 'x', label: 'Abandoned Calls', value: int(abandoned) + ` <small>${pct(total ? abandoned / total * 100 : 0, 0)}</small>`, delta: deltaChip(abandoned, pAbandoned), invert: true },
      { k: 5, ico: 'cart', label: 'Sales Closed', value: int(totalSales), delta: deltaChip(totalSales, pTotalSales) },
      { k: 6, ico: 'layers', label: 'RGUs Sold', value: int(rgus), delta: deltaChip(rgus, pRgus) },
      { k: 7, ico: 'target', label: 'Conversion Rate', value: pct(conv), delta: deltaChip(conv, pConv) },
      { k: 8, ico: 'star', label: 'Total Points', value: int(points), delta: deltaChip(points, pPoints) },
    ];
    $('#kpiRow').innerHTML = items.map(it => `
      <div class="kpi kpi--${it.k}">
        <div class="kpi__top">
          <div class="kpi__ico">${icon(it.ico)}</div>
          <div class="kpi__go">${icon('arrow-up-right')}</div>
        </div>
        <div class="kpi__label">${it.label}</div>
        <div class="kpi__row">
          <div class="kpi__value">${it.value}</div>
          ${it.delta}
        </div>
      </div>`).join('');
  }

  function renderSalesKpis(sales, pSales) {
    const wrap = $('#salesTiles'); if (!wrap) return;
    const byProvider = groupCount(sales, s => s.provider || 'Unknown');
    const topProvider = Object.entries(byProvider).sort((a, b) => b[1] - a[1])[0];
    const proInstall = sales.filter(s => s.install === 'Pro Install').length;
    const mailOut = sales.filter(s => s.install === 'Mail Out').length;
    const avgPts = sales.length ? sales.reduce((a, s) => a + (s.total || 0), 0) / sales.length : 0;
    const items = [
      { label: 'Top Provider', value: topProvider ? topProvider[0] : '—', hint: topProvider ? `${topProvider[1]} sales` : '' },
      { label: 'Pro Install', value: int(proInstall), hint: pct(sales.length ? proInstall / sales.length * 100 : 0) + ' of sales' },
      { label: 'Mail Out', value: int(mailOut), hint: pct(sales.length ? mailOut / sales.length * 100 : 0) + ' of sales' },
      { label: 'Avg Points / Sale', value: avgPts.toFixed(1), hint: 'reward points' },
    ];
    wrap.innerHTML = items.map(it => `<div class="tile"><div class="tile__label">${it.label}</div><div class="tile__value">${it.value}</div><div class="tile__hint">${it.hint}</div></div>`).join('');
  }

  function groupCount(arr, keyFn) {
    const o = {};
    arr.forEach(x => { const k = keyFn(x); if (!k) return; o[k] = (o[k] || 0) + 1; });
    return o;
  }

  // ---------------- Service level ring ----------------
  function renderServiceLevel(calls) {
    const total = calls.length || 1;
    const answered = calls.filter(c => c.result === 'Answered').length;
    const abandoned = calls.filter(c => c.result === 'Abandoned').length;
    const overflow = calls.filter(c => c.result.startsWith('Overflow')).length;
    const stranded = calls.filter(c => c.result.startsWith('Stranded')).length;
    const pAns = answered / total * 100, pAban = abandoned / total * 100, pOver = overflow / total * 100, pStr = stranded / total * 100;
    Charts.radialRings($('#slChart'), {
      centerLabel: 'Total calls', centerValue: shortNum(calls.length),
      rings: [
        { pct: pAns, color: COLORS.green, segments: 26 },
        { pct: pOver, color: COLORS.amber, segments: 22 },
        { pct: pStr, color: COLORS.violet, segments: 18 },
      ],
    });
    $('#slLegend').innerHTML = [
      ['Answered', pAns, COLORS.green], ['Overflow', pOver, COLORS.amber],
      ['Stranded', pStr, COLORS.violet], ['Abandoned', pAban, COLORS.rose],
    ].map(([l, v, c]) => `<div class="sl__item"><span class="sl__dot" style="background:${c}"></span><div><div class="sl__num">${v.toFixed(0)}%</div><div class="sl__lbl">${l} calls</div></div></div>`).join('');
  }

  function shortNum(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  // ---------------- Result breakdown bars ("First Call" style) ----------------
  const RESULT_SHORT = {
    'Answered': 'Answered', 'Abandoned': 'Abandoned', 'Overflow - Time': 'Overflow',
    'Stranded - Unavailable': 'No agent free', 'Stranded': 'Stranded', 'Transferred': 'Transferred', 'Escaped': 'Escaped',
  };
  function renderResultBars(calls) {
    const results = DataEngine.distinctResults();
    const counts = results.map(r => calls.filter(c => c.result === r).length);
    const total = calls.length || 1;
    const pctVals = counts.map(c => c / total * 100);
    const maxIdx = pctVals.indexOf(Math.max(...pctVals));
    Charts.barChart($('#resultChart'), {
      labels: results.map(r => RESULT_SHORT[r] || r),
      series: [{ values: pctVals, color: 'var(--amber-pale)', perBarColor: i => i === maxIdx ? COLORS.green : 'var(--amber-pale)' }],
      format: v => v.toFixed(0) + '%', height: 260,
    });
  }

  // ---------------- Trend line (calls per bucket) ----------------
  function bucketKey(dt, granularity) {
    if (granularity === 'yearly') return String(dt.getUTCFullYear());
    if (granularity === 'daily') return DataEngine.fmtDate(dt);
    if (granularity === 'monthly') return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
    // weekly: ISO-ish week start (Sunday)
    const d = new Date(dt);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return DataEngine.fmtDate(d);
  }
  function bucketLabel(key, granularity) {
    if (granularity === 'yearly') return key;
    if (granularity === 'monthly') {
      const [y, m] = key.split('-');
      return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    }
    const d = new Date(key + 'T00:00:00Z');
    return granularity === 'weekly' ? DataEngine.fmtDateShort(d) : DataEngine.fmtDateShort(d);
  }

  function renderTrend(calls) {
    const g = state.granularity;
    const buckets = new Map();
    calls.forEach(c => {
      const k = bucketKey(c.date, g);
      if (!buckets.has(k)) buckets.set(k, { total: 0, answered: 0, abandoned: 0 });
      const b = buckets.get(k); b.total++; if (c.result === 'Answered') b.answered++; if (c.result === 'Abandoned') b.abandoned++;
    });
    const keys = Array.from(buckets.keys()).sort();
    const labels = keys.map(k => bucketLabel(k, g));
    const answered = keys.map(k => buckets.get(k).answered);
    const abandoned = keys.map(k => buckets.get(k).abandoned);
    const total = keys.map(k => buckets.get(k).total);

    const series = state.trendMetric === 'volume'
      ? [{ name: 'Total calls', values: total, color: COLORS.violet }]
      : [{ name: 'Answered', values: answered, color: COLORS.green }, { name: 'Abandoned', values: abandoned, color: COLORS.rose, dash: true, area: false }];

    Charts.lineChart($('#trendChart'), { labels, series, height: 260 });
    $('#trendLegend').innerHTML = series.map(s => `<span><i style="background:${s.color}${s.dash ? ';border-radius:2px' : ''}"></i>${s.name}</span>`).join('');
  }

  // ---------------- Result cluster bubbles ----------------
  function renderResultCluster(calls) {
    const total = calls.length || 1;
    const answered = calls.filter(c => c.result === 'Answered').length;
    const abandoned = calls.filter(c => c.result === 'Abandoned').length;
    const other = total - answered - abandoned;
    const data = [
      { label: 'Answered', value: answered, color: COLORS.green },
      { label: 'Overflow / Stranded', value: other, color: COLORS.violet },
      { label: 'Abandoned', value: abandoned, color: COLORS.magenta },
    ].filter(d => d.value > 0);
    Charts.bubbleCluster($('#clusterChart'), { data, size: 260 });
    $('#clusterLegend').innerHTML = data.map(d => `<span><i style="background:${d.color}"></i>${d.label} <b>${pct(d.value / total * 100, 0)}</b></span>`).join('');
  }

  // ---------------- Queue leaderboard (hbars) ----------------
  function renderQueueLeaderboard(calls) {
    const counts = groupCount(calls, c => c.queue);
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = rows.length ? rows[0][1] : 1;
    $('#queueBars').innerHTML = rows.map(([name, v]) => `
      <button class="hbar" data-queue="${escapeAttr(name)}">
        <span class="hbar__name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        <span class="hbar__track"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span>
        <span class="hbar__val">${int(v)}</span>
      </button>`).join('') || emptyRow();
    $$('#queueBars .hbar').forEach(b => b.addEventListener('click', () => toggleFilterValue('queues', b.dataset.queue)));
  }

  // ---------------- Agent table ----------------
  function computeAgentRows(calls, sales) {
    const map = new Map();
    function ensure(name) {
      if (!map.has(name)) map.set(name, { agent: name, calls: 0, answered: 0, abandoned: 0, talk: 0, hold: 0, wrap: 0, talkN: 0, points: 0, rgu: 0, salesCount: 0 });
      return map.get(name);
    }
    calls.forEach(c => {
      if (!c.agent) return;
      const r = ensure(c.agent); r.calls++;
      if (c.result === 'Answered') { r.answered++; r.talk += c.talk; r.hold += c.hold; r.wrap += c.wrap; r.talkN++; }
      if (c.result === 'Abandoned') r.abandoned++;
    });
    // Merge in sales performance so agents show up (and get credit) even if
    // they only appear on the "sales Data" tab, not the calls tab.
    (sales || []).forEach(s => {
      if (!s.agent) return;
      const r = ensure(s.agent);
      r.points += Number(s.total) || 0;
      r.rgu += Number(s.rgu) || 0;
      r.salesCount++;
    });
    return Array.from(map.values()).map(r => ({
      ...r,
      aht: r.talkN ? (r.talk + r.hold + r.wrap) / r.talkN : 0,
      avgTalk: r.talkN ? r.talk / r.talkN : 0,
      avgHold: r.talkN ? r.hold / r.talkN : 0,
      avgWrap: r.talkN ? r.wrap / r.talkN : 0,
      share: 0,
      convRate: r.answered ? r.salesCount / r.answered * 100 : 0, // Sales as a % of calls handled
      perf: (r.points || 0) + (r.rgu || 0), // blended sales score, used for default ranking
    }));
  }

  const AGENT_AVA_COLORS = ['#5240D6', '#3F49B8', '#B23FA8', '#E5484D', '#FDAC00', '#2FA352', '#2B83C6', '#9A6A3A'];
  function avaColor(name) {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AGENT_AVA_COLORS[h % AGENT_AVA_COLORS.length];
  }
  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }
  function rankBadge(i) {
    if (i === 0) return `<span class="rankmedal rankmedal--1" title="#1">🥇</span>`;
    if (i === 1) return `<span class="rankmedal rankmedal--2" title="#2">🥈</span>`;
    if (i === 2) return `<span class="rankmedal rankmedal--3" title="#3">🥉</span>`;
    return `<span class="rankmedal">${i + 1}</span>`;
  }

  function renderAgentTable(calls, sales) {
    let rows = computeAgentRows(calls, sales);
    // "Calls Handled" / Share of Volume are based on ANSWERED calls only —
    // abandoned calls don't count as "handled".
    const totalHandled = rows.reduce((a, r) => a + r.answered, 0) || 1;
    rows.forEach(r => r.share = r.answered / totalHandled * 100);
    const search = state.tableSearch.agents.toLowerCase();
    if (search) rows = rows.filter(r => r.agent.toLowerCase().includes(search));
    const { key, dir } = state.tableSort.agents;
    rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === 'asc' ? 1 : -1));
    const maxShare = Math.max(...rows.map(x => x.share), 1);
    renderTable('agents', rows, {
      pageSize: 10,
      cols: [
        { key: 'rank', label: '#', cls: 'rank', render: (r, i) => rankBadge(i), sortable: false },
        { key: 'agent', label: 'Agent', cls: 'grow', render: r => `
            <span class="agentcell">
              <span class="agentava" style="background:${avaColor(r.agent)}">${escapeHtml(initials(r.agent))}</span>
              <span>${escapeHtml(r.agent)}</span>
            </span>` },
        { key: 'answered', label: 'Calls Handled', cls: 'r' },
        { key: 'salesCount', label: 'Sales', cls: 'r' },
        { key: 'convRate', label: 'Sales %', cls: 'r', render: r => { const c = heatColors(Math.max(0, Math.min(100, r.convRate))); return `<span class="ratepill" style="background:${c.bg}; color:${c.fg}">${pct(r.convRate, 1)}</span>`; } },
        { key: 'rgu', label: 'RGUs', cls: 'r', render: r => int(r.rgu) },
        { key: 'points', label: 'Total Points', cls: 'r', render: r => int(r.points) },
        { key: 'aht', label: 'AHT', cls: 'r', render: r => hmsShort(r.aht) },
        { key: 'avgTalk', label: 'Avg Talk', cls: 'r', render: r => hmsShort(r.avgTalk) },
        { key: 'avgHold', label: 'Avg Hold', cls: 'r', render: r => hmsShort(r.avgHold) },
        { key: 'share', label: 'Share of Volume', cls: 'r', render: r => barCell(r.share, maxShare) },
      ],
      empty: { title: 'No agent activity', sub: 'Try widening the date range or clearing filters.' },
    });
  }

  function barCell(v, max) {
    const w = Math.max(2, Math.min(100, (v / max) * 100));
    return `<span class="cellbar"><i style="width:${w}px"></i>${v.toFixed(0)}%</span>`;
  }

  // ---------------- Closer / Lead Gen tables ----------------
  // Closer and Lead Gen are sales-only roles (Closer Name / Lead Generated
  // by (If Any) columns on the "sales Data" tab, per SALES_MAP in
  // Code.gs) — they never appear on "Calls Data", so unlike the Agent
  // table there's no calls/AHT side to join in, just Sales, RGUs and
  // Points. Same sortable/searchable/paginated table shape as All Agents.
  function computeSalesRoleRows(sales, field) {
    const map = new Map();
    (sales || []).forEach(s => {
      const name = s[field];
      if (!name) return;
      if (!map.has(name)) map.set(name, { name, salesCount: 0, rgu: 0, points: 0 });
      const r = map.get(name);
      r.salesCount++; r.rgu += Number(s.rgu) || 0; r.points += Number(s.total) || 0;
    });
    return Array.from(map.values()).map(r => ({ ...r, avgPoints: r.salesCount ? r.points / r.salesCount : 0 }));
  }

  function renderSalesRoleTable(tableId, field, label, sales) {
    let rows = computeSalesRoleRows(sales, field);
    const totalSales = rows.reduce((a, r) => a + r.salesCount, 0) || 1;
    rows.forEach(r => r.share = r.salesCount / totalSales * 100);
    const search = state.tableSearch[tableId].toLowerCase();
    if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search));
    const { key, dir } = state.tableSort[tableId];
    rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (dir === 'asc' ? 1 : -1));
    const maxShare = Math.max(...rows.map(x => x.share), 1);
    renderTable(tableId, rows, {
      pageSize: 10,
      cols: [
        { key: 'rank', label: '#', cls: 'rank', render: (r, i) => rankBadge(i), sortable: false },
        { key: 'name', label, cls: 'grow', render: r => `
            <span class="agentcell">
              <span class="agentava" style="background:${avaColor(r.name)}">${escapeHtml(initials(r.name))}</span>
              <span>${escapeHtml(r.name)}</span>
            </span>` },
        { key: 'salesCount', label: 'Sales', cls: 'r' },
        { key: 'rgu', label: 'RGUs', cls: 'r', render: r => int(r.rgu) },
        { key: 'points', label: 'Total Points', cls: 'r', render: r => int(r.points) },
        { key: 'avgPoints', label: 'Avg Points/Sale', cls: 'r', render: r => r.avgPoints.toFixed(1) },
        { key: 'share', label: 'Share of Sales', cls: 'r', render: r => barCell(r.share, maxShare) },
      ],
      empty: { title: `No ${label.toLowerCase()} activity`, sub: 'Try widening the date range or clearing filters.' },
    });
  }

  function renderClosersTable(sales) { if ($('#page-closers')) renderSalesRoleTable('closers', 'closer', 'Closer', sales); }
  function renderLeadsTable(sales) { if ($('#page-leads')) renderSalesRoleTable('leads', 'lead', 'Lead Gen', sales); }

  // Compact top-5 previews shown on the Overview page (no search/pager —
  // just a quick glance, with a "View all" button that jumps to the full
  // Closer/Lead Gen Performance page).
  function renderRolePreview(containerId, field, sales) {
    const el2 = $(`#${containerId}`); if (!el2) return;
    let rows = computeSalesRoleRows(sales, field);
    rows.sort((a, b) => b.points - a.points);
    rows = rows.slice(0, 5);
    if (!rows.length) { el2.innerHTML = emptyRow(); return; }
    el2.innerHTML = `<table class="tbl">
      <tbody>
        ${rows.map((r, i) => `<tr>
          <td class="rank">${rankBadge(i)}</td>
          <td class="grow"><span class="agentcell"><span class="agentava" style="background:${avaColor(r.name)}">${escapeHtml(initials(r.name))}</span><span>${escapeHtml(r.name)}</span></span></td>
          <td class="r">${int(r.salesCount)} sales</td>
          <td class="r"><b>${int(r.points)}</b> pts</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }
  function renderClosersPreview(sales) { renderRolePreview('tbl_closersOv', 'closer', sales); }
  function renderLeadsPreview(sales) { renderRolePreview('tbl_leadsOv', 'lead', sales); }

  // ---------------- Sales breakdowns ----------------
  function renderSalesByProvider(sales) {
    const counts = groupCount(sales, s => s.provider || 'Unknown');
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const data = entries.map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
    Charts.donutChart($('#providerDonut'), { data, centerLabel: 'Sales', centerValue: int(sales.length) });
    $('#providerList').innerHTML = data.map(d => `<div><i style="background:${d.color}"></i><span>${escapeHtml(d.label)}</span><b>${d.value}</b><small>${pct(sales.length ? d.value / sales.length * 100 : 0, 0)}</small></div>`).join('') || emptyRow();
  }

  function renderSalesByTeam(sales) {
    const counts = groupCount(sales, s => s.team || 'Unassigned');
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    $('#teamBars').innerHTML = rows.map(([name, v]) => `
      <div class="hbar">
        <span class="hbar__name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        <span class="hbar__track"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span>
        <span class="hbar__val">${v}</span>
      </div>`).join('') || emptyRow();
  }

  function renderSalesTable(sales) {
    let rows = sales.slice();
    const search = state.tableSearch.sales.toLowerCase();
    if (search) rows = rows.filter(r => [r.agent, r.closer, r.lead, r.provider, r.team, r.state, r.campaign, r.queue].filter(Boolean).join(' ').toLowerCase().includes(search));
    const { key, dir } = state.tableSort.sales;
    rows.sort((a, b) => {
      const av = a[key], bv = b[key];
      const cmp = (av > bv ? 1 : av < bv ? -1 : 0);
      return cmp * (dir === 'asc' ? 1 : -1);
    });
    renderTable('sales', rows, {
      cols: [
        { key: 'd', label: 'Date', render: r => DataEngine.fmtDateShort(DataEngine.dateFromNum(r.d)) },
        { key: 'agent', label: 'Agent', cls: 'grow', render: r => r.agent || '—' },
        { key: 'closer', label: 'Closer', render: r => r.closer || '—' },
        { key: 'lead', label: 'Lead Gen', render: r => r.lead || '—' },
        { key: 'provider', label: 'Provider', render: r => r.provider || '—' },
        { key: 'services', label: 'Service', render: r => r.services || '—' },
        { key: 'team', label: 'Team', render: r => r.team || '—' },
        { key: 'state', label: 'State', render: r => r.state || '—' },
        { key: 'rgu', label: 'RGUs', cls: 'r' },
        { key: 'total', label: 'Points', cls: 'r', render: r => (r.total || 0).toFixed(1) },
      ],
      empty: { title: 'No sales in range', sub: 'Sales rows will appear here once they match your filters.' },
    });
  }

  // ---------------- Generic sortable/paged table ----------------
  function renderTable(id, rows, { cols, empty, pageSize = 10 }) {
    const wrap = $(`#tbl_${id}`);
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty"><b>${empty.title}</b>${empty.sub}</div>`;
      $(`#count_${id}`).textContent = '0 rows';
      $(`#pager_${id}`).innerHTML = '';
      return;
    }
    const page = state.tablePage[id] || 1;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const p = Math.min(page, totalPages);
    state.tablePage[id] = p;
    const pageRows = rows.slice((p - 1) * pageSize, p * pageSize);
    const sort = state.tableSort[id];
    const thead = `<thead><tr>${cols.map(c => `<th data-key="${c.key}" ${c.sortable === false ? '' : 'class="sortable"'} ${sort.key === c.key ? `data-dir="${sort.dir}"` : ''}>${c.label}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${pageRows.map((r, i) => `<tr>${cols.map(c => `<td class="${c.cls || ''}">${c.render ? c.render(r, (p - 1) * pageSize + i) : (r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>`;
    wrap.innerHTML = `<table class="tbl">${thead}${tbody}</table>`;
    $(`#count_${id}`).textContent = `${int(rows.length)} row${rows.length === 1 ? '' : 's'}`;
    $(`#pager_${id}`).innerHTML = `
      <button ${p <= 1 ? 'disabled' : ''} data-act="prev">Prev</button>
      <span>Page ${p} of ${totalPages}</span>
      <button ${p >= totalPages ? 'disabled' : ''} data-act="next">Next</button>`;
    $$('th[data-key]', wrap).forEach(th => {
      if (th.getAttribute('class') !== 'sortable' && cols.find(c => c.key === th.dataset.key)?.sortable === false) return;
      th.addEventListener('click', () => {
        const k = th.dataset.key;
        if (sort.key === k) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.key = k; sort.dir = 'desc'; }
        state.tablePage[id] = 1;
        renderAll();
      });
    });
    const pager = $(`#pager_${id}`);
    pager.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.tablePage[id] += b.dataset.act === 'next' ? 1 : -1;
      renderAll();
    }));
  }

  // ---------------- Heatmap: calls by weekday x hour ----------------
  function renderHeatmap(calls) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    calls.forEach(c => { if (c.hour >= 0 && c.hour < 24) grid[c.dow][c.hour]++; });
    const max = Math.max(1, ...grid.flat());
    const el2 = $('#heatmap');
    let html = `<div class="heat" style="grid-template-columns:44px repeat(24,1fr)">`;
    html += `<div></div>` + Array.from({ length: 24 }, (_, h) => `<div class="heat__hdr">${h}</div>`).join('');
    DataEngine.DOW_LABELS.forEach((lbl, d) => {
      html += `<div class="heat__lbl">${lbl}</div>`;
      for (let h = 0; h < 24; h++) {
        const v = grid[d][h];
        const alpha = v / max;
        html += `<div class="heat__cell" data-v="${v}" data-d="${lbl}" data-h="${h}" style="background:${v === 0 ? 'var(--heat-0)' : `color-mix(in srgb, var(--amber) ${Math.max(10, alpha * 100).toFixed(0)}%, var(--heat-0))`}"></div>`;
      }
    });
    html += `</div>`;
    el2.innerHTML = html;
    $$('.heat__cell', el2).forEach(c => {
      c.addEventListener('mousemove', evt => { Charts.showTip(evt, `<div class="t">${c.dataset.d} · ${c.dataset.h}:00</div><b>${c.dataset.v}</b> calls`); Charts.moveTip(evt); });
      c.addEventListener('mouseleave', Charts.hideTip);
    });
  }

  // ---------------- Hourly page ----------------
  function hr12(h) { let hh = h % 12; if (hh === 0) hh = 12; return hh; }
  function ctLabel(h) { const pad = n => String(n).padStart(2, '0'); return `${pad(h)}-${pad((h + 1) % 24)}CT`; }
  function pakLabel(h) { const period = h < 12 ? 'AM' : 'PM'; return `${hr12(h)}-${hr12((h + 1) % 24)}${period}`; }

  // Reorders the 24 CT-indexed buckets into ascending order for the chosen
  // timezone and attaches a display label to each. Pak Time is a fixed
  // +10h offset from Central Time (confirmed against the user's own
  // Pak/Central hour-mapping sheet), so this is just a relabel + rotation —
  // the underlying call/sale counts per bucket never change.
  function hourBucketsForDisplay(buckets) {
    if (state.hourlyTZ === 'pkt') {
      return buckets
        .map(b => Object.assign({}, b, { dispHour: (b.hour + 10) % 24 }))
        .sort((a, b) => a.dispHour - b.dispHour)
        .map(b => Object.assign({}, b, { label: pakLabel(b.dispHour) }));
    }
    return buckets.map(b => Object.assign({}, b, { label: ctLabel(b.hour) }));
  }

  function heatColors(pct) {
    // 0% -> red, 50% -> amber, 100% -> green
    const hue = Math.max(0, Math.min(120, pct * 1.2));
    return { bg: `hsl(${hue} 75% 90%)`, fg: `hsl(${hue} 70% 28%)` };
  }

  function renderHourCalls(buckets) {
    const el2 = $('#hourHeatCalls'); if (!el2) return;
    const rows = hourBucketsForDisplay(buckets);
    el2.innerHTML = rows.map((b, i) => {
      const c = b.calls === 0 ? { bg: 'var(--heat-0)', fg: 'var(--muted)' } : heatColors(b.answerRate);
      return `<div class="hourHeat__cell" style="background:${c.bg}; color:${c.fg}; animation-delay:${i * 14}ms" data-h="${b.label}" data-rate="${b.answerRate.toFixed(1)}" data-calls="${b.calls}" data-ans="${b.answered}" data-miss="${b.missed}">
        <div class="h">${b.label}</div>
        <div class="v">${int(b.answered)}</div>
        <div class="n">answered</div>
      </div>`;
    }).join('');
    $$('.hourHeat__cell', el2).forEach(c => {
      c.addEventListener('mousemove', evt => {
        Charts.showTip(evt, `<div class="t">${c.dataset.h}</div><b>${int(c.dataset.ans)}</b> answered`);
        Charts.moveTip(evt);
      });
      c.addEventListener('mouseleave', Charts.hideTip);
    });
  }

  function renderHourSales(buckets) {
    const el2 = $('#hourHeatSales'); if (!el2) return;
    const rows = hourBucketsForDisplay(buckets);
    const max = Math.max(1, ...rows.map(b => b.sales));
    el2.innerHTML = rows.map((b, i) => {
      const alpha = b.sales === 0 ? 0 : Math.max(15, b.sales / max * 100);
      const bg = b.sales === 0 ? 'var(--heat-0)' : `color-mix(in srgb, var(--amber) ${alpha.toFixed(0)}%, var(--heat-0))`;
      const fg = b.sales === 0 ? 'var(--muted)' : 'var(--amber-ink)';
      return `<div class="hourHeat__cell" style="background:${bg}; color:${fg}; animation-delay:${i * 14}ms" data-h="${b.label}" data-sales="${b.sales}" data-pts="${b.points}" data-rgu="${b.rgu}">
        <div class="h">${b.label}</div>
        <div class="v">${b.sales || '—'}</div>
        <div class="n">${int(b.rgu)} RGUs</div>
      </div>`;
    }).join('');
    $$('.hourHeat__cell', el2).forEach(c => {
      c.addEventListener('mousemove', evt => {
        Charts.showTip(evt, `<div class="t">${c.dataset.h}</div><b>${int(c.dataset.sales)}</b> sales<br/>${int(c.dataset.pts)} points · ${int(c.dataset.rgu)} RGUs`);
        Charts.moveTip(evt);
      });
      c.addEventListener('mouseleave', Charts.hideTip);
    });
  }

  function renderHourlyTable(buckets) {
    const el2 = $('#tbl_hourly'); if (!el2) return;
    const rows = hourBucketsForDisplay(buckets);
    const maxCalls = Math.max(1, ...rows.map(r => r.calls));
    const html = `<table class="tbl">
      <thead><tr>
        <th>Hour</th><th class="r">Total Calls</th><th class="r">Answered</th><th class="r">Missed</th>
        <th class="r">Answer Rate</th><th class="r">Missed %</th><th class="r">Sales</th><th class="r">Points</th><th class="r">RGUs</th><th>Volume</th>
      </tr></thead>
      <tbody>${rows.map(b => `<tr>
        <td><b>${b.label}</b></td>
        <td class="r">${int(b.calls)}</td>
        <td class="r">${int(b.answered)}</td>
        <td class="r">${int(b.missed)}</td>
        <td class="r">${b.calls ? pct(b.answerRate, 0) : '—'}</td>
        <td class="r">${(b.answered + b.missed) ? pct(b.missedPct, 1) : '—'}</td>
        <td class="r">${int(b.sales)}</td>
        <td class="r">${int(b.points)}</td>
        <td class="r">${int(b.rgu)}</td>
        <td><div class="hourly-bar"><i style="width:${(b.calls / maxCalls * 100).toFixed(1)}%"></i></div></td>
      </tr>`).join('')}</tbody>
    </table>`;
    el2.innerHTML = html;
  }

  // ---------------- Daily x Hourly matrix table ----------------
  // Replicates the "Sept'26 / Pak Time / Central Time" sheet: one block of
  // 4 rows (Sales, Answered, Missed, Missed %) per calendar date, one
  // column per active hour (shown in both Pakistan Time and Central Time),
  // plus a Grand Total column per row and a Total block across all dates.
  function matrixColumns(dayRows) {
    // Only show hours that actually have calls or sales somewhere in the
    // selected range — keeps the table to the real shift window (e.g. the
    // sample sheet only ever has traffic 06:00–24:00 CT) instead of 24
    // mostly-empty columns.
    const active = new Set();
    dayRows.forEach(day => day.buckets.forEach(b => { if (b.calls > 0 || b.sales > 0) active.add(b.hour); }));
    return Array.from(active).sort((a, b) => a - b);
  }

  function scaleCell(value, rowMax, varName) {
    if (!value) return '';
    const alpha = rowMax ? Math.max(15, Math.round(value / rowMax * 100)) : 0;
    const fg = alpha > 60 ? '#fff' : 'inherit';
    return ` style="background:color-mix(in srgb, var(${varName}) ${alpha}%, transparent); color:${fg}"`;
  }
  function missedPctCell(p, hasData) {
    if (!hasData) return '';
    // Low missed % is good (green) → high missed % is bad (red), same
    // red→amber→green ramp used by the answer-rate heatmap, just inverted.
    const c = heatColors(Math.max(0, Math.min(100, 100 - p)));
    return ` style="background:${c.bg}; color:${c.fg}"`;
  }

  function matrixDayBlock(day, columns) {
    const t = day.totals;
    const salesMax = Math.max(0, ...columns.map(h => day.buckets[h].sales));
    const dateLabel = day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const rowsDef = [
      { key: 'sales', label: 'Sales', cell: h => { const v = day.buckets[h].sales; return `<td class="r"${scaleCell(v, salesMax, '--green')}>${v || ''}</td>`; }, total: int(t.sales) },
      { key: 'answered', label: 'Answered', cell: h => { const v = day.buckets[h].answered; return `<td class="r">${v || ''}</td>`; }, total: int(t.answered) },
      { key: 'missed', label: 'Missed', cell: h => { const v = day.buckets[h].missed; return `<td class="r">${v || ''}</td>`; }, total: int(t.missed) },
      { key: 'missedPct', label: 'Missed %', cell: h => { const b = day.buckets[h]; const has = (b.answered + b.missed) > 0; return `<td class="r"${missedPctCell(b.missedPct, has)}>${has ? pct(b.missedPct, 2) : ''}</td>`; }, total: (t.answered + t.missed) ? pct(t.missedPct, 2) : '—' },
    ];
    return rowsDef.map((r, i) => `<tr class="${i === 0 ? 'matrix__blockstart ' : ''}${r.key === 'missedPct' ? 'matrix__pctrow matrix__blockend' : ''}">
      ${i === 0 ? `<td class="matrix__date" rowspan="4"><b>${dateLabel}</b></td>` : ''}
      <td class="matrix__metric">${r.label}</td>
      ${columns.map(r.cell).join('')}
      <td class="r matrix__total"><b>${r.total}</b></td>
    </tr>`).join('');
  }

  function matrixTotalsBlock(dayRows, columns) {
    const grand = { sales: 0, answered: 0, missed: 0 };
    const colTotals = columns.map(h => {
      const c = { sales: 0, answered: 0, missed: 0 };
      dayRows.forEach(day => { const b = day.buckets[h]; c.sales += b.sales; c.answered += b.answered; c.missed += b.missed; });
      return c;
    });
    dayRows.forEach(day => { grand.sales += day.totals.sales; grand.answered += day.totals.answered; grand.missed += day.totals.missed; });
    const grandPct = (grand.answered + grand.missed) ? grand.missed / (grand.answered + grand.missed) * 100 : 0;
    const salesMax = Math.max(0, ...colTotals.map(c => c.sales));
    const rowsDef = [
      { label: 'Sales', cell: c => `<td class="r"${scaleCell(c.sales, salesMax, '--green')}>${c.sales || ''}</td>`, total: int(grand.sales) },
      { label: 'Answered', cell: c => `<td class="r">${c.answered || ''}</td>`, total: int(grand.answered) },
      { label: 'Missed', cell: c => `<td class="r">${c.missed || ''}</td>`, total: int(grand.missed) },
      { label: 'Missed %', cell: c => { const has = (c.answered + c.missed) > 0; const p = has ? c.missed / (c.answered + c.missed) * 100 : 0; return `<td class="r"${missedPctCell(p, has)}>${has ? pct(p, 2) : ''}</td>`; }, total: (grand.answered + grand.missed) ? pct(grandPct, 2) : '—' },
    ];
    return rowsDef.map((r, i) => `<tr class="matrix__totalrow ${i === 0 ? 'matrix__blockstart ' : ''}${r.label === 'Missed %' ? 'matrix__pctrow matrix__blockend' : ''}">
      ${i === 0 ? `<td class="matrix__date" rowspan="4"><b>Total</b></td>` : ''}
      <td class="matrix__metric">${r.label}</td>
      ${colTotals.map(r.cell).join('')}
      <td class="r matrix__total"><b>${r.total}</b></td>
    </tr>`).join('');
  }

  function renderDailyMatrix(dayRows) {
    const el2 = $('#tbl_dailyMatrix'); if (!el2) return;
    if (!dayRows.length) { el2.innerHTML = '<div class="empty">No calls or sales in the selected range.</div>'; return; }
    const columns = matrixColumns(dayRows);
    if (!columns.length) { el2.innerHTML = '<div class="empty">No hourly data in the selected range.</div>'; return; }
    const pakOf = h => (h + 10) % 24;
    const html = `<div class="matrixScroll"><table class="tbl matrix">
      <thead>
        <tr>
          <th class="matrix__corner" rowspan="2">Date</th>
          <th class="matrix__corner matrix__tzhdr">Pak Time</th>
          ${columns.map(h => `<th>${pakLabel(pakOf(h))}</th>`).join('')}
          <th class="r" rowspan="2">Grand Total</th>
        </tr>
        <tr>
          <th class="matrix__corner matrix__tzhdr">Central Time</th>
          ${columns.map(h => `<th>${ctLabel(h)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${dayRows.map(day => matrixDayBlock(day, columns)).join('')}
        ${matrixTotalsBlock(dayRows, columns)}
      </tbody>
    </table></div>`;
    el2.innerHTML = html;
  }

  // ---------------- Executive Summary: revenue impact + forecast + insights ----------------
  const TARGET_KEY = 'sc_daily_sales_target';
  function getTarget(fallback) {
    const v = Number(localStorage.getItem(TARGET_KEY));
    return v > 0 ? v : fallback;
  }
  function setTarget(v) { try { localStorage.setItem(TARGET_KEY, String(v)); } catch (e) {} }

  function historyDays(limit) {
    const todayStr = DataEngine.todayDateStr();
    const rows = DataEngine.dailyHourlyMatrix(DataEngine.calls, DataEngine.sales)
      .filter(d => d.dateStr < todayStr && d.totals.calls + d.totals.sales > 0);
    return rows.slice(-limit);
  }

  // Average fraction of the day's eventual total reached by the END of each
  // hour, averaged evenly across historical days (so a slow vs busy day
  // both contribute one "shape" vote, not skewed by raw volume).
  function paceCurve(hist, key) {
    const curve = new Array(24).fill(0);
    let n = 0;
    hist.forEach(d => {
      const total = d.totals[key];
      if (!total) return;
      n++;
      let cum = 0;
      for (let h = 0; h < 24; h++) { cum += d.buckets[h][key]; curve[h] += cum / total; }
    });
    return n ? curve.map(v => v / n) : curve;
  }
  function projectForecast(todayBuckets, hist, key) {
    const curve = paceCurve(hist, key);
    const h = currentCtHour();
    const soFar = todayBuckets.slice(0, h + 1).reduce((a, b) => a + b[key], 0);
    const frac = h > 0 ? curve[h - 1] : 0;
    if (frac < 0.04) return { value: null, soFar, started: false };
    return { value: soFar / frac, soFar, started: true };
  }

  function renderExecSummary() {
    const el2 = $('#execSummary'); if (!el2) return;
    const todayStr = DataEngine.todayDateStr();
    const today = DataEngine.todayHourlyStats(todayStr).buckets;
    const hist = historyDays(14);

    const histTotals = hist.reduce((a, d) => { a.sales += d.totals.sales; a.answered += d.totals.answered; a.missed += d.totals.missed; a.rgu += d.totals.rgu; return a; }, { sales: 0, answered: 0, missed: 0, rgu: 0 });
    const avgConv = histTotals.answered ? histTotals.sales / histTotals.answered : 0;      // sales per answered call
    const avgRguPerSale = histTotals.sales ? histTotals.rgu / histTotals.sales : 0;
    const avgDailySales = hist.length ? histTotals.sales / hist.length : null;
    const histAnswerRate = (histTotals.answered + histTotals.missed) ? histTotals.answered / (histTotals.answered + histTotals.missed) * 100 : null;

    const todayTotals = today.reduce((a, b) => { a.sales += b.sales; a.answered += b.answered; a.missed += b.missed; a.rgu += b.rgu; return a; }, { sales: 0, answered: 0, missed: 0, rgu: 0 });
    const todayAnswerRate = (todayTotals.answered + todayTotals.missed) ? todayTotals.answered / (todayTotals.answered + todayTotals.missed) * 100 : null;

    // Missed-call cost so far today, plus a projected end-of-day cost.
    const lostSalesSoFar = todayTotals.missed * avgConv;
    const lostRguSoFar = lostSalesSoFar * avgRguPerSale;
    const missedFc = projectForecast(today, hist, 'missed');
    const projMissed = missedFc.value != null ? Math.max(missedFc.soFar, missedFc.value) : null;
    const projLostSales = projMissed != null ? projMissed * avgConv : null;

    // Sales forecast + target.
    const salesFc = projectForecast(today, hist, 'sales');
    const target = getTarget(avgDailySales != null ? Math.round(avgDailySales) : null);
    const forecastSales = salesFc.value != null ? salesFc.value : (avgDailySales != null ? avgDailySales : null);
    const progressPct = target ? Math.min(160, todayTotals.sales / target * 100) : null;
    const forecastPct = target && forecastSales != null ? Math.min(160, forecastSales / target * 100) : null;

    // ---- insight lines (data-driven, no hardcoding) ----
    const insights = [];
    if (todayTotals.missed > 0) {
      insights.push(`<b>${int(todayTotals.missed)} missed call${todayTotals.missed === 1 ? '' : 's'}</b> so far today ≈ <b>${int(Math.round(lostSalesSoFar))} sale${Math.round(lostSalesSoFar) === 1 ? '' : 's'}</b> and <b>${int(Math.round(lostRguSoFar))} RGU${Math.round(lostRguSoFar) === 1 ? '' : 's'}</b> left on the table, based on your ${hist.length}-day average conversion.`);
    } else if (hist.length) {
      insights.push(`No missed calls today — full conversion window preserved so far.`);
    }
    if (target) {
      const diff = Math.round((forecastSales != null ? forecastSales : 0) - target);
      if (!salesFc.started) {
        insights.push(`Day just getting started — projection will sharpen once the first shift hours are in.`);
      } else if (diff >= 0) {
        insights.push(`On current pace, today lands around <b>${int(Math.round(forecastSales))} sales</b> — <b>${int(diff)} above</b> the ${int(target)} target.`);
      } else {
        insights.push(`On current pace, today lands around <b>${int(Math.round(forecastSales))} sales</b> — <b>${int(-diff)} short</b> of the ${int(target)} target.`);
      }
    }
    if (histAnswerRate != null && todayTotals.answered + todayTotals.missed >= 5) {
      const d = todayAnswerRate - histAnswerRate;
      if (Math.abs(d) >= 1.5) {
        insights.push(`Answer rate today is <b>${pct(todayAnswerRate, 0)}</b>, ${Math.abs(d).toFixed(0)} pts ${d >= 0 ? 'above' : 'below'} your ${hist.length}-day average of ${pct(histAnswerRate, 0)}.`);
      }
    }
    const decided = today.map(b => b.answered + b.missed);
    const worstI = argMax(today.map((b, i) => decided[i] >= 3 ? b.missedPct : -1));
    if (worstI >= 0 && today[worstI].missedPct > 0) {
      insights.push(`Missed rate peaks around <b>${ctLabel(worstI)}</b> (${pct(today[worstI].missedPct, 0)}) — that window is worth extra coverage.`);
    }

    const ringPct = progressPct != null ? Math.min(100, progressPct) : 0;
    const ringColor = target ? (todayTotals.sales >= target ? 'var(--green)' : (forecastPct != null && forecastPct >= 100 ? 'var(--amber-strong)' : 'var(--rose)')) : 'var(--muted)';
    const circumf = 2 * Math.PI * 42;

    el2.innerHTML = `
      <div class="exec__head">
        <div>
          <div class="card__title">Executive Summary</div>
          <div class="card__sub">Live read on today (${today.length ? DataEngine.fmtDateShort(new Date(todayStr)) : todayStr}) · auto-generated from the last ${hist.length || '—'} days</div>
        </div>
      </div>
      <div class="exec-grid">
        <div class="exec-tile exec-tile--impact">
          <div class="exec-tile__label">Missed-call revenue impact</div>
          <div class="exec-tile__big">${int(todayTotals.missed)} <small>missed</small></div>
          <div class="exec-tile__sub">≈ <b>${int(Math.round(lostSalesSoFar))}</b> sales · <b>${int(Math.round(lostRguSoFar))}</b> RGUs lost so far${projLostSales != null && projMissed > todayTotals.missed ? `<br/>Projected full day: ≈ ${int(Math.round(projMissed))} missed → ${int(Math.round(projLostSales))} sales` : ''}</div>
        </div>
        <div class="exec-tile exec-tile--forecast">
          <div class="exec-tile__label">End-of-day forecast</div>
          <div class="exec-tile__big">${forecastSales != null ? '~' + int(Math.round(forecastSales)) : '—'} <small>sales</small></div>
          <div class="exec-tile__sub">${salesFc.started ? `So far: ${int(todayTotals.sales)} · pace-projected from ${hist.length}-day pattern` : `So far: ${int(todayTotals.sales)} · projection warms up once the shift is underway`}</div>
        </div>
        <div class="exec-tile exec-tile--target">
          <div class="exec-tile__label">Pace vs target</div>
          <div class="exec-ring">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" class="exec-ring__bg"/>
              <circle cx="50" cy="50" r="42" class="exec-ring__fg" style="stroke:${ringColor}; stroke-dasharray:${circumf}; stroke-dashoffset:${circumf * (1 - ringPct / 100)}"/>
            </svg>
            <div class="exec-ring__num">${target ? Math.round(todayTotals.sales / target * 100) + '%' : '—'}</div>
          </div>
          <div class="exec-tile__sub exec-target">${int(todayTotals.sales)} of
            <span class="exec-target__val" id="execTargetVal">${target ? int(target) : 'no target set'}</span>
            <button type="button" class="exec-target__edit" id="execTargetEdit" title="Edit daily target">✎</button>
          </div>
        </div>
      </div>
      <div class="exec-insights">
        ${insights.map(t => `<div class="exec-insights__row"><span class="exec-insights__dot"></span><span>${t}</span></div>`).join('')}
      </div>
      <div class="exec-note">Revenue-impact and forecast figures are estimates from your own recent conversion and pacing patterns, not exact numbers.</div>
    `;

    const editBtn = $('#execTargetEdit', el2);
    if (editBtn) editBtn.addEventListener('click', () => {
      const cur = target || '';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.className = 'exec-target__input'; input.value = cur;
      const valEl = $('#execTargetVal', el2);
      valEl.replaceWith(input); input.focus(); input.select();
      const commit = () => { const v = Number(input.value); if (v > 0) setTarget(v); renderExecSummary(); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderExecSummary(); });
      input.addEventListener('blur', commit);
    });
  }

  // ---------------- Today vs Yesterday: cards + interactive hourly chart + insights ----------------
  const TY_METRICS = {
    sales:    { label: 'Sales',       bad: false },
    answered: { label: 'Answered',    bad: false },
    rgu:      { label: 'RGUs',        bad: false },
    missed:   { label: 'Missed',      bad: true  },
    rate:     { label: 'Answer Rate', bad: false, ratio: true },
  };
  let tyData = null;

  function currentCtHour() {
    try {
      return Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Chicago' }).format(new Date()));
    } catch (e) { return new Date().getHours(); }
  }
  function tySum(buckets) {
    const t = buckets.reduce((a, b) => { a.calls += b.calls; a.answered += b.answered; a.missed += b.missed; a.sales += b.sales; a.rgu += b.rgu; return a; }, { calls: 0, answered: 0, missed: 0, sales: 0, rgu: 0 });
    const dec = t.answered + t.missed;
    t.rate = dec ? t.answered / dec * 100 : 0;
    return t;
  }
  function tyFmt(key, v) { return TY_METRICS[key].ratio ? pct(v, 1) : int(v); }
  function tyDelta(key, curr, prev) {
    const m = TY_METRICS[key];
    if (m.ratio) {
      const d = curr - prev;
      if (Math.abs(d) < 0.05) return { cls: 'flat', text: '± 0 pts' };
      return { cls: d > 0 ? 'good' : 'bad', text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} pts` };
    }
    if (curr === prev) return { cls: 'flat', text: '± 0' };
    const up = curr > prev;
    const good = m.bad ? !up : up;
    const text = prev === 0 ? `▲ +${int(curr)}` : `${up ? '▲' : '▼'} ${Math.abs((curr - prev) / prev * 100).toFixed(0)}%`;
    return { cls: good ? 'good' : 'bad', text };
  }
  function tyValue(b, key) { return key === 'rate' ? (b.answered + b.missed ? b.answerRate : 0) : b[key]; }
  function tySeries(rows, key, cumulative) {
    if (!cumulative) return rows.map(b => tyValue(b, key));
    let a = 0, m = 0, run = 0;
    return rows.map(b => {
      if (key === 'rate') { a += b.answered; m += b.missed; return (a + m) ? a / (a + m) * 100 : 0; }
      run += b[key]; return run;
    });
  }
  function tyShort(b) {
    if (state.hourlyTZ === 'pkt') { const h = b.dispHour; return `${hr12(h)}${h < 12 ? 'a' : 'p'}`; }
    return String(b.hour).padStart(2, '0');
  }
  function spark(tRows, yRows, key) {
    const W = 100, H = 30, n = tRows.length;
    if (n < 2) return '';
    const tv = tySeries(tRows, key, false), yv = tySeries(yRows, key, false);
    const max = Math.max(1, ...tv, ...yv);
    const pts = arr => arr.map((v, i) => `${(i / (n - 1) * W).toFixed(1)},${(H - 2 - v / max * (H - 4)).toFixed(1)}`).join(' ');
    return `<svg class="ty-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="y" points="${pts(yv)}" vector-effect="non-scaling-stroke"/>
      <polyline class="t" points="${pts(tv)}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function argMax(arr, ok) {
    let bi = -1, bv = -Infinity;
    arr.forEach((v, i) => { if ((!ok || ok(i)) && v > bv) { bv = v; bi = i; } });
    return bi;
  }

  function renderTYCompare(todayBuckets, yestBuckets) {
    const el2 = $('#tyCompare'); if (!el2) return;
    tyData = { todayBuckets, yestBuckets };
    const T = tySum(todayBuckets), Y = tySum(yestBuckets);
    const tRowsAll = hourBucketsForDisplay(todayBuckets), yRowsAll = hourBucketsForDisplay(yestBuckets);
    const idx = tRowsAll.map((_, i) => i).filter(i => tRowsAll[i].calls || tRowsAll[i].sales || yRowsAll[i].calls || yRowsAll[i].sales);
    const tRows = idx.map(i => tRowsAll[i]), yRows = idx.map(i => yRowsAll[i]);
    const key = state.hourlyMetric, cum = state.hourlyMode === 'cumulative', m = TY_METRICS[key];

    // ---- metric cards (horizontal) ----
    const cards = Object.keys(TY_METRICS).map((k, i) => {
      const d = tyDelta(k, T[k], Y[k]);
      return `<button type="button" class="ty-card${k === key ? ' is-on' : ''}" data-metric="${k}" aria-pressed="${k === key}" style="animation-delay:${i * 40}ms">
        <span class="ty-card__label">${TY_METRICS[k].label}</span>
        <span class="ty-card__value">${tyFmt(k, T[k])}</span>
        <span class="ty-card__row"><span class="ty-delta ${d.cls}">${d.text}</span><span class="ty-card__y">Yesterday <b>${tyFmt(k, Y[k])}</b></span></span>
        ${spark(tRows, yRows, k)}
      </button>`;
    }).join('');

    // ---- chart ----
    let chart;
    if (!tRows.length) {
      chart = '<div class="empty">No calls or sales yet for today or yesterday.</div>';
    } else {
      const tv = tySeries(tRows, key, cum), yv = tySeries(yRows, key, cum);
      const max = Math.max(1, ...tv, ...yv);
      const nowH = currentCtHour();
      if (state.hourlyPin == null || !tRows.some(r => r.hour === state.hourlyPin)) {
        const base = tySeries(tRows, key === 'rate' ? 'answered' : key, false);
        let pi = argMax(base);
        if (pi < 0 || base[pi] <= 0) pi = argMax(tRows.map(r => r.calls));
        state.hourlyPin = tRows[Math.max(0, pi)].hour;
      }
      chart = `<div class="ty-chart" id="tyChart">${tRows.map((b, i) => `
        <div class="ty-col${b.hour === state.hourlyPin ? ' is-pin' : ''}${b.hour === nowH ? ' is-now' : ''}" data-i="${i}" data-hour="${b.hour}">
          <div class="ty-col__bars">
            <i class="y" style="height:${(yv[i] / max * 100).toFixed(1)}%"></i>
            <i class="t" style="height:${(tv[i] / max * 100).toFixed(1)}%"></i>
          </div>
          <span class="ty-col__lbl">${tyShort(b)}</span>
        </div>`).join('')}</div>`;
    }

    // ---- insights (today) ----
    const tBase = tySeries(tRows, key === 'rate' ? 'answered' : key, false);
    const pk = tRows.length ? argMax(tBase) : -1;
    const totalMetric = tBase.reduce((a, v) => a + v, 0);
    const peakTile = (pk >= 0 && tBase[pk] > 0)
      ? { t: `Peak hour · ${key === 'rate' ? 'Answered' : m.label}`, v: tRows[pk].label, s: `${int(tBase[pk])} · ${totalMetric ? (tBase[pk] / totalMetric * 100).toFixed(0) : 0}% of today` }
      : { t: `Peak hour · ${m.label}`, v: '—', s: 'No activity yet' };

    const ct = currentCtHour();
    const paceKey = key === 'rate' ? 'answered' : key;
    const done = b => b.hour < ct;
    const tp = todayBuckets.filter(done).reduce((a, b) => a + b[paceKey], 0);
    const yp = yestBuckets.filter(done).reduce((a, b) => a + b[paceKey], 0);
    const pd = tyDelta(paceKey, tp, yp);
    const paceTile = { t: `Pace · ${TY_METRICS[paceKey].label}`, v: `${int(tp)} <small>vs ${int(yp)}</small>`, s: ct > 0 ? `Completed hours so far · <span class="ty-delta ${pd.cls}">${pd.text}</span>` : 'Day just started', cls: pd.cls };

    const bestI = argMax(tRows.map(b => b.answerRate), i => (tRows[i].answered + tRows[i].missed) >= 3);
    const bestTile = bestI >= 0
      ? { t: 'Best answer rate', v: tRows[bestI].label, s: `${pct(tRows[bestI].answerRate, 0)} of ${int(tRows[bestI].answered + tRows[bestI].missed)} decided calls`, cls: 'good' }
      : { t: 'Best answer rate', v: '—', s: 'Needs 3+ decided calls in an hour' };

    const missI = argMax(tRows.map(b => b.missed));
    const missTile = (missI >= 0 && tRows[missI].missed > 0)
      ? { t: 'Most missed', v: tRows[missI].label, s: `${int(tRows[missI].missed)} missed · ${pct(tRows[missI].missedPct, 0)} of decided`, cls: 'bad' }
      : { t: 'Most missed', v: 'None', s: 'No missed calls today', cls: 'good' };

    const tiles = [peakTile, paceTile, bestTile, missTile].map(x => `<div class="ty-ins ${x.cls || ''}"><div class="ty-ins__t">${x.t}</div><div class="ty-ins__v">${x.v}</div><div class="ty-ins__s">${x.s}</div></div>`).join('');

    el2.innerHTML = `
      <div class="ty-cards">${cards}</div>
      <div class="card ty-panel">
        <div class="card__head">
          <div>
            <div class="card__title">${m.label} by hour — Today vs Yesterday</div>
            <div class="card__sub">Hover a column for numbers · click to pin it below · ${state.hourlyTZ === 'pkt' ? 'Pakistan Time' : 'Central Time'}</div>
          </div>
          <div class="card__tools">
            <span class="legend"><span><i style="background:var(--amber)"></i>Today</span><span><i style="background:var(--slate)"></i>Yesterday</span></span>
            <div class="seg seg--sm" data-group="tyMode">
              <button data-mode="hourly" aria-pressed="${!cum}">Hourly</button>
              <button data-mode="cumulative" aria-pressed="${cum}">Cumulative</button>
            </div>
          </div>
        </div>
        ${chart}
        <div class="ty-detail" id="tyDetail"></div>
        <div class="ty-insights">${tiles}</div>
      </div>`;

    renderTYDetail(tRows, yRows);
    wireTY(el2, tRows, yRows, key, cum);
  }

  function renderTYDetail(tRows, yRows) {
    const box = $('#tyDetail'); if (!box) return;
    const i = tRows.findIndex(r => r.hour === state.hourlyPin);
    if (i < 0) { box.innerHTML = ''; return; }
    const t = tRows[i], y = yRows[i];
    const line = (lbl, b, cls) => `<div class="ty-detail__row ${cls}"><b>${lbl}</b>
      <span>${int(b.sales)} <small>sales</small></span><span>${int(b.rgu)} <small>RGUs</small></span>
      <span>${int(b.answered)} <small>answered</small></span><span>${int(b.missed)} <small>missed</small></span>
      <span>${(b.answered + b.missed) ? pct(b.answerRate, 0) : '—'} <small>answer rate</small></span></div>`;
    box.innerHTML = `<div class="ty-detail__hdr">${t.label}</div>${line('Today', t, 't')}${line('Yesterday', y, 'y')}`;
  }

  function wireTY(el2, tRows, yRows, key, cum) {
    $$('.ty-card', el2).forEach(c => c.addEventListener('click', () => {
      state.hourlyMetric = c.dataset.metric;
      renderTYCompare(tyData.todayBuckets, tyData.yestBuckets);
    }));
    $$('.seg[data-group="tyMode"] button', el2).forEach(b => b.addEventListener('click', () => {
      state.hourlyMode = b.dataset.mode;
      renderTYCompare(tyData.todayBuckets, tyData.yestBuckets);
    }));
    const tv = tySeries(tRows, key, cum), yv = tySeries(yRows, key, cum);
    $$('.ty-col', el2).forEach(col => {
      const i = Number(col.dataset.i);
      col.addEventListener('mousemove', evt => {
        const t = tRows[i], hourlyT = tyValue(t, key), hourlyY = tyValue(yRows[i], key);
        const extra = cum ? `<br/><span style="opacity:.7">this hour: ${tyFmt(key, hourlyT)} vs ${tyFmt(key, hourlyY)}</span>` : '';
        Charts.showTip(evt, `<div class="t">${t.label}</div>
          <div class="row"><span><i style="background:var(--amber)"></i>Today</span><b>${tyFmt(key, tv[i])}</b></div>
          <div class="row"><span><i style="background:var(--slate)"></i>Yesterday</span><b>${tyFmt(key, yv[i])}</b></div>${extra}`);
        Charts.moveTip(evt);
      });
      col.addEventListener('mouseleave', Charts.hideTip);
      col.addEventListener('click', () => {
        state.hourlyPin = tRows[i].hour;
        $$('.ty-col', el2).forEach(c => c.classList.toggle('is-pin', c === col));
        renderTYDetail(tRows, yRows);
      });
    });
  }

  function renderHourly(calls, sales) {
    if (!$('#sec-hourly')) return;
    renderExecSummary();
    // Top 3 widgets (Answer Rate heatmap, Sales heatmap, Hourly Detail
    // Table) are pinned to TODAY or YESTERDAY (via the Today/Yesterday
    // toggle) and ignore the filter bar entirely — calls use the Daily
    // Call Center Report's queue criteria, sales are untouched. The
    // comparison strip always shows both days side by side regardless of
    // which one is selected below. The Daily x Hourly Breakdown matrix
    // further down still respects the filter bar (date range/queue/
    // agent/result), since that one is meant for looking back over any
    // range of days.
    const todayStr = DataEngine.todayDateStr();
    const yestStr = DataEngine.yesterdayDateStr();
    const today = DataEngine.todayHourlyStats(todayStr);
    const yesterday = DataEngine.todayHourlyStats(yestStr);
    const selected = state.hourlyDay === 'yesterday' ? yesterday : today;

    renderHourCalls(selected.buckets);
    renderHourSales(selected.buckets);
    renderHourlyTable(selected.buckets);
    renderTYCompare(today.buckets, yesterday.buckets);

    const dayLbl = $('#hourlyDayLabel'); if (dayLbl) dayLbl.textContent = state.hourlyDay === 'yesterday' ? 'Yesterday' : 'Today';
    const lbl = $('#hourlyTodayLabel'); if (lbl) lbl.textContent = selected.dateStr;
    renderDailyMatrix(DataEngine.dailyHourlyMatrix(calls, sales));
  }

  // ---------------- Daily Call Center Report ----------------
  function renderDailyReport(rows) {
    const el2 = $('#tbl_dailyReport'); if (!el2) return;
    if (!rows.length) { el2.innerHTML = '<div class="empty"><b>No data</b>None of the selected calls/sales belong to the reported call-center groups yet.</div>'; return; }
    const grand = rows.reduce((a, r) => { a.totalCalls += r.totalCalls; a.answered += r.answered; a.missed += r.missed; a.sales += r.sales; a.rgu += r.rgu; return a; }, { totalCalls: 0, answered: 0, missed: 0, sales: 0, rgu: 0 });
    const grandPct = grand.totalCalls ? grand.missed / grand.totalCalls * 100 : 0;
    const allProviders = new Map();
    rows.forEach(r => r.providerRows.forEach(p => { if (p.provider === '—') return; const g = allProviders.get(p.provider) || { provider: p.provider, sales: 0, rgu: 0 }; g.sales += p.sales; g.rgu += p.rgu; allProviders.set(p.provider, g); }));
    const grandProviderRows = Array.from(allProviders.values()).sort((a, b) => b.sales - a.sales);

    function dayBlock(r, isTotal) {
      const n = r.providerRows.length;
      return r.providerRows.map((p, i) => `<tr class="${i === 0 ? 'matrix__blockstart ' : ''}${i === n - 1 ? 'matrix__blockend' : ''}${isTotal ? ' matrix__totalrow' : ''}">
        ${i === 0 ? `<td class="matrix__date"${n > 1 ? ` rowspan="${n}"` : ''}><b>${isTotal ? 'Total' : DataEngine.fmtDateFull(r.date)}</b></td>` : ''}
        <td>${escapeHtml(p.provider)}</td>
        <td class="r">${int(p.sales)}</td>
        <td class="r">${int(p.rgu)}</td>
        ${i === 0 ? `
          <td class="r"${n > 1 ? ` rowspan="${n}"` : ''}><b>${int(r.totalCalls)}</b></td>
          <td class="r"${n > 1 ? ` rowspan="${n}"` : ''}><b>${int(r.answered)}</b></td>
          <td class="r"${n > 1 ? ` rowspan="${n}"` : ''}><b>${int(r.missed)}</b></td>
          <td class="r"${n > 1 ? ` rowspan="${n}"` : ''}${missedPctCell(r.missedPct, r.totalCalls > 0)}><b>${r.totalCalls ? pct(r.missedPct, 2) : '—'}</b></td>
        ` : ''}
      </tr>`).join('');
    }

    const html = `<div class="matrixScroll"><table class="tbl matrix">
      <thead><tr>
        <th>Date</th><th>Provider</th><th class="r">Sales</th><th class="r">RGUs</th>
        <th class="r">Total Calls</th><th class="r">Answered</th><th class="r">Missed</th><th class="r">Missed %</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => dayBlock(r, false)).join('')}
        ${dayBlock({ providerRows: grandProviderRows.length ? grandProviderRows.map(p => ({ provider: p.provider, sales: p.sales, rgu: p.rgu })) : [{ provider: '—', sales: 0, rgu: 0 }], totalCalls: grand.totalCalls, answered: grand.answered, missed: grand.missed, missedPct: grandPct }, true)}
      </tbody>
    </table></div>`;
    el2.innerHTML = html;
  }

  // ---------------- Data health ----------------
  function renderDataHealth(calls, sales) {
    const el2 = $('#dataHealth'); if (!el2) return;
    const missingAgent = calls.filter(c => !c.agent).length;
    // Sales rows whose points came back as 0/blank/unreadable from the feed —
    // the row itself is present (counts toward Sales Closed) but contributes
    // nothing to Total Points. If your spreadsheet's Points sum is higher
    // than the dashboard's, this count is where to start looking: sort the
    // Sales table by the "Points" column (ascending) to see these rows, then
    // check their Points cell in the sheet (blank / text / comma-formatted
    // numbers like "1,234" are the usual culprits).
    const zeroPointSales = sales.filter(s => !s.total || Number(s.total) === 0).length;
    const items = [
      ['Rows in range (calls)', int(calls.length)],
      ['Rows in range (sales)', int(sales.length)],
      ['Calls without an agent', int(missingAgent) + ' (' + pct(calls.length ? missingAgent / calls.length * 100 : 0, 0) + ')'],
      ['Sales with 0 points', int(zeroPointSales) + (sales.length ? ' (' + pct(sales.length ? zeroPointSales / sales.length * 100 : 0, 0) + ')' : '')],
      ['Data source', DataEngine.source === 'sample' ? 'Sample export' : 'Live Google Sheet'],
      ['Last refreshed', DataEngine.generatedAt ? new Date(DataEngine.generatedAt).toLocaleString() : '—'],
    ];
    el2.innerHTML = `<dl class="kv">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }

  // ---------------- Filter UI wiring ----------------
  // =====================================================================
  // Weekly Compare — Previous week vs Current week (Mon–Sun)
  // Opens from the "Weekly Compare" button in the filter bar.
  // =====================================================================
  const WC = { open: false, weekStart: null, likeForLike: true, useFilters: true, dayMetric: 'calls', kind: 'agents', metric: 'sales' };

  const WC_METRICS = [
    { key: 'total',     label: 'Total Calls',        fmt: int },
    { key: 'answered',  label: 'Answered Calls',     fmt: int },
    { key: 'ansRate',   label: 'Answer Rate',        fmt: v => pct(v, 1), kind: 'pct' },
    { key: 'abandoned', label: 'Abandoned Calls',    fmt: int, lowerBetter: true },
    { key: 'abRate',    label: 'Abandon Rate',       fmt: v => pct(v, 1), kind: 'pct', lowerBetter: true },
    { key: 'aht',       label: 'Avg Handling Time',  fmt: hms, kind: 'time', neutral: true },
    { key: 'sales',     label: 'Sales Closed',       fmt: int },
    { key: 'rgu',       label: 'RGUs Sold',          fmt: int },
    { key: 'conv',      label: 'Conversion Rate',    fmt: v => pct(v, 2), kind: 'pct' },
    { key: 'points',    label: 'Total Points',       fmt: int },
    { key: 'avgPts',    label: 'Avg Points / Sale',  fmt: v => v.toFixed(1), kind: 'dec' },
  ];

  // What can be compared per group (who/what changed).
  const WC_KINDS = {
    agents:    { label: 'Agents',    metrics: {
      calls:  { label: 'Calls',  src: 'calls', key: c => c.agent, val: () => 1 },
      sales:  { label: 'Sales',  src: 'sales', key: s => s.agent, val: () => 1 },
      points: { label: 'Points', src: 'sales', key: s => s.agent, val: s => s.total || 0 } } },
    queues:    { label: 'Queues',    metrics: {
      calls:     { label: 'Calls',     src: 'calls', key: c => c.queue, val: () => 1 },
      answered:  { label: 'Answered',  src: 'calls', key: c => c.queue, val: c => (c.result === 'Answered' ? 1 : 0) },
      abandoned: { label: 'Abandoned', src: 'calls', key: c => c.queue, val: c => (c.result === 'Abandoned' ? 1 : 0), lowerBetter: true } } },
    providers: { label: 'Providers', metrics: {
      sales: { label: 'Sales', src: 'sales', key: s => s.provider, val: () => 1 },
      rgu:   { label: 'RGUs',  src: 'sales', key: s => s.provider, val: s => s.rgu || 1 } } },
    teams:     { label: 'Teams',     metrics: {
      sales:  { label: 'Sales',  src: 'sales', key: s => s.team, val: () => 1 },
      points: { label: 'Points', src: 'sales', key: s => s.team, val: s => s.total || 0 } } },
    closers:   { label: 'Closers',   metrics: {
      sales:  { label: 'Sales',  src: 'sales', key: s => s.closer, val: () => 1 },
      points: { label: 'Points', src: 'sales', key: s => s.closer, val: s => s.total || 0 } } },
  };

  function wcMonday(dt) { return new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * DataEngine.DAY); }
  function wcWeekList() {
    const { min, max } = DataEngine.bounds, D = DataEngine.DAY, out = [];
    const first = wcMonday(min);
    for (let s = wcMonday(max); s >= first; s = new Date(s.getTime() - 7 * D)) out.push(s);
    return out;
  }
  function wcRanges() {
    const D = DataEngine.DAY, { max } = DataEngine.bounds;
    const cs = WC.weekStart, fullEnd = new Date(cs.getTime() + 5 * D); // week = Mon–Sat (Sunday excluded)
    const ce = fullEnd > max ? max : fullEnd;
    const ps = new Date(cs.getTime() - 7 * D);
    const pe = WC.likeForLike ? new Date(ps.getTime() + (ce.getTime() - cs.getTime())) : new Date(ps.getTime() + 5 * D);
    return { cur: { start: cs, end: ce }, prev: { start: ps, end: pe }, partial: ce < fullEnd };
  }
  const wcSpan = r => `${DataEngine.fmtDateShort(r.start)} – ${DataEngine.fmtDateFull(r.end)}`;
  const wcDays = r => Math.round((r.end.getTime() - r.start.getTime()) / DataEngine.DAY) + 1;

  function wcMetrics(calls, sales) {
    const total = calls.length;
    const ans = calls.filter(c => c.result === 'Answered');
    const abandoned = calls.filter(c => c.result === 'Abandoned').length;
    const aht = ans.length ? ans.reduce((a, c) => a + c.talk + c.hold + c.wrap, 0) / ans.length : 0;
    const nSales = sales.length;
    const rgu = sales.reduce((a, s) => a + (s.rgu || 1), 0);
    const points = sales.reduce((a, s) => a + (s.total || 0), 0);
    return {
      total, answered: ans.length, ansRate: total ? ans.length / total * 100 : 0,
      abandoned, abRate: total ? abandoned / total * 100 : 0, aht,
      sales: nSales, rgu, conv: total ? nSales / total * 100 : 0, points, avgPts: nSales ? points / nSales : 0,
    };
  }

  const wcSign = d => (d > 0 ? '+' : d < 0 ? '−' : '');
  function wcChange(m, cur, prev) {
    const diff = cur - prev;
    const tiny = m.kind === 'pct' ? Math.abs(diff) < 0.05 : (prev ? Math.abs(diff / prev) < 0.005 : diff === 0);
    const dir = tiny ? 0 : (diff > 0 ? 1 : -1);
    let cls = 'flat';
    if (dir !== 0 && !m.neutral) cls = ((m.lowerBetter ? -dir : dir) > 0) ? 'good' : 'bad';
    const a = Math.abs(diff);
    const abs = m.kind === 'pct' ? `${wcSign(dir)}${a.toFixed(1)} pp`
      : m.kind === 'time' ? `${wcSign(dir)}${hms(a)}`
      : m.kind === 'dec' ? `${wcSign(dir)}${a.toFixed(1)}`
      : `${wcSign(dir)}${int(a)}`;
    let rel = '—';
    if (m.kind !== 'pct') {
      const d = DataEngine.pctDelta(cur, prev);
      rel = d === null ? (cur > 0 ? 'New' : '—') : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(0)}%`;
    }
    const arrow = rel === '—' ? '' : (dir > 0 ? '▲ ' : dir < 0 ? '▼ ' : '');
    return { diff, dir, cls, abs, rel, arrow, relNum: prev ? diff / prev : null };
  }
  const wcChipCls = c => (c === 'good' ? 'ty-delta good' : c === 'bad' ? 'ty-delta bad' : 'ty-delta flat');

  function wcAgg(kind, metric, calls, sales) {
    const def = WC_KINDS[kind].metrics[metric];
    const rows = def.src === 'calls' ? calls : sales, m = new Map();
    rows.forEach(r => { const k = def.key(r); if (!k) return; m.set(k, (m.get(k) || 0) + def.val(r)); });
    return m;
  }

  function wcOpen() {
    if (!dataLoaded) return;
    const weeks = wcWeekList();
    if (!WC.weekStart || !weeks.some(w => w.getTime() === WC.weekStart.getTime())) WC.weekStart = weeks[0];
    WC.open = true;
    $('#wcOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#wcLike').checked = WC.likeForLike;
    $('#wcFilters').checked = WC.useFilters;
    renderWeeklyCompare();
  }
  function wcClose() {
    WC.open = false;
    $('#wcOverlay').hidden = true;
    document.body.style.overflow = '';
  }
  function wcShift(dir) { // dir -1 = older, +1 = newer
    const weeks = wcWeekList(); // newest first
    const i = weeks.findIndex(w => w.getTime() === WC.weekStart.getTime());
    const j = Math.min(weeks.length - 1, Math.max(0, i - dir));
    WC.weekStart = weeks[j];
    renderWeeklyCompare();
  }

  function wcData() {
    const R = wcRanges();
    const base = WC.useFilters ? currentFilter() : {};
    const cf = Object.assign({}, base, R.cur), pf = Object.assign({}, base, R.prev);
    // Weekly Compare covers ONLY the reported call-center groups (REPORT_QUEUES in data.js).
    const cCalls = DataEngine.filterCalls(cf).filter(DataEngine.isReportCall), cSales = DataEngine.filterSales(cf).filter(DataEngine.isReportSale);
    const pCalls = DataEngine.filterCalls(pf).filter(DataEngine.isReportCall), pSales = DataEngine.filterSales(pf).filter(DataEngine.isReportSale);
    return { R, cCalls, cSales, pCalls, pSales, cur: wcMetrics(cCalls, cSales), prev: wcMetrics(pCalls, pSales) };
  }

  function renderWeeklyCompare() {
    if (!WC.open) return;
    const weeks = wcWeekList();
    const sel = $('#wcWeek');
    sel.innerHTML = weeks.map((w, i) => {
      const e = new Date(w.getTime() + 5 * DataEngine.DAY);
      return `<option value="${DataEngine.fmtDate(w)}">${DataEngine.fmtDateShort(w)} – ${DataEngine.fmtDateShort(e)}${i === 0 ? '  (latest)' : ''}</option>`;
    }).join('');
    sel.value = DataEngine.fmtDate(WC.weekStart);
    const idx = weeks.findIndex(w => w.getTime() === WC.weekStart.getTime());
    $('#wcNewer').disabled = idx <= 0;
    $('#wcOlder').disabled = idx >= weeks.length - 1;

    const D = wcData();
    const { R, cur, prev } = D;
    const nFilters = WC.useFilters ? ['queues', 'agents', 'results', 'teams', 'providers', 'services'].reduce((a, k) => a + state[k].size, 0) : 0;
    const noPrev = D.pCalls.length === 0 && D.pSales.length === 0;

    // ---- period banner ----
    const banner = `
      <div class="wc__periods">
        <div class="wc__period wc__period--prev"><span class="wc__tag">Previous week</span><b>${wcSpan(R.prev)}</b><small>${wcDays(R.prev)} day${wcDays(R.prev) === 1 ? '' : 's'}${WC.likeForLike && R.partial ? ' · trimmed to match current' : ''}</small></div>
        <div class="wc__vs">vs</div>
        <div class="wc__period wc__period--cur"><span class="wc__tag">Current week</span><b>${wcSpan(R.cur)}</b><small>${wcDays(R.cur)} day${wcDays(R.cur) === 1 ? '' : 's'}${R.partial ? ' · week still in progress' : ''}</small></div>
      </div>
      ${nFilters ? `<div class="wc__note">Dashboard filters applied (${nFilters} selected) — numbers below follow them. Untick "Use dashboard filters" to see everything.</div>` : ''}
      ${noPrev ? `<div class="wc__note wc__note--warn">Previous week ke liye is range mein data nahi mila — comparison zero se ho raha hai.</div>` : ''}`;

    // ---- highlights ----
    const changes = WC_METRICS.map(m => ({ m, c: wcChange(m, cur[m.key], prev[m.key]) }))
      .filter(x => !x.m.neutral && x.m.kind !== 'pct' && x.c.relNum !== null && prev[x.m.key] > 0);
    const goodness = x => (x.m.lowerBetter ? -1 : 1) * x.c.relNum;
    const sorted = changes.slice().sort((a, b) => goodness(b) - goodness(a));
    const best = sorted[0] && goodness(sorted[0]) > 0.005 ? sorted[0] : null;
    const worst = sorted[sorted.length - 1] && goodness(sorted[sorted.length - 1]) < -0.005 ? sorted[sorted.length - 1] : null;
    const hl = card => card ? `<div class="wc__hl wc__hl--${card.cls}"><span>${card.title}</span><b>${card.text}</b></div>` : '';
    const highlights = `<div class="wc__hls">
      ${hl(best ? { cls: 'good', title: 'Biggest improvement', text: `${best.m.label}: ${best.m.fmt(prev[best.m.key])} → ${best.m.fmt(cur[best.m.key])} (${best.c.rel})` } : { cls: 'flat', title: 'Biggest improvement', text: 'Koi clear improvement nahi' })}
      ${hl(worst ? { cls: 'bad', title: 'Needs attention', text: `${worst.m.label}: ${worst.m.fmt(prev[worst.m.key])} → ${worst.m.fmt(cur[worst.m.key])} (${worst.c.rel})` } : { cls: 'flat', title: 'Needs attention', text: 'Koi clear decline nahi' })}
    </div>`;

    // ---- KPI table ----
    const kpiRows = WC_METRICS.map(m => {
      const c = wcChange(m, cur[m.key], prev[m.key]);
      return `<tr>
        <td><b>${m.label}</b></td>
        <td class="r">${m.fmt(prev[m.key])}</td>
        <td class="r"><b>${m.fmt(cur[m.key])}</b></td>
        <td class="r wc__diff wc__diff--${c.cls}">${c.abs}</td>
        <td class="r"><span class="${wcChipCls(c.cls)}">${c.arrow}${c.rel}</span></td>
      </tr>`;
    }).join('');
    const kpiTable = `<section class="wc__sec"><h3>Overall change</h3>
      <div class="wc__scroll"><table class="tbl wc__tbl"><thead><tr><th>Metric</th><th class="r">Previous</th><th class="r">Current</th><th class="r">Change</th><th class="r">% Change</th></tr></thead><tbody>${kpiRows}</tbody></table></div>
      <p class="wc__hint">Green = better, red = worse (Abandoned ke liye kam hona better hai). Rates ka change percentage points (pp) mein hai.</p></section>`;

    // ---- day by day ----
    const D1 = DataEngine.DAY, dn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const tally = (calls, sales) => { const m = new Map(); (WC.dayMetric === 'calls' ? calls : sales).forEach(r => m.set(r.dateStr, (m.get(r.dateStr) || 0) + 1)); return m; };
    const cMap = tally(D.cCalls, D.cSales), pMap = tally(D.pCalls, D.pSales);
    const days = dn.map((label, i) => {
      const cd = new Date(R.cur.start.getTime() + i * D1), pd = new Date(R.prev.start.getTime() + i * D1);
      const cv = cd <= R.cur.end ? (cMap.get(DataEngine.fmtDate(cd)) || 0) : null;
      const pv = pd <= R.prev.end ? (pMap.get(DataEngine.fmtDate(pd)) || 0) : null;
      return { label, cv, pv, cd, pd };
    });
    const dMax = Math.max(1, ...days.map(d => Math.max(d.cv || 0, d.pv || 0)));
    const bar = (v, cls) => v === null ? `<div class="wc__bar wc__bar--na" title="No data"></div>` : `<div class="wc__bar ${cls}" style="height:${Math.max(2, v / dMax * 100)}%"><i>${int(v)}</i></div>`;
    const dayChart = `<section class="wc__sec"><div class="wc__sechead"><h3>Day by day</h3>
      <div class="seg seg--sm" data-wc="dayMetric"><button data-v="calls" aria-pressed="${WC.dayMetric === 'calls'}">Calls</button><button data-v="sales" aria-pressed="${WC.dayMetric === 'sales'}">Sales</button></div></div>
      <div class="wc__legend"><span><i class="wc__sw wc__sw--prev"></i>Previous week</span><span><i class="wc__sw wc__sw--cur"></i>Current week</span></div>
      <div class="wc__days">${days.map(d => `<div class="wc__day"><div class="wc__bars">${bar(d.pv, 'wc__bar--prev')}${bar(d.cv, 'wc__bar--cur')}</div><div class="wc__daylbl"><b>${d.label}</b><small>${DataEngine.fmtDateShort(d.cd)}</small></div></div>`).join('')}</div></section>`;

    // ---- movers ----
    const kindDef = WC_KINDS[WC.kind];
    if (!kindDef.metrics[WC.metric]) WC.metric = Object.keys(kindDef.metrics)[0];
    const mdef = kindDef.metrics[WC.metric];
    const cAgg = wcAgg(WC.kind, WC.metric, D.cCalls, D.cSales), pAgg = wcAgg(WC.kind, WC.metric, D.pCalls, D.pSales);
    const names = new Set([...cAgg.keys(), ...pAgg.keys()]);
    const rows = [...names].map(n => { const c = cAgg.get(n) || 0, p = pAgg.get(n) || 0; return { n, c, p, d: c - p }; });
    const up = rows.filter(r => r.d > 0).sort((a, b) => b.d - a.d).slice(0, 8);
    const down = rows.filter(r => r.d < 0).sort((a, b) => a.d - b.d).slice(0, 8);
    const mm = { lowerBetter: !!mdef.lowerBetter };
    const list = (arr, title) => `<div class="wc__mv"><h4>${title}</h4>${arr.length ? `<ul>${arr.map(r => {
      const ch = wcChange(mm, r.c, r.p);
      return `<li><span class="wc__mvname" title="${escapeHtml(r.n)}">${escapeHtml(r.n)}</span><span class="wc__mvvals">${int(r.p)} → <b>${int(r.c)}</b></span><span class="${wcChipCls(ch.cls)}">${ch.abs}${r.p ? ` · ${ch.rel}` : ''}</span></li>`;
    }).join('')}</ul>` : `<p class="wc__empty">Kuch nahi</p>`}</div>`;
    const movers = `<section class="wc__sec"><div class="wc__sechead"><h3>Who changed?</h3>
      <div class="wc__mvtools">
        <div class="seg seg--sm" data-wc="kind">${Object.entries(WC_KINDS).map(([k, v]) => `<button data-v="${k}" aria-pressed="${WC.kind === k}">${v.label}</button>`).join('')}</div>
        <div class="seg seg--sm" data-wc="metric">${Object.entries(kindDef.metrics).map(([k, v]) => `<button data-v="${k}" aria-pressed="${WC.metric === k}">${v.label}</button>`).join('')}</div>
      </div></div>
      <div class="wc__mvgrid">${list(up, `Increased most · ${mdef.label}`)}${list(down, `Decreased most · ${mdef.label}`)}</div></section>`;

    $('#wcBody').innerHTML = banner + highlights + kpiTable + dayChart + movers;
  }

  function wcExportCsv() {
    if (!WC.open) return;
    const D = wcData();
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Metric', 'Previous week', 'Current week', 'Change', '% Change'].map(q).join(',')];
    WC_METRICS.forEach(m => {
      const c = wcChange(m, D.cur[m.key], D.prev[m.key]);
      lines.push([m.label, m.fmt(D.prev[m.key]), m.fmt(D.cur[m.key]), c.abs, c.rel].map(q).join(','));
    });
    lines.push('', [`Previous: ${wcSpan(D.R.prev)}`, `Current: ${wcSpan(D.R.cur)}`].map(q).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `weekly-compare-${DataEngine.fmtDate(D.R.cur.start)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function wireWeeklyCompare() {
    const btn = $('#btnWeekly'); if (!btn) return;
    btn.addEventListener('click', wcOpen);
    $('#wcClose').addEventListener('click', wcClose);
    $('#wcOverlay').addEventListener('click', e => { if (e.target.id === 'wcOverlay') wcClose(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && WC.open) wcClose(); });
    $('#wcOlder').addEventListener('click', () => wcShift(-1));
    $('#wcNewer').addEventListener('click', () => wcShift(1));
    $('#wcWeek').addEventListener('change', e => {
      const w = wcWeekList().find(x => DataEngine.fmtDate(x) === e.target.value);
      if (w) { WC.weekStart = w; renderWeeklyCompare(); }
    });
    $('#wcLike').addEventListener('change', e => { WC.likeForLike = e.target.checked; renderWeeklyCompare(); });
    $('#wcFilters').addEventListener('change', e => { WC.useFilters = e.target.checked; renderWeeklyCompare(); });
    $('#wcExport').addEventListener('click', wcExportCsv);
    $('#wcBody').addEventListener('click', e => {
      const b = e.target.closest('.seg[data-wc] button'); if (!b) return;
      const g = b.parentElement.dataset.wc;
      if (g === 'dayMetric') WC.dayMetric = b.dataset.v;
      else if (g === 'kind') { WC.kind = b.dataset.v; WC.metric = Object.keys(WC_KINDS[WC.kind].metrics)[0]; }
      else if (g === 'metric') WC.metric = b.dataset.v;
      renderWeeklyCompare();
    });
  }

  function wireStaticUI() {
    wireWeeklyCompare();
    // theme
    $('#themeToggle').addEventListener('click', () => applyTheme(state.theme === 'light' ? 'dark' : 'light', true));

    // date range presets
    $$('.seg[data-group="range"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveSeg('range', btn);
        applyRangePreset(btn.dataset.range);
      });
    });
    $('#dateStart').addEventListener('change', () => { onCustomDate(); });
    $('#dateEnd').addEventListener('change', () => { onCustomDate(); });

    // granularity for trend
    $$('.seg[data-group="gran"] button').forEach(btn => {
      btn.addEventListener('click', () => { setActiveSeg('gran', btn); state.granularity = btn.dataset.gran; renderTrend(DataEngine.filterCalls(currentFilter())); });
    });
    $$('.seg[data-group="trendMetric"] button').forEach(btn => {
      btn.addEventListener('click', () => { setActiveSeg('trendMetric', btn); state.trendMetric = btn.dataset.metric; renderTrend(DataEngine.filterCalls(currentFilter())); });
    });

    // reset
    $('#btnReset').addEventListener('click', resetFilters);

    // export
    $('#btnExport').addEventListener('click', exportCsv);

    // table search
    ['agents', 'queues', 'sales', 'closers', 'leads'].forEach(id => {
      const inp = $(`#search_${id}`);
      if (inp) inp.addEventListener('input', debounce(() => { state.tableSearch[id] = inp.value; state.tablePage[id] = 1; renderAll(); }, 200));
    });

    // top search
    const topSearch = $('#topSearch');
    topSearch.addEventListener('input', debounce(() => renderTopSearch(topSearch.value), 120));
    topSearch.addEventListener('focus', () => renderTopSearch(topSearch.value));
    document.addEventListener('click', evt => {
      if (!evt.target.closest('.search')) $('#searchPanel').hidden = true;
      if (!evt.target.closest('.dd')) $$('.dd__panel').forEach(p => p.remove());
      if (!evt.target.closest('.rel')) $$('.pop').forEach(p => p.hidden = true);
    });

    // notif / connect popovers
    $('#btnNotif').addEventListener('click', e => { e.stopPropagation(); togglePop('#notifPop'); });
    $('#btnConnect').addEventListener('click', e => { e.stopPropagation(); openConnectPanel(); });
    $('#btnConnectSave').addEventListener('click', saveFeedUrl);
    $('#btnConnectClear').addEventListener('click', () => { localStorage.removeItem(DATA_URL_KEY); $('#connectUrl').value = ''; $('#connectPop').hidden = true; bootLoad((window.SC_CONFIG && window.SC_CONFIG.feedUrl) || null); });

    // resize: redraw charts crisp
    window.addEventListener('resize', debounce(() => { if (dataLoaded) renderAll(); }, 200));

    // rail navigation: smooth-scroll to section + track active state
    const railBtns = $$('.rail__btn[data-goto]');
    railBtns.forEach(b => b.addEventListener('click', () => {
      const scoped = state.page === 'groups' || state.page === 'fiber';
      if (!scoped || b.dataset.goto === 'top') switchPage('overview');
      const target = document.getElementById(b.dataset.goto);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const sections = railBtns.map(b => ({ btn: b, el: document.getElementById(b.dataset.goto) })).filter(s => s.el);
    const onScroll = debounce(() => {
      if (state.page !== 'overview') return;
      const y = window.scrollY + 110;
      let active = sections[0];
      sections.forEach(s => { if (s.el.offsetTop <= y) active = s; });
      railBtns.forEach(b => b.removeAttribute('aria-current'));
      active.btn.setAttribute('aria-current', 'page');
    }, 60);
    window.addEventListener('scroll', onScroll);

    // Hourly section (now lives inline on the Overview page — its
    // click nav is handled generically above via data-goto="sec-hourly").
    $$('.seg[data-group="hourlyTz"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveSeg('hourlyTz', btn);
        state.hourlyTZ = btn.dataset.tz;
        renderHourly(DataEngine.filterCalls(currentFilter()), DataEngine.filterSales(currentFilter()));
      });
    });
    $$('.seg[data-group="hourlyDay"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveSeg('hourlyDay', btn);
        state.hourlyDay = btn.dataset.day;
        renderHourly(DataEngine.filterCalls(currentFilter()), DataEngine.filterSales(currentFilter()));
      });
    });

    // Call Center Groups / Fiber pages (same dashboard, scoped to those queues)
    $$('.rail__btn[data-page="groups"], .rail__btn[data-page="fiber"]').forEach(b =>
      b.addEventListener('click', () => switchPage(b.dataset.page)));

    // Closer Performance tab
    const railClosers = $('#rail_closerperf');
    if (railClosers) railClosers.addEventListener('click', () => switchPage('closerperf'));

    // Master Reports tab (pivot tabs from the spreadsheet)
    const railReports = $('#rail_reports');
    if (railReports) railReports.addEventListener('click', () => switchPage('reports'));

    // Lead Gen Performance tab
    const railLeads = $('#rail_leadperf');
    if (railLeads) railLeads.addEventListener('click', () => switchPage('leadperf'));

    // Overview page "View all" buttons on the Closer/Lead Gen previews
    const viewAllClosers = $('#btnViewAllClosers');
    if (viewAllClosers) viewAllClosers.addEventListener('click', () => switchPage('closerperf'));
    const viewAllLeads = $('#btnViewAllLeads');
    if (viewAllLeads) viewAllLeads.addEventListener('click', () => switchPage('leadperf'));
  }

  const SCOPE_META = {
    all:    { title: 'Overview',           sub: 'All queues' },
    groups: { title: 'Groups Calls', sub: '' },
    fiber:  { title: 'Fiber Calls & sales',              sub: '' },
  };

  function switchPage(id) {
    const scope = (id === 'groups' || id === 'fiber') ? id : 'all';
    const scopeChanged = DataEngine.getScope() !== scope;
    state.page = id;
    DataEngine.setScope(scope);
    const setHidden = (sel, val) => { const el2 = $(sel); if (el2) el2.hidden = val; };
    const setCurrent = sel => { const el2 = $(sel); if (el2) el2.setAttribute('aria-current', 'page'); };
    setHidden('#top', !(id === 'overview' || scope !== 'all'));
    setHidden('#page-closers', id !== 'closerperf');
    setHidden('#page-leads', id !== 'leadperf');
    setHidden('#page-reports', id !== 'reports');
    setHidden('.filters', id === 'reports'); // calls/sales filters don't apply to the pivot-tab reports
    $$('.rail__btn[data-goto], .rail__btn[data-page]').forEach(b => b.removeAttribute('aria-current'));
    if (id === 'reports') {
      setCurrent('#rail_reports');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (window.ReportsPage) window.ReportsPage.show();
    } else if (id === 'closerperf') {
      setCurrent('#rail_closerperf');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (id === 'leadperf') {
      setCurrent('#rail_leadperf');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (scope !== 'all') {
      setCurrent(`.rail__btn[data-page="${scope}"]`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setCurrent('.rail__btn[data-goto="top"]');
    }
    renderScopeBar(scope);
    if (scopeChanged && dataLoaded) {
      // a queue picked on one page must not leak into another page's scope
      state.queues.clear();
      populateFilterOptions();
      renderAll();
    }
  }

  function renderScopeBar(scope) {
    const bar = $('#scopeBar'); if (!bar) return;
    if (scope === 'all') { bar.hidden = true; bar.innerHTML = ''; return; }
    const list = scope === 'fiber' ? DataEngine.FIBER_QUEUES : DataEngine.REPORT_QUEUES;
    bar.hidden = false;
    bar.innerHTML = `<div><h2 class="hourlyHead__title">${escapeHtml(SCOPE_META[scope].title)}</h2>`
      + `<p class="hourlyHead__sub">Full dashboard — sirf in ${list.length} queues ka data: calls, sales, agents, hourly sab kuch.</p></div>`
      + `<div class="scopeChips">${list.map(q => `<span class="scopeChip">${escapeHtml(q)}</span>`).join('')}</div>`;
  }

  function togglePop(sel) {
    $$('.pop').forEach(p => { if (p !== $(sel)) p.hidden = true; });
    const p = $(sel); p.hidden = !p.hidden;
  }

  function openConnectPanel() {
    togglePop('#connectPop');
    const cur = (window.SC_CONFIG && window.SC_CONFIG.feedUrl) || localStorage.getItem(DATA_URL_KEY) || '';
    $('#connectUrl').value = cur;
  }
  function saveFeedUrl() {
    const url = $('#connectUrl').value.trim();
    if (!url) return;
    localStorage.setItem(DATA_URL_KEY, url);
    $('#connectPop').hidden = true;
    bootLoad(url, true);
  }

  function setActiveSeg(group, activeBtn) {
    $$(`.seg[data-group="${group}"] button`).forEach(b => b.setAttribute('aria-pressed', b === activeBtn ? 'true' : 'false'));
  }

  function applyRangePreset(preset) {
    const { max } = DataEngine.bounds;
    let start;
    if (preset === 'daily') {
      // Single most-recent day that has data.
      start = max;
    } else if (preset === 'weekly') {
      // Current week (Mon–Sun) that contains the latest data date.
      const dow = max.getUTCDay(); // 0=Sun..6=Sat
      const diffToMonday = (dow + 6) % 7; // days since Monday
      start = new Date(max.getTime() - diffToMonday * DataEngine.DAY);
    } else if (preset === 'monthly') {
      // Month-to-date for the latest data date's month.
      start = new Date(Date.UTC(max.getUTCFullYear(), max.getUTCMonth(), 1));
    } else {
      start = DataEngine.bounds.min;
    }
    state.start = start < DataEngine.bounds.min ? DataEngine.bounds.min : start;
    state.end = max;
    $('#dateStart').value = DataEngine.fmtDate(state.start);
    $('#dateEnd').value = DataEngine.fmtDate(state.end);
    renderAll();
  }
  function onCustomDate() {
    const s = new Date($('#dateStart').value + 'T00:00:00Z');
    const e = new Date($('#dateEnd').value + 'T00:00:00Z');
    if (isNaN(s) || isNaN(e) || s > e) return;
    state.start = s; state.end = e;
    setActiveSeg('range', null);
    renderAll();
  }

  function resetFilters() {
    state.queues.clear(); state.agents.clear(); state.results.clear();
    state.teams.clear(); state.providers.clear(); state.services.clear();
    setupFilterDefaults();
    setActiveSeg('range', $('.seg[data-group="range"] button[data-range="all"]'));
    populateFilterOptions();
    renderAll();
  }

  function toggleFilterValue(key, value) {
    const set = state[key];
    if (set.has(value)) set.delete(value); else set.add(value);
    renderAll();
  }

  function updateFilterChipStates() {
    ['queues', 'agents', 'results', 'teams', 'providers', 'services'].forEach(key => {
      const btn = $(`#dd_${key}_btn`);
      if (!btn) return;
      const set = state[key];
      const valEl = btn.querySelector('.val');
      if (set.size === 0) { btn.classList.remove('is-on'); valEl.textContent = 'All'; }
      else { btn.classList.add('is-on'); valEl.textContent = set.size === 1 ? [...set][0] : set.size + ' selected'; }
    });
  }

  // ---------------- Multi-select dropdown ----------------
  function buildDropdown(key, label, options, countFn) {
    const host = $(`#dd_${key}`);
    if (!host) return;
    host.innerHTML = `<button class="dd__btn" id="dd_${key}_btn"><span class="lbl">${label}:</span><span class="val">All</span>${icon('chevron')}</button>`;
    const btn = $(`#dd_${key}_btn`, host);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      $$('.dd__panel').forEach(p => p.remove());
      const panel = document.createElement('div');
      panel.className = 'dd__panel';
      panel.innerHTML = `
        <input class="dd__search" placeholder="Search ${label.toLowerCase()}…" />
        <div class="dd__list"></div>
        <div class="dd__foot"><button data-act="all">Select all</button><button data-act="none">Clear</button></div>`;
      host.appendChild(panel);
      const list = $('.dd__list', panel);
      function draw(filterTxt) {
        const opts = options.filter(o => !filterTxt || o.toLowerCase().includes(filterTxt.toLowerCase()));
        list.innerHTML = opts.length ? opts.map(o => `
          <label class="dd__opt"><input type="checkbox" value="${escapeAttr(o)}" ${state[key].has(o) ? 'checked' : ''}/><span>${escapeHtml(o)}</span><small>${countFn(o)}</small></label>`).join('')
          : `<div class="dd__empty">No matches</div>`;
        $$('input', list).forEach(cb => cb.addEventListener('change', () => {
          if (cb.checked) state[key].add(cb.value); else state[key].delete(cb.value);
          renderAll();
        }));
      }
      draw('');
      $('.dd__search', panel).addEventListener('input', e2 => draw(e2.target.value));
      $('.dd__search', panel).focus();
      panel.querySelector('[data-act="all"]').addEventListener('click', () => { options.forEach(o => state[key].add(o)); draw($('.dd__search', panel).value); renderAll(); });
      panel.querySelector('[data-act="none"]').addEventListener('click', () => { state[key].clear(); draw($('.dd__search', panel).value); renderAll(); });
      panel.addEventListener('click', e2 => e2.stopPropagation());
    });
  }

  // ---------------- Top search (global) ----------------
  function renderTopSearch(q) {
    const panel = $('#searchPanel');
    if (!q || q.trim().length < 1) { panel.hidden = true; return; }
    const ql = q.toLowerCase();
    const agents = DataEngine.distinctAgents().filter(a => a.toLowerCase().includes(ql)).slice(0, 6);
    const queues = DataEngine.distinctQueues().filter(a => a.toLowerCase().includes(ql)).slice(0, 6);
    if (!agents.length && !queues.length) { panel.innerHTML = `<div class="dd__empty">No matches for “${escapeHtml(q)}”</div>`; panel.hidden = false; return; }
    let html = '';
    if (agents.length) html += `<div class="search__grp">Agents</div>` + agents.map(a => `<button class="search__item" data-type="agents" data-val="${escapeAttr(a)}">${escapeHtml(a)} <small>${DataEngine.calls.filter(c => c.agent === a).length} calls</small></button>`).join('');
    if (queues.length) html += `<div class="search__grp">Queues</div>` + queues.map(a => `<button class="search__item" data-type="queues" data-val="${escapeAttr(a)}">${escapeHtml(a)} <small>${DataEngine.calls.filter(c => c.queue === a).length} calls</small></button>`).join('');
    panel.innerHTML = html; panel.hidden = false;
    $$('.search__item', panel).forEach(b => b.addEventListener('click', () => {
      state[b.dataset.type].add(b.dataset.val);
      $('#topSearch').value = ''; panel.hidden = true; renderAll();
    }));
  }

  // ---------------- Export ----------------
  function exportCsv() {
    const f = currentFilter();
    const calls = DataEngine.filterCalls(f);
    const rows = [['Date', 'Hour', 'Queue', 'Agent', 'Result', 'Wait(s)', 'Talk(s)', 'Hold(s)', 'Wrap(s)', 'Bounces']];
    calls.forEach(c => rows.push([c.dateStr, c.hour, c.queue, c.agent || '', c.result, c.wait, c.talk, c.hold, c.wrap, c.bounces]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `simply-connect-calls_${DataEngine.fmtDate(state.start)}_to_${DataEngine.fmtDate(state.end)}.csv`;
    a.click();
  }

  // ---------------- Theme ----------------
  function applyTheme(theme, persist) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    $('#themeToggle') && ($('#themeToggle').innerHTML = icon(theme === 'light' ? 'moon' : 'sun'));
    if (persist) { localStorage.setItem('sc_theme', theme); if (dataLoaded) renderAll(); }
  }

  // ---------------- Utils ----------------
  function emptyRow() { return `<div class="empty" style="padding:18px 0"><b>No data</b>Nothing matches the current filters.</div>`; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttr(s) { return escapeHtml(s); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function icon(name) {
    const M = {
      phone: '<path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.9 21 3 13.1 3 3.9c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z"/>',
      check: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
      clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      x: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
      cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.6a1.5 1.5 0 0 0 1.5 1.2h7.8a1.5 1.5 0 0 0 1.5-1.2L20 8H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      layers: '<path d="M12 2 2 7l10 5 10-5-10-5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
      target: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
      star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.6 6.1 20.5l1.2-6.5-4.8-4.6 6.6-.9L12 2.5z" fill="currentColor"/>',
      'arrow-up-right': '<path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      search: '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      share: '<circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" stroke="currentColor" stroke-width="1.8"/>',
      refresh: '<path d="M21 12a9 9 0 1 1-3-6.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 3v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      bell: '<path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 17a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="2"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>',
      chart: '<path d="M4 20V10M12 20V4M20 20v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
      users: '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 4.5c1.7.4 3 2 3 3.9 0 1.9-1.3 3.4-3 3.9M20 20c-.6-2.4-1.8-4.1-3.4-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      trend: '<path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      doc: '<path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      tag: '<path d="M3 12.5 12.5 3H20v7.5L10.5 20 3 12.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="16" cy="7" r="1.3" fill="currentColor"/>',
      gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M22 12h-3M5 12H2M19 5l-2 2M7 17l-2 2M19 19l-2-2M7 7 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" fill="currentColor"/>',
      sun: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      chevron: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      alert: '<path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8h.01M11.5 11h1v6h-1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      plug: '<path d="M9 3v5M15 3v5M6 8h12l-1 4a5 5 0 0 1-10 0L6 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none">${M[name] || M.info}</svg>`;
  }
  window.__scIcon = icon;
})();
