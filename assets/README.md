# assets

## `smc-logo.webp`

The SMC lockup shown in the dashboard header — the official horizontal lockup
with the "moneywise. be wise." tagline, 2886×1001. Same asset as `smc_logo.webp`
in the SQE and SQE-ProQuant dashboards; keep the three in sync when it changes.
If the file goes missing the header falls back to the plain `SQE` badge, so
nothing renders broken.

Notes for whoever replaces it:

- The background is **opaque white, not transparent**, and the wordmark is
  near-black. On the dark theme it therefore sits on a white plate
  (`.brand-logo-chip` in `style.css`) that the asset blends into; in light mode
  the plate is dropped. An **SVG or a transparent knockout variant** would be
  better — with a white variant, drop it in as `smc-logo-light.webp`, remove the
  plate, and swap the two files by theme.
- The header sizes it to 46px tall, max 190px wide (36 / 150 on narrow screens).
  The tagline renders small at that height; a lockup without it would read
  better if one is ever supplied.
