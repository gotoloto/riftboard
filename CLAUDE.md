# Riftbound dashboard — project notes for Claude

A local-first dashboard summarising Riftbound (League of Legends TCG)
tournament decks scraped from [riftdecks.com](https://riftdecks.com).
Hosted statically at **https://gotoloto.github.io/riftboard/** (renamed from
the old `riftbound-meta-dashboard`; GitHub redirects the old URL).
Repo: `gotoloto/riftboard` (working dir
`/Users/travisschmauss/Desktop/vibe coding/riftbound`).

## Pages

| URL | What it does |
|---|---|
| `/` (`index.html`) | Per-legend card table with sortable columns, type/percentile/date filters, "median deck" panel (Composite vs Representative). Picker swaps champions via `champions.js` and lazy-loaded `legends/<slug>/data.js`. |
| `/staples.html` | Top 40 commons / uncommons / rares across all cached legends, with the legends that run each at >50% inclusion. |
| `/cart.html` | TCGplayer shopping-list builder. Pick legends, optional team assignment (A/B/solo), rarity cap, sideboard toggle, marginal-copy ranking. Reads `collection-owned.js` for default Owned column. |
| `/closeness.html` | Ranks legends by how close the imported collection is to their top-25 % composite. Rarity-weighted (common 1, uncommon 2.333, rare 3.5, epic/showcase 28). "Include en route" toggle uses `collection-enroute.js`. |
| `/diff.html` | Paste a riftdecks deck URL → diff against collection → TCGplayer-formatted copy of missing cards. Reads `deck-lookup.js`. |

Nothing is linked between pages except `← Main dashboard` back-buttons.

## Data pipeline (`scrape.py`)

All commands run from the repo with `.venv/bin/python3 scrape.py …`.

| Command | Output |
|---|---|
| `scrape.py <archetype-url>` | Full scrape for one legend. Writes `legends/<slug>/{decks.json, data.js}`. Per-card aggregated stats are computed in-memory from `decks.json` whenever needed. Auto-regenerates downstream artifacts (champions.js, staples.js, collection-template.xlsx, closeness-data.js, deck-lookup.js). |
| `scrape.py --update [<slug>…]` | Incremental: pings `/legends` once, only walks the per-archetype listings whose deck counts changed. Fetches only new decks and new card metadata. |
| `scrape.py --refresh [<slug>…]` | Re-fetches every cached deck URL for the given legends (default: all). Wholesale replaces deck contents — used to flush cache contamination from running `--update` through a poisoned IP. **Only run from a clean source IP** (hotspot / VPN / VPS). See "IP-affinity poisoning" note. |
| `scrape.py --check` | Read-only freshness report. |
| `scrape.py --catalog` | Re-scrape every card detail page (~770) for the canonical printing, rarity, image URL. Slow (~3 min). Writes `cards-catalog.json` + `cards-catalog.js`. |
| `scrape.py --catalog-new` | Incremental: fetch detail pages only for slugs referenced by a legend's `decks.json` (via its `cards_meta` slug index) but missing from `cards-catalog.json`. Fast (seconds when 0–5 missing). Backfills after `--update` if new cards entered the meta. |
| `scrape.py --staples` | Regenerate `staples.js`. |
| `scrape.py --closeness` | Regenerate `closeness-data.js`. |
| `scrape.py --collection` | Regenerate `collection-template.xlsx`. |
| `scrape.py --deck-lookup` | Regenerate `deck-lookup.js`. |
| `scrape.py --import-collection <xlsx>` | Read a filled-in collection workbook (`Qty Owned` + optional `Qty En Route` columns); emit `collection-owned.js` and `collection-enroute.js`. |

Always include `?metagame_id=3` on archetype URLs (current release period).
Canonical URL form: `https://riftdecks.com/legends/constructed/<slug>?metagame_id=3`.

## Key invariants

- **Cloudflare bypass**: `curl_cffi` with `impersonate="chrome"` (already in
  the venv).
- **Per-card slug** is the stable identity (`details-<slug>`); names from the
  detail page can be epithet-only for legends (`"Scorn of the Moon"`) — we
  fix those in `build_collection_template` using the full archetype name
  from `champions.js`.
- **Rarity quirks**: the detail page may show only "showcase" if the default
  printing is alt-art. `fetch_card_catalog` walks variant URLs
  (`/cards/<slug>/<printing-id>`) to find the non-showcase rarity. Showcase
  is always optional alt-art; the buy weight uses the standard rarity.
- **TCGplayer name fixes** in `tcgplayer-fixes.js`: cards where the default
  comma→dash rewrite is wrong (e.g. `Khazix, Voidreaver` → `Kha'zix - Voidreaver`,
  `Allay, Eager Admirer` keeps its comma). Add new entries there as found.
