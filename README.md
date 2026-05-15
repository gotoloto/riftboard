# Riftbound archetype dashboard

Local dashboard summarising every tournament deck for a given Riftbound
champion archetype on [riftdecks.com](https://riftdecks.com): how often each
card appears across the archetype, and how many copies decks tend to run when
they include it.

## Files

- `scrape.py` — fetches the archetype's deck list, every deck, and per-card
  metadata. Writes per-champion files into `legends/<slug>/`.
- `index.html`, `app.js`, `styles.css` — the dashboard.
- `champions.js` — index of every cached champion. The dashboard loads this
  first to populate the champion dropdown.
- `legends/<slug>/data.js` — full per-champion payload the dashboard reads
  when a champion is selected (`window.__DATA__ = …;`).
- `legends/<slug>/decks.json` — raw scrape (every deck, every card row).
  Per-card aggregated stats (`decks_including`, `inclusion_pct`,
  `copies_pct`, etc.) are computed at runtime by the dashboard and by the
  scraper's `build_staples` / `build_closeness_data` helpers, so no
  separate `cards.json` is written.

## Setup

The site is fronted by Cloudflare and rejects vanilla `requests`. We use
[`curl_cffi`](https://github.com/lexiforest/curl_cffi) to impersonate a real
Chrome TLS fingerprint, which sails through.

```sh
python3 -m venv .venv
.venv/bin/pip install curl_cffi beautifulsoup4
```

## Cache a champion (or refresh an existing one)

Grab the archetype URL from riftdecks.com and pass it as the only argument:

```sh
.venv/bin/python3 scrape.py "https://riftdecks.com/legends/constructed/<slug>?metagame_id=3"
```

The scrape writes `data-<slug>.js`, `decks-<slug>.json`, and `cards-<slug>.json`,
then rebuilds `champions.js` with the updated index. The dashboard's champion
dropdown picks up new entries on the next page reload — no re-scrape needed
when you switch back to a previously cached champion.

## View the dashboard

Just double-click `index.html`, or:

```sh
open index.html
```

(The dashboard reads `cards.js` via a `<script>` tag, which works under
`file://`. A local server is no longer required.)

## Notes

- Sideboard copies are **excluded** from the inclusion / average-copies stats.
  Tournament decks with sideboards count the mainboard only — that's the metric
  that tells you "how essential a card is to the archetype".
- "Avg copies" is the mean number of copies *among decks that include the card*
  — not averaged across all 337 decks. Multiply by inclusion % to get the
  archetype-wide average.
- Re-running `scrape.py` is idempotent: it overwrites both JSON files in
  place, with `decks.json` saved incrementally so a mid-run failure preserves
  what's already been parsed.
