# Riftbound dashboard — project notes for Claude

A local-first dashboard summarising Riftbound (League of Legends TCG)
tournament decks scraped from [riftdecks.com](https://riftdecks.com).
Hosted statically at **https://gotoloto.github.io/riftbound-meta-dashboard/**.
Repo: `gotoloto/riftbound-meta-dashboard` (working dir
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
| `scrape.py <archetype-url>` | Full scrape for one legend. Writes `legends/<slug>/{decks.json, cards.json, data.js}`. Auto-regenerates downstream artifacts (champions.js, staples.js, collection-template.xlsx, closeness-data.js, deck-lookup.js, cards-catalog.js). |
| `scrape.py --update [<slug>…]` | Incremental: pings `/legends` once, only walks the per-archetype listings whose deck counts changed. Fetches only new decks and new card metadata. |
| `scrape.py --check` | Read-only freshness report. |
| `scrape.py --catalog` | Re-scrape every card detail page (~770) for the canonical printing, rarity, image URL. Slow (~3 min). Writes `cards-catalog.json` + `cards-catalog.js`. |
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
- **Decks data drifts**: empirically, riftdecks rewrites tournament decks
  over time (every cached deck mismatched live after 24 hours during one
  audit). The user is sceptical that this is real (suspects a parser bug),
  but multiple controlled re-scrapes confirm it. Don't rebuild the parser —
  it's correct; just re-scrape periodically.
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
