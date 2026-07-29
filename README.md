# SQE MultiAsset ProQuant — Equity + Gold + Silver

Institutional-grade multi-asset portfolio analytics for the Sharpe Efficient
Portfolio (SQE) strategy run with a **fixed bullion sleeve** across three
universes: **Nifty 50**, **Nifty 500** and **All Indices**.

This is a static dashboard (HTML / CSS / vanilla JS) served from GitHub Pages.

## The strategy

The same EGP / Sharpe single-index selection that drives the equity-only SQE
sites, but a fixed slice of total capital is reserved for two ETFs — GOLDBEES
and SILVERBEES — and the stock sleeve gets whatever is left. The bullion weights
are fixed, not tactical: they are rebalanced back to target every month
alongside the equity basket. Metals never compete with stocks for a slot.

| Sleeve | Stocks | Gold | Silver |
|---|---|---|---|
| Equity Only (control) | 100% | — | — |
| Equity + Gold | 90% | 10% | — |
| Equity + Silver | 90% | — | 10% |
| Equity + Gold + Silver | 80% | 10% | 10% |

## Backtest window

**Jun 2022 – Jun 2026 (49 completed months)**, identical for every universe and
every sleeve so the comparison is like-for-like. The start is set by SILVERBEES
inception (10 May 2022) — there is no silver price history before that, so no
earlier window can contain a genuine three-asset portfolio.

Returns follow the engine's trade convention: the basket is formed on the signal
month's close, bought at the trade month's open and sold at its close.

### The live month

The newest month is usually still running. Its book is formed and traded, but
its return is only month-to-date, so folding it into an annualised statistic
would distort everything downstream. It is therefore held apart: `data.js` keeps
it under `live`, never inside `monthly`, and the site shows it in its own card,
as a marked cell in the heatmap (excluded from the year total) and as a labelled
row in the CSV export. Every headline figure — CAGR, Sharpe, drawdown, win rate
— covers completed months only.

The **Live Portfolio** tab shows the book formed on the last completed signal
month's close, i.e. the basket being held right now.

## Heatmap drill-down

Clicking any cell in the PnL heatmap opens the book that actually produced that
month: the month's Nifty 50 / Nifty 500 returns, portfolio beta and ex-ante
Sharpe, every sleeve's return against the benchmark, and the full holdings list
with an investment calculator.

Two per-holding figures are shown and they are not the same thing:

- **Return** — the price move across the trade month, open to close.
- **Contrib** — the position's P&L that month as a share of capital.

The engine runs a real book: positions carry forward at average cost, so a name
can book a gain in a month its price fell. Contribution therefore is *not*
weight × return, and only contribution reconciles:

```
sum(contributions of held positions) + P&L on positions exited this month
    = the month's portfolio return
```

Both terms are shown in the table footer. The exited-position line is a real
quantity taken from the engine, not a plug — its median across all 600
month-books is 0.02%.

## Portfolio Size — restating the whole dashboard for an amount

The **Portfolio Size** bar switches the entire terminal between two views:

- **Model ₹1 Cr** — the engine's own book, where rounding a position to whole
  shares is immaterial.
- **Your Amount** — every statistic on every tab (CAGR, Sharpe, drawdown, win
  rate, the equity curves, the heatmap, the tail table, the radar) restated for
  the amount entered.

Each month the published book is re-sized into whole shares with a one-share
floor, and **only what that rounding changed** is carried onto the model's own
month:

```
adjustment = return at achieved weights − return at target weights
month      = the model's month + adjustment
```

Anchoring to the model is deliberate. Rebuilding each month's return from the
holdings alone would also swap out the engine's accounting — it carries
positions at average cost and books their P&L on rebalance, which a fresh buyer
of the published book does not — and over this window that is worth about **4
percentage points of CAGR**. That difference is a property of the accounting
method, not of the amount, so it is held constant. The result is the behaviour
you want: capital compounds, the rounding effect fades as the book grows, and at
a large enough amount the numbers converge back on the published ones.

