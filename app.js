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
  universe: 'T759',
  variant: 'goldsilver',
  tab: 'overview',
  heatVariant: 'goldsilver',
  chartTypes: { equityOverview: 'line', equityMain: 'line', bullionChart: 'bar' }
};
const charts = {};

/* ── SIZING MODE ─────────────────────────────────
   'model' shows the engine's own book, sized against Rs.1 crore, where rounding
   a position to whole shares is immaterial.

   'amount' adjusts that same history for a real rupee figure. Each month the
   published book is re-sized into whole shares with a one-share floor, and the
   ONLY thing carried across is what that rounding did to the month:

       adjustment = return at achieved weights - return at target weights
       month      = the model's own month + adjustment

   Anchoring to the model this way is deliberate. Rebuilding the return from the
   holdings alone would also swap out the engine's accounting — it carries
   positions at average cost and books their P&L on rebalance, which a fresh
   buyer of the published book does not — and that is worth about 4pp of CAGR
   over this window. That difference is a property of the method, not of the
   amount, so it is held constant: at a large amount the adjustment vanishes and
   the numbers converge on the published ones, which is the behaviour you want.

   Capital compounds, so the lumpiness eases as the book grows. */
let sizing = { mode: 'model', amount: 100000 };
const _seriesCache = {};

function haveBooks(u, v) {
  return typeof MONTHLY_HOLDINGS !== 'undefined' && !!MONTHLY_HOLDINGS[`${u}_${v}`];
}

/* The book's return at its target weights — the no-rounding reference. */
function exactReturn(holds) {
  const priced = holds.filter(h => h.p != null && h.r != null && h.w != null);
  const wsum = priced.reduce((a, h) => a + h.w, 0);
  if (!wsum) return null;
  return priced.reduce((a, h) => a + (h.w / wsum) * (h.r / 100), 0);
}

function amountSeries(u, v) {
  const ck = `${u}_${v}_${sizing.amount}`;
  if (_seriesCache[ck]) return _seriesCache[ck];

  const books = MONTHLY_HOLDINGS[`${u}_${v}`] || {};
  const model = mon(u, v);
  const out = { rets: [], adj: [], overshoot: 0, minAmount: 0 };
  let wealth = sizing.amount;
  model.forEach(row => {
    const holds = books[row.trade_month] || [];
    const s = sizeBook(holds, wealth);
    const exact = exactReturn(holds);
    const adj = (s.ret == null || exact == null) ? 0 : s.ret / 100 - exact;
    const r = row.port_ret + adj;
    out.rets.push(r);
    out.adj.push(adj);
    if (s.invested > wealth) out.overshoot = Math.max(out.overshoot, s.invested / wealth - 1);
    out.minAmount = Math.max(out.minAmount, s.invested);
    wealth *= (1 + r);
  });
  out.final = wealth;
  _seriesCache[ck] = out;
  return out;
}

/* Every headline statistic, recomputed from a monthly return series — the same
   definitions the Python extractor uses, so model and amount modes are directly
   comparable. */
