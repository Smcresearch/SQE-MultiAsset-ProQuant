/* ══════════════════════════════════════════════════════════════════════════
   FACTSHEET EXPORT — MultiAsset

   Same idea as the factsheet.js shipped on the SQE / SQE-ProQuant dashboards:
   Export Report builds the client-facing factsheet from whatever the dashboard
   currently has loaded and hands it to the browser's PDF printer, instead of
   the old bare window.print() of the terminal itself.

   The data model here is its own thing, so this is a sibling rather than a
   copy — metrics come from runs[universe_variant], the book carries a bullion
   sleeve alongside the equity names, and the document has to state which
   sleeve mix it is describing. Everything is read at click time, so the sheet
   always matches the selected universe, the selected variant, and the latest
   data update.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = {
    model:      'SQE MultiAsset ProQuant',
    modelLong:  'SQE MultiAsset ProQuant — Equity + Bullion',
    siteUrl:    'https://smcresearch.github.io/SQE-MultiAsset-ProQuant/',
    siteLabel:  'smcresearch.github.io/SQE-MultiAsset-ProQuant/',
    logo:       'assets/smc-logo.webp',
    filePrefix: 'SQE_MultiAsset_Factsheet',
    riskLabel:  'High Volatility',
    horizon:    'Long Term',
    maxWeight:  '10%'
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  var SECTOR_COLORS = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9c27b0',
                       '#00bcd4', '#ff5722', '#607d8b', '#795548', '#e91e63'];
  var GOLD = '#f4b942', SILVER = '#9fb3c8';

  /* ── HELPERS ──────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function num(v, dp) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dp == null ? 2 : dp);
  }
  /* Run metrics are stored as fractions; the factsheet prints percentages. */
  function pct(v, dp) {
    return (v == null || isNaN(v)) ? '—' : (Number(v) * 100).toFixed(dp == null ? 2 : dp) + '%';
  }
  function signed(v, dp) {
    if (v == null || isNaN(v)) return '—';
    return (v >= 0 ? '+' : '') + (Number(v) * 100).toFixed(dp == null ? 2 : dp) + '%';
  }
  function monthName(ym) {
    if (!ym) return '—';
    var p = String(ym).split('-');
    return (MONTHS[parseInt(p[1], 10) - 1] || '') + ' ' + p[0];
  }
  function addMonth(ym, n) {
    var p = String(ym).split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function dateName(ymd) {
    if (!ymd) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    return m ? MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[3] + ', ' + m[1] : ymd;
  }

  /* ── DATA ─────────────────────────────────────────────────────────────── */
  function collect() {
    var D = (typeof MULTIASSET_DATA !== 'undefined') ? MULTIASSET_DATA : null;
    if (!D) return null;

    var uKey = (typeof state !== 'undefined' && state && state.universe) || 'N500';
    var vKey = (typeof state !== 'undefined' && state && state.variant) || 'goldsilver';
    var R = D.runs && D.runs[uKey + '_' + vKey];
    if (!R) return null;

    var uni = (D.meta.universes || []).filter(function (u) { return u.key === uKey; })[0] ||
              { key: uKey, name: uKey, bench: 'Nifty 500' };
    var vari = (D.meta.variants || []).filter(function (v) { return v.key === vKey; })[0] ||
               { key: vKey, name: vKey, gold: 0, silver: 0 };

    /* The stored book is always the full gold+silver formation. Rebuilding it
       for another variant is not a simple renormalise: each metal sits at its
       own target weight (0 if the variant does not hold it) and only the equity
       sleeve stretches to fill whatever is left. Renormalising the whole book
       instead would push a single 10% metal up to 11%. */
    var src = (D.holdings && D.holdings[uKey]) || { holdings: [] };
    var secMapG = (typeof SECTOR_MAP !== 'undefined') ? SECTOR_MAP : {};
    var metalTarget = function (sym) {
      if (/GOLD/i.test(sym)) return vari.gold || 0;
      if (/SILVER/i.test(sym)) return vari.silver || 0;
      return 0;
    };
    var raw = (src.holdings || []).map(function (h) {
      return {
        symbol: h.symbol,
        sector: secMapG[h.symbol] || h.sector,
        weight: h.weight,
        beta: h.beta,
        is_metal: !!h.is_metal
      };
    });
    var equityTarget = 1 - (vari.gold || 0) - (vari.silver || 0);
    var equitySum = raw.filter(function (h) { return !h.is_metal; })
      .reduce(function (a, h) { return a + (h.weight || 0); }, 0);
    var holdings = raw.map(function (h) {
      return {
        symbol: h.symbol, sector: h.sector, beta: h.beta, is_metal: h.is_metal,
        weight: h.is_metal ? metalTarget(h.symbol)
                           : (equitySum > 0 ? (h.weight / equitySum) * equityTarget : 0)
      };
    }).filter(function (h) {
      return h.weight > 0;
    }).sort(function (a, b) { return b.weight - a.weight; });

    var metalW = holdings.filter(function (h) { return h.is_metal; })
      .reduce(function (a, h) { return a + h.weight; }, 0);

    var secAgg = {};
    holdings.forEach(function (h) {
      var s = h.sector || 'Other / Unclassified';
      secAgg[s] = (secAgg[s] || 0) + h.weight;
    });
    var sectors = Object.keys(secAgg).map(function (s) {
      return { name: s, wt: secAgg[s] * 100 };
    }).sort(function (a, b) { return b.wt - a.wt; });

    var top10 = holdings.map(function (h) { return h.weight * 100; })
      .sort(function (a, b) { return b - a; }).slice(0, 10)
      .reduce(function (a, b) { return a + b; }, 0);

    var win = D.meta.window || {};
    var asOf = (D.live && D.live.as_of) || D.meta.generated || '';

    return {
      uKey: uKey, vKey: vKey, uni: uni, vari: vari, R: R,
      holdings: holdings,
      sectors: sectors,
      metalW: metalW,
      top10: top10,
      nMetals: holdings.filter(function (h) { return h.is_metal; }).length,
      portfolioMonth: src.portfolio_month || win.last,
      exanteBeta: src.exante_beta,
      first: win.first,
      last: win.last,
      months: win.months,
      nextRebalance: (src.portfolio_month || win.last) ? addMonth(src.portfolio_month || win.last, 1) : null,
      asOf: asOf,
      asOfFmt: dateName(asOf)
    };
  }

  /* ── MARKUP ───────────────────────────────────────────────────────────── */
  function sectorRows(sectors) {
    return sectors.map(function (s, i) {
      var c = /Gold/i.test(s.name) ? GOLD
            : /Silver/i.test(s.name) ? SILVER
            : SECTOR_COLORS[i % SECTOR_COLORS.length];
      return '<div class="alloc-row"><span class="alloc-name">' + esc(s.name) +
        '</span><div class="alloc-track"><div class="alloc-fill" style="width:' +
        s.wt.toFixed(1) + '%;background:' + c + '"></div></div><span class="alloc-pct">' +
        s.wt.toFixed(1) + '%</span></div>';
    }).join('\n');
  }

  function holdingRows(holdings) {
    return holdings.map(function (h, i) {
      var type = !h.is_metal ? 'Equity'
               : /GOLD/i.test(h.symbol) ? 'Gold ETF' : 'Silver ETF';
      var tint = h.is_metal ? ' style="background:#fdf6e6"' : '';
      return '<tr' + tint + '><td class="c">' + (i + 1) + '</td><td class="sym">' +
        esc(h.symbol) + '</td><td>' + esc(type) + '</td><td>' + esc(h.sector) +
        '</td><td class="mono b">' + (h.weight * 100).toFixed(1) + '%</td>' +
        '<td class="mono">' + num(h.beta) + '</td></tr>';
    }).join('\n');
  }

  function step(icon, k, text) {
    return '<div class="ic" style="text-align:center">' +
      '<div style="font-size:22px;margin-bottom:6px">' + icon + '</div>' +
      '<div class="k">' + k + '</div>' +
      '<div style="font-size:11.5px;color:var(--sub);margin-top:4px">' + text + '</div></div>';
  }
  function risk(k, text) {
    return '<div class="rc"><div class="rk">' + k + '</div><p>' + text + '</p></div>';
  }

  function buildHTML(F) {
    var R = F.R, U = F.uni, V = F.vari;
    var n = F.holdings.length;
    var nEquity = n - F.nMetals;
    var logoUrl = new URL(CFG.logo, location.href).href;
    var title = CFG.filePrefix + '_' + U.name.replace(/\s+/g, '') + '_' +
                V.key + (F.portfolioMonth ? '_' + F.portfolioMonth : '');
    var sleeve = F.metalW > 0
      ? (F.metalW * 100).toFixed(0) + '% bullion / ' + ((1 - F.metalW) * 100).toFixed(0) + '% equity'
      : '100% equity';

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + esc(title) + '</title>\n' +
'<meta name="description" content="Official factsheet for the ' + esc(CFG.modelLong) + ' portfolio.">\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap">\n' +
'<style>\n' + CSS + '</style>\n</head>\n<body>\n<div class="wrap">\n' +

/* ─────────── PAGE 1 ─────────── */
'<div class="card">' +
  '<div class="hdr-logo-bar"><img class="logo" src="' + esc(logoUrl) + '" alt="SMC Research"></div>' +
  '<div class="hdr">' +
    '<div class="tag">Factsheet</div>' +
    '<h1>' + esc(CFG.model) + '</h1>' +
    '<p class="sub">' + esc(U.name) + ' &mdash; ' + esc(V.name) + '</p>' +
    '<div class="pills">' +
      '<div class="pill"><div class="v green">' + pct(R.cagr) + '</div><div class="l">CAGR</div></div>' +
      '<div class="pill"><div class="v green">' + pct(R.total_return, 1) + '</div><div class="l">Total Return</div></div>' +
      '<div class="pill"><div class="chip">' + esc(CFG.riskLabel) + '</div><div class="l" style="margin-top:4px">Risk Level</div></div>' +
      '<div class="pill"><div class="chip">' + esc(CFG.horizon) + '</div><div class="l" style="margin-top:4px">Horizon</div></div>' +
    '</div>' +
    '<p class="ts">Data as of: ' + esc(F.asOfFmt) + ' &nbsp;·&nbsp; <a href="' + CFG.siteUrl + '">View Live Dashboard →</a></p>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Portfolio Overview</div>' +
    '<div class="ig">' +
      '<div class="ic"><div class="k">Portfolio Type</div><div class="v">Thematic / Quant</div></div>' +
      '<div class="ic"><div class="k">Asset Class</div><div class="v">' + (F.metalW > 0 ? 'Multi Asset' : 'Equity Multi Cap') + '</div></div>' +
      '<div class="ic"><div class="k">Universe</div><div class="v">' + esc(U.name) + '</div></div>' +
      '<div class="ic"><div class="k">Sleeve Mix</div><div class="v">' + esc(V.name) + '</div></div>' +
      '<div class="ic"><div class="k">Positions</div><div class="v b">' + n + '</div></div>' +
      '<div class="ic"><div class="k">Composition</div><div class="v" style="font-size:12.5px">' + nEquity + ' stocks + ' + F.nMetals + ' ETFs</div></div>' +
      '<div class="ic"><div class="k">Bullion Weight</div><div class="v" style="color:' + GOLD + '">' + (F.metalW * 100).toFixed(0) + '%</div></div>' +
      '<div class="ic"><div class="k">Backtest Window</div><div class="v" style="font-size:12.5px">' + esc(monthName(F.first)) + ' &ndash; ' + esc(monthName(F.last)) + '</div></div>' +
      '<div class="ic"><div class="k">CAGR (Portfolio)</div><div class="v g">' + pct(R.cagr) + '</div></div>' +
      '<div class="ic"><div class="k">CAGR (' + esc(U.bench) + ')</div><div class="v b">' + pct(R.bench_cagr) + '</div></div>' +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Portfolio Rationale</div>' +
    '<div class="rat">' +
      '<strong>' + esc(CFG.model) + '</strong> pairs the SQE quantitative equity book with a ' +
      'passive <strong>bullion sleeve</strong>, held through exchange-traded funds. The intent is ' +
      'not higher returns from the metal but a <strong>lower drawdown</strong>: gold and silver ' +
      'have historically been weakly or negatively correlated with Indian equities, so the sleeve ' +
      'tends to hold up when the equity book is under stress.' +
      '<ul>' +
        '<li>The equity sleeve is selected by the same <strong>proprietary quantitative model</strong> ' +
        'used across the SQE range, drawn from the ' + esc(U.name) + ' universe</li>' +
        '<li>This variant runs <strong>' + esc(V.name) + '</strong> — a ' + esc(sleeve) + ' split — with ' +
        'individual equity positions capped at <strong>' + esc(CFG.maxWeight) + '</strong></li>' +
        '<li>The whole book is <strong>rebalanced monthly</strong> back to target weights, so the ' +
        'bullion sleeve is systematically trimmed into strength and topped up into weakness</li>' +
        '<li>Over the backtest window the portfolio returned <strong>' + pct(R.cagr) + ' CAGR</strong> against ' +
        pct(R.bench_cagr) + ' for the ' + esc(U.bench) + ', with a maximum drawdown of ' +
        pct(Math.abs(R.max_dd)) + ' versus ' + pct(Math.abs(R.bench_max_dd)) + ' for the benchmark</li>' +
      '</ul>' +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Rebalance Schedule</div>' +
    '<div class="reb">' +
      '<div class="ri"><div class="k">Frequency</div><div class="v">Monthly</div></div>' +
      '<div class="ri"><div class="k">Rebalance Day</div><div class="v">1st Trading Day</div></div>' +
      '<div class="ri"><div class="k">Signal Month</div><div class="v">' + esc(monthName(F.portfolioMonth)) + '</div></div>' +
      '<div class="ri"><div class="k">Next Rebalance</div><div class="v">' + esc(monthName(F.nextRebalance)) + '</div></div>' +
      '<div class="ri"><div class="k">Managed By</div><div class="v" style="font-size:12px">SMC Research</div></div>' +
    '</div>' +
  '</div>' +
'</div>' +

/* ─────────── PAGE 2 ─────────── */
'<div class="card brk">' +
  '<div class="sec">' +
    '<div class="sec-t">Performance &amp; Risk Metrics</div>' +
    '<div class="mg">' +
      '<div>' +
        '<div class="mr"><span class="k">CAGR (Portfolio)</span><span class="v g">' + pct(R.cagr) + '</span></div>' +
        '<div class="mr"><span class="k">CAGR (' + esc(U.bench) + ' &mdash; Benchmark)</span><span class="v n">' + pct(R.bench_cagr) + '</span></div>' +
        '<div class="mr"><span class="k">Total Return</span><span class="v g">' + pct(R.total_return) + '</span></div>' +
        '<div class="mr"><span class="k">Total Return (Benchmark)</span><span class="v n">' + pct(R.bench_total_return) + '</span></div>' +
        '<div class="mr"><span class="k">Alpha (Annualised)</span><span class="v ' + (R.alpha_ann >= 0 ? 'g' : 'r') + '">' + signed(R.alpha_ann) + '</span></div>' +
        '<div class="mr"><span class="k">Annualised Volatility</span><span class="v n">' + pct(R.vol) + '</span></div>' +
        '<div class="mr"><span class="k">Volatility (Benchmark)</span><span class="v n">' + pct(R.bench_vol) + '</span></div>' +
        '<div class="mr"><span class="k">Sharpe Ratio</span><span class="v g">' + num(R.sharpe) + '</span></div>' +
        '<div class="mr"><span class="k">Sortino Ratio</span><span class="v g">' + num(R.sortino) + '</span></div>' +
        '<div class="mr"><span class="k">Calmar Ratio</span><span class="v g">' + num(R.calmar) + '</span></div>' +
        '<div class="mr"><span class="k">Information Ratio</span><span class="v g">' + num(R.info_ratio) + '</span></div>' +
      '</div>' +
      '<div>' +
        '<div class="mr"><span class="k">Max Drawdown</span><span class="v r">' + pct(R.max_dd) + '</span></div>' +
        '<div class="mr"><span class="k">Max Drawdown (Benchmark)</span><span class="v r">' + pct(R.bench_max_dd) + '</span></div>' +
        '<div class="mr"><span class="k">Drawdown Duration</span><span class="v n">' + num(R.dd_duration, 0) + ' mo</span></div>' +
        '<div class="mr"><span class="k">Win Rate (Monthly)</span><span class="v g">' + pct(R.win_rate, 1) + '</span></div>' +
        '<div class="mr"><span class="k">Avg Monthly Gain</span><span class="v g">' + signed(R.avg_gain) + '</span></div>' +
        '<div class="mr"><span class="k">Avg Monthly Loss</span><span class="v r">' + pct(R.avg_loss) + '</span></div>' +
        '<div class="mr"><span class="k">Best Month</span><span class="v g">' + signed(R.best_month) + '</span></div>' +
        '<div class="mr"><span class="k">Worst Month</span><span class="v r">' + pct(R.worst_month) + '</span></div>' +
        '<div class="mr"><span class="k">VaR (95%, Monthly)</span><span class="v r">' + pct(R.var95) + '</span></div>' +
        '<div class="mr"><span class="k">Beta vs Benchmark</span><span class="v n">' + num(R.beta) + '</span></div>' +
        '<div class="mr"><span class="k">Backtest Window</span><span class="v n">' + num(R.months, 0) + ' months</span></div>' +
      '</div>' +
    '</div>' +
  '</div>' +
  '<div class="sec">' +
    '<div class="sec-t">Allocation by Sector &amp; Sleeve</div>' +
    sectorRows(F.sectors) +
  '</div>' +
'</div>' +

/* ─────────── PAGE 3 ─────────── */
'<div class="card brk">' +
  '<div class="sec">' +
    '<div class="sec-t">Current Book &mdash; ' + n + ' Positions &middot; ' + esc(monthName(F.portfolioMonth)) + '</div>' +
    '<div style="overflow-x:auto"><table>' +
      '<thead><tr><th>#</th><th>Instrument</th><th>Type</th><th>Sector</th><th>Weight</th><th>Beta</th></tr></thead>' +
      '<tbody>' + holdingRows(F.holdings) + '</tbody>' +
    '</table></div>' +
    '<p style="margin-top:12px;font-size:10.5px;color:var(--sub)">Weights are the formation weights for ' +
    esc(monthName(F.portfolioMonth)) + '. Beta is measured ex-ante against the ' + esc(U.bench) +
    '; the book&rsquo;s ex-ante beta is ' + num(F.exanteBeta) + '. Bullion ETF rows are shaded.</p>' +
  '</div>' +
'</div>' +

/* ─────────── PAGE 4 ─────────── */
'<div class="card brk">' +
  '<div class="sec">' +
    '<div class="sec-t">How It Works</div>' +
    '<div class="ig" style="grid-template-columns:repeat(4,1fr)">' +
      step('📊', 'Step 1', 'SMC Research runs the proprietary quant model every month') +
      step('🥇', 'Step 2', 'The equity book is combined with the bullion sleeve at target weights') +
      step('💼', 'Step 3', 'Execute the rebalance trades at the start of each month') +
      step('📈', 'Step 4', 'Hold for 3–5 years for best risk-adjusted returns') +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Key Risk Factors</div>' +
    '<div class="rg">' +
      risk('Market Risk', 'Equity prices can decline sharply due to macroeconomic, geopolitical or ' +
        'company-specific factors. The portfolio has seen a maximum drawdown of ' + pct(R.max_dd) +
        ' over the backtest period, against ' + pct(R.bench_max_dd) + ' for the ' + esc(U.bench) + '.') +
      risk('Commodity Risk', 'Gold and silver prices are driven by global rates, the US dollar, and ' +
        'physical demand — factors unrelated to Indian equities. Silver in particular is materially ' +
        'more volatile than gold. The bullion sleeve reduces equity drawdown but introduces its own ' +
        'price risk, and can detract in a sustained equity bull market.') +
      risk('Concentration Risk', 'The book holds ' + n + ' positions, but is top-heavy — the largest ' +
        'equity positions are capped at ' + esc(CFG.maxWeight) + ' each and the top 10 holdings account for ' +
        'roughly ' + num(F.top10, 0) + '% of the portfolio.') +
      risk('Tracking Error Risk', 'The bullion sleeve is held through ETFs, whose returns can diverge ' +
        'from spot metal prices through expense ratios, tracking error and market-price premiums or ' +
        'discounts to NAV.') +
      risk('Model Risk', 'Past performance is not a guarantee of future results. Quantitative models ' +
        'may underperform during regime changes or unprecedented market events.') +
      risk('History Risk', 'The backtest window is bounded by SILVERBEES&rsquo; own price history and ' +
        'covers ' + num(R.months, 0) + ' months from ' + esc(monthName(F.first)) + '. That is a shorter ' +
        'record than the equity-only strategies, and it does not span a full market cycle.') +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Definitions and Disclosures</div>' +
    '<div style="font-size:11px;line-height:1.75;margin-bottom:16px">' +
      '<p style="margin-bottom:10px"><strong style="color:var(--pri)">CAGR</strong> — Compound Annual Growth Rate expresses the returns of each ' +
      'year as the single annual rate that would produce the same terminal value over the period. ' +
      'In this factsheet CAGR is computed on backtested model data from ' + esc(monthName(F.first)) +
      ' to ' + esc(monthName(F.last)) + '.</p>' +
      '<p style="margin-bottom:10px"><strong style="color:var(--pri)">Sleeve Mix</strong> — The split between the quantitative equity book and ' +
      'the passive bullion holding. This variant is <strong>' + esc(V.name) + '</strong> (' + esc(sleeve) + '). ' +
      'Gold is held via GOLDBEES and silver via SILVERBEES; both are exchange-traded funds, not ' +
      'physical metal.</p>' +
      '<p style="margin-bottom:10px"><strong style="color:var(--pri)">Volatility Label</strong> — Portfolios are bucketed High, Medium or Low ' +
      "Volatility against the Nifty 100 Index. This portfolio's annualised volatility is " + pct(R.vol) +
      ', placing it in the <strong>' + esc(CFG.riskLabel) + '</strong> bucket. High Volatility means changes ' +
      'in your investment value can be sudden and significant.</p>' +
      '<p style="margin-bottom:10px"><strong style="color:var(--pri)">Investment Horizon</strong> — Short Term: &lt;1 year. Medium Term: ' +
      '1&ndash;3 years. Long Term: &gt;3 years. This portfolio is recommended as <strong>' + esc(CFG.horizon) + '</strong>.</p>' +
      '<p style="margin-bottom:10px"><strong style="color:var(--pri)">Rebalance</strong> — The whole book, equity and bullion, is rebalanced ' +
      '<strong>monthly</strong> on the first trading day of each month, back to target weights.</p>' +
      '<p><strong style="color:var(--pri)">Benchmark</strong> — Performance is compared against the <strong>' + esc(U.bench) + '</strong> ' +
      '(CAGR ' + pct(R.bench_cagr) + ' over the same window). Note that the benchmark is equity-only ' +
      'while this portfolio is multi-asset, so the comparison speaks to the risk-reduction case ' +
      'rather than to like-for-like exposure.</p>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;font-size:11px;line-height:1.7">' +
      '<div><strong>CAGR:</strong> Compound Annual Growth Rate — annualised return over the full period.</div>' +
      '<div><strong>Sharpe Ratio:</strong> Risk-adjusted return per unit of total volatility.</div>' +
      '<div><strong>Sortino Ratio:</strong> Risk-adjusted return penalising only downside deviation.</div>' +
      '<div><strong>Calmar Ratio:</strong> CAGR divided by maximum drawdown.</div>' +
      '<div><strong>Information Ratio:</strong> Excess return over the benchmark per unit of tracking error.</div>' +
      '<div><strong>Max Drawdown:</strong> Largest peak-to-trough decline during the period.</div>' +
      '<div><strong>Beta:</strong> Sensitivity of the portfolio to benchmark moves.</div>' +
      '<div><strong>VaR (95%):</strong> Worst expected monthly loss at 95% confidence.</div>' +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">General Investment Disclosure</div>' +
    '<div class="disc">' +
      '<strong>⚠ IMPORTANT:</strong> This factsheet is for <strong>informational purposes only</strong> ' +
      'and does not constitute investment advice, solicitation, or a recommendation to buy ' +
      'or sell any securities. Past performance is not indicative of future results. ' +
      'Investments in the securities market are subject to market risks. Read all related ' +
      'documents carefully before investing.<br><br>' +
      'The performance data shown is based on a quantitative model simulation. Live ' +
      'performance may differ from model results due to transaction costs, taxes (STT, GST), ' +
      'impact cost, ETF tracking error, and execution timing. The portfolio is rebalanced monthly ' +
      'at month-open prices. <strong>All returns, CAGR and risk figures shown in this factsheet are ' +
      'derived from backtested model data covering ' + esc(monthName(F.first)) + ' to ' +
      esc(monthName(F.last)) + ', and do not represent the returns of an actual live-traded ' +
      'portfolio.</strong> Backtested results are hypothetical, are computed with the benefit of ' +
      'hindsight, and have inherent limitations. They have not been validated by an independent ' +
      'chartered accountant, nor verified by the Past Risk and Return Verification Agency (PaRRVA) ' +
      'or any other agency recognised by SEBI.<br><br>' +
      'The backtest window is bounded by the price history of the silver ETF and spans ' +
      num(R.months, 0) + ' months. A window this short does not cover a full market cycle, and the ' +
      'diversification benefit of the bullion sleeve observed over it may not persist.' +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Risk Disclosure</div>' +
    '<div class="disc">' +
      'Investing in securities involves various types of risk that may impact your investment. ' +
      'Key risks affecting all asset classes include changes in: market volatility; general ' +
      'market conditions; trading volumes, liquidity and settlement periods; interest rates; ' +
      'the rate of inflation; domestic and global political, economic and financial ' +
      'developments; and policies, legal or regulatory frameworks set by government and other ' +
      'appropriate authorities.<br><br>' +
      '<strong>Risks relating to equity and equity-linked investments:</strong> equity shares and ' +
      'equity-related instruments are volatile and prone to price fluctuation on a daily basis. ' +
      '<strong>Mid cap and small cap stocks generally exhibit higher volatility than large cap ' +
      'stocks.</strong><br><br>' +
      '<strong>Risks relating to commodity ETFs:</strong> gold and silver ETF prices track ' +
      'international metal prices and the rupee exchange rate, and are affected by global interest ' +
      'rates, central bank activity and physical demand. Silver is an industrial as well as a ' +
      'precious metal and is materially more volatile than gold. ETF market prices may trade at a ' +
      'premium or discount to net asset value, and returns are reduced by the fund&rsquo;s expense ' +
      'ratio.<br><br>' +
      'In light of the risks involved, you should transact in securities only after understanding ' +
      'the associated risks. Please consider and assess all risk factors and your own risk ' +
      'tolerance before making investment decisions.' +
    '</div>' +
  '</div>' +

  '<div class="sec">' +
    '<div class="sec-t">Manager Disclosure</div>' +
    '<div class="disc">' +
      '<strong>SMC Global Securities Ltd.</strong> is registered with SEBI as a Research Analyst, ' +
      'with its registered office at 11/6B, Shanti Chamber, Pusa Road, New Delhi &ndash; 110005. ' +
      'Registration granted by SEBI and certification from NISM in no way guarantee performance ' +
      'of the intermediary or provide any assurance of returns to investors.<br><br>' +
      'The content and data available in this material, including index values, return numbers ' +
      'and rationale, are for information and illustration purposes only. Charts and performance ' +
      'numbers do not include the impact of transaction fees and other related costs. Past ' +
      'performance does not guarantee future returns and the performance of the portfolio is ' +
      'subject to market risk. Data used for the calculation of historical returns and other ' +
      'information is sourced from exchange-approved third party vendors and has neither been ' +
      'audited nor independently validated.<br><br>' +
      'Information presented in this material shall not be considered a recommendation or ' +
      'solicitation of an investment. Investors are responsible for their own investment ' +
      'decisions and for validating all information used to make those decisions.<br><br>' +
      'This document is solely for the personal information of the recipient and must not ' +
      'be used as the basis of any investment decision. Nothing in this document should be ' +
      'construed as investment or financial advice. The report and information contained ' +
      'herein may not be altered, reproduced, or redistributed without prior written consent.' +
    '</div>' +
  '</div>' +
'</div>' +

'<div class="ft" style="margin-bottom:0">' +
  '<strong>SMC Research — Moneywise. Be Wise.</strong><br>' +
  esc(CFG.model) + ' · ' + esc(U.name) + ' · ' + esc(V.name) + ' · Monthly Rebalanced<br>' +
  '<a href="' + CFG.siteUrl + '">' + esc(CFG.siteLabel) + '</a>' +
  ' &nbsp;·&nbsp; Data as of: ' + esc(F.asOfFmt) +
'</div>' +

'</div>\n' +
'<button class="pbtn no-print" onclick="window.print()">🖨️ Print / Save PDF</button>\n' +
'<script>\n' +
'window.addEventListener("load", function () {\n' +
'  var fonts = document.fonts ? document.fonts.ready : Promise.resolve();\n' +
'  fonts.catch(function () {}).then(function () {\n' +
'    setTimeout(function () { window.focus(); window.print(); }, 300);\n' +
'  });\n' +
'});\n' +
'<\/script>\n' +
'</body>\n</html>';
  }

  /* ── STYLES ───────────────────────────────────────────────────────────
     Same sheet the SQE factsheet uses, so the two documents are visually one
     family. Inlined because the generated page is opened blank and has no
     stylesheet of its own to fall back on. */
  var CSS = [
'*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
':root{--pri:#0f2b54;--pri2:#1565c0;--acc:#16c784;--red:#ea3943;--bg:#f3f6fb;--bdr:#dde3ef;--txt:#1a1a2e;--sub:#6b7a99;--wh:#fff;--sh:0 2px 16px rgba(15,43,84,.08);--r:12px;--f:\'Inter\',system-ui,sans-serif;--m:\'Roboto Mono\',monospace}',
'html{scroll-behavior:smooth}',
'body{font-family:var(--f);background:var(--bg);color:var(--txt);font-size:13px;line-height:1.65;-webkit-font-smoothing:antialiased}',
'@page{size:A4;margin:10mm 9mm 12mm}',
'@media print{',
/* Chrome drops background colours when printing unless told otherwise —
   without this the blue header, sector bars and metric colours print white. */
'  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}',
'  html,body{background:#fff;font-size:9.5px}',
'  .no-print{display:none!important}',
'  .wrap{max-width:none;padding:0}',
'  .brk{page-break-before:always}',
'  .card{box-shadow:none;margin-bottom:0;border:none;border-radius:0;overflow:visible}',
'  .sec{break-inside:auto;padding:14px 22px}',
'  .sec-t{break-after:avoid}',
'  .ic,.ri,.mr,.rc,.sb{break-inside:avoid}',
'  .rat{break-inside:avoid}',
'  table{break-inside:auto;font-size:8.6px!important}',
'  thead{display:table-header-group}',
'  tr{break-inside:avoid;break-after:auto}',
'  thead th,td{padding:4.1px 8px!important;font-size:8.6px!important}',
'  tr:hover td{background:transparent!important}',
'  .hdr{padding:20px 30px 22px}',
'  .disc{break-inside:auto}',
'  a{text-decoration:none;color:inherit}',
'}',
'.wrap{max-width:880px;margin:0 auto;padding:20px 16px 80px}',
'.card{background:var(--wh);border-radius:var(--r);box-shadow:var(--sh);margin-bottom:20px;overflow:hidden}',
'.hdr-logo-bar{background:#ffffff;padding:20px 40px;text-align:center;border-bottom:1px solid var(--bdr);display:flex;justify-content:center;align-items:center}',
'.logo{display:block;height:45px;max-width:100%;object-fit:contain}',
'.hdr{background:linear-gradient(135deg,#0f2b54 0%,#1565c0 60%,#1e88e5 100%);color:#fff;padding:28px 40px 30px;text-align:center;position:relative}',
'.hdr::after{content:\'\';position:absolute;inset:0;background:url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 30h60M30 0v60\' stroke=\'%23fff\' stroke-opacity=\'.03\' stroke-width=\'1\'/%3E%3C/svg%3E");pointer-events:none}',
'.hdr>*{position:relative;z-index:1}',
'.tag{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:3px 14px;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;margin-bottom:14px}',
'.hdr h1{font-size:24px;font-weight:800;letter-spacing:-.4px;margin-bottom:6px}',
'.hdr .sub{font-size:12.5px;opacity:.75;margin-bottom:22px}',
'.pills{display:flex;justify-content:center;gap:28px;flex-wrap:wrap}',
'.pill{text-align:center}',
'.pill .v{font-size:22px;font-weight:800}',
'.pill .v.green{color:#4ade80}',
'.pill .l{font-size:10px;opacity:.65;margin-top:2px}',
'.pill .chip{display:inline-block;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:16px;padding:3px 12px;font-size:10.5px;font-weight:600}',
'.hdr .ts{margin-top:18px;font-size:10px;opacity:.5}',
'.hdr .ts a{color:rgba(255,255,255,.85);text-decoration:none}',
'.sec{padding:24px 32px;border-bottom:1px solid var(--bdr)}',
'.sec:last-child{border-bottom:none}',
'.sec-t{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--pri);margin-bottom:16px;display:flex;align-items:center;gap:8px}',
'.sec-t::after{content:\'\';flex:1;height:1px;background:var(--bdr)}',
'.ig{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}',
'.ic{background:var(--bg);border:1px solid var(--bdr);border-radius:8px;padding:12px 14px}',
'.ic .k{font-size:10px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}',
'.ic .v{font-size:14px;font-weight:700}',
'.ic .v.g{color:var(--acc)} .ic .v.b{color:var(--pri2)} .ic .v.r{color:var(--red)}',
'.rat{background:linear-gradient(135deg,#f0f5ff 0%,#e8f5e9 100%);border:1px solid #c8d8f0;border-left:4px solid var(--pri2);border-radius:8px;padding:18px 22px;font-size:13px;line-height:1.8;color:var(--txt)}',
'.rat strong{color:var(--pri)}',
'.rat ul{margin:10px 0 0 20px}',
'.rat li{margin-bottom:6px}',
'.reb{display:flex;gap:14px;flex-wrap:wrap}',
'.ri{flex:1;min-width:130px;background:var(--bg);border:1px solid var(--bdr);border-radius:8px;padding:14px;text-align:center}',
'.ri .k{font-size:10px;color:var(--sub);font-weight:600;text-transform:uppercase;letter-spacing:.4px}',
'.ri .v{font-size:14px;font-weight:700;color:var(--pri);margin-top:4px}',
'.mg{display:grid;grid-template-columns:1fr 1fr;gap:28px}',
'@media(max-width:600px){.mg{grid-template-columns:1fr}}',
'.mr{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bdr)}',
'.mr:last-child{border-bottom:none}',
'.mr .k{font-size:12px;color:var(--sub)}',
'.mr .v{font-size:13px;font-weight:700;font-family:var(--m)}',
'.g{color:var(--acc)!important} .r{color:var(--red)!important} .n{color:var(--txt)}',
'.alloc-row{display:flex;align-items:center;gap:10px;padding:6px 0}',
'.alloc-name{font-size:11.5px;min-width:210px;color:var(--txt)}',
'.alloc-track{flex:1;background:var(--bg);border-radius:4px;height:7px;overflow:hidden}',
'.alloc-fill{height:100%;border-radius:4px}',
'.alloc-pct{font-size:12px;font-weight:700;font-family:var(--m);min-width:42px;text-align:right}',
'table{width:100%;border-collapse:collapse;font-size:12px}',
'thead th{background:var(--pri);color:#fff;padding:9px 10px;text-align:left;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}',
'thead th:first-child{border-radius:6px 0 0 0} thead th:last-child{border-radius:0 6px 0 0}',
'td{padding:9px 10px;border-bottom:1px solid var(--bdr)}',
'tr:last-child td{border-bottom:none}',
'tr:nth-child(even) td{background:#fafbfd}',
'tr:hover td{background:#f0f4ff}',
'.c{text-align:center;color:var(--sub);font-size:11px}',
'.sym{font-weight:700;font-size:13px;color:var(--pri)}',
'.b{font-weight:700}',
'.mono{font-family:var(--m)}',
'.rg{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
'@media(max-width:600px){.rg{grid-template-columns:1fr}}',
'.rc{background:var(--bg);border:1px solid var(--bdr);border-radius:8px;padding:14px 16px}',
'.rc .rk{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--red);margin-bottom:5px}',
'.rc p{font-size:11px;color:var(--sub);line-height:1.6}',
'.disc{background:#f9fafc;border:1px solid var(--bdr);border-radius:8px;padding:16px 20px;font-size:10px;color:var(--sub);line-height:1.75}',
'.disc strong{color:var(--red)}',
'.ft{background:var(--pri);color:rgba(255,255,255,.65);text-align:center;padding:18px 32px;font-size:10.5px;border-radius:var(--r)}',
'.ft strong{color:#fff} .ft a{color:rgba(255,255,255,.85);text-decoration:none}',
'.pbtn{position:fixed;bottom:20px;right:20px;background:var(--pri2);color:#fff;border:none;border-radius:50px;padding:11px 22px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(21,101,192,.35);font-family:var(--f);z-index:999;transition:transform .2s}',
'.pbtn:hover{transform:translateY(-2px)}',
'@media(max-width:600px){.sec{padding:18px 16px}.hdr{padding:24px 18px 22px}.alloc-name{min-width:140px}.rg,.ig{grid-template-columns:1fr}}'
  ].join('\n');

  /* ── ENTRY POINT ──────────────────────────────────────────────────────── */
  function exportFactsheet() {
    var F;
    try {
      F = collect();
    } catch (e) {
      console.error('[factsheet] could not read dashboard data', e);
      F = null;
    }
    if (!F) {
      alert('Factsheet unavailable — the dashboard data has not finished loading. Please try again in a moment.');
      return;
    }
    if (!F.holdings.length) {
      alert('Factsheet unavailable — no holdings found for ' + F.uni.name + ' / ' + F.vari.name + '.');
      return;
    }

    var win = window.open('', '_blank');
    if (!win) {
      alert('The factsheet opens in a new tab — please allow pop-ups for this site and click Export again.');
      return;
    }
    win.document.open();
    win.document.write(buildHTML(F));
    win.document.close();
  }

  /* Deliberately NOT overriding exportReport() the way the SQE dashboards do.
     Here that button downloads the monthly-returns CSV, which is its own
     feature worth keeping — the factsheet gets its own button in the header. */
  window.exportFactsheet = exportFactsheet;
})();