Measured on the Nifty 500 overlay, the mean monthly deviation from the model is
0.48% at ₹1 lakh, 0.019% at ₹25 lakh and 0.0008% at ₹5 crore.

## Which price is shown

The workbooks record three prices per holding and only one of them is a price
anyone can transact at:

| column | what it is |
|---|---|
| `Buy Price` | the **open of the trade month** — what the book was entered at |
| `Sell Price` | the close of the trade month, or the latest close for the live month |
| `Avg Price` | the engine's **carried cost basis** |

The site prices and sizes everything off the **Buy Price**. The average cost is
not a market price: the engine has held GOLDBEES since May 2022 and averages its
cost across years of rebalancing, so by July 2026 that column reads ₹61.71
against a market price of ₹115.36 — and SILVERBEES ₹121.90 against ₹212.50.
Sizing quantities off it would have roughly doubled every long-held position.
Across the 15,178 priced rows on this site, 8,616 sit more than 5% away from
their cost basis, so this is not an edge case.

The cost basis is still carried in the data as `a` and surfaced in a tooltip on
the price cell, because it is what makes a position's contribution differ from
weight × return.

Every displayed price is verified against the month-open in the underlying price
CSVs, per universe (the three stock folders carry different corporate-action
adjustments for the same name).

## Sizing for a real amount

The model book is sized against ₹1 crore, where rounding a position to whole
shares is immaterial. At ₹1 lakh it is not, so entering an amount does not
scale the model's numbers — it re-derives them from what could actually be
bought:

- whole shares only, and **at least one of every holding**, so nothing the
  model holds is rounded away;
- the achieved weight of each position is therefore its own cost over the total
  cost, not its target weight;
- **Contrib** is that achieved weight × the stock's return, and the footer's
  return is their sum — the return on *your* amount, not the model's.

The one-share floor has a consequence worth stating plainly: a high-priced name
can only be bought in a lump, so at small amounts its achieved weight overshoots
its target and the book can cost more than the amount entered. At ₹1 lakh, 441
of the 600 month-books do. The table shows each position's achieved weight
against its target (flagged when it drifts more than 2pp) and the footer turns
"Cash Left" into "Additional needed for 1 share of each", so the shortfall is
visible rather than silently truncated.

The model's own result stays on screen underneath, clearly labelled, so the two
are never confused.

## Files
- `index.html` — page shell and layout
- `style.css` — styling (shared with the other SQE terminals)
- `app.js` — rendering logic and interactivity
- `data.js` — precomputed dashboard data (`MULTIASSET_DATA`)
- `holdings.js` — per-month books for the drill-down (`MONTHLY_HOLDINGS`,
  `MONTH_META`, `SECTOR_MAP`)

## Where the numbers come from

`data.js` is generated by `build_multiasset.py` in the main research repo. That
script merges two JSON files produced by the report pipeline, which in turn
recompute every statistic from first principles out of the backtest workbooks
(`Sharpe_Summary_{UNIV}_A_{VARIANT}.xlsx`):

- `metrics.json` — 12 runs (3 universes x 4 sleeves), monthly return series,
  standalone bullion statistics, the correlation matrix and the crisis-month table
- `holdings.json` — the current Equity + Gold + Silver book per universe
- `holdings_monthly.json` — every month's book for all 12 runs, pulled from the
  per-month `PM_YYYY-MM` sheets, plus a sector map built from the price files'
  own Industry column (the index constituent lists stop at the Nifty 500, which
  left most of the All-Indices book unclassified)

Nothing on this site is hand-typed, and nothing is recomputed in the browser
except chart-level derivations (equity curves, drawdown, rolling returns) that
follow directly from the monthly series shipped in `data.js`.

## Local preview

```sh
python -m http.server 8000
# then visit http://localhost:8000
```

## Deploy (GitHub Pages)

Push to `main`, then in repo settings enable **Pages → Deploy from branch → main / root**.

> `index.html` loads `app.js` / `data.js` with a `?v=` cache-bust token. Bump it
> whenever those files change so browsers pick up the fresh copies.
