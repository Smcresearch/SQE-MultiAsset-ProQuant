/* SQE MultiAsset ProQuant — Equity + Gold + Silver terminal */

const M = MULTIASSET_DATA;

/* The four sleeves. Keys match the run keys in data.js (N500_goldsilver etc.). */
const VARIANTS = {
  base:       { label: 'Equity Only',            short: 'Equity',       color: '#64748b' },
  gold:       { label: 'Equity + Gold',          short: '+Gold',        color: '#f4b942' },
  silver:     { label: 'Equity + Silver',        short: '+Silver',      color: '#9fb3c8' },
  goldsilver: { label: 'Equity + Gold + Silver', short: '+Gold+Silver', color: '#22d3ee' }
};
const VKEYS = Object.keys(VARIANTS);
const BENCH_COLOR = '#8b5cf6';
const UNIV_LABEL = { N50: 'Nifty 50', N500: 'Nifty 500', T759: 'All Indices' };

let state = {
  universe: 'N500',
  variant: 'goldsilver',
  tab: 'overview',
  heatVariant: 'goldsilver',
  chartTypes: { equityOverview: 'line', equityMain: 'line', bullionChart: 'bar' }
};
const charts = {};

/* ── DATA ACCESSORS ──────────────────────────── */
function run(u = state.universe, v = state.variant) { return M.runs[`${u}_${v}`]; }
function mon(u = state.universe, v = state.variant) { return M.monthly[`${u}_${v}`]; }
function months(u = state.universe) { return mon(u, 'base').map(r => r.trade_month); }
function benchRets(u = state.universe) { return mon(u, 'base').map(r => r.bench_ret); }
function portRets(u = state.universe, v = state.variant) { return mon(u, v).map(r => r.port_ret); }
function book() { return M.holdings[state.universe]; }

/* ── MATH ────────────────────────────────────── */
function growth(rets, start = 1) {
  let v = start;
  return rets.map(r => (v *= (1 + r)));
}
function underwater(rets) {
  let peak = 0;
  return growth(rets).map(v => { peak = Math.max(peak, v); return (v / peak - 1) * 100; });
}
function rolling(rets, w = 12) {
  return rets.map((_, i) => {
    if (i < w - 1) return null;
    let p = 1;
    for (let j = i - w + 1; j <= i; j++) p *= (1 + rets[j]);
    return (p - 1) * 100;
  });
}

/* ── FORMAT ──────────────────────────────────── */
const pct = (v, d = 2) => v == null || isNaN(v) ? '—' : (v * 100).toFixed(d) + '%';
const spct = (v, d = 2) => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const num = (v, d = 2) => v == null || isNaN(v) ? '—' : Number(v).toFixed(d);
const snum = (v, d = 2) => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d);
const tone = v => v > 0 ? 'text-emerald' : (v < 0 ? 'text-rose' : '');
const money = v => '₹' + Math.round(v).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = m => MON[+String(m).slice(5, 7) - 1] + ' ' + String(m).slice(0, 4);

/* ── GLOBAL CONTROLS ─────────────────────────── */
function switchUniverse(u) {
  state.universe = u;
  ['N50', 'N500', 'T759'].forEach(k =>
    document.getElementById('btn-' + k)?.classList.toggle('active', k === u));
  renderHeader();
  renderTab(state.tab);
}

function switchVariant(v) {
  state.variant = v;
  renderVariantTabs();
  renderHeader();
  renderTab(state.tab);
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderTab(tab);
}

function switchChartType(id, type) {
  state.chartTypes[id] = type;
  renderTab(state.tab);
}

function toggleTheme() {
  const target = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('som-theme', target);
  Chart.defaults.color = target === 'light' ? '#475569' : '#94a3b8';
  renderTab(state.tab);
}

function closeModal() { document.getElementById('hmModal').classList.remove('open'); }

/* Download the full monthly series for the active universe — every sleeve plus
   the benchmark — so anything on screen can be checked in a spreadsheet. */
