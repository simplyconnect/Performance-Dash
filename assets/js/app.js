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
    tablePage: { agents: 1, queues: 1, sales: 1 },
    tableSort: { agents: { key: 'perf', dir: 'desc' }, queues: { key: 'calls', dir: 'desc' }, sales: { key: 'd', dir: 'desc' } },
    tableSearch: { agents: '', queues: '', sales: '' },
    hourlyTZ: 'ct', // ct | pkt
    page: 'overview', // overview | hourly
  };

  // ---------------- Boot ----------------
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    applyTheme(state.theme, false);
    wireStaticUI();
    const feedUrl = (window.SC_CONFIG && window.SC_CONFIG.feedUrl) || localStorage.getItem(DATA_URL_KEY) || DEFAULT_FEED;
    await bootLoad(feedUrl);
  }

  async function bootLoad(feedUrl) {
    showBoot(true);
    dataLoaded = false;
    if (!feedUrl) {
      showNotConnected();
      clearStage();
      showBoot(false);
      return;
    }
    try {
      await DataEngine.load(feedUrl);
      showSourceBanner('live', feedUrl);
    } catch (err) {
      console.error(err);
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
    const rb = $('#btnRefresh'); if (rb) rb.addEventListener('click', () => bootLoad(url));
  }

  function showSourceBanner(kind, url) {
    const el2 = $('#dataBanner');
    el2.innerHTML = `<div class="banner banner--ok">${icon('check')}<div><b>Connected.</b> Live data from your Google Sheet${DataEngine.generatedAt ? ' · updated ' + timeAgo(DataEngine.generatedAt) : ''}.</div>
      <button class="btn btn--ghost" id="btnRefresh">${icon('refresh')} Refresh</button></div>`;
    const rb = $('#btnRefresh'); if (rb) rb.addEventListener('click', () => bootLoad((window.SC_CONFIG && window.SC_CONFIG.feedUrl) || localStorage.getItem(DATA_URL_KEY)));
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
    renderHeatmap(calls);
    renderSalesKpis(sales, pSales);
    renderSalesByProvider(sales);
    renderSalesByTeam(sales);
    renderSalesTable(sales);
    renderDataHealth(calls, sales);
    renderDailyReport(DataEngine.dailyReport(calls, sales));
    renderHourly(calls, sales);
    updateFilterChipStates();
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
    if (granularity === 'daily') return DataEngine.fmtDate(dt);
    if (granularity === 'monthly') return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
    // weekly: ISO-ish week start (Sunday)
    const d = new Date(dt);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return DataEngine.fmtDate(d);
  }
  function bucketLabel(key, granularity) {
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
    if (search) rows = rows.filter(r => [r.agent, r.closer, r.provider, r.team, r.state, r.campaign].filter(Boolean).join(' ').toLowerCase().includes(search));
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

  function renderHourly(calls, sales) {
    if (!$('#page-hourly')) return;
    // Top 3 widgets (Answer Rate heatmap, Sales heatmap, Hourly Detail
    // Table) are pinned to TODAY and ignore the filter bar entirely —
    // calls use the Daily Call Center Report's queue criteria, sales
    // are untouched. The Daily x Hourly Breakdown matrix below still
    // respects the filter bar (date range/queue/agent/result), since
    // that one is meant for looking back over any range of days.
    const today = DataEngine.todayHourlyStats();
    renderHourCalls(today.buckets);
    renderHourSales(today.buckets);
    renderHourlyTable(today.buckets);
    const lbl = $('#hourlyTodayLabel'); if (lbl) lbl.textContent = today.dateStr;
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
        ${i === 0 ? `<td class="matrix__date"${n > 1 ? ` rowspan="${n}"` : ''}><b>${isTotal ? 'Total' : DataEngine.fmtDateShort(r.date)}</b></td>` : ''}
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
    const items = [
      ['Rows in range (calls)', int(calls.length)],
      ['Rows in range (sales)', int(sales.length)],
      ['Calls without an agent', int(missingAgent) + ' (' + pct(calls.length ? missingAgent / calls.length * 100 : 0, 0) + ')'],
      ['Data source', DataEngine.source === 'sample' ? 'Sample export' : 'Live Google Sheet'],
      ['Last refreshed', DataEngine.generatedAt ? new Date(DataEngine.generatedAt).toLocaleString() : '—'],
    ];
    el2.innerHTML = `<dl class="kv">${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  }

  // ---------------- Filter UI wiring ----------------
  function wireStaticUI() {
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
    ['agents', 'queues', 'sales'].forEach(id => {
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
      switchPage('overview');
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

    // Hourly tab
    $('#rail_hourly').addEventListener('click', () => switchPage('hourly'));
    $$('.seg[data-group="hourlyTz"] button').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveSeg('hourlyTz', btn);
        state.hourlyTZ = btn.dataset.tz;
        renderHourly(DataEngine.filterCalls(currentFilter()), DataEngine.filterSales(currentFilter()));
      });
    });
  }

  function switchPage(id) {
    state.page = id;
    $('#top').hidden = id !== 'overview';
    $('#page-hourly').hidden = id !== 'hourly';
    $$('.rail__btn[data-goto], .rail__btn[data-page]').forEach(b => b.removeAttribute('aria-current'));
    if (id === 'hourly') {
      $('#rail_hourly').setAttribute('aria-current', 'page');
      renderHourly(DataEngine.filterCalls(currentFilter()), DataEngine.filterSales(currentFilter()));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      $('.rail__btn[data-goto="top"]').setAttribute('aria-current', 'page');
    }
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
    bootLoad(url);
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