function computeMetrics(port, bench, rf) {
  const n = port.length, yrs = n / 12;
  const sum = a => a.reduce((x, y) => x + y, 0);
  const mean = a => a.length ? sum(a) / a.length : 0;
  const sd = a => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
  };
  const S12 = Math.sqrt(12);
  // The risk-free rate moves month to month; a single average would shift Sharpe
  // and Sortino by a couple of basis points against the published figures.
  const rfArr = Array.isArray(rf) ? rf : port.map(() => rf);

  const growth = port.reduce((a, r) => a * (1 + r), 1);
  const bgrowth = bench.reduce((a, r) => a * (1 + r), 1);
  const cagr = growth ** (1 / yrs) - 1;
  const bcagr = bgrowth ** (1 / yrs) - 1;

  const excess = port.map((r, i) => r - rfArr[i] / 12);
  const negDev = Math.sqrt(mean(excess.map(x => Math.min(x, 0) ** 2))) * S12;

  let eq = 1, peak = 0, mdd = 0, under = 0, longest = 0;
  port.forEach(r => {
    eq *= (1 + r); peak = Math.max(peak, eq);
    const dd = eq / peak - 1;
    mdd = Math.min(mdd, dd);
    under = dd < -1e-9 ? under + 1 : 0;
    longest = Math.max(longest, under);
  });
  let beq = 1, bpeak = 0, bmdd = 0;
  bench.forEach(r => { beq *= (1 + r); bpeak = Math.max(bpeak, beq); bmdd = Math.min(bmdd, beq / bpeak - 1); });

  const wins = port.filter(r => r > 0), losses = port.filter(r => r <= 0);
  const downside = port.filter(r => r < 0);      // strictly negative, unlike `losses`
  const mp = mean(port), mb = mean(bench);
  const cov = sum(port.map((r, i) => (r - mp) * (bench[i] - mb))) / (n - 1);
  const bvar = sd(bench) ** 2;
  const active = port.map((r, i) => r - bench[i]);
  const te = sd(active) * S12;
  const srt = [...port].sort((a, b) => a - b);
  // Linear-interpolated percentile, matching numpy's default.
  const q = p => {
    const pos = p / 100 * (srt.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return srt[lo] + (pos - lo) * (srt[hi] - srt[lo]);
  };
  const var95 = q(5), var99 = q(1);
  const tail = t => { const s = srt.filter(x => x <= t); return s.length ? mean(s) : t; };

  return {
    months: n, years: yrs, growth_of_1: growth, total_return: growth - 1,
    cagr, bench_cagr: bcagr, alpha_ann: cagr - bcagr, bench_total_return: bgrowth - 1,
    vol: sd(port) * S12, bench_vol: sd(bench) * S12,
    downside_dev: downside.length > 1 ? sd(downside) * S12 : NaN,
    sharpe: sd(excess) > 0 ? mean(excess) / sd(excess) * S12 : NaN,
    sortino: negDev > 0 ? mean(excess) * 12 / negDev : NaN,
    max_dd: mdd, bench_max_dd: bmdd, dd_duration: longest,
    calmar: mdd ? cagr / Math.abs(mdd) : NaN,
    win_rate: wins.length / n,
    profit_factor: losses.length && sum(losses) !== 0 ? sum(wins) / Math.abs(sum(losses)) : Infinity,
    best_month: Math.max(...port), worst_month: Math.min(...port),
    avg_gain: wins.length ? mean(wins) : 0, avg_loss: losses.length ? mean(losses) : 0,
    expectancy: mp,
    beta: bvar ? cov / bvar : NaN,
    corr_bench: (sd(port) * sd(bench)) ? cov / (sd(port) * sd(bench)) : NaN,
    tracking_error: te, info_ratio: te > 0 ? mean(active) * 12 / te : NaN,
    var95, var99, cvar95: tail(var95), cvar99: tail(var99),
    rf_avg: mean(rfArr)
  };
}

const _metricCache = {};
function amountMetrics(u, v) {
  const ck = `${u}_${v}_${sizing.amount}`;
  if (_metricCache[ck]) return _metricCache[ck];
  const model = M.runs[`${u}_${v}`];
  const s = amountSeries(u, v);
  const m = computeMetrics(s.rets, benchRets(u), mon(u, 'base').map(r => r.rf));
  // Carry over what does not depend on sizing: labels, sleeve weights, and the
  // engine's ex-ante forecasts (made at formation, before any rupee figure).
  _metricCache[ck] = {
    ...model, ...m,
    bench_name: model.bench_name, variant_name: model.variant_name,
    universe_name: model.universe_name,
    stock_w: model.stock_w, gold_w: model.gold_w, silver_w: model.silver_w,
    final_value: s.final, overshoot: s.overshoot, min_amount: s.minAmount,
    sized: true
  };
  return _metricCache[ck];
}

/* ── DATA ACCESSORS ──────────────────────────── */
function sized(u = state.universe, v = state.variant) {
  return sizing.mode === 'amount' && haveBooks(u, v);
}
function run(u = state.universe, v = state.variant) {
  return sized(u, v) ? amountMetrics(u, v) : M.runs[`${u}_${v}`];
}
function mon(u = state.universe, v = state.variant) { return M.monthly[`${u}_${v}`]; }
function months(u = state.universe) { return mon(u, 'base').map(r => r.trade_month); }
function benchRets(u = state.universe) { return mon(u, 'base').map(r => r.bench_ret); }
function portRets(u = state.universe, v = state.variant) {
  return sized(u, v) ? amountSeries(u, v).rets : mon(u, v).map(r => r.port_ret);
}

/* Month counts, off whichever series is in force, so they follow the sizing mode. */
function monthTally(u = state.universe, v = state.variant) {
  const p = portRets(u, v), b = benchRets(u);
  let positive = 0, beat = 0;
  p.forEach((r, i) => {
    if (r > 0) positive++;
    if (r > b[i]) beat++;
  });
  return { positive, beat, total: p.length };
}
/* The current book, with sectors re-derived from SECTOR_MAP (built from the price
   files' own Industry column). The constituent lists only cover the Nifty 500, so
   without this most of the All-Indices book reads "Other / Unclassified". */
const _bookCache = {};
function book() {
  const u = state.universe;
  if (_bookCache[u]) return _bookCache[u];
  const src = M.holdings[u];
  if (typeof SECTOR_MAP === 'undefined') return src;

  const holdings = src.holdings.map(h => ({ ...h, sector: SECTOR_MAP[h.symbol] || h.sector }));
  const agg = {};
  holdings.forEach(h => { agg[h.sector] = (agg[h.sector] || 0) + h.weight; });
  _bookCache[u] = {
    ...src,
    holdings,
    sectors: Object.entries(agg).sort((a, b) => b[1] - a[1]),
    unclassified: holdings.filter(h => h.sector === 'Other / Unclassified').length
  };
  return _bookCache[u];
}

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

