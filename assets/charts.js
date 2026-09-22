/* =========================================================
   Simply Connect – lightweight SVG chart primitives
   No external chart library: full control + tiny payload.
   ========================================================= */
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function niceMax(v) {
    if (v <= 0) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    let step;
    if (n <= 1) step = 1; else if (n <= 2) step = 2; else if (n <= 5) step = 5; else step = 10;
    return step * p;
  }
  function ticks(max, count = 4) {
    const step = max / count;
    return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
  }

  let tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = document.getElementById('tip'); }
    return tipEl;
  }
  function showTip(evt, html) {
    const t = tip(); if (!t) return;
    t.innerHTML = html; t.classList.add('on');
    moveTip(evt);
  }
  function moveTip(evt) {
    const t = tip(); if (!t) return;
    const pad = 16;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    const vw = window.innerWidth, vh = window.innerHeight;
    requestAnimationFrame(() => {
      const r = t.getBoundingClientRect();
      if (x + r.width > vw - 8) x = evt.clientX - r.width - pad;
      if (y + r.height > vh - 8) y = evt.clientY - r.height - pad;
      t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
    });
  }
  function hideTip() { const t = tip(); if (t) t.classList.remove('on'); }

  // ---------------- Line / area chart (multi-series) ----------------
  function lineChart(container, { labels, series, height = 260, format = fmtInt, yTicks = 4, area = true }) {
    container.innerHTML = '';
    const w = Math.max(container.clientWidth || 600, 280), h = height;
    const padL = 40, padR = 12, padT = 16, padB = 28;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'xMidYMid meet' }, container);

    const allVals = series.flatMap(s => s.values);
    const max = niceMax(Math.max(1, ...allVals));
    const tk = ticks(max, yTicks);
    const n = labels.length;
    const x = i => padL + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const y = v => padT + innerH - (innerH * v) / max;

    // gridlines + y labels
    tk.forEach(v => {
      el('line', { x1: padL, x2: w - padR, y1: y(v), y2: y(v), stroke: 'var(--grid-line)', 'stroke-width': 1 }, svg);
      el('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--muted)' }, svg).textContent = format(v);
    });
    // x labels (thin out if crowded)
    const stepEvery = Math.max(1, Math.ceil(n / (w / 62)));
    labels.forEach((lb, i) => {
      if (i % stepEvery !== 0 && i !== n - 1) return;
      el('text', { x: x(i), y: h - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--muted)' }, svg).textContent = lb;
    });

    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [x(i), y(v)]);
      if (area && s.area !== false) {
        const areaId = 'ga' + Math.random().toString(36).slice(2, 8);
        const grad = el('linearGradient', { id: areaId, x1: 0, y1: 0, x2: 0, y2: 1 }, el('defs', {}, svg));
        el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': 0.28 }, grad);
        el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0.02 }, grad);
        const d = 'M' + pts.map(p => p.join(',')).join('L') + `L${x(n - 1)},${padT + innerH}L${x(0)},${padT + innerH}Z`;
        el('path', { d, fill: `url(#${areaId})`, stroke: 'none' }, svg);
      }
      const d = 'M' + pts.map(p => p.join(',')).join('L');
      el('path', {
        d, fill: 'none', stroke: s.color, 'stroke-width': 2.25,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': s.dash ? '5,4' : 'none',
      }, svg);
    });

    // hover layer
    const hoverX = el('line', { x1: 0, x2: 0, y1: padT, y2: padT + innerH, stroke: 'var(--line-strong)', 'stroke-width': 1, opacity: 0 }, svg);
    const dots = series.map(s => el('circle', { r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 }, svg));
    const overlay = el('rect', { x: padL, y: padT, width: innerW, height: innerH, fill: 'transparent', style: 'cursor:crosshair' }, svg);
    overlay.addEventListener('mousemove', evt => {
      const rect = svg.getBoundingClientRect();
      const relX = ((evt.clientX - rect.left) / rect.width) * w;
      let i = Math.round(((relX - padL) / innerW) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      hoverX.setAttribute('x1', x(i)); hoverX.setAttribute('x2', x(i)); hoverX.setAttribute('opacity', 1);
      let html = `<div class="t">${labels[i]}</div>`;
      series.forEach((s, si) => {
        dots[si].setAttribute('cx', x(i)); dots[si].setAttribute('cy', y(s.values[i])); dots[si].setAttribute('opacity', 1);
        html += `<div class="row"><span><i style="background:${s.color}"></i>${s.name}</span><b>${format(s.values[i])}</b></div>`;
      });
      showTip(evt, html); moveTip(evt);
    });
    overlay.addEventListener('mouseleave', () => { hideTip(); hoverX.setAttribute('opacity', 0); dots.forEach(d => d.setAttribute('opacity', 0)); });
    return svg;
  }

  // ---------------- Bar chart (single or grouped) ----------------
  function barChart(container, { labels, series, height = 260, format = fmtInt, yTicks = 4, highlight = null, onBarClick = null, radius = 6 }) {
    container.innerHTML = '';
    const w = Math.max(container.clientWidth || 600, 280), h = height;
    const padL = 40, padR = 12, padT = 16, padB = 28;
    const innerW = w - padL - padR, innerH = h - padT - padB;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'xMidYMid meet' }, container);

    const n = labels.length;
    const allVals = series.flatMap(s => s.values);
    const max = niceMax(Math.max(1, ...allVals));
    const tk = ticks(max, yTicks);
    const y = v => padT + innerH - (innerH * v) / max;
    tk.forEach(v => {
      el('line', { x1: padL, x2: w - padR, y1: y(v), y2: y(v), stroke: 'var(--grid-line)', 'stroke-width': 1 }, svg);
      el('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--muted)' }, svg).textContent = format(v);
    });

    const groupW = innerW / n;
    const nS = series.length;
    const barGap = 4;
    const barW = Math.max(4, (groupW - 14) / nS - barGap);

    labels.forEach((lb, i) => {
      const gx = padL + groupW * i + groupW / 2;
      el('text', { x: gx, y: h - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: (highlight === i ? 'var(--text)' : 'var(--muted)'), 'font-weight': (highlight === i ? 700 : 400) }, svg).textContent = lb;
      series.forEach((s, si) => {
        const v = s.values[i];
        const bx = gx - (barW * nS + barGap * (nS - 1)) / 2 + si * (barW + barGap);
        const by = y(v), bh = Math.max(0, padT + innerH - by);
        const color = s.perBarColor ? s.perBarColor(i) : (highlight === i && nS === 1 ? (s.hiColor || s.color) : s.color);
        const rect = el('rect', {
          x: bx, y: by, width: barW, height: bh, rx: radius, ry: radius, fill: color,
          style: onBarClick ? 'cursor:pointer' : '',
        }, svg);
        rect.addEventListener('mousemove', evt => {
          const html = `<div class="t">${lb}${s.name ? ' · ' + s.name : ''}</div><b>${format(v)}</b>`;
          showTip(evt, html); moveTip(evt);
        });
        rect.addEventListener('mouseleave', hideTip);
        if (onBarClick) rect.addEventListener('click', () => onBarClick(i, lb));
      });
    });
    return svg;
  }

  // ---------------- Donut chart ----------------
  function donutChart(container, { data, size = 190, thickness = 26, centerLabel, centerValue, onSliceClick = null }) {
    container.innerHTML = '';
    const w = size, h = size;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: '100%', style: `max-width:${size}px; margin:0 auto;` }, container);
    const cx = w / 2, cy = h / 2, r = (Math.min(w, h) - thickness) / 2;
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    let ang = -Math.PI / 2;
    const g = el('g', {}, svg);
    data.forEach(d => {
      const frac = d.value / total;
      const a0 = ang, a1 = ang + frac * Math.PI * 2;
      ang = a1;
      if (frac <= 0) return;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const path = el('path', {
        d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`,
        fill: 'none', stroke: d.color, 'stroke-width': thickness, 'stroke-linecap': frac > 0.995 ? 'butt' : 'round',
        style: onSliceClick ? 'cursor:pointer' : '',
      }, g);
      path.addEventListener('mousemove', evt => {
        showTip(evt, `<div class="t">${d.label}</div><b>${d.value.toLocaleString()}</b> · ${(frac * 100).toFixed(1)}%`);
        moveTip(evt);
      });
      path.addEventListener('mouseleave', hideTip);
      if (onSliceClick) path.addEventListener('click', () => onSliceClick(d.label));
    });
    if (centerLabel || centerValue) {
      el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: 'var(--text)' }, svg).textContent = centerValue || '';
      el('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--muted)' }, svg).textContent = centerLabel || '';
    }
    return svg;
  }

  // ---------------- Radial segmented ring (reference-style "Service level") ----------------
  function radialRings(container, { rings, size = 210, centerLabel, centerValue }) {
    container.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: '100%', style: `max-width:${size}px; margin:0 auto;` }, container);
    const cx = size / 2, cy = size / 2;
    const baseR = size / 2 - 10;
    const gap = 15;
    rings.forEach((ring, idx) => {
      const r = baseR - idx * gap;
      const segTotal = ring.segments;
      const segGapDeg = 5;
      const segAngle = (360 - segGapDeg * segTotal) / segTotal;
      const filled = Math.round((ring.pct / 100) * segTotal);
      for (let i = 0; i < segTotal; i++) {
        const a0 = -90 + i * (segAngle + segGapDeg);
        const a1 = a0 + segAngle;
        const rad0 = (a0 * Math.PI) / 180, rad1 = (a1 * Math.PI) / 180;
        const x0 = cx + r * Math.cos(rad0), y0 = cy + r * Math.sin(rad0);
        const x1 = cx + r * Math.cos(rad1), y1 = cy + r * Math.sin(rad1);
        const large = segAngle > 180 ? 1 : 0;
        el('path', {
          d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`,
          fill: 'none', stroke: i < filled ? ring.color : 'var(--surface-3)',
          'stroke-width': 9, 'stroke-linecap': 'round',
        }, svg);
      }
    });
    el('text', { x: cx, y: cy - 3, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 800, fill: 'var(--text)' }, svg).textContent = centerValue || '';
    el('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }, svg).textContent = centerLabel || '';
    return svg;
  }

  // ---------------- Bubble cluster (reference-style "Call Trends") ----------------
  function bubbleCluster(container, { data, size = 260 }) {
    container.innerHTML = '';
    const w = size, h = size * 0.82;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h }, container);
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    const maxR = Math.min(w, h) * 0.42;
    const items = data.map(d => ({ ...d, r: Math.max(22, Math.sqrt(d.value / total) * maxR) })).sort((a, b) => b.r - a.r);
    // simple layout: largest centered, others placed around without heavy overlap
    const positions = [
      [w * 0.42, h * 0.48], [w * 0.78, h * 0.32], [w * 0.22, h * 0.78], [w * 0.75, h * 0.78], [w * 0.15, h * 0.28],
    ];
    items.forEach((d, i) => {
      const [x, y] = positions[i] || [w / 2 + (i * 30), h / 2];
      const g = el('g', {}, svg);
      const c = el('circle', { cx: x, cy: y, r: d.r, fill: d.color, style: 'cursor:pointer' }, g);
      el('text', { x, y: y + 6, 'text-anchor': 'middle', 'font-size': Math.max(12, d.r * 0.32), 'font-weight': 800, fill: '#fff' }, g).textContent = Math.round((d.value / total) * 100) + '%';
      c.addEventListener('mousemove', evt => { showTip(evt, `<div class="t">${d.label}</div><b>${d.value.toLocaleString()}</b>`); moveTip(evt); });
      c.addEventListener('mouseleave', hideTip);
    });
    return svg;
  }

  // ---------------- Sparkline (tiny inline) ----------------
  function sparkline(container, { values, color = 'var(--amber)', height = 34 }) {
    container.innerHTML = '';
    const w = Math.max(container.clientWidth || 80, 60), h = height;
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height }, container);
    const max = Math.max(1, ...values), min = Math.min(0, ...values);
    const n = values.length;
    const x = i => n <= 1 ? 0 : (w * i) / (n - 1);
    const y = v => h - ((v - min) / (max - min || 1)) * h;
    const d = 'M' + values.map((v, i) => `${x(i)},${y(v)}`).join('L');
    el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    return svg;
  }

  return { lineChart, barChart, donutChart, radialRings, bubbleCluster, sparkline, fmtInt, showTip, hideTip, moveTip, niceMax };
})();
