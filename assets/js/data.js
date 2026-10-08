/* =========================================================
   Simply Connect – Data Engine
   Loads compact JSON (sample or live Apps Script feed),
   expands it, and exposes filter/aggregate helpers.
   ========================================================= */
const DataEngine = (() => {
  const EPOCH = Date.UTC(1970, 0, 1);
  const DAY = 86400000;

  // ---------------- Daily Call Center Report config ----------------
  const REPORT_QUEUES = [
    'Group 44 Sales', 'Group 48', 'Group 56', 'Group 50 CS', 'Group 42',
    'Group 43', 'Group 41', 'Group 18', 'Group 13 OB CB', 'Group 45 ATT Sales',
    'Group 51', 'Group 54', 'Group 5', 'Group 14 (Spectrum cs call)', 'Group 53',
  ];
  // Abandoned calls from these queues are NEVER counted as "Missed".
  const ABANDON_EXCLUDE_QUEUES = ['Group 10 FB $99', 'Group 13 OB CB', 'Group 18'];

  // ---------------- Page scopes (sidebar buttons) ----------------
  const FIBER_QUEUES = ['Fiber 4', 'Fiber3', 'Fiber Opp', 'Fiber2'];
  let scope = 'all';
  const normQ = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');
  function scopeQueues() { return scope === 'fiber' ? FIBER_QUEUES : scope === 'groups' ? REPORT_QUEUES : null; }
  function setScope(name) { scope = (name === 'groups' || name === 'fiber') ? name : 'all'; }
  function getScope() { return scope; }
  // Fiber page only counts calls with Talk Time >= 2:00.
  const FIBER_MIN_TALK_SEC = 119;
  function talkOk(c) { return scope !== 'fiber' || (Number(c.talk) || 0) > FIBER_MIN_TALK_SEC; }
  function callInScope(c) {
    const list = scopeQueues(); if (!list) return true;
    const q = normQ(c.queue);
    return list.some(x => normQ(x) === q) && talkOk(c);
  }
  // Fiber SALES are identified by "Call Received from Queue Name" (s.queue).
  const FIBER_SALE_QUEUES = ['Fiber Op', 'Fiber Opp'];
  const saleQueueOf = s => s.queue || s.callQueue || s.receivedQueue || '';
  function isFiberSale(s) {
    const q = normQ(saleQueueOf(s));
    return !!q && FIBER_SALE_QUEUES.some(x => normQ(x) === q);
  }
  const FIBER_REQUIRE_LEAD = true;
  const hasLead = s => String(s.lead == null ? '' : s.lead).trim() !== '';

  // FIX: one shared campaign matcher. Exact match, or campaign starts with
  // the queue name and is NOT followed by another digit
  // ("Group 5" matches "Group 5 xyz" but not "Group 50 CS").
  // Before, some places compared only the first word ("Group"), so every
  // campaign starting with "Group" matched every queue.
  function campMatches(camp, name) {
    const c = normQ(camp), n = normQ(name);
    if (!c || !n) return false;
    if (c === n) return true;
    return c.startsWith(n) && !/[0-9]/.test(c.charAt(n.length));
  }
  function saleInScope(s) {
    if (scope === 'fiber') return isFiberSale(s) && (!FIBER_REQUIRE_LEAD || hasLead(s));
    const list = scopeQueues(); if (!list) return true;
    return list.some(x => campMatches(s.campaign, x));
  }
  function inReportScope(queue) {
    return scope === 'fiber' ? FIBER_QUEUES.some(x => normQ(x) === normQ(queue)) : REPORT_QUEUES.includes(queue);
  }
  function saleInReportScope(s) {
    if (scope !== 'all') return saleInScope(s);
    return REPORT_QUEUES.some(g => campMatches(s.campaign, g)); // FIX
  }

  let raw = null;
  let calls = [];
  let sales = [];
  let bounds = { min: null, max: null };

  function dateFromNum(d) { return new Date(EPOCH + d * DAY); }
  function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
  function fmtDateShort(dt) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtDateFull(dt) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function dow(dt) { return dt.getUTCDay(); }
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const LAST_GOOD_KEY = 'sc_last_good_feed';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fetchJson(url, attempts = 3, forceFresh = false) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now() + (forceFresh ? '&nocache=1' : '');
        const res = await fetch(bust, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (json.ok === false) throw new Error(json.error || 'Feed returned an error');
        return json;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(600 * (i + 1));
      }
    }
    throw lastErr;
  }

  async function load(url, forceFresh = false) {
    const json = await fetchJson(url, 3, forceFresh);
    try { localStorage.setItem(LAST_GOOD_KEY, JSON.stringify({ json, savedAt: Date.now() })); } catch (e) { /* ignore */ }
    return ingest(json);
  }

  function loadLastGood() {
    try {
      const cached = JSON.parse(localStorage.getItem(LAST_GOOD_KEY) || 'null');
      if (!cached) return null;
      const info = ingest(cached.json);
      return Object.assign({}, info, { stale: true, savedAt: cached.savedAt });
    } catch (e) { return null; }
  }

  function ingest(json) {
    raw = json;
    const qd = json.calls.dict.queue, ad = json.calls.dict.agent, rd = json.calls.dict.result;
    calls = json.calls.rows.map(r => {
      const dt = dateFromNum(r[0]);
      return {
        date: dt, dateStr: fmtDate(dt), dow: dow(dt),
        hour: r[1], queue: qd[r[2]] || 'Unknown',
        agent: r[3] >= 0 ? ad[r[3]] : null,
        result: rd[r[4]] || 'Unknown',
        wait: r[5], talk: r[6], hold: r[7], wrap: r[8], bounces: r[9],
      };
    });
    sales = ((json.sales && json.sales.rows) || []).map(r => {
      const dt = dateFromNum(r.d);
      return Object.assign({}, r, { date: dt, dateStr: fmtDate(dt), dow: dow(dt) });
    });
    // FIX: Math.min(...bigArray) throws "Maximum call stack size exceeded"
    // on large feeds. Use a plain loop instead.
    let lo = Infinity, hi = -Infinity;
    const track = r => { const t = r.date.getTime(); if (t < lo) lo = t; if (t > hi) hi = t; };
    calls.forEach(track); sales.forEach(track);
    bounds.min = lo === Infinity ? new Date() : new Date(lo);
    bounds.max = hi === -Infinity ? new Date() : new Date(hi);
    return { meta: json.meta, generatedAt: json.generatedAt, source: json.source, bounds };
  }

  function distinctQueues() { return Array.from(new Set(calls.filter(callInScope).map(c => c.queue))).sort(); }
  function distinctAgents() { return Array.from(new Set(calls.map(c => c.agent).filter(Boolean))).sort(); }
  function distinctResults() { return Array.from(new Set(calls.map(c => c.result))).sort(); }
  function distinctTeams() { return Array.from(new Set(sales.map(s => s.team).filter(Boolean))).sort(); }
  function distinctProviders() { return Array.from(new Set(sales.map(s => s.provider).filter(Boolean))).sort(); }
  function distinctServices() { return Array.from(new Set(sales.map(s => s.services).filter(Boolean))).sort(); }

  function inRange(dt, f) { const t = dt.getTime(); return t >= f.start.getTime() && t <= f.end.getTime(); }
  function passSet(v, set) { return !set || set.size === 0 || set.has(v); }

  function saleQueuePass(s, set) {
    if (!set || set.size === 0) return true;
    if (scope === 'fiber') {
      const sq = normQ(saleQueueOf(s)).replace(/^fiberop+$/, 'fiberop');
      return [...set].some(q => normQ(q).replace(/^fiberop+$/, 'fiberop') === sq);
    }
    return set.has(s.campaign) || [...set].some(q => campMatches(s.campaign, q)); // FIX
  }

  function filterCalls(f) {
    return calls.filter(c => inRange(c.date, f) && callInScope(c) && passSet(c.queue, f.queues) && passSet(c.agent, f.agents) && passSet(c.result, f.results));
  }
  function filterSales(f) {
    return sales.filter(s => inRange(s.date, f) && saleInScope(s)
      && saleQueuePass(s, f.queues)
      && passSet(s.agent, f.agents)
      && passSet(s.team, f.teams)
      && passSet(s.provider, f.providers)
      && passSet(s.services, f.services));
  }

  function prevPeriod(f) {
    const span = f.end.getTime() - f.start.getTime();
    const end = new Date(f.start.getTime() - DAY);
    const start = new Date(end.getTime() - span);
    return Object.assign({}, f, { start, end });
  }

  // ---------------- Hourly breakdown ----------------
  function classifyCall(b, c) {
    if (!inReportScope(c.queue)) return;
    b.calls++;
    if (c.result === 'Answered') b.answered++;
    else if (c.result === 'Abandoned' && !ABANDON_EXCLUDE_QUEUES.includes(c.queue)) b.missed++;
  }
  function addSale(b, s) {
    b.sales++;
    b.points += Number(s.total) || 0;
    b.rgu += Number(s.rgu) || 0;
  }
  function finalizeBucket(b) {
    const decided = b.answered + b.missed;
    b.answerRate = decided ? b.answered / decided * 100 : 0;
    b.missedPct = decided ? b.missed / decided * 100 : 0;
  }

  function hourlyStats(filteredCalls, filteredSales) {
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      hour: h, calls: 0, answered: 0, missed: 0, sales: 0, points: 0, rgu: 0,
    }));
    filteredCalls.forEach(c => {
      if (c.hour == null || c.hour < 0 || c.hour > 23) return;
      classifyCall(buckets[c.hour], c);
    });
    (filteredSales || []).forEach(s => {
      if (s.h == null || s.h < 0 || s.h > 23) return;
      addSale(buckets[s.h], s);
    });
    buckets.forEach(finalizeBucket);
    return buckets;
  }

  // FIX: "today"/"yesterday" were mixing UTC (toISOString) with the browser's
  // local date (setDate), so around midnight — and always for a browser in a
  // different timezone — the two could disagree or be a day off. Sheet hours
  // are Central Time, so both now use the same Central calendar date.
  // Change REPORT_TZ if your sheet uses a different timezone.
  const REPORT_TZ = 'America/Chicago';
  function dateStrInTz(ms) {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: REPORT_TZ }); // YYYY-MM-DD
  }
  function todayDateStr() { return dateStrInTz(Date.now()); }
  function yesterdayDateStr() { return dateStrInTz(Date.now() - DAY); }

  function todayHourlyStats(dateStr) {
    const day = dateStr || todayDateStr();
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      hour: h, calls: 0, answered: 0, missed: 0, sales: 0, points: 0, rgu: 0,
    }));
    calls.forEach(c => {
      if (c.dateStr !== day || !inReportScope(c.queue) || !talkOk(c)) return;
      if (c.hour == null || c.hour < 0 || c.hour > 23) return;
      const b = buckets[c.hour];
      b.calls++;
      if (c.result === 'Answered') b.answered++;
      else if (c.result === 'Abandoned' && !ABANDON_EXCLUDE_QUEUES.includes(c.queue)) b.missed++;
    });
    sales.forEach(s => {
      if (s.dateStr !== day || !saleInScope(s)) return;
      if (s.h == null || s.h < 0 || s.h > 23) return;
      addSale(buckets[s.h], s);
    });
    buckets.forEach(finalizeBucket);
    return { dateStr: day, buckets };
  }

  // ---------------- Daily x Hourly matrix ----------------
  function dailyHourlyMatrix(filteredCalls, filteredSales) {
    const days = new Map();
    function ensureDay(dateStr, date) {
      let d = days.get(dateStr);
      if (!d) {
        d = {
          dateStr, date,
          buckets: Array.from({ length: 24 }, (_, h) => ({
            hour: h, calls: 0, answered: 0, missed: 0, sales: 0, points: 0, rgu: 0,
          })),
        };
        days.set(dateStr, d);
      }
      return d;
    }
    filteredCalls.forEach(c => {
      if (c.hour == null || c.hour < 0 || c.hour > 23) return;
      const day = ensureDay(c.dateStr, c.date);
      classifyCall(day.buckets[c.hour], c);
    });
    (filteredSales || []).forEach(s => {
      if (s.h == null || s.h < 0 || s.h > 23) return;
      const day = ensureDay(s.dateStr, s.date);
      addSale(day.buckets[s.h], s);
    });
    const rows = Array.from(days.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    rows.forEach(day => {
      day.buckets.forEach(finalizeBucket);
      const t = { calls: 0, answered: 0, missed: 0, sales: 0, points: 0, rgu: 0 };
      day.buckets.forEach(b => { t.calls += b.calls; t.answered += b.answered; t.missed += b.missed; t.sales += b.sales; t.points += b.points; t.rgu += b.rgu; });
      finalizeBucket(t);
      day.totals = t;
    });
    return rows;
  }

  // FIX: the old `if (!prev) return null;` ran first, so the next line
  // (prev === 0 -> cur === 0 ? 0 : null) could never execute and 0 -> 0
  // showed "no data" instead of 0%.
  function pctDelta(cur, prev) {
    if (prev === 0 || prev == null) return cur === 0 ? 0 : null;
    return ((cur - prev) / prev) * 100;
  }

  const isReportCall = c => inReportScope(c.queue)
    && !(c.result === 'Abandoned' && ABANDON_EXCLUDE_QUEUES.includes(c.queue));
  const isReportSale = s => saleInReportScope(s);

  // ---------------- Daily Call Center Report ----------------
  function dailyReport(filteredCalls, filteredSales) {
    const inReport = c => inReportScope(c.queue);
    const salesInReport = s => saleInReportScope(s);

    const days = new Map();
    function ensureDay(dateStr, date) {
      let d = days.get(dateStr);
      if (!d) { d = { dateStr, date, calls: 0, answered: 0, missed: 0, providers: new Map() }; days.set(dateStr, d); }
      return d;
    }
    function ensureProvider(day, name) {
      let p = day.providers.get(name);
      if (!p) { p = { provider: name, sales: 0, points: 0, rgu: 0 }; day.providers.set(name, p); }
      return p;
    }
    filteredCalls.forEach(c => {
      if (!inReport(c)) return;
      const day = ensureDay(c.dateStr, c.date);
      day.calls++;
      if (c.result === 'Answered') day.answered++;
      else if (c.result === 'Abandoned' && !ABANDON_EXCLUDE_QUEUES.includes(c.queue)) day.missed++;
    });
    (filteredSales || []).forEach(s => {
      if (!salesInReport(s)) return;
      const day = ensureDay(s.dateStr, s.date);
      const p = ensureProvider(day, s.provider || 'Unknown');
      p.sales++;
      p.points += Number(s.total) || 0;
      p.rgu += Number(s.rgu) || 0;
    });
    const rows = Array.from(days.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    rows.forEach(d => {
      d.totalCalls = d.answered + d.missed;
      d.missedPct = d.totalCalls ? d.missed / d.totalCalls * 100 : 0;
      d.providerRows = Array.from(d.providers.values()).sort((a, b) => b.sales - a.sales);
      d.sales = d.providerRows.reduce((a, p) => a + p.sales, 0);
      d.points = d.providerRows.reduce((a, p) => a + p.points, 0);
      d.rgu = d.providerRows.reduce((a, p) => a + p.rgu, 0);
      if (!d.providerRows.length) d.providerRows = [{ provider: '—', sales: 0, points: 0, rgu: 0 }];
    });
    return rows;
  }

  return {
    load, loadLastGood, ingest, dateFromNum, fmtDate, fmtDateShort, fmtDateFull, dow, DOW_LABELS, DAY,
    get calls() { return calls; }, get sales() { return sales; }, get bounds() { return bounds; },
    get meta() { return raw && raw.meta; }, get generatedAt() { return raw && raw.generatedAt; }, get source() { return raw && raw.source; },
    distinctQueues, distinctAgents, distinctResults, distinctTeams, distinctProviders, distinctServices,
    filterCalls, filterSales, prevPeriod, pctDelta, hourlyStats, dailyHourlyMatrix, dailyReport,
    todayDateStr, yesterdayDateStr, todayHourlyStats, REPORT_QUEUES, FIBER_QUEUES, FIBER_SALE_QUEUES, isFiberSale, setScope, getScope, isReportCall, isReportSale, ABANDON_EXCLUDE_QUEUES,
  };
})();