function setSizingMode(mode) {
  sizing.mode = mode;
  sharedInvest = sizing.amount;
  renderSizingBar();
  renderHeader();
  renderTab(state.tab);
}

let _amtTimer = null;
function setAmount(v) {
  const n = Math.max(1000, +v || 0);
  sizing.amount = n;
  sharedInvest = n;
  // Typing a figure is a statement of intent — switch into amount mode for it.
  sizing.mode = 'amount';
  clearTimeout(_amtTimer);
  _amtTimer = setTimeout(() => {
    renderSizingBar();
    renderHeader();
    renderTab(state.tab);
  }, 250);
}

window.setSizingMode = setSizingMode;
window.setAmount = setAmount;

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
  const head = ['Month', ...VKEYS.map(v => VARIANTS[v].label), M.runs[`${u}_base`].bench_name, 'Status'];
  const rows = ms.map((m, i) =>
    [m, ...VKEYS.map(v => (portRets(u, v)[i] * 100).toFixed(4)), (b[i] * 100).toFixed(4), 'complete']);
  if (M.live) {
    const lb = M.live.runs[`${u}_base`].bench_ret;
    rows.push([M.live.month,
      ...VKEYS.map(v => (M.live.runs[`${u}_${v}`].port_ret * 100).toFixed(4)),
      (lb * 100).toFixed(4), `live month-to-date as of ${M.live.as_of} — excluded from all statistics`]);
  }
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
/* The in-progress month, if the data has one. Its return is month-to-date, so it
   is deliberately kept out of every statistic and shown on its own. */
function liveRow(u = state.universe, v = state.variant) {
  if (!M.live) return null;
  const model = M.live.runs[`${u}_${v}`];
  if (!model || !sized(u, v)) return model;
  // Same adjustment as the history: size the live book against what the amount
  // has compounded to, and carry across only what the rounding changed.
  const books = MONTHLY_HOLDINGS[`${u}_${v}`] || {};
  const holds = books[M.live.month] || [];
  const s = sizeBook(holds, amountSeries(u, v).final);
  const exact = exactReturn(holds);
  if (s.ret == null || exact == null) return model;
  return { ...model, port_ret: model.port_ret + (s.ret / 100 - exact) };
}

