/* =========================================================
   Simply Connect – Data Engine
   Loads compact JSON (sample or live Apps Script feed),
   expands it, and exposes filter/aggregate helpers.
   ========================================================= */
const DataEngine = (() => {
  const EPOCH = Date.UTC(1970, 0, 1);
  const DAY = 86400000;

  // ---------------- Daily Call Center Report config ----------------
  // Only these queues ("Call Center" column) count toward the Daily
  // report. Edit this list any time your groups change.
  const REPORT_QUEUES = [
    'Group 44 Sales', 'Group 48', 'Group 56', 'Group 50 CS', 'Group 42',
    'Group 43', 'Group 41', 'Group 18', 'Group 13 OB CB', 'Group 45 ATT Sales',
    'Group 51', 'Group 54', 'Group 5', 'Group 14 (Spectrum cs call)', 'Group 53',
  ];
  // Abandoned calls from these queues are NEVER counted as "Missed" — even
  // though Group 13 OB CB and Group 18 are also in REPORT_QUEUES above
  // (their calls/answered/sales still count, only their abandons don't).
  const ABANDON_EXCLUDE_QUEUES = ['Group 10 FB $99', 'Group 13 OB CB', 'Group 18'];

  let raw = null;      // parsed payload
  let calls = [];      // expanded call rows
  let sales = [];       // expanded sale rows
  let bounds = { min: null, max: null };

  function dateFromNum(d) { return new Date(EPOCH + d * DAY); }
  function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
  function fmtDateShort(dt) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtDateFull(dt) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function dow(dt) { return dt.getUTCDay(); } // 0 Sun..6 Sat
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Apps Script Web App URLs (script.google.com/.../exec) are served through
  // a shared script.googleusercontent.com "echo" layer that can — especially
  // right after a fresh deploy, or under concurrent/rapid requests — return
  // a transient 404, or occasionally hand back a stale cached response
  // instead of the latest sheet data. Two things fix both symptoms:
  //   1. A unique cache-busting query param on every request, so neither the
  //      browser nor any edge layer can serve back an old response.
  //   2. A few retries with backoff before we give up — a 404 here is very
  //      often gone if you just ask again a second later.
  const LAST_GOOD_KEY = 'sc_last_good_feed';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fetchJson(url, attempts = 3, forceFresh = false) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        // nocache=1 tells Code.gs's doGet() to skip its own 2-minute
        // CacheService read and pull straight from the sheet — without this,
        // Apps Script can hand back the same response for up to 120s no
        // matter how many times (or how hard) the frontend re-requests it.
        const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now() + (forceFresh ? '&nocache=1' : '');
        const res = await fetch(bust, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (json.ok === false) throw new Error(json.error || 'Feed returned an error');
        return json;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(600 * (i + 1)); // 600ms, then 1200ms
      }
    }
    throw lastErr;
  }

  async function load(url, forceFresh = false) {
    const json = await fetchJson(url, 3, forceFresh);
    try { localStorage.setItem(LAST_GOOD_KEY, JSON.stringify({ json, savedAt: Date.now() })); } catch (e) { /* storage full/unavailable — ignore */ }
    return ingest(json);
  }

  // Fallback used by app.js when a live fetch fails after retries — lets the
  // dashboard keep showing the last successful pull instead of going blank.
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
    sales = (json.sales.rows || []).map(r => {
      const dt = dateFromNum(r.d);
      return Object.assign({}, r, { date: dt, dateStr: fmtDate(dt), dow: dow(dt) });
    });
    const allDates = calls.map(c => c.date.getTime()).concat(sales.map(s => s.date.getTime()));
    bounds.min = allDates.length ? new Date(Math.min(...allDates)) : new Date();
    bounds.max = allDates.length ? new Date(Math.max(...allDates)) : new Date();
    return { meta: json.meta, generatedAt: json.generatedAt, source: json.source, bounds };
  }

  function distinctQueues() { return Array.from(new Set(calls.map(c => c.queue))).sort(); }
  function distinctAgents() { return Array.from(new Set(calls.map(c => c.agent).filter(Boolean))).sort(); }
  function distinctResults() { return Array.from(new Set(calls.map(c => c.result))).sort(); }
  function distinctTeams() { return Array.from(new Set(sales.map(s => s.team).filter(Boolean))).sort(); }
  function distinctProviders() { return Array.from(new Set(sales.map(s => s.provider).filter(Boolean))).sort(); }
  function distinctServices() { return Array.from(new Set(sales.map(s => s.services).filter(Boolean))).sort(); }

  // filters: { start, end (Date, inclusive, UTC midnight),
  //   queues/agents/results:Set|null (apply to calls),
  //   teams/providers/services:Set|null (apply to sales only — calls rows don't carry these fields) }
  function inRange(dt, f) { const t = dt.getTime(); return t >= f.start.getTime() && t <= f.end.getTime(); }
  function passSet(v, set) { return !set || set.size === 0 || set.has(v); }

  function filterCalls(f) {
    return calls.filter(c => inRange(c.date, f) && passSet(c.queue, f.queues) && passSet(c.agent, f.agents) && passSet(c.result, f.results));
  }
  function filterSales(f) {
    return sales.filter(s => inRange(s.date, f)
      && (!f.queues || f.queues.size === 0 || f.queues.has(s.campaign) || [...f.queues].some(q => (s.campaign || '').startsWith(q.split(' ')[0])))
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

  // ---------------- Hourly breakdown (calls + sales, 0-23 = the hour value
  // already parsed out of the sheet's "Time Frame" / "Timestamp" columns) ----
  // "Missed" = Call Result === 'Abandoned' only (not every non-Answered
  // result — Overflow/Stranded/Escaped/Transferred are neither). "Answered"
  // = Call Result === 'Answered'. Both counts (and the two percentages
  // below) are restricted to REPORT_QUEUES — the same call-center queue
  // group used by the Daily Call Center Report — and Abandoned calls from
  // ABANDON_EXCLUDE_QUEUES never count as Missed. This keeps the Hourly
  // page and the Daily × Hourly Breakdown in sync with that report instead
  // of counting every queue.
  // answerRate / missedPct are both out of the *decided* calls only
  // (Answered + Missed — calls still ringing/transferred/etc. are excluded
  // from the denominator), so the two always add up to 100%:
  //   answerRate = Answered / (Answered + Missed) × 100
  //   missedPct  = Missed   / (Answered + Missed) × 100
  function classifyCall(b, c) {
    if (!REPORT_QUEUES.includes(c.queue)) return;
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

  // "Today", independent of anything picked in the top filter bar — the
  // real calendar date, so this always rolls forward on its own at
  // midnight. Calls use the same criteria as the Daily Call Center Report
  // (REPORT_QUEUES only, Missed never counts ABANDON_EXCLUDE_QUEUES).
  // Sales are every sale logged today — no queue restriction, since that
  // side of the sheet was already correct.
  function todayDateStr() { return new Date().toISOString().slice(0, 10); }
  function yesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function todayHourlyStats(dateStr) {
    const day = dateStr || todayDateStr();
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      hour: h, calls: 0, answered: 0, missed: 0, sales: 0, points: 0, rgu: 0,
    }));
    calls.forEach(c => {
      if (c.dateStr !== day || !REPORT_QUEUES.includes(c.queue)) return;
      if (c.hour == null || c.hour < 0 || c.hour > 23) return;
      const b = buckets[c.hour];
      b.calls++;
      if (c.result === 'Answered') b.answered++;
      else if (c.result === 'Abandoned' && !ABANDON_EXCLUDE_QUEUES.includes(c.queue)) b.missed++;
    });
    sales.forEach(s => {
      if (s.dateStr !== day) return;
      if (s.h == null || s.h < 0 || s.h > 23) return;
      addSale(buckets[s.h], s);
    });
    buckets.forEach(finalizeBucket);
    return { dateStr: day, buckets };
  }

  // ---------------- Daily x Hourly matrix (one row-group per calendar date,
  // one column per hour) — powers the "Sales / Answered / Missed / Missed %"
  // breakdown table. Dates come from the calls' own date field, hours are
  // the same raw 0-23 (Central Time) bucket used everywhere else, so this
  // stays in sync with the single-range Hourly page and the KPI cards. ----
  function dailyHourlyMatrix(filteredCalls, filteredSales) {
    const days = new Map(); // dateStr -> { dateStr, date, buckets[24] }
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

  function pctDelta(cur, prev) {
    if (!prev) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return ((cur - prev) / prev) * 100;
  }

  // ---------------- Daily Call Center Report ----------------
  // One row-group per calendar date, restricted to REPORT_QUEUES only.
  // Missed (Abandoned) never counts calls from ABANDON_EXCLUDE_QUEUES,
  // whether or not that queue is itself part of REPORT_QUEUES.
  // "Total Calls" = Answered + Missed only (matches the sheet's "# of
  // Calls" column) — NOT every call in the queue, since some results
  // (Overflow/Transferred/etc.) are neither answered nor missed.
  // Sales are also broken down by Provider (one sub-row per provider that
  // had a sale that day) since calls have no provider of their own.
  function dailyReport(filteredCalls, filteredSales) {
    const inReport = c => REPORT_QUEUES.includes(c.queue);
    const salesInReport = s => REPORT_QUEUES.includes(s.campaign)
      || REPORT_QUEUES.some(g => (s.campaign || '').startsWith(g.split(' ')[0]));

    const days = new Map(); // dateStr -> row
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
    todayDateStr, yesterdayDateStr, todayHourlyStats, REPORT_QUEUES, ABANDON_EXCLUDE_QUEUES,
  };
})();
