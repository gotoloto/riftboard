# Riftboard

Local-first Riftbound (League of Legends TCG) collection site for two
players, hosted on GitHub Pages at
<https://gotoloto.github.io/riftboard/>.

Since June 2026 the site is centred on two pages that run purely off the
card catalog and a shared Google Sheet:

- **Lineup** (`index.html`, the homepage) — read-only view of both
  players' locked A/B decks with shortfall / en-route / swap flags,
  energy curves, and binder locators.
- **Builder** (`builder.html`) — collection explorer + deck builder with
  riftdecks-format copy/paste.

The original tournament-meta side (per-legend card frequencies scraped
from [riftdecks.com](https://riftdecks.com)) is **retired**: riftdecks
serves diverged deck data per source IP, so refreshes stopped being
trustworthy. Those pages remain browsable with frozen June-2026 data —
`meta.html`, `staples.html`, `cart.html`, `closeness.html`, `diff.html`
— linked from the homepage footer.

## Files

- `index.html` + `lineup-app.js` — Lineup (homepage).
- `builder.html` + `collection-app.js` — Builder.
- `meta.html` + `app.js` — retired meta dashboard (accepts
  `?champion=<slug>` deep links).
- `cards-catalog.js` — every canonical card printing (slug, cost,
  domains, rarity, set + number, image, TCGplayer price snapshot).
- `collection-sheet.js` — live Google Sheet sync (collection counts +
  the four 🔒 lock tabs). Static fallbacks: `collection-owned.js`,
  `collection-enroute.js`.
- `legends/<slug>/` — frozen per-legend tournament deck data feeding the
  retired pages.
- `scrape.py` — data pipeline. Deck scraping is retired (it prints a
  notice); `--import-collection <xlsx>` and the `--catalog*` commands
  remain useful. See `CLAUDE.md` for the full command table and the
  IP-affinity-poisoning saga.

## View locally

Everything is JS-wrapped JSON loaded via `<script>` tags, so `file://`
works — just open `index.html` in a browser. Pushes to `main` deploy to
GitHub Pages in about a minute.

## Setup (only needed for scrape.py)

```sh
python3 -m venv .venv
.venv/bin/pip install curl_cffi beautifulsoup4 openpyxl
```
