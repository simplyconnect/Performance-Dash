/* =========================================================
   Simply Connect – Data Engine
   Loads compact JSON (sample or live Apps Script feed),
   expands it, and exposes filter/aggregate helpers.
   ========================================================= */
const DataEngine = (() => {
  const EPOCH = Date.UTC(1970, 0, 1);
  const DAY = 86400000;

  let raw = null;      // parsed payload
  let calls = [];      // expanded call rows
  let sales = [];       // expanded sale rows
  let bounds = { min: null, max: null };

  function dateFromNum(d) { return new Date(EPOCH + d * DAY); }
  function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
  function fmtDateShort(dt) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function dow(dt) { return dt.getUTCDay(); } // 0 Sun..6 Sat
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function load(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.ok === false) throw new Error(json.error || 'Feed returned an error');
    return ingest(json);
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

  function pctDelta(cur, prev) {
    if (!prev) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return ((cur - prev) / prev) * 100;
  }

  return {
    load, ingest, dateFromNum, fmtDate, fmtDateShort, dow, DOW_LABELS, DAY,
    get calls() { return calls; }, get sales() { return sales; }, get bounds() { return bounds; },
    get meta() { return raw && raw.meta; }, get generatedAt() { return raw && raw.generatedAt; }, get source() { return raw && raw.source; },
    distinctQueues, distinctAgents, distinctResults, distinctTeams, distinctProviders, distinctServices,
    filterCalls, filterSales, prevPeriod, pctDelta,
  };
})();
