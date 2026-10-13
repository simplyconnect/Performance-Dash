/* =========================================================
   Simply Connect – Fiber Agent Scorecard
   Sirf "Fiber Calls & Sales" page par dikhta hai.

   Calls : calls Data tab  -> queue = Fiber 4 / Fiber3 / Fiber Opp / Fiber2
                              (Talk Time > 1:59 — DataEngine pehle hi filter kar deta hai)
   Sales : Fiber sales     -> agent-wise sales / RGU / points / daily counts

   app.js renderAll() se call hota hai:
       FiberAgents.render(filteredCalls, filteredSales, isFiberPage)
   ========================================================= */
window.FiberAgents = (() => {
  'use strict';

  const QUEUES = ['Fiber 4', 'Fiber3', 'Fiber Opp', 'Fiber2'];
  const PAGE_SIZE = 15;
  const MIN_CALLS_FOR_CONV = 20; // "Best conversion" ke liye minimum calls

  const ui = {
    view: 'score',            // score | matrix
    search: '',
    page: 1,
    sort: { key: 'sales', dir: 'desc' },
    wired: false,
  };
  let last = { calls: [], sales: [], on: false };

  const $ = s => document.querySelector(s);
  const int = n => Math.round(n || 0).toLocaleString('en-US');
  const pct = n => (isFinite(n) ? n.toFixed(1) : '0.0') + '%';
  const mmss = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
  const normQ = v => norm(v).replace(/\s+/g, '');
  const QKEYS = QUEUES.map(normQ);

  const AVA = ['#5240D6', '#3F49B8', '#B23FA8', '#E5484D', '#FDAC00', '#2FA352', '#2B83C6', '#9A6A3A'];
  function avaColor(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return AVA[h % AVA.length]; }
  function initials(name) { const p = String(name).trim().split(/\s+/); return ((p[0] || '')[0] || '').toUpperCase() + ((p[1] || '')[0] || '').toUpperCase() || '?'; }

  // ---------------- Aggregation ----------------
  function build(calls, sales) {
    const map = new Map();
    const ensure = name => {
      const k = norm(name);
      let r = map.get(k);
      if (!r) {
        r = { key: k, agent: String(name).trim(), q: [0, 0, 0, 0], calls: 0, talk: 0, hold: 0, wrap: 0,
              sales: 0, rgu: 0, points: 0, days: new Set(), byDay: new Map() };
        map.set(k, r);
      }
      return r;
    };
    calls.forEach(c => {
      if (!c.agent) return;
      const r = ensure(c.agent);
      r.calls++; r.talk += c.talk || 0; r.hold += c.hold || 0; r.wrap += c.wrap || 0;
      const qi = QKEYS.indexOf(normQ(c.queue)); if (qi >= 0) r.q[qi]++;
      r.days.add(c.dateStr);
    });
    sales.forEach(s => {
      if (!s.agent) return;
      const r = ensure(s.agent);
      r.sales++; r.rgu += Number(s.rgu) || 0; r.points += Number(s.total) || 0;
      r.days.add(s.dateStr);
      r.byDay.set(s.dateStr, (r.byDay.get(s.dateStr) || 0) + 1);
    });
    const rows = Array.from(map.values()).map(r => ({
      ...r,
      activeDays: r.days.size,
      avgTalk: r.calls ? r.talk / r.calls : 0,
      aht: r.calls ? (r.talk + r.hold + r.wrap) / r.calls : 0,
      conv: r.calls ? r.sales / r.calls * 100 : 0,
      callsPerDay: r.days.size ? r.calls / r.days.size : 0,
    }));
    const dates = Array.from(new Set(sales.map(s => s.dateStr))).sort();
    return { rows, dates };
  }

  // ---------------- Pieces ----------------
  function sparkline(r, dates) {
    if (!dates.length) return '';
    const W = 84, H = 24, pad = 2;
    const vals = dates.map(d => r.byDay.get(d) || 0);
    const max = Math.max(...vals, 1);
    const step = dates.length > 1 ? (W - pad * 2) / (dates.length - 1) : 0;
    const pts = vals.map((v, i) => `${(pad + i * step).toFixed(1)},${(H - pad - v / max * (H - pad * 2)).toFixed(1)}`).join(' ');
    return `<svg class="fa-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--violet)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function convPill(r) {
    if (!r.calls) return '<span class="mut">—</span>';
    const cls = r.conv >= 15 ? 'good' : r.conv >= 8 ? 'mid' : 'low';
    return `<span class="fa-pill fa-pill--${cls}">${pct(r.conv)}</span>`;
  }

  function medal(i) { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1); }

  function tiles(rows) {
    const active = rows.filter(r => r.calls || r.sales);
    const top = [...rows].sort((a, b) => b.sales - a.sales || b.calls - a.calls)[0];
    const topCalls = [...rows].sort((a, b) => b.calls - a.calls)[0];
    const elig = rows.filter(r => r.calls >= MIN_CALLS_FOR_CONV && r.sales > 0).sort((a, b) => b.conv - a.conv)[0];
    const totalSales = rows.reduce((a, r) => a + r.sales, 0);
    const sellers = rows.filter(r => r.sales > 0).length;
    const t = (label, value, hint) => `<div class="tile"><div class="tile__label">${label}</div><div class="tile__value fa-tile__v">${value}</div><div class="tile__hint">${hint}</div></div>`;
    return t('Active agents', int(active.length), `${int(sellers)} ne sale ki`)
      + t('Top seller', top && top.sales ? esc(top.agent) : '—', top && top.sales ? `${int(top.sales)} sales · ${int(top.rgu)} RGUs` : 'No sales')
      + t('Best conversion', elig ? esc(elig.agent) : '—', elig ? `${pct(elig.conv)} · min ${MIN_CALLS_FOR_CONV} calls` : `min ${MIN_CALLS_FOR_CONV} calls chahiye`)
      + t('Avg sales / seller', sellers ? (totalSales / sellers).toFixed(1) : '0', topCalls && topCalls.calls ? `Most calls: ${esc(topCalls.agent)} (${int(topCalls.calls)})` : '');
  }

  // ---------------- Scorecard ----------------
  const COLS = [
    { key: 'rank', label: '#', sortable: false, cls: 'rank' },
    { key: 'agent', label: 'Agent', cls: 'grow' },
    { key: 'q0', label: 'Fiber 4', cls: 'r', sortable: false },
    { key: 'q1', label: 'Fiber3', cls: 'r', sortable: false },
    { key: 'q2', label: 'Fiber Opp', cls: 'r', sortable: false },
    { key: 'q3', label: 'Fiber2', cls: 'r', sortable: false },
    { key: 'calls', label: 'Total Calls', cls: 'r' },
    { key: 'avgTalk', label: 'Avg Talk', cls: 'r' },
    { key: 'aht', label: 'AHT', cls: 'r' },
    { key: 'sales', label: 'Sales', cls: 'r' },
    { key: 'conv', label: 'Sales %', cls: 'r' },
    { key: 'rgu', label: 'RGUs', cls: 'r' },
    { key: 'points', label: 'Points', cls: 'r' },
    { key: 'activeDays', label: 'Active Days', cls: 'r' },
    { key: 'trend', label: 'Sales Trend', sortable: false },
  ];

  function sortRows(rows) {
    const { key, dir } = ui.sort;
    const m = dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      if (key === 'agent') return a.agent.localeCompare(b.agent) * m;
      const d = ((a[key] || 0) - (b[key] || 0)) * m;
      return d || (b.sales - a.sales) || (b.calls - a.calls) || a.agent.localeCompare(b.agent);
    });
  }

  function renderScore(rows, dates) {
    const wrap = $('#fa_body');
    if (!rows.length) { wrap.innerHTML = '<div class="empty"><b>Koi agent activity nahi</b>Date range ya filters change karke dekhein.</div>'; $('#fa_pager').innerHTML = ''; return; }
    const q = ui.search.trim().toLowerCase();
    let list = q ? rows.filter(r => r.agent.toLowerCase().includes(q)) : rows.slice();
    sortRows(list);
    const totals = list.reduce((t, r) => {
      t.calls += r.calls; t.sales += r.sales; t.rgu += r.rgu; t.points += r.points; t.talk += r.talk; t.hold += r.hold; t.wrap += r.wrap;
      r.q.forEach((v, i) => { t.q[i] += v; }); return t;
    }, { calls: 0, sales: 0, rgu: 0, points: 0, talk: 0, hold: 0, wrap: 0, q: [0, 0, 0, 0] });
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    ui.page = Math.min(ui.page, pages);
    const start = (ui.page - 1) * PAGE_SIZE;
    const pageRows = list.slice(start, start + PAGE_SIZE);
    const maxCalls = Math.max(...list.map(r => r.calls), 1);
    const maxSales = Math.max(...list.map(r => r.sales), 1);

    const head = COLS.map(c => `<th data-key="${c.key}" class="${c.sortable === false ? '' : 'sortable'} ${c.cls || ''}" ${ui.sort.key === c.key ? `data-dir="${ui.sort.dir}"` : ''}>${c.label}</th>`).join('');
    const body = pageRows.map((r, i) => `<tr>
      <td class="rank">${medal(start + i)}</td>
      <td class="grow"><span class="agentcell"><span class="agentava" style="background:${avaColor(r.agent)}">${esc(initials(r.agent))}</span><span><b class="fa-name">${esc(r.agent)}</b><small class="fa-sub">${int(r.callsPerDay)} calls/day</small></span></span></td>
      ${r.q.map(v => `<td class="r${v ? '' : ' mut'}">${v ? int(v) : '–'}</td>`).join('')}
      <td class="r"><span class="fa-bar"><i style="width:${Math.max(3, r.calls / maxCalls * 100)}%"></i><b>${int(r.calls)}</b></span></td>
      <td class="r">${r.calls ? mmss(r.avgTalk) : '–'}</td>
      <td class="r">${r.calls ? mmss(r.aht) : '–'}</td>
      <td class="r"><span class="fa-bar fa-bar--g"><i style="width:${r.sales ? Math.max(3, r.sales / maxSales * 100) : 0}%"></i><b>${int(r.sales)}</b></span></td>
      <td class="r">${convPill(r)}</td>
      <td class="r">${int(r.rgu)}</td>
      <td class="r">${int(r.points)}</td>
      <td class="r">${int(r.activeDays)}</td>
      <td>${sparkline(r, dates)}</td>
    </tr>`).join('');
    const foot = `<tr class="fa-total"><td></td><td><b>Total (${int(list.length)} agents)</b></td>
      ${totals.q.map(v => `<td class="r"><b>${int(v)}</b></td>`).join('')}
      <td class="r"><b>${int(totals.calls)}</b></td>
      <td class="r"><b>${totals.calls ? mmss(totals.talk / totals.calls) : '–'}</b></td>
      <td class="r"><b>${totals.calls ? mmss((totals.talk + totals.hold + totals.wrap) / totals.calls) : '–'}</b></td>
      <td class="r"><b>${int(totals.sales)}</b></td>
      <td class="r"><b>${totals.calls ? pct(totals.sales / totals.calls * 100) : '–'}</b></td>
      <td class="r"><b>${int(totals.rgu)}</b></td>
      <td class="r"><b>${int(totals.points)}</b></td><td></td><td></td></tr>`;
    wrap.innerHTML = `<table class="tbl fa-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
    $('#fa_count').textContent = `${int(list.length)} agent${list.length === 1 ? '' : 's'}`;
    $('#fa_pager').innerHTML = pages > 1
      ? `<button ${ui.page <= 1 ? 'disabled' : ''} data-act="prev">Prev</button><span>Page ${ui.page} of ${pages}</span><button ${ui.page >= pages ? 'disabled' : ''} data-act="next">Next</button>` : '';
    wrap.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (ui.sort.key === k) ui.sort.dir = ui.sort.dir === 'asc' ? 'desc' : 'asc'; else { ui.sort.key = k; ui.sort.dir = k === 'agent' ? 'asc' : 'desc'; }
      ui.page = 1; draw();
    }));
  }

  // ---------------- Agent x Date sales matrix (aapki "Fiber sales" tab jaisa) ----------------
  function renderMatrix(rows, dates) {
    const wrap = $('#fa_body');
    $('#fa_pager').innerHTML = '';
    const q = ui.search.trim().toLowerCase();
    let list = rows.filter(r => r.sales > 0 && (!q || r.agent.toLowerCase().includes(q)));
    if (!list.length || !dates.length) { wrap.innerHTML = '<div class="empty"><b>Is range mein koi Fiber sale nahi</b>Date range ya filters change karke dekhein.</div>'; $('#fa_count').textContent = '0 agents'; return; }
    list.sort((a, b) => b.sales - a.sales || a.agent.localeCompare(b.agent));
    const max = Math.max(...list.flatMap(r => dates.map(d => r.byDay.get(d) || 0)), 1);
    const colTot = dates.map(d => list.reduce((a, r) => a + (r.byDay.get(d) || 0), 0));
    const lbl = d => { const dt = new Date(d + 'T00:00:00Z'); return `<span>${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span><small>${dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</small>`; };
    const head = `<tr><th class="fa-sticky fa-sticky--h">Agent</th>${dates.map(d => `<th class="r fa-d">${lbl(d)}</th>`).join('')}<th class="r fa-d fa-tcol">Total</th></tr>`;
    const body = list.map(r => `<tr><td class="fa-sticky"><span class="agentcell"><span class="agentava" style="background:${avaColor(r.agent)}">${esc(initials(r.agent))}</span><b class="fa-name">${esc(r.agent)}</b></span></td>
      ${dates.map(d => { const v = r.byDay.get(d) || 0; const a = v ? Math.max(18, Math.round(v / max * 100)) : 0; return `<td class="r fa-cell"${v ? ` style="background:color-mix(in srgb, var(--green) ${a}%, transparent);color:${a > 60 ? '#fff' : 'inherit'}"` : ''}>${v || ''}</td>`; }).join('')}
      <td class="r fa-tcol"><b>${int(r.sales)}</b></td></tr>`).join('');
    const grand = colTot.reduce((a, b) => a + b, 0);
    const foot = `<tr class="fa-total"><td class="fa-sticky"><b>Total</b></td>${colTot.map(v => `<td class="r"><b>${v ? int(v) : ''}</b></td>`).join('')}<td class="r fa-tcol"><b>${int(grand)}</b></td></tr>`;
    wrap.innerHTML = `<table class="tbl fa-tbl fa-matrix"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
    $('#fa_count').textContent = `${int(list.length)} agent${list.length === 1 ? '' : 's'} · ${int(dates.length)} days`;
  }

  // ---------------- CSV ----------------
  function exportCsv() {
    const { rows } = build(last.calls, last.sales);
    sortRows(rows);
    const head = ['Agent', ...QUEUES, 'Total Calls', 'Avg Talk (s)', 'AHT (s)', 'Sales', 'Sales %', 'RGUs', 'Points', 'Active Days'];
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')].concat(rows.map(r => [r.agent, ...r.q, r.calls, Math.round(r.avgTalk), Math.round(r.aht), r.sales, r.conv.toFixed(2), r.rgu, r.points, r.activeDays].map(q).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'fiber-agents.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------- Shell + wiring ----------------
  function wire() {
    if (ui.wired) return; ui.wired = true;
    $('#fa_search').addEventListener('input', e => { ui.search = e.target.value; ui.page = 1; draw(); });
    $('#fa_pager').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; ui.page += b.dataset.act === 'next' ? 1 : -1; draw(); });
    $('#fa_export').addEventListener('click', exportCsv);
    document.querySelectorAll('#fa_view button').forEach(b => b.addEventListener('click', () => {
      ui.view = b.dataset.view; ui.page = 1;
      document.querySelectorAll('#fa_view button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      draw();
    }));
  }

  function draw() {
    const { rows, dates } = build(last.calls, last.sales);
    $('#fa_tiles').innerHTML = tiles(rows);
    if (ui.view === 'matrix') renderMatrix(rows, dates); else renderScore(rows, dates);
  }

  function render(calls, sales, on) {
    const sec = $('#sec-fiberagents'); if (!sec) return;
    const legacy = $('#sec-agents');           // purana generic "All Agents" card
    last = { calls: calls || [], sales: sales || [], on: !!on };
    sec.hidden = !on;
    if (legacy) legacy.hidden = !!on;
    if (!on) return;
    wire();
    draw();
  }

  return { render };
})();