function exportReport() {
  const u = state.universe, ms = months(u), b = benchRets(u);
  const head = ['Month', ...VKEYS.map(v => VARIANTS[v].label), M.runs[`${u}_base`].bench_name];
  const rows = ms.map((m, i) =>
    [m, ...VKEYS.map(v => (portRets(u, v)[i] * 100).toFixed(4)), (b[i] * 100).toFixed(4)]);
  const csv = [head, ...rows].map(r => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `SQE_MultiAsset_${u}_monthly_returns.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

window.switchUniverse = switchUniverse;
window.switchVariant = switchVariant;
window.switchTab = switchTab;
window.switchChartType = switchChartType;
window.toggleTheme = toggleTheme;
window.closeModal = closeModal;
window.exportReport = exportReport;

/* ── CHART HELPER ────────────────────────────── */
function mkChart(id, defaultType, data, options) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();

  const type = state.chartTypes[id] || defaultType;
  if (type === 'dot') {
    data.datasets.forEach(ds => { ds.showLine = false; ds.pointRadius = 4; });
  } else if (type === 'line') {
    data.datasets.forEach(ds => {
      if (ds.showLine === undefined) ds.showLine = true;
      if (ds.pointRadius === undefined) ds.pointRadius = id.includes('equity') ? 0 : 2;
    });
  }

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const gridCol = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
  const tickCol = isLight ? '#475569' : '#64748b';
  const labelCol = isLight ? '#1e293b' : '#94a3b8';

  const defaults = {
    responsive: true, maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { labels: { color: labelCol, boxWidth: 10, font: { size: 10 } } },
      tooltip: {
        backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(10,22,42,0.95)',
        titleColor: isLight ? '#06b6d4' : '#22d3ee',
        bodyColor: isLight ? '#1e293b' : '#e2e8f0',
        borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(34,211,238,0.2)',
        borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true,
        bodyFont: { family: "'Roboto Mono', monospace", size: 12 },
        titleFont: { family: "'Inter', sans-serif", weight: 'bold', size: 14 }
      }
    },
    scales: {
      x: { grid: { color: gridCol }, ticks: { color: tickCol, maxTicksLimit: 12 } },
      y: { grid: { color: gridCol }, ticks: { color: tickCol } }
    }
  };

  const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw: (chart) => {
      if (chart.tooltip?._active?.length) {
        const x = chart.tooltip._active[0].element.x;
        const yAxis = chart.scales.y, ctx = chart.ctx;
        ctx.save(); ctx.beginPath();
        ctx.moveTo(x, yAxis.top); ctx.lineTo(x, yAxis.bottom);
        ctx.lineWidth = 1;
        ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(34,211,238,0.3)';
        ctx.setLineDash([5, 5]); ctx.stroke(); ctx.restore();
      }
    }
  };

  charts[id] = new Chart(el.getContext('2d'), {
    type: type === 'dot' ? 'line' : type,
    data,
    options: Object.assign({}, defaults, options),
    plugins: [verticalLinePlugin]
  });

  renderChartControls(id);
}

function renderChartControls(id) {
  const container = document.querySelector(`.chart-controls[data-for="${id}"]`);
  if (!container) return;
  const current = state.chartTypes[id] || 'line';
  const types = [{ id: 'line', icon: '📈' }, { id: 'bar', icon: '📊' }, { id: 'dot', icon: '●' }];
  container.innerHTML = types.map(t =>
    `<button class="chart-control-btn ${current === t.id ? 'active' : ''}"
       onclick="switchChartType('${id}','${t.id}')">${t.icon}</button>`).join('');
}

/* ── HEADER / SLEEVE SELECTOR ────────────────── */
function renderHeader() {
  const w = M.meta.window, r = run();
  document.getElementById('last-refresh').textContent = 'Terminal Updated: ' + M.meta.generated;
  document.getElementById('backtest-period').textContent =
    `Backtest: ${fmtMonth(w.first)} – ${fmtMonth(w.last)} · ${w.months} months · window bounded by SILVERBEES inception (May 2022) · all metrics computed over this period`;

  const badge = document.getElementById('regime-badge');
  const baseRun = M.runs[`${state.universe}_base`];
  const cagrLift = r.cagr - baseRun.cagr;
  const ddLift = r.max_dd - baseRun.max_dd;   // positive = shallower drawdown
  let label, cls;
  if (state.variant === 'base') { label = 'Equity Only — no bullion'; cls = ''; }
  else if (ddLift > 0 && cagrLift > 0) { label = 'Bullion: return up, drawdown down'; cls = 'bull'; }
  else if (ddLift > 0) { label = 'Bullion: drawdown reduced'; cls = 'bias'; }
  else { label = 'Bullion: risk-neutral'; cls = ''; }
  badge.innerHTML = `<span class="regime-dot ${cls}"></span> ${label}`;
  badge.className = `regime-badge ${cls}`;

  const sub = document.getElementById('sleeve-sub');
  if (state.variant === 'base') {
    sub.textContent = '100% stocks — the control run every overlay is measured against.';
  } else {
    sub.textContent = `${pct(r.stock_w, 0)} stocks · ${pct(r.gold_w, 0)} GOLDBEES · ${pct(r.silver_w, 0)} SILVERBEES — fixed weights of total capital, rebalanced monthly with the equity basket.`;
  }
}

function renderVariantTabs() {
  document.getElementById('variant-tabs').innerHTML = VKEYS.map(v =>
    `<button class="layer-tab-btn ${v === state.variant ? 'active' : ''}"
       onclick="switchVariant('${v}')">${VARIANTS[v].label}</button>`).join('');
}

/* ── TAB DISPATCH ────────────────────────────── */
function renderTab(tab) {
  if (tab === 'overview')  renderOverview();
  if (tab === 'heatmap')   renderHeatmapTab();
  if (tab === 'risk')      renderRisk();
  if (tab === 'metrics')   renderMetrics();
  if (tab === 'bullion')   renderBullion();
  if (tab === 'portfolio') renderPortfolio();
}

/* ══════════════════════════════════════════════
   OVERVIEW
══════════════════════════════════════════════ */
function renderOverview() {
  const r = run();

  const kpis = [
    { label: 'CAGR', value: pct(r.cagr, 2), color: 'var(--emerald)',
      sub: `${r.bench_name} ${pct(r.bench_cagr, 2)}` },
    { label: 'Alpha (ann.)', value: spct(r.alpha_ann, 2),
      color: r.alpha_ann >= 0 ? 'var(--emerald)' : 'var(--rose)', sub: `vs ${r.bench_name}` },
    { label: 'Sharpe', value: num(r.sharpe), color: 'var(--cyan)', sub: `Sortino ${num(r.sortino)}` },
    { label: 'Max Drawdown', value: pct(r.max_dd, 2), color: 'var(--rose)',
      sub: `${r.dd_duration} mo underwater` },
    { label: 'Volatility', value: pct(r.vol, 2), color: 'var(--gold)', sub: `Beta ${num(r.beta)}` },
    { label: 'Win Rate', value: pct(r.win_rate, 1), color: 'var(--emerald)', sub: `${r.months} months` }
  ];
  document.getElementById('kpi-row').innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--accent:${k.color}">
      <span class="kpi-label">${k.label}</span>
      <span class="kpi-value" style="color:${k.color}">${k.value}</span>
      <span class="kpi-delta">${k.sub}</span>
    </div>`).join('');

  const ms = months().map(fmtMonth);
  mkChart('equityOverview', 'line', {
    labels: ms,
    datasets: [
      ...VKEYS.map(v => ({
        label: VARIANTS[v].label,
        data: growth(portRets(state.universe, v)),
        borderColor: VARIANTS[v].color,
        backgroundColor: VARIANTS[v].color + '22',
        borderWidth: v === state.variant ? 3 : 1.5,
        tension: 0.25, fill: false
      })),
      {
        label: r.bench_name, data: growth(benchRets()),
        borderColor: BENCH_COLOR, borderDash: [6, 4], borderWidth: 1.5, tension: 0.25, fill: false
      }
    ]
  }, {
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ₹${c.parsed.y.toFixed(2)}` } } },
    scales: { y: { ticks: { callback: v => '₹' + v.toFixed(1) } } }
  });

  renderSectorPie('overviewSectorPie');
  renderLift();

  const pts = VKEYS.map(v => ({
    label: VARIANTS[v].label, color: VARIANTS[v].color,
    x: M.runs[`${state.universe}_${v}`].vol * 100,
    y: M.runs[`${state.universe}_${v}`].cagr * 100
  }));
  pts.push({ label: r.bench_name, color: BENCH_COLOR, x: r.bench_vol * 100, y: r.bench_cagr * 100 });
  pts.push({ label: 'GOLDBEES', color: '#f4b942', x: M.bullion_bh.GOLDBEES.vol * 100, y: M.bullion_bh.GOLDBEES.cagr * 100 });
  pts.push({ label: 'SILVERBEES', color: '#9fb3c8', x: M.bullion_bh.SILVERBEES.vol * 100, y: M.bullion_bh.SILVERBEES.cagr * 100 });

  mkChart('scatterChart', 'scatter', {
    datasets: pts.map(p => ({
      label: p.label, data: [{ x: p.x, y: p.y }],
      backgroundColor: p.color, borderColor: p.color, pointRadius: 7, pointHoverRadius: 10
    }))
  }, {
    interaction: { mode: 'nearest', intersect: true },
    plugins: {
      tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}% CAGR at ${c.parsed.x.toFixed(1)}% vol` } }
    },
    scales: {
      x: { title: { display: true, text: 'Annualised volatility %' }, ticks: { callback: v => v + '%' } },
      y: { title: { display: true, text: 'CAGR %' }, ticks: { callback: v => v + '%' } }
    }
  });
}

