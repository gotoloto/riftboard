# Riftboard — project notes for Claude

A local-first Riftbound (League of Legends TCG) collection site for
Travis + Santiago. **Recentred 2026-06 on the Builder and Lineup pages**,
which run purely off the card catalog + a shared Google Sheet. The old
tournament-meta side (scraped from
[riftdecks.com](https://riftdecks.com)) is retired-but-kept: riftdecks'
per-IP backend divergence made deck refreshes unreliable, so that data
is frozen as of June 2026.
Hosted statically at **https://gotoloto.github.io/riftboard/** (renamed
from the old `riftbound-meta-dashboard`; GitHub redirects the old URL).
Repo: `gotoloto/riftboard` (working dir
`/Users/travisschmauss/Desktop/vibe coding/riftbound`).

## Pages

Active (the site's center):

| URL | What it does |
|---|---|
| `/` (`index.html`) | **Lineup** (the homepage). Read-only side-by-side view of the four locked decks (Travis A/B, Santiago A/B) from the Sheet's 🔒 tabs: per-section shortfall math (maindeck priority over sideboard), en-route ✈ flags, intra-player swap ⇄ flags, energy curves, power-by-domain, set+number binder tags. Hosts the site motto banner. `lineup.html` is a redirect stub for old bookmarks. |
| `/builder.html` | Collection explorer + deck builder. Filter owned cards by rarity/set/type/domain/energy; +M/+S build a deck with Legend/Champion slots, 3-copy caps, energy curve; riftdecks-format copy/paste; "Read <player> 🔒" buttons import a lock-tab deck. |

Retired (linked from the homepage footer; each carries an amber
"Retired — data frozen June 2026" banner; tournament data is a static
snapshot):

| URL | What it did |
|---|---|
| `/meta.html` (was `index.html`) | Per-legend card table, median/composite deck panel, percentile/date/region filters, performance stat strip, trend sparkline, composition variance. Accepts `?champion=<slug>` deep links from the legend chips on builder/staples/cart. |
| `/staples.html` | Top 40 commons/uncommons/rares across all cached legends. |
| `/cart.html` | TCGplayer shopping-list builder from per-legend composites. |
| `/closeness.html` | Ranks legends by dollar cost to complete their top-25% composite. |
| `/diff.html` | Paste a riftdecks deck URL → diff against collection (local cache lookup). |

All pages share `styles.css`, `utils.js`, `theme.js` (☾/☀ toggle), the
live Google Sheet sync, and the hover card-thumb (battlefields rotate
90°). Retired pages still sync Owned counts live from the Sheet — only
the tournament data is frozen.

## Data pipeline (`scrape.py`)

**Deck scraping is RETIRED (2026-06).** The deck-fetching commands print
a retirement notice but still run if ever needed; the card-content
canary (see below) guards against cache poisoning. Don't invest in
maintaining them.

| Command | Status | Output |
|---|---|---|
| `scrape.py <archetype-url>` | retired | Full scrape for one legend → `legends/<slug>/{decks.json, data.js}` + downstream artifacts. |
| `scrape.py --update [<slug>…]` | retired | Incremental deck fetch + tournaments.js + champion-slugs.js + downstream artifacts. |
| `scrape.py --refresh [<slug>…]` | retired | Re-fetch every cached deck URL (poison-flush). Clean source IP only. |
| `scrape.py --check` | retired | Read-only freshness report. |
| `scrape.py --tournaments` | retired | Tournament catalog + deck→tournament map (`tournaments.json/.js`). |
| `scrape.py --catalog` | live-ish | Re-scrape all card detail pages (`/cards/*` — not affected by the deck-page bot wall). Use for new sets. |
| `scrape.py --catalog-new` | live-ish | Incremental catalog backfill for missing slugs. |
| `scrape.py --staples` / `--closeness` / `--deck-lookup` / `--collection` | local-only | Regenerate the respective artifact from the frozen `legends/*/decks.json`. No network. |
| `scrape.py --import-collection <xlsx>` | **live** | Read a filled-in collection workbook → `collection-owned.js` + `collection-enroute.js` (static fallbacks behind the live Sheet). No network. |

Historical: archetype URLs used `?metagame_id=3` (the Unleashed period);
canonical form `https://riftdecks.com/legends/constructed/<slug>?metagame_id=3`.

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
  command. It pings deck 147957 (SantiSM's Lillia) and aborts the run
  if the response doesn't match our clean-route reference. Prevents
  accidental cache poisoning if WARP/VPN drops or if running from an
  unfamiliar network. Skip with env var `RIFTBOUND_SKIP_CANARY=1`
  (only needed if the deck legitimately changed upstream — then
  re-tune CANARY_CLEAN_MARKER / CANARY_POISON_MARKER against a fresh
  clean-route dump).

  **The phantom evolved (2026-06).** Originally the poisoned backend
  served a wrong *champion* (Lillia, Protector of Dreams), so the
  canary keyed on champion name. Weeks later the two backends now
  AGREE on the champion (both 'Fae Fawn') but diverge on the maindeck
  cards *and* on the deck's finishing rank (real 128th vs phantom
  109th — an author can't edit a tournament placement, so this is
  backend divergence, not an edit). A champion-level check passed on
  the poisoned backend, so the canary now keys on card content:
  clean marker `Thousand-Tailed Watcher` (in the real list), poison
  marker `Trevor Snoozebottom` (in the phantom). Both flip together.
  Verified on 2026-06 that the Claude-env IP hits the *poisoned*
  backend — the new canary correctly aborts there where the old one
  would have proceeded.
- **Set sizes** (for completeness checks): UNL 219, OGN 298, SFD 221, OGS 25, VEN 166 (the 2026-06 wave; its 9 legends get full names synthesized from slugs since no archetype pages were ever scraped).
  Catalog now covers 929 canonical printings (overnumbered-only dropped).
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