function renderHeader() {
  const w = M.meta.window, r = run();
  document.getElementById('last-refresh').textContent = 'Terminal Updated: ' + M.meta.generated;
  const liveNote = M.live
    ? ` · ${fmtMonth(M.live.month)} is live (month-to-date to ${M.live.as_of}) and is excluded from every statistic`
    : '';
  const sizeNote = sizing.mode === 'amount'
    ? ` · sized for ${money(sizing.amount)}, whole shares`
    : ' · model book, ₹1 Cr';
  document.getElementById('backtest-period').textContent =
    `Backtest: ${fmtMonth(w.first)} – ${fmtMonth(w.last)} · ${w.months} completed months · window starts at SILVERBEES inception (May 2022) · all metrics computed over this period${sizeNote}${liveNote}`;

  /* The header regime badge ("Bullion: return up, drawdown down") was removed:
     it editorialised the sleeve comparison in the masthead, where the same
     figures are already reported plainly in the metric tiles below. */

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

function renderSizingBar() {
  const tabs = document.getElementById('sizing-tabs');
  if (tabs) {
    tabs.innerHTML = [['model', 'Model ₹1 Cr'], ['amount', 'Your Amount']].map(([m, label]) =>
      `<button class="layer-tab-btn ${sizing.mode === m ? 'active' : ''}"
         onclick="setSizingMode('${m}')">${label}</button>`).join('');
  }
  const sub = document.getElementById('sizing-sub');
  if (!sub) return;
  if (sizing.mode === 'model') {
    sub.textContent = 'Showing the engine\'s own book, sized against ₹1 crore — share rounding is immaterial at that size. '
      + 'Switch to Your Amount to re-derive every statistic from what your money could actually buy.';
  } else {
    const r = run();
    const over = r.overshoot ? ` Largest month needed ${pct(r.overshoot, 1)} more than the capital on hand at the time.` : '';
    sub.textContent = `Every statistic below is restated for ${money(sizing.amount)}: each month's book re-sized into whole `
      + `shares (minimum 1 of each), and only what that rounding changed is carried onto the published month. `
      + `Capital compounds, so the effect fades as the book grows — at a large enough amount the numbers converge on the model's.${over}`;
  }
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

  const t = monthTally();
  const kpis = [
    { label: 'CAGR', value: pct(r.cagr, 2), color: 'var(--emerald)',
      sub: `${r.bench_name} ${pct(r.bench_cagr, 2)}` },
    { label: 'Alpha (ann.)', value: spct(r.alpha_ann, 2),
      color: r.alpha_ann >= 0 ? 'var(--emerald)' : 'var(--rose)', sub: `vs ${r.bench_name}` },
    // The engine's forecast at formation — made before any rupee figure, so it
    // does not move with the Portfolio Size setting.
    { label: 'Ex-Ante Sharpe', value: num(r.exante_sharpe_avg), color: 'var(--cyan)',
      sub: `latest ${num(r.exante_sharpe_current)} · realised ${num(r.sharpe)}` },
    { label: 'Max Drawdown', value: pct(r.max_dd, 2), color: 'var(--rose)',
      sub: `${r.dd_duration} mo underwater` },
    { label: 'Volatility', value: pct(r.vol, 2), color: 'var(--gold)', sub: `Beta ${num(r.beta)}` },
    { label: 'Positive Months', value: `${t.positive} / ${t.total}`, color: 'var(--emerald)',
      sub: `${pct(t.positive / t.total, 1)} of months in profit` },
    { label: `Beat ${r.bench_name}`, value: `${t.beat} / ${t.total}`,
      color: t.beat * 2 >= t.total ? 'var(--emerald)' : 'var(--rose)',
      sub: `${pct(t.beat / t.total, 1)} of months outperformed` }
  ];
  if (r.sized) {
    kpis.push({
      label: `${money(sizing.amount)} would be`, value: money(r.final_value),
      color: 'var(--cyan)', sub: `${spct(r.total_return, 1)} over ${r.months} months`
    });
    const model = M.runs[`${state.universe}_${state.variant}`];
    kpis.push({
      label: 'vs Model Book', value: spct(r.cagr - model.cagr, 2),
      color: r.cagr >= model.cagr ? 'var(--emerald)' : 'var(--rose)',
      sub: `model CAGR ${pct(model.cagr, 2)}`
    });
  }
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

  renderLiveStrip();
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

/* The current, unfinished month: every sleeve's month-to-date against the
   benchmark and the two ETFs. Never folded into CAGR, Sharpe or drawdown. */
function renderLiveStrip() {
  const card = document.getElementById('live-card');
  if (!M.live) { card.style.display = 'none'; return; }
  card.style.display = '';

  const lr = liveRow();
  document.getElementById('live-title').textContent =
    `Live Month — ${fmtMonth(M.live.month)}`;
  document.getElementById('live-sub').textContent =
    `Book formed on the ${fmtMonth(M.meta.window.last)} close and held through ${fmtMonth(M.live.month)}. ` +
    `Month-to-date as of ${M.live.as_of} — the month has not finished, so these figures are excluded from every statistic on this site.`;

  const bench = lr ? lr.bench_ret : null;
  const rows = VKEYS.map(v => {
    const row = liveRow(state.universe, v);
    return {
      label: VARIANTS[v].label, color: VARIANTS[v].color,
      val: row ? row.port_ret : null,
      vs: row && bench != null ? row.port_ret - bench : null
    };
  });

  const assets = [
    { label: run().bench_name, color: BENCH_COLOR, val: bench, vs: null },
    { label: 'GOLDBEES', color: '#f4b942', val: M.live.gold, vs: null },
    { label: 'SILVERBEES', color: '#9fb3c8', val: M.live.silver, vs: null }
  ];

  const line = r => `
    <tr${r.label === VARIANTS[state.variant].label ? ' style="background:rgba(34,211,238,.06)"' : ''}>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color};margin-right:.5rem"></span>${r.label}</td>
      <td class="mono ${tone(r.val)}" style="font-weight:600">${r.val == null ? '—' : spct(r.val)}</td>
      <td class="mono ${r.vs == null ? '' : tone(r.vs)}">${r.vs == null ? '' : spct(r.vs)}</td>
    </tr>`;

  document.getElementById('live-container').innerHTML = `
    <table class="data-table">
      <thead><tr><th>${fmtMonth(M.live.month)} month-to-date</th><th>Return</th><th>vs Benchmark</th></tr></thead>
      <tbody>
        ${rows.map(line).join('')}
        <tr><td colspan="3" style="height:.4rem;border:none"></td></tr>
        ${assets.map(line).join('')}
      </tbody>
    </table>`;
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
  const rets = portRets(state.universe, variant);
  months().forEach((m, i) => {
    const yr = m.slice(0, 4), mo = +m.slice(5, 7) - 1;
    if (!grid[yr]) grid[yr] = new Array(12).fill(null);
    grid[yr][mo] = +(rets[i] * 100).toFixed(2);
  });

  // The live month gets its own cell — shown, but kept out of the year total
  // because it is only a part-month.
  const lr = liveRow(state.universe, variant);
  const liveM = lr ? M.live.month : null;
  const liveVal = lr ? +(lr.port_ret * 100).toFixed(2) : null;
  if (liveM && !grid[liveM.slice(0, 4)]) grid[liveM.slice(0, 4)] = new Array(12).fill(null);

  const years = Object.keys(grid).sort((a, b) => +b - +a);
  let html = '<div class="heatmap-wrap"><div class="heatmap-grid">';
  html += '<div class="hm-head">Year</div>' + MON.map(m => `<div class="hm-head">${m}</div>`).join('')
        + '<div class="hm-head">Total</div>';

  years.forEach(yr => {
    html += `<div class="hm-year">${yr}</div>`;
    grid[yr].forEach((val, mi) => {
      const monthStr = `${yr}-${String(mi + 1).padStart(2, '0')}`;
      if (monthStr === liveM) {
        html += `<div class="hm-cell" style="background:rgba(56,189,248,0.18);color:#38bdf8;font-weight:700;
          outline:1px dashed rgba(56,189,248,.5);outline-offset:-2px"
          onclick="openHeatModal('${monthStr}')"
          title="${monthStr}: LIVE — ${liveVal > 0 ? '+' : ''}${liveVal}% month-to-date as of ${M.live.as_of}. The month is unfinished, so it is excluded from the year total and from every statistic.">${liveVal > 0 ? '+' : ''}${liveVal}</div>`;
      } else if (val === null) {
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
      const liveNote = (liveM && liveM.slice(0, 4) === yr)
        ? ` — excludes the live ${fmtMonth(liveM)} cell` : '';
      html += `<div class="hm-cell hm-total" style="background:${bg};color:${fg}"
        title="${yr} compounded over the ${got.length} completed month(s) inside the window: ${total}%${liveNote}">${total > 0 ? '+' : ''}${total}</div>`;
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

/* Return for one universe/sleeve in a given month, live month included. */
function retIn(u, v, monthStr) {
  if (M.live && monthStr === M.live.month) return M.live.runs[`${u}_${v}`]?.port_ret ?? null;
  const i = months(u).indexOf(monthStr);
  return i < 0 ? null : portRets(u, v)[i];
}
function benchIn(u, monthStr) {
  if (M.live && monthStr === M.live.month) return M.live.runs[`${u}_base`]?.bench_ret ?? null;
  const i = months(u).indexOf(monthStr);
  return i < 0 ? null : benchRets(u)[i];
}

let modalHolds = [];

/* The book that produced a heatmap cell: the month's KPIs, every sleeve's return,
   and the actual holdings with their contributions. */
function openHeatModal(monthStr) {
  const isLive = M.live && monthStr === M.live.month;
  if (!isLive && months().indexOf(monthStr) < 0) return;

  const v = state.heatVariant;
  const key = `${state.universe}_${v}`;
  const bench = benchIn(state.universe, monthStr);
  const bm = M.bullion_monthly, bi = isLive ? -1 : bm.months.indexOf(monthStr);
  const goldVal = isLive ? M.live.gold : (bi >= 0 ? bm.gold_bh[bi] : null);
  const silverVal = isLive ? M.live.silver : (bi >= 0 ? bm.silver_bh[bi] : null);

  const meta = (typeof MONTH_META !== 'undefined' && MONTH_META[key]?.[monthStr]) || {};
  const holds = ((typeof MONTHLY_HOLDINGS !== 'undefined' && MONTHLY_HOLDINGS[key]?.[monthStr]) || [])
    .map(h => ({ ...h, sec: h.m ? (h.s === 'GOLDBEES' ? 'Bullion - Gold ETF' : 'Bullion - Silver ETF')
                                : ((typeof SECTOR_MAP !== 'undefined' && SECTOR_MAP[h.s]) || '—') }));
  modalHolds = holds;

  document.getElementById('modal-month').textContent =
    fmtMonth(monthStr) + (isLive ? `  ·  LIVE, month-to-date as of ${M.live.as_of}` : '');

  /* ── month KPI strip ── */
  const kpiHtml = `
    <div class="modal-row" style="background:rgba(34,211,238,0.05);border-radius:.5rem;padding:.75rem;grid-template-columns:repeat(4,1fr)">
      <div>
        <div class="modal-metric">Nifty 50</div>
        <div class="modal-val" style="color:#94a3b8">${spct(benchIn('N50', monthStr))}</div>
      </div>
      <div>
        <div class="modal-metric">Nifty 500</div>
        <div class="modal-val" style="color:#94a3b8">${spct(benchIn('N500', monthStr))}</div>
      </div>
      <div>
        <div class="modal-metric">Portfolio Beta</div>
        <div class="modal-val" style="color:var(--gold)">${num(meta.port_beta)}</div>
      </div>
      <div>
        <div class="modal-metric">Ex-Ante Sharpe</div>
        <div class="modal-val" style="color:#22d3ee">${num(meta.exante_sharpe)}</div>
      </div>
    </div>`;

  /* ── every sleeve's return for the month ── */
  const sleeveHtml = '<div style="margin-top:1rem">' + VKEYS.map(k => {
    const val = retIn(state.universe, k, monthStr);
    if (val == null) return '';
    const vs = bench == null ? null : val - bench;
    return `<div class="modal-row"${k === v ? ' style="background:rgba(34,211,238,.06);border-radius:.4rem"' : ''}>
      <div><div class="modal-metric" style="color:${VARIANTS[k].color}">${VARIANTS[k].label}</div></div>
      <div>
        <div class="modal-metric">Return</div>
        <div class="modal-val" style="color:${val >= 0 ? '#10b981' : '#f43f5e'}">${spct(val)}</div>
      </div>
      <div>
        <div class="modal-metric">vs ${run().bench_name}</div>
        <div class="modal-val" style="color:${vs == null ? '#64748b' : (vs >= 0 ? '#10b981' : '#f43f5e')}">${vs == null ? 'N/A' : spct(vs)}</div>
      </div>
    </div>`;
  }).join('') + `
    <div class="modal-row">
      <div><div class="modal-metric" style="color:#f4b942">GOLDBEES</div></div>
      <div><div class="modal-metric">Return</div>
        <div class="modal-val" style="color:${(goldVal ?? 0) >= 0 ? '#10b981' : '#f43f5e'}">${spct(goldVal)}</div></div>
      <div><div class="modal-metric" style="color:#9fb3c8">SILVERBEES</div>
        <div class="modal-val" style="color:${(silverVal ?? 0) >= 0 ? '#10b981' : '#f43f5e'}">${spct(silverVal)}</div></div>
    </div>
    ${isLive ? `<div class="modal-row"><div><div class="modal-metric" style="color:#38bdf8">
      This month is still running — everything here is month-to-date and is not used in any
      statistic on this site.</div></div></div>` : ''}
  </div>`;

  /* ── the book that produced it ── */
  const portRet = meta.port_ret != null ? meta.port_ret : (retIn(state.universe, v, monthStr) * 100);
  const held = meta.held_contrib, exited = meta.exited_contrib;
  const sgnPct = (x, d = 2) => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d) + '%';
  const col = x => x == null ? 'text-muted' : (x >= 0 ? 'text-emerald' : 'text-rose');

  const holdingsHtml = `
    <div style="margin-top:1.25rem">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.6rem">
        <div class="modal-metric">${VARIANTS[v].label} — ${holds.length} Holding${holds.length === 1 ? '' : 's'}</div>
        ${holds.length ? `<div style="display:flex;align-items:center;gap:.5rem">
          <span class="modal-metric">Invest</span>
          <span class="mono" style="color:var(--slate)">₹</span>
          <input id="inv-amt" type="number" min="0" step="10000" value="${sharedInvest}" oninput="recalcInvest()"
            style="width:130px;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:.4rem;
                   color:var(--cyan);font-family:var(--mono);font-weight:700;padding:.35rem .5rem;font-size:.8rem">
        </div>` : ''}
      </div>
      ${holds.length ? `
      <div style="border:1px solid var(--border);border-radius:.5rem;overflow:hidden">
        <table class="data-table mini-table">
          <colgroup>
            <col style="width:4%"><col style="width:14%"><col style="width:16%"><col style="width:8%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:11%"><col style="width:7%"><col style="width:14%">
          </colgroup>
          <thead><tr>
            <th>#</th><th>Stock</th><th>Sector</th>
            <th title="Target weight in the model book.">Weight</th>
            <th title="What that weight actually becomes once your amount is rounded to whole shares, with a one-share floor.">Actual</th>
            <th title="Price move across the trade month: open to close.">Return</th>
            <th title="Your achieved weight × the stock's return — its contribution to the return on YOUR amount.">Contrib</th>
            <th title="Execution price for this month — the open of the trade month, what the book was entered at. Quantities are sized against this.">Buy Price</th>
            <th>Qty</th><th>Amount</th>
          </tr></thead>
          <tbody>
            ${holds.map((h, i) => `<tr${h.m ? ' style="background:rgba(244,185,66,.08)"' : ''}>
              <td class="text-muted mono" style="font-size:.65rem">${i + 1}</td>
              <td class="mono" style="font-weight:700;color:${h.m ? '#f4b942' : 'inherit'}">${h.s}</td>
              <td class="text-muted" style="font-size:.68rem">${h.sec}</td>
              <td class="mono text-muted">${h.w != null ? h.w + '%' : '—'}</td>
              <td class="mono" id="iw${i}">—</td>
              <td class="mono ${col(h.r)}">${sgnPct(h.r)}</td>
              <td class="mono" id="ic${i}">—</td>
              <td class="mono"${h.a != null && h.p != null && Math.abs(h.a / h.p - 1) > 0.02
                  ? ` title="Entered at ${money(h.p)}. The engine's carried cost basis is ${money(h.a)} — it has held this position across earlier months, which is why its contribution is not simply weight × return."` : ''}>${h.p != null ? money(h.p) : '—'}</td>
              <td class="mono text-cyan" id="iq${i}" style="font-weight:700">—</td>
              <td class="mono text-emerald" id="ia${i}">—</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--border)">
              <td colspan="6" class="text-muted" style="font-size:.68rem;text-align:right" id="inv-ret-label">Return on your amount</td>
              <td class="mono" id="inv-ret" style="font-weight:700">—</td>
              <td></td>
              <td class="text-muted" style="font-size:.68rem;text-align:right">Invested</td>
              <td class="mono text-emerald" id="inv-total" style="font-weight:700">—</td>
            </tr>
            <tr>
              <td colspan="6" class="text-muted" style="font-size:.65rem;text-align:right;opacity:.8">
                whole shares, minimum 1 of each — so achieved weights differ from target</td>
              <td></td><td></td>
              <td class="text-muted" style="font-size:.68rem;text-align:right" id="inv-cash-label">Cash Left</td>
              <td class="mono" id="inv-cash" style="color:var(--slate)">—</td>
            </tr>
            <tr style="border-top:2px solid var(--border)">
              <td colspan="6" class="text-muted" style="font-size:.68rem;text-align:right">Model book — held positions</td>
              <td class="mono ${col(held)}">${sgnPct(held)}</td><td colspan="3"></td>
            </tr>
            <tr>
              <td colspan="6" class="text-muted" style="font-size:.68rem;text-align:right"
                  title="P&amp;L booked on positions that left the portfolio this month — they are no longer in the book above, so they appear here.">Model book — positions exited</td>
              <td class="mono ${col(exited)}">${sgnPct(exited)}</td><td colspan="3"></td>
            </tr>
            <tr>
              <td colspan="6" class="text-muted" style="font-size:.68rem;text-align:right"
                  title="The engine's own result for the month, on its Rs.1 Cr book where share rounding is immaterial.">Portfolio return (month, model)</td>
              <td class="mono ${col(portRet)}" style="font-weight:700">${sgnPct(portRet)}</td><td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>` : `<div class="text-muted" style="font-size:.75rem">No holdings snapshot for this month.</div>`}
    </div>`;

  document.getElementById('modal-body').innerHTML = kpiHtml + sleeveHtml + holdingsHtml;
  document.getElementById('hmModal').classList.add('open');
  recalcInvest();
}
window.openHeatModal = openHeatModal;

/* Size a book for a real rupee amount, shared by the drill-down and the Live
   Portfolio tab so the amount carries between them.

   Two rules make this differ from the model book:
     - whole shares only, and at least ONE of every holding, so nothing the
       model holds gets rounded away;
     - the achieved weights are therefore not the target weights, so the
       contributions and the portfolio return are recomputed from what was
       actually bought rather than scaled down from the engine's Rs.1 Cr book,
       where the same rounding is immaterial.

   At small amounts a high-priced name can only be bought in a lump, so its
   achieved weight overshoots its target and the book can cost more than the
   amount entered. Both effects are surfaced rather than hidden. */
let sharedInvest = 100000;
const MIN_QTY = 1;

function sizeBook(holds, amount) {
  const rows = holds.map(h => {
    if (h.p == null || h.p <= 0 || h.w == null || !amount) {
      return { h, qty: null, value: 0, actualW: null, contrib: null };
    }
    const qty = Math.max(MIN_QTY, Math.floor(amount * (h.w / 100) / h.p));
    return { h, qty, value: qty * h.p, actualW: null, contrib: null };
  });
  const invested = rows.reduce((a, r) => a + r.value, 0);
  rows.forEach(r => {
    if (r.qty == null || invested <= 0) return;
    r.actualW = r.value / invested * 100;
    if (r.h.r != null) r.contrib = r.actualW / 100 * r.h.r;
  });
  const ret = rows.some(r => r.contrib != null)
    ? rows.reduce((a, r) => a + (r.contrib || 0), 0) : null;
  return { rows, invested, ret, cash: amount - invested };
}

/* Paint a sized book into a table. `ids` gives the per-row cell prefixes and the
   footer element ids, so the drill-down and the Live Portfolio tab share this. */
function paintSizing(holds, amount, ids) {
  const sized = sizeBook(holds, amount);

  sized.rows.forEach((r, i) => {
    const set = (id, txt, cls) => {
      const e = document.getElementById(id + i);
      if (!e) return;
      e.textContent = txt;
      if (cls !== undefined) e.className = cls;
    };
    if (r.qty == null) { set(ids.qty, '—'); set(ids.amt, '—'); set(ids.contrib, '—', 'mono text-muted'); return; }
    set(ids.qty, r.qty.toLocaleString('en-IN'));
    set(ids.amt, money(r.value));
    set(ids.contrib, r.contrib == null ? '—' : (r.contrib >= 0 ? '+' : '') + r.contrib.toFixed(2) + '%',
        'mono ' + (r.contrib == null ? 'text-muted' : (r.contrib >= 0 ? 'text-emerald' : 'text-rose')));
    const wEl = document.getElementById(ids.wt + i);
    if (wEl && r.actualW != null) {
      wEl.textContent = r.actualW.toFixed(2) + '%';
      wEl.title = `Target weight ${r.h.w}% — achieved ${r.actualW.toFixed(2)}% once rounded to whole shares`;
      const off = Math.abs(r.actualW - r.h.w);
      wEl.className = 'mono' + (off > 2 ? ' text-rose' : '');
    }
  });

  const put = (id, txt, cls) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = txt;
    if (cls !== undefined) e.className = cls;
  };
  put(ids.total, money(sized.invested));
  put(ids.ret, sized.ret == null ? '—' : (sized.ret >= 0 ? '+' : '') + sized.ret.toFixed(2) + '%',
      'mono ' + (sized.ret == null ? 'text-muted' : (sized.ret >= 0 ? 'text-emerald' : 'text-rose')));
  put(ids.retLabel, `${ids.retText || 'Return on your'} ${money(amount)}`);

  // With a one-share floor the book can cost more than the amount entered.
  const over = sized.cash < 0;
  put(ids.cashLabel, over ? 'Additional needed for 1 share of each' : 'Cash Left');
  put(ids.cash, money(Math.abs(sized.cash)), 'mono ' + (over ? 'text-rose' : ''));
  return sized;
}

const MODAL_IDS = {
  qty: 'iq', amt: 'ia', contrib: 'ic', wt: 'iw',
  total: 'inv-total', ret: 'inv-ret', retLabel: 'inv-ret-label',
  cash: 'inv-cash', cashLabel: 'inv-cash-label'
};
const PORT_IDS = {
  qty: 'pq', amt: 'pa', contrib: 'pc', wt: 'pw',
  total: 'pinv-total', ret: 'pinv-ret', retLabel: 'pinv-ret-label',
  cash: 'pinv-cash', cashLabel: 'pinv-cash-label',
  retText: 'Month-to-date on your'
};

function recalcInvest() {
  const el = document.getElementById('inv-amt');
  sharedInvest = el ? (+el.value || 0) : sharedInvest;
  paintSizing(modalHolds, sharedInvest, MODAL_IDS);
}
window.recalcInvest = recalcInvest;

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
   PERFORMANCE METRICS
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

  const heldIn = M.live ? fmtMonth(M.live.month) : 'the following month';
  document.getElementById('book-sub').textContent =
    `${UNIV_LABEL[state.universe]} — Equity + Gold + Silver book formed on the ${fmtMonth(b.portfolio_month + '-01')} close and held through ${heldIn}. This tab always shows the full overlay book, whichever sleeve is selected above.`;

  renderHoldings();
  renderSectorPie('portSector');
}

/* Prices for the live book come from the same month's PM snapshot, so the tab can
   size real quantities instead of showing a weight times an amount. */
function liveBookRows() {
  const b = book();
  const key = `${state.universe}_goldsilver`;
  const month = M.live ? M.live.month : null;
  const snap = (typeof MONTHLY_HOLDINGS !== 'undefined' && month && MONTHLY_HOLDINGS[key]?.[month]) || [];
  const byS = {};
  snap.forEach(h => { byS[h.s] = h; });
  return b.holdings.map(h => {
    const s = byS[h.symbol] || {};
    // p = entry price for the live month (its open); x = latest traded price.
    return { ...h, s: h.symbol, w: h.weight * 100, p: s.p ?? null, x: s.x ?? null, r: s.r ?? null };
  });
}

function renderHoldings() {
  const rows = liveBookRows();
  const amt = +document.getElementById('pinv-amt').value || 0;
  document.getElementById('holdingsBody').innerHTML = rows.map((h, i) => `
    <tr${h.is_metal ? ' style="background:rgba(244,185,66,.08)"' : ''}>
      <td class="mono text-muted">${h.rank}</td>
      <td class="mono" style="font-weight:600;color:${h.is_metal ? '#f4b942' : 'var(--cyan)'}">${h.symbol}</td>
      <td class="text-muted" style="font-size:.7rem">${h.sector}</td>
      <td class="mono text-muted">${pct(h.weight, 2)}</td>
      <td class="mono" id="pw${i}">—</td>
      <td class="mono ${h.beta < 0 ? 'text-emerald' : ''}">${num(h.beta)}</td>
      <td class="mono ${h.r == null ? 'text-muted' : (h.r >= 0 ? 'text-emerald' : 'text-rose')}">${h.r == null ? '—' : (h.r >= 0 ? '+' : '') + h.r.toFixed(2) + '%'}</td>
      <td class="mono" id="pc${i}">—</td>
      <td class="mono">${h.p != null ? money(h.p) : '—'}</td>
      <td class="mono text-cyan">${h.x != null ? money(h.x) : '—'}</td>
      <td class="mono text-cyan" id="pq${i}" style="font-weight:700">—</td>
      <td class="mono text-emerald" id="pa${i}">—</td>
    </tr>`).join('');
  paintSizing(rows, amt, PORT_IDS);
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
  renderSizingBar();
  renderHeader();
  renderTab('overview');
});