/* Each overlay measured against the Equity Only control. */
function renderLift() {
  const base = M.runs[`${state.universe}_base`];
  const rows = VKEYS.filter(v => v !== 'base').map(v => {
    const r = M.runs[`${state.universe}_${v}`];
    return {
      label: VARIANTS[v].label, color: VARIANTS[v].color,
      cagr: r.cagr - base.cagr,
      vol: r.vol - base.vol,
      sharpe: r.sharpe - base.sharpe,
      dd: r.max_dd - base.max_dd,
      beta: r.beta - base.beta
    };
  });

  const cell = (v, fmt, goodUp) => {
    const good = goodUp ? v > 0 : v < 0;
    return `<td class="mono ${v === 0 ? '' : (good ? 'text-emerald' : 'text-rose')}">${fmt(v)}</td>`;
  };

  document.getElementById('lift-container').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>vs Equity Only</th><th>CAGR</th><th>Volatility</th><th>Sharpe</th><th>Max DD</th><th>Beta</th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color};margin-right:.5rem"></span>${r.label}</td>
          ${cell(r.cagr, v => spct(v, 2), true)}
          ${cell(r.vol, v => spct(v, 2), false)}
          ${cell(r.sharpe, v => snum(v, 2), true)}
          ${cell(r.dd, v => spct(v, 2), true)}
          ${cell(r.beta, v => snum(v, 2), false)}
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="card-sub" style="margin-top:.75rem;display:block;line-height:1.5">
      Green is the improvement direction: higher CAGR and Sharpe, lower volatility, shallower
      drawdown, lower beta. Bullion is funded out of the stock sleeve, so any return given up
      is the price paid for the risk reduction.
    </p>`;
}

/* ══════════════════════════════════════════════
   HEATMAP
══════════════════════════════════════════════ */
function renderHeatmapTab() {
  document.getElementById('heatmap-variant-tabs').innerHTML = VKEYS.map(v =>
    `<button class="layer-tab-btn ${v === state.heatVariant ? 'active' : ''}"
       onclick="setHeatVariant('${v}')">${VARIANTS[v].short}</button>`).join('');
  renderHeatmap(state.heatVariant);
}

function setHeatVariant(v) {
  state.heatVariant = v;
  renderHeatmapTab();
}
window.setHeatVariant = setHeatVariant;

function renderHeatmap(variant) {
  const grid = {};
  mon(state.universe, variant).forEach(r => {
    const m = String(r.trade_month), yr = m.slice(0, 4), mo = +m.slice(5, 7) - 1;
    if (!grid[yr]) grid[yr] = new Array(12).fill(null);
    grid[yr][mo] = +(r.port_ret * 100).toFixed(2);
  });

  const years = Object.keys(grid).sort((a, b) => +b - +a);
  let html = '<div class="heatmap-wrap"><div class="heatmap-grid">';
  html += '<div class="hm-head">Year</div>' + MON.map(m => `<div class="hm-head">${m}</div>`).join('')
        + '<div class="hm-head">Total</div>';

  years.forEach(yr => {
    html += `<div class="hm-year">${yr}</div>`;
    grid[yr].forEach((val, mi) => {
      const monthStr = `${yr}-${String(mi + 1).padStart(2, '0')}`;
      if (val === null) {
        html += `<div class="hm-cell empty" title="${monthStr}: outside the backtest window">–</div>`;
      } else {
        const bg = heatColor(val);
        const fg = Math.abs(val) > 4 ? '#fff' : 'rgba(255,255,255,0.5)';
        html += `<div class="hm-cell" style="background:${bg};color:${fg}"
          onclick="openHeatModal('${monthStr}')" title="${monthStr}: ${val}%">${val > 0 ? '+' : ''}${val}</div>`;
      }
    });
    const got = grid[yr].filter(v => v !== null);
    if (got.length) {
      const total = +((got.reduce((a, v) => a * (1 + v / 100), 1) - 1) * 100).toFixed(2);
      const bg = heatColor(total);
      const fg = Math.abs(total) > 4 ? '#fff' : 'rgba(255,255,255,0.75)';
      html += `<div class="hm-cell hm-total" style="background:${bg};color:${fg}"
        title="${yr} compounded over the ${got.length} month(s) inside the window: ${total}%">${total > 0 ? '+' : ''}${total}</div>`;
    } else {
      html += '<div class="hm-cell empty"></div>';
    }
  });

  html += '</div></div>';
  document.getElementById('heatmap-container').innerHTML = html;
}

function heatColor(val) {
  if (val > 0) return `rgba(16,185,129,${Math.min(val / 10, 0.85)})`;
  return `rgba(244,63,94,${Math.min(Math.abs(val) / 10, 0.85)})`;
}

function openHeatModal(monthStr) {
  const ms = months(), i = ms.indexOf(monthStr);
  if (i < 0) return;
  const bench = benchRets()[i];
  const bm = M.bullion_monthly, bi = bm.months.indexOf(monthStr);

  document.getElementById('modal-month').textContent = fmtMonth(monthStr);

  const sleeveHtml = VKEYS.map(v => {
    const val = portRets(state.universe, v)[i];
    return `
      <div class="modal-row">
        <div>
          <div class="modal-metric">${VARIANTS[v].label}</div>
          <div class="modal-val" style="color:${VARIANTS[v].color}">${spct(val)}</div>
          <div class="modal-bench">${spct(val - bench)} vs benchmark</div>
        </div>
      </div>`;
  }).join('');

  const assetHtml = `
    <div class="modal-row">
      <div>
        <div class="modal-metric">${run().bench_name}</div>
        <div class="modal-val" style="color:${BENCH_COLOR}">${spct(bench)}</div>
      </div>
    </div>
    ${bi >= 0 ? `
    <div class="modal-row">
      <div>
        <div class="modal-metric">GOLDBEES</div>
        <div class="modal-val" style="color:#f4b942">${spct(bm.gold_bh[bi])}</div>
      </div>
    </div>
    <div class="modal-row">
      <div>
        <div class="modal-metric">SILVERBEES</div>
        <div class="modal-val" style="color:#9fb3c8">${spct(bm.silver_bh[bi])}</div>
      </div>
    </div>` : ''}`;

  document.getElementById('modal-body').innerHTML = sleeveHtml + assetHtml;
  document.getElementById('hmModal').classList.add('open');
}
window.openHeatModal = openHeatModal;

/* ══════════════════════════════════════════════
   RISK & REWARD
══════════════════════════════════════════════ */
function renderRisk() {
  const ms = months().map(fmtMonth);

  mkChart('equityMain', 'line', {
    labels: ms,
    datasets: [
      ...VKEYS.map(v => ({
        label: VARIANTS[v].label,
        data: growth(portRets(state.universe, v)),
        borderColor: VARIANTS[v].color,
        backgroundColor: VARIANTS[v].color + '22',
        borderWidth: v === state.variant ? 3 : 1.5,
        tension: 0.25, fill: false
      })),
      {
        label: run().bench_name, data: growth(benchRets()),
        borderColor: BENCH_COLOR, borderDash: [6, 4], borderWidth: 1.5, tension: 0.25, fill: false
      }
    ]
  }, {
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ₹${c.parsed.y.toFixed(2)}` } } },
    scales: { y: { ticks: { callback: v => '₹' + v.toFixed(1) } } }
  });

  mkChart('drawdownChart', 'line', {
    labels: ms,
    datasets: VKEYS.map(v => ({
      label: VARIANTS[v].label,
      data: underwater(portRets(state.universe, v)),
      borderColor: VARIANTS[v].color,
      backgroundColor: VARIANTS[v].color + '33',
      borderWidth: v === state.variant ? 2.5 : 1.2,
      pointRadius: 0, tension: 0.2, fill: v === state.variant
    })).concat([{
      label: run().bench_name, data: underwater(benchRets()),
      borderColor: BENCH_COLOR, borderDash: [6, 4], borderWidth: 1.2, pointRadius: 0, fill: false
    }])
  }, {
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } } },
    scales: { y: { ticks: { callback: v => v.toFixed(0) + '%' } } }
  });

  mkChart('rollingChart', 'line', {
    labels: ms,
    datasets: [
      { label: VARIANTS[state.variant].label, data: rolling(portRets()),
        borderColor: VARIANTS[state.variant].color, backgroundColor: VARIANTS[state.variant].color + '33',
        borderWidth: 2.5, pointRadius: 0, tension: 0.25, fill: true, spanGaps: false },
      { label: run().bench_name, data: rolling(benchRets()),
        borderColor: BENCH_COLOR, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.25, fill: false }
    ]
  }, {
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(2) + '%'}` } } },
    scales: { y: { ticks: { callback: v => v.toFixed(0) + '%' } } }
  });

  const cols = [
    ['VaR 95%', r => pct(r.var95)], ['CVaR 95%', r => pct(r.cvar95)],
    ['VaR 99%', r => pct(r.var99)], ['CVaR 99%', r => pct(r.cvar99)],
    ['Worst Month', r => pct(r.worst_month)], ['Best Month', r => pct(r.best_month)],
    ['Downside Dev', r => pct(r.downside_dev)], ['DD Recovery', r => r.dd_duration + ' mo']
  ];
  document.getElementById('tailTable').innerHTML = `
    <thead><tr><th>Sleeve</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead>
    <tbody>${VKEYS.map(v => {
      const r = M.runs[`${state.universe}_${v}`];
      return `<tr${v === state.variant ? ' style="background:rgba(34,211,238,.06)"' : ''}>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${VARIANTS[v].color};margin-right:.5rem"></span>${VARIANTS[v].short}</td>
        ${cols.map(c => `<td class="mono">${c[1](r)}</td>`).join('')}
      </tr>`;
    }).join('')}</tbody>`;

  const edges = [-Infinity, -0.10, -0.05, -0.02, 0, 0.02, 0.05, 0.10, Infinity];
  const labels = ['< -10%', '-10..-5%', '-5..-2%', '-2..0%', '0..2%', '2..5%', '5..10%', '> 10%'];
  const bucket = rets => {
    const c = new Array(labels.length).fill(0);
    rets.forEach(r => {
      for (let i = 0; i < edges.length - 1; i++) {
        if (r > edges[i] && r <= edges[i + 1]) { c[i]++; break; }
      }
    });
    return c;
  };
  mkChart('distChart', 'bar', {
    labels,
    datasets: [
      { label: VARIANTS[state.variant].label, data: bucket(portRets()),
        backgroundColor: VARIANTS[state.variant].color + 'cc' },
      { label: 'Equity Only', data: bucket(portRets(state.universe, 'base')),
        backgroundColor: VARIANTS.base.color + '88' }
    ]
  }, {
    scales: { y: { title: { display: true, text: 'Months' }, ticks: { precision: 0 } } }
  });
}

/* ══════════════════════════════════════════════
   VARIANT METRICS
══════════════════════════════════════════════ */
function renderMetrics() {
  document.getElementById('variantTableBody').innerHTML = VKEYS.map(v => {
    const r = M.runs[`${state.universe}_${v}`];
    return `<tr${v === state.variant ? ' style="background:rgba(34,211,238,.06)"' : ''}>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${VARIANTS[v].color};margin-right:.5rem"></span>${r.variant_name}</td>
      <td class="mono">${pct(r.stock_w, 0)}</td>
      <td class="mono" style="color:#f4b942">${pct(r.gold_w, 0)}</td>
      <td class="mono" style="color:#9fb3c8">${pct(r.silver_w, 0)}</td>
      <td class="mono text-emerald">${pct(r.cagr)}</td>
      <td class="mono ${tone(r.alpha_ann)}">${spct(r.alpha_ann)}</td>
      <td class="mono">${pct(r.vol)}</td>
      <td class="mono text-cyan">${num(r.sharpe)}</td>
      <td class="mono">${num(r.sortino)}</td>
      <td class="mono">${num(r.calmar)}</td>
      <td class="mono text-rose">${pct(r.max_dd)}</td>
      <td class="mono">${num(r.beta)}</td>
      <td class="mono">${pct(r.win_rate, 1)}</td>
    </tr>`;
  }).join('');

  // Radar axes are min-max normalised across the four sleeves, so the shape shows
  // relative standing within this universe, not an absolute score.
  const axes = [
    ['CAGR', r => r.cagr], ['Sharpe', r => r.sharpe], ['Sortino', r => r.sortino],
    ['Calmar', r => r.calmar], ['Low Drawdown', r => r.max_dd],
    ['Low Volatility', r => -r.vol], ['Win Rate', r => r.win_rate]
  ];
  const raw = VKEYS.map(v => axes.map(a => a[1](M.runs[`${state.universe}_${v}`])));
  const norm = raw.map(row => row.map((val, j) => {
    const col = raw.map(r => r[j]);
    const lo = Math.min(...col), hi = Math.max(...col);
    return hi === lo ? 75 : 35 + 65 * (val - lo) / (hi - lo);
  }));

  mkChart('radarChart', 'radar', {
    labels: axes.map(a => a[0]),
    datasets: VKEYS.map((v, i) => ({
      label: VARIANTS[v].short, data: norm[i],
      borderColor: VARIANTS[v].color, backgroundColor: VARIANTS[v].color + '25',
      borderWidth: v === state.variant ? 2.5 : 1.2, pointRadius: 2
    }))
  }, {
    scales: {
      r: {
        beginAtZero: true, max: 100,
        grid: { color: 'rgba(148,163,184,0.15)' },
        angleLines: { color: 'rgba(148,163,184,0.15)' },
        pointLabels: { font: { size: 10 } },
        ticks: { display: false }
      }
    },
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: rank score ${c.parsed.r.toFixed(0)}/100` } } }
  });

  const rowsSpec = [
    ['Months', r => r.months, 'Length of the common backtest window'],
    ['Total Return', r => pct(r.total_return), 'Compounded over the window'],
    ['Growth of ₹1', r => '₹' + num(r.growth_of_1), ''],
    ['CAGR', r => pct(r.cagr), 'Annualised'],
    ['Benchmark CAGR', r => pct(r.bench_cagr), ''],
    ['Alpha (ann.)', r => spct(r.alpha_ann), 'CAGR less benchmark CAGR'],
    ['Volatility', r => pct(r.vol), 'Annualised stdev of monthly returns'],
    ['Benchmark Volatility', r => pct(r.bench_vol), ''],
    ['Downside Deviation', r => pct(r.downside_dev), ''],
    ['Sharpe', r => num(r.sharpe), `Risk-free ${pct(run().rf_avg, 2)} avg over the window`],
    ['Sortino', r => num(r.sortino), ''],
    ['Calmar', r => num(r.calmar), 'CAGR / |Max DD|'],
    ['Max Drawdown', r => pct(r.max_dd), ''],
    ['Benchmark Max DD', r => pct(r.bench_max_dd), ''],
    ['Drawdown Duration', r => r.dd_duration + ' mo', 'Longest underwater stretch'],
    ['Win Rate', r => pct(r.win_rate, 1), 'Share of positive months'],
    ['Profit Factor', r => num(r.profit_factor), 'Sum of gains / sum of losses'],
    ['Best Month', r => pct(r.best_month), ''],
    ['Worst Month', r => pct(r.worst_month), ''],
    ['Avg Gain', r => pct(r.avg_gain), ''],
    ['Avg Loss', r => pct(r.avg_loss), ''],
    ['Expectancy', r => pct(r.expectancy), 'Mean monthly return'],
    ['Beta', r => num(r.beta), 'Realised, vs benchmark'],
    ['Correlation', r => num(r.corr_bench), 'vs benchmark'],
    ['Tracking Error', r => pct(r.tracking_error), ''],
    ['Information Ratio', r => num(r.info_ratio), ''],
    ['VaR 95%', r => pct(r.var95), 'Monthly'],
    ['CVaR 95%', r => pct(r.cvar95), ''],
    ['VaR 99%', r => pct(r.var99), ''],
    ['CVaR 99%', r => pct(r.cvar99), ''],
    ['Ex-Ante Sharpe (avg)', r => num(r.exante_sharpe_avg), "Engine's forecast at formation"],
    ['Ex-Ante Sortino (avg)', r => num(r.exante_sortino_avg), ''],
    ['Ex-Ante Beta (latest)', r => num(r.exante_beta_current), ''],
    ['Avg Positions', r => num(r.avg_stocks, 1), 'Names in the book, monthly average']
  ];

  document.getElementById('execTable').innerHTML = `
    <thead><tr><th>Metric</th>${VKEYS.map(v =>
      `<th style="color:${VARIANTS[v].color}">${VARIANTS[v].short}</th>`).join('')}<th>Note</th></tr></thead>
    <tbody>${rowsSpec.map(([label, fn, note]) => `
      <tr>
        <td>${label}</td>
        ${VKEYS.map(v => `<td class="mono">${fn(M.runs[`${state.universe}_${v}`])}</td>`).join('')}
        <td class="text-muted" style="font-size:.68rem">${note}</td>
      </tr>`).join('')}</tbody>`;

  document.getElementById('crossTable').innerHTML = `
    <thead><tr><th>Universe</th>${VKEYS.map(v =>
      `<th style="color:${VARIANTS[v].color}">${VARIANTS[v].short}</th>`).join('')}<th>Benchmark</th></tr></thead>
    <tbody>${M.meta.universes.map(u => `
      <tr${u.key === state.universe ? ' style="background:rgba(34,211,238,.06)"' : ''}>
        <td>${u.name}</td>
        ${VKEYS.map(v => {
          const r = M.runs[`${u.key}_${v}`];
          return `<td class="mono" style="line-height:1.5">
            <span class="text-emerald">${pct(r.cagr, 1)}</span><br>
            <span class="text-muted" style="font-size:.68rem">SR ${num(r.sharpe)} · DD ${pct(r.max_dd, 1)}</span>
          </td>`;
        }).join('')}
        <td class="mono text-muted">${pct(M.runs[`${u.key}_base`].bench_cagr, 1)}<br>
          <span style="font-size:.68rem">${M.runs[`${u.key}_base`].bench_name}</span></td>
      </tr>`).join('')}</tbody>`;
}

