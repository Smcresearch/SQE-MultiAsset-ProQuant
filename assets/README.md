# assets

## `smc-logo.png` (or `.svg`)

The SMC lockup shown in the dashboard header. **Not committed yet** — drop the
official file here with exactly this name and the header picks it up; until then
the header falls back to the plain `SQE` badge, so nothing renders broken.

Notes for whoever adds it:

- **SVG is preferred** over PNG — the header scales it and the tagline text goes
  soft at small raster sizes. If using PNG, supply it at 3× the display size
  (roughly 570px wide) with a transparent background.
- The wordmark and tagline are near-black, so on the dark theme the logo sits on
  a white plate (`.brand-logo-chip` in `style.css`). If a **white / knockout
  variant** exists, that is the better option: drop it in as
  `smc-logo-light.png`, remove the plate from `.brand-logo-chip`, and swap the
  two files by theme.
- The header sizes it to 46px tall, max 190px wide (36 / 150 on narrow screens).
  A horizontal lockup without the tagline reads better at that height; the full
  stacked lockup with "Moneywise. Be wise." will render the tagline very small.