- **Decks "drift" is actually IP-affinity poisoning** (diagnosed
  2026-05-17). Riftdecks' load balancer pins each client to one of
  several backend application servers via a stable hash of the source
  IP. Some backends have diverged data (stale snapshots, partial
  replication, missed cache invalidations — they don't share their
  ops with us). Travis' home Comcast IP hash-pins to a backend whose
  Lillia/Diana/etc. decks are wrong-but-plausible (real Riftbound
  decks under the wrong URLs). His iPhone cellular IP hash-pins to a
  clean backend. Same Cloudflare POP (SJC) and same `cf-cache-status:
  DYNAMIC` (no edge caching) for both — Cloudflare is just passing
  through. Verified independently in 2026-05-17 reddit thread
  (`r/riftboundtcg`): user "Jahikoi" on a different ISP saw the same
  correct deck the iPhone saw, with Travis' OP screenshot showing the
  phantom. Earlier theories that "riftdecks rewrites decks over time"
  (the 24-hour audit) and "authors edit decks after the fact" (the
  representative-deck tooltip from May 10) were both wrong — those
  symptoms came from sampling backend-A vs backend-B across runs, not
  from any actual mutation over time.

  **Practical**: scrape from a clean IP (hotspot, VPN exit, VPS). The
  scraper is technically correct; the data source is non-deterministic
  per source IP. A `--refresh` mode on scrape.py re-fetches every
  cached deck URL so a single clean-IP session can repair the entire
  cache.

  **Canary**: scrape.py runs `check_canary()` before every fetching
  command. It pings deck 147957 and aborts the run if the response
  contains the phantom 'Protector of Dreams' champion instead of the
  expected 'Fae Fawn'. Prevents accidental cache poisoning if WARP/VPN
  drops or if running from an unfamiliar network. Skip with env var
  `RIFTBOUND_SKIP_CANARY=1` (only needed if deck 147957 itself has
  been edited upstream — then re-tune CANARY_CLEAN_MARKER /
  CANARY_POISON_MARKER in scrape.py).
- **Set sizes** (for completeness checks): UNL 219, OGN 298, SFD 221, OGS 24.
  Catalog now covers all 763 canonical printings (overnumbered-only dropped).
- **40 legends** currently cached. All on `?metagame_id=3`.

## Personal data

- `collection-template_260513-1948.xlsx` is the user's filled-in workbook.
  Gitignored. Drop a fresh one in, run
  `scrape.py --import-collection collection-template_260513-1948.xlsx`
  to refresh `collection-owned.js` + `collection-enroute.js`.
- `Qty Owned` and `Qty En Route` columns. The xlsx has 763 rows
  (one per canonical card).

### Live Google Sheet sync (no rescrape required)

The cart/closeness/diff/staples pages also fetch a shared Google Sheet's
CSV export at runtime (`collection-sheet.js`). Sheet URL is hard-coded:
`docs.google.com/spreadsheets/d/1Q7RCiWYiC52FIkkDIReUkfotIyGVRSUr/export?format=csv`.

Flow on each page load:
1. Static `collection-owned.js` + `collection-enroute.js` populate
   `window.__OWNED_DEFAULTS__` / `__EN_ROUTE_DEFAULTS__` synchronously —
   first paint uses those.
2. `collection-sheet.js` fetches the CSV in parallel (~200 ms, CORS open).
3. On success it **fully replaces** both globals and dispatches
   `window.dispatchEvent(new CustomEvent("collection:updated"))`.
4. Each page-app captures owned/en-route in `let` (not `const`) and
   re-renders on the event.

Status line `<p id="sheet-status">` shows loading/success/error per page.
Failure (network, sheet revoked, parse error) silently falls back to the
static `.js` snapshot.

**Consequence:** values in `collection-owned.js` / `collection-enroute.js`
that aren't also in the sheet vanish once the fetch resolves. The static
files are now snapshot/offline fallback; the sheet is the source of truth.

## Tech / hosting

- Static site on GitHub Pages, `main` branch, root path. Deploys ~1 min
  after `git push`.
- No build step. HTML + a few sibling `.js` / `.css` files, JS-wrapped JSON
  data so `file://` also works.
- Pythonland: `.venv/bin/python3 scrape.py`. Deps: `curl_cffi`,
  `beautifulsoup4`, `openpyxl`, `Pillow` (one-off for icon colour sampling).

## Working style preferences

- Plan mode + ExitPlanMode for non-trivial changes; auto mode for quick
  iteration. The user toggles modes deliberately.
- Always commit + push when work is meaningful — pages auto-deploy.
- Use `Monitor` with an `until` loop to wait for Pages redeploy.
- Tight commit messages explaining the why, not just the what.
- The user prefers prose summaries over tables for status updates, and
  precise empirical evidence (numbers, sample rows) over hand-waving.