/* ══════════════════════════════════════════════
   BULLION ANALYTICS
══════════════════════════════════════════════ */
function renderBullion() {
  const g = M.bullion_bh.GOLDBEES, s = M.bullion_bh.SILVERBEES;
  const corr = M.corr_matrix;

  const kpis = [
    { label: 'Gold CAGR', value: pct(g.cagr, 1), color: '#f4b942', sub: `vol ${pct(g.vol, 1)}` },
    { label: 'Silver CAGR', value: pct(s.cagr, 1), color: '#9fb3c8', sub: `vol ${pct(s.vol, 1)}` },
    { label: 'Gold vs Equity', value: num(corr['Equity Strategy'].GOLDBEES), color: 'var(--cyan)', sub: 'correlation' },
    { label: 'Silver vs Equity', value: num(corr['Equity Strategy'].SILVERBEES), color: 'var(--cyan)', sub: 'correlation' },
    { label: 'Gold Max DD', value: pct(g.max_dd, 1), color: 'var(--rose)', sub: 'over the window' },
    { label: 'Silver Max DD', value: pct(s.max_dd, 1), color: 'var(--rose)', sub: 'over the window' }
  ];
  document.getElementById('bullionKpis').innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--accent:${k.color}">
      <span class="kpi-label">${k.label}</span>
      <span class="kpi-value" style="color:${k.color}">${k.value}</span>
      <span class="kpi-delta">${k.sub}</span>
    </div>`).join('');

  const keys = Object.keys(corr);
  const cc = v => {
    const a = Math.min(Math.abs(v), 1);
    return v >= 0 ? `rgba(244,63,94,${0.06 + 0.5 * a})` : `rgba(16,185,129,${0.06 + 0.5 * a})`;
  };
  document.getElementById('correlation-container').innerHTML = `
    <table class="data-table">
      <thead><tr><th></th>${keys.map(k => `<th style="font-size:.65rem">${k}</th>`).join('')}</tr></thead>
      <tbody>${keys.map(a => `
        <tr><td style="font-size:.7rem">${a}</td>
          ${keys.map(b => {
            const v = corr[a][b];
            return `<td class="mono" style="background:${a === b ? 'transparent' : cc(v)};text-align:center">${num(v)}</td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
    </table>
    <p class="card-sub" style="margin-top:.75rem;display:block;line-height:1.5">
      Gold and silver are effectively uncorrelated with the indices and mildly negatively
      correlated with the equity strategy itself — that is what lets a fixed sleeve cut
      drawdown without giving up much return. Green cells are negative correlation.
    </p>`;

  const bm = M.bullion_monthly;
  mkChart('bullionChart', 'bar', {
    labels: bm.months.map(fmtMonth),
    datasets: [
      { label: 'GOLDBEES', data: bm.gold_bh.map(v => v * 100), backgroundColor: '#f4b942cc', borderColor: '#f4b942' },
      { label: 'SILVERBEES', data: bm.silver_bh.map(v => v * 100), backgroundColor: '#9fb3c8cc', borderColor: '#9fb3c8' }
    ]
  }, {
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } } },
    scales: { y: { ticks: { callback: v => v + '%' } } }
  });

  document.getElementById('crisisTable').innerHTML = `
    <thead><tr>
      <th>Month</th><th>Nifty 500</th><th>Equity Only</th><th>GOLDBEES</th><th>SILVERBEES</th>
      <th>Equity + Gold + Silver</th><th>Cushion</th>
    </tr></thead>
    <tbody>${M.crisis.map(c => `
      <tr>
        <td>${fmtMonth(c.month)}</td>
        <td class="mono text-rose">${pct(c.bench)}</td>
        <td class="mono ${tone(c.equity)}">${pct(c.equity)}</td>
        <td class="mono ${tone(c.gold)}">${pct(c.gold)}</td>
        <td class="mono ${tone(c.silver)}">${pct(c.silver)}</td>
        <td class="mono ${tone(c.overlay)}" style="font-weight:700">${pct(c.overlay)}</td>
        <td class="mono ${tone(c.overlay - c.equity)}">${spct(c.overlay - c.equity)}</td>
      </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7" class="text-muted" style="font-size:.68rem;padding-top:.6rem">
      The six worst months for the Nifty 500 over the window. "Cushion" compares the Nifty 500
      overlay book against the same book with no bullion. ETF returns here follow the engine's
      trade convention (buy at the month's open, sell at its close).
    </td></tr></tfoot>`;

  const fh = M.bullion_full_history;
  const rows = [
    ['GOLDBEES', M.bullion_bh.GOLDBEES, fh.GOLDBEES, '#f4b942'],
    ['SILVERBEES', M.bullion_bh.SILVERBEES, fh.SILVERBEES, '#9fb3c8'],
    ['50 / 50 Gold + Silver', M.bullion_bh.BULLION_5050, null, '#cbd5e1']
  ];
  document.getElementById('bullionTable').innerHTML = `
    <thead><tr>
      <th>Asset</th><th>CAGR</th><th>Volatility</th><th>Sharpe</th><th>Max DD</th>
      <th>Corr vs Nifty 500</th><th>Best Month</th><th>Worst Month</th>
      <th>Full History</th><th>Full-History CAGR</th>
    </tr></thead>
    <tbody>${rows.map(([name, b, f, col]) => `
      <tr>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:.5rem"></span>${name}</td>
        <td class="mono text-emerald">${pct(b.cagr)}</td>
        <td class="mono">${pct(b.vol)}</td>
        <td class="mono text-cyan">${num(b.sharpe)}</td>
        <td class="mono text-rose">${pct(b.max_dd)}</td>
        <td class="mono">${num(b.corr_bench)}</td>
        <td class="mono text-emerald">${pct(b.best_month)}</td>
        <td class="mono text-rose">${pct(b.worst_month)}</td>
        <td class="mono text-muted">${f ? `${fmtMonth(f.start)} – ${fmtMonth(f.end)}` : '—'}</td>
        <td class="mono">${f ? pct(f.cagr) : '—'}</td>
      </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="10" class="text-muted" style="font-size:.68rem;padding-top:.6rem">
      Every column left of "Full History" covers the ${M.meta.window.months}-month backtest window
      (${fmtMonth(M.meta.window.first)} – ${fmtMonth(M.meta.window.last)}) on a buy-and-hold basis, so it is
      directly comparable with the strategy runs. "Full History" is the ETF's entire price record —
      GOLDBEES back to ${fmtMonth(fh.GOLDBEES.start)}, SILVERBEES only to ${fmtMonth(fh.SILVERBEES.start)},
      which is what bounds the backtest window.
    </td></tr></tfoot>`;
}

/* ══════════════════════════════════════════════
   LIVE PORTFOLIO
══════════════════════════════════════════════ */
function renderPortfolio() {
  const b = book();
  const equityW = 1 - b.metal_weight;
  const topSector = b.sectors.find(s => !s[0].startsWith('Bullion'));
  const nMetals = b.holdings.filter(h => h.is_metal).length;

  const kpis = [
    { label: 'Portfolio Month', value: fmtMonth(b.portfolio_month + '-01'), color: 'var(--cyan)', sub: 'signal month' },
    { label: 'Positions', value: b.n_positions, color: 'var(--cyan)', sub: `${b.n_positions - nMetals} stocks + ${nMetals} ETFs` },
    { label: 'Ex-Ante Beta', value: num(b.exante_beta), color: 'var(--gold)', sub: 'at formation' },
    { label: 'Bullion Weight', value: pct(b.metal_weight, 0), color: '#f4b942', sub: '10% gold + 10% silver' },
    { label: 'Equity Weight', value: pct(equityW, 0), color: 'var(--emerald)', sub: 'stock sleeve' },
    { label: 'Top Sector', value: pct(topSector[1], 1), color: 'var(--emerald)', sub: topSector[0] }
  ];
  document.getElementById('portKpis').innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--accent:${k.color}">
      <span class="kpi-label">${k.label}</span>
      <span class="kpi-value" style="color:${k.color}">${k.value}</span>
      <span class="kpi-delta">${k.sub}</span>
    </div>`).join('');

  document.getElementById('book-sub').textContent =
    `${UNIV_LABEL[state.universe]} — Equity + Gold + Silver book formed on the ${fmtMonth(b.portfolio_month + '-01')} close and held through the following month. This tab always shows the full overlay book, whichever sleeve is selected above.`;

  renderHoldings();
  renderSectorPie('portSector');
}

function renderHoldings() {
  const b = book();
  const amt = +document.getElementById('pinv-amt').value || 0;
  document.getElementById('holdingsBody').innerHTML = b.holdings.map(h => `
    <tr${h.is_metal ? ' style="background:rgba(244,185,66,.08)"' : ''}>
      <td class="mono text-muted">${h.rank}</td>
      <td class="mono" style="font-weight:600;color:${h.is_metal ? '#f4b942' : 'var(--cyan)'}">${h.symbol}</td>
      <td class="text-muted" style="font-size:.7rem">${h.sector}</td>
      <td class="mono">${pct(h.weight, 2)}</td>
      <td class="mono ${h.beta < 0 ? 'text-emerald' : ''}">${num(h.beta)}</td>
      <td class="mono">${num(h.erb)}</td>
      <td class="mono text-emerald">${money(h.weight * amt)}</td>
    </tr>`).join('');
  const total = b.holdings.reduce((a, h) => a + h.weight, 0) * amt;
  document.getElementById('pinv-total').textContent = money(total);
}

function recalcPortInvest() { renderHoldings(); }
window.recalcPortInvest = recalcPortInvest;

function renderSectorPie(canvasId) {
  const b = book();
  const top = b.sectors.slice(0, 10);
  const rest = b.sectors.slice(10).reduce((a, s) => a + s[1], 0);
  const labels = top.map(s => s[0]).concat(rest > 0.0001 ? ['Other'] : []);
  const values = top.map(s => +(s[1] * 100).toFixed(2)).concat(rest > 0.0001 ? [+(rest * 100).toFixed(2)] : []);
  const palette = ['#22d3ee', '#10b981', '#f59e0b', '#f4b942', '#9fb3c8', '#8b5cf6',
                   '#ec4899', '#14b8a6', '#eab308', '#64748b', '#475569'];
  const colors = labels.map((l, i) =>
    l === 'Bullion - Gold ETF' ? '#f4b942' :
    l === 'Bullion - Silver ETF' ? '#9fb3c8' : palette[i % palette.length]);

  mkChart(canvasId, 'doughnut', {
    labels,
    datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
  }, {
    cutout: '58%',
    interaction: { mode: 'nearest', intersect: true },
    plugins: {
      legend: { position: 'right', labels: { boxWidth: 8, font: { size: 9 } } },
      tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed.toFixed(1)}%` } }
    },
    scales: {}
  });
}

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('som-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  Chart.defaults.color = savedTheme === 'light' ? '#475569' : '#94a3b8';
  Chart.defaults.font.family = "'Inter', sans-serif";

  if (window.particlesJS) {
    particlesJS('particles-js', {
      particles: {
        number: { value: 25, density: { enable: true, value_area: 900 } },
        color: { value: ['#22d3ee', '#f4b942'] },
        shape: { type: 'circle' },
        opacity: { value: 0.12, random: true },
        size: { value: 1.5, random: true },
        line_linked: { enable: true, distance: 160, color: '#22d3ee', opacity: 0.06, width: 1 },
        move: { enable: true, speed: 0.4, random: true, out_mode: 'out' }
      },
      interactivity: { events: { onhover: { enable: true, mode: 'grab' } } },
      retina_detect: true
    });
  }

  renderVariantTabs();
  renderHeader();
  renderTab('overview');
});
