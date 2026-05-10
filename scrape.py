#!/usr/bin/env python3
"""
Scrape every tournament deck for a given riftdecks.com champion archetype
and emit decks.json (raw) + cards.json (aggregated for the dashboard).

Usage: python scrape.py [archetype_url]

Defaults to the Lillia, Bashful Bloom Unleashed Constructed page.
"""

import glob
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from curl_cffi import requests

BASE = "https://riftdecks.com"
DEFAULT_URL = (
    "https://riftdecks.com/legends/constructed/lillia-bashful-bloom?metagame_id=3"
)
DECK_HREF_RE = re.compile(r"/riftbound-metagame/deck-")
CARD_HREF_RE = re.compile(r"/cards/details-")


def fetch(url: str, retries: int = 3) -> str:
    last = None
    for attempt in range(retries):
        try:
            r = requests.get(url, impersonate="chrome", timeout=30)
            if r.status_code == 200:
                return r.text
            last = f"status {r.status_code}"
        except Exception as exc:
            last = str(exc)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fetch failed for {url}: {last}")


RANK_TOP_RE = re.compile(r"Top\s*(\d+)", re.I)
RANK_ORDINAL_RE = re.compile(r"^(\d+)(?:st|nd|rd|th)$", re.I)
PLAYERS_RE = re.compile(r"(\d+)\s*Players", re.I)


def _parse_rank(text: str):
    """Convert "Top4", "1st", "76th" -> int rank; return None if unrecognized."""
    text = (text or "").strip()
    m = RANK_TOP_RE.match(text)
    if m:
        return int(m.group(1))
    m = RANK_ORDINAL_RE.match(text)
    if m:
        return int(m.group(1))
    return None


def parse_listing(html: str):
    soup = BeautifulSoup(html, "html.parser")
    deck_links = []
    deck_meta: dict[str, dict] = {}
    seen = set()

    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            a = tr.find("a", href=DECK_HREF_RE)
            if not a:
                continue
            full = urljoin(BASE, a["href"]).split("?")[0]
            if full in seen:
                continue
            seen.add(full)
            deck_links.append(full)
            cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
            row_text = " | ".join(cells)
            rank = None
            for c in cells:
                rank = _parse_rank(c)
                if rank is not None:
                    break
            players = None
            m = PLAYERS_RE.search(row_text)
            if m:
                players = int(m.group(1))
            finish_pct = None
            if rank is not None and players and players > 0:
                # Source occasionally reports "Top32" / "Top64" in smaller
                # tournaments (likely a bucket label for a cut that didn't
                # happen). Clamp impossible rank/players ratios at 100%.
                finish_pct = round(min(rank / players, 1.0) * 100, 1)
            deck_meta[full] = {
                "rank": rank,
                "players": players,
                "finish_pct": finish_pct,
            }

    # also find any deck links that weren't in the main tables (fallback)
    for a in soup.find_all("a", href=DECK_HREF_RE):
        full = urljoin(BASE, a["href"]).split("?")[0]
        if full not in seen:
            seen.add(full)
            deck_links.append(full)
            deck_meta.setdefault(
                full, {"rank": None, "players": None, "finish_pct": None}
            )

    max_page = 1
    for a in soup.find_all("a", href=re.compile(r"page=\d+")):
        m = re.search(r"page=(\d+)", a["href"])
        if m:
            max_page = max(max_page, int(m.group(1)))
    archetype, total = "", None
    if soup.title and soup.title.string:
        m = re.match(
            r"Riftbound (?:\w+ )?(.+?) decks - (\d+) available", soup.title.string
        )
        if m:
            archetype = m.group(1).strip()
            total = int(m.group(2))
    return deck_links, max_page, archetype, total, deck_meta


SECTION_RE = re.compile(r"^([\w\s]+?)\s*\((\d+)\)\s*$")
TYPE_NORMALIZE = {
    "battlefields": "battlefield",
    "runes": "rune",
    "spells": "spell",
    "units": "unit",
    "gears": "gear",
    "champions": "champion",
    "legends": "legend",
}


def parse_deck(html: str, url: str):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    h = soup.find(
        lambda t: t.name in ("h2", "h3") and "Text Decklist" in t.get_text()
    )
    if not h:
        return None
    table = h.find_next("table")
    if not table:
        return None
    cards = []
    current_type = None
    board = "main"
    for tr in table.find_all("tr"):
        link = tr.find("a", href=CARD_HREF_RE)
        if not link:
            text = tr.get_text(" ", strip=True)
            m = SECTION_RE.match(text)
            if m:
                section = m.group(1).strip().lower()
                if section == "sideboard":
                    board = "side"
                    current_type = None
                else:
                    current_type = TYPE_NORMALIZE.get(section, section)
            continue
        cell_texts = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
        qty = next(
            (int(c) for c in cell_texts if c.isdigit()), None
        )
        if qty is None:
            continue
        href = link["href"]
        slug = href.rsplit("/", 1)[-1]
        cards.append(
            {
                "name": link.get_text(strip=True),
                "slug": slug,
                "url": urljoin(BASE, href),
                "qty": qty,
                "type": current_type,
                "board": board,
            }
        )
    return {"url": url, "title": title, "cards": cards}


def parse_card_detail(html: str):
    soup = BeautifulSoup(html, "html.parser")
    fields: dict[str, list[str]] = {}
    for div in soup.find_all("div", class_="mb-2"):
        h3 = div.find("h3")
        if not h3:
            continue
        key = h3.get_text(strip=True).lower()
        h3.extract()
        val = div.get_text(" ", strip=True)
        if not val:
            continue
        fields.setdefault(key, []).append(val)
    return fields


def save_json(path: str, data) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def save_cards_js(path: str, data) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.__CARDS__ = ")
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    os.replace(tmp, path)


def build_dashboard_payload(raw: dict) -> dict:
    """Compact, dashboard-friendly view: per-deck mainboard + sideboard summary
    plus card metadata. The dashboard recomputes inclusion/avg/distribution
    stats live from this so UI filters (board, finish percentile, type) can
    change the aggregate."""
    decks_slim = []
    for d in raw["decks"]:
        mainboard: dict[str, int] = {}
        sideboard: dict[str, int] = {}
        for c in d["cards"]:
            target = mainboard if c["board"] == "main" else sideboard
            target[c["slug"]] = target.get(c["slug"], 0) + c["qty"]
        decks_slim.append(
            {
                "u": d["url"],
                "t": d.get("title", ""),
                "rk": d.get("rank"),
                "pl": d.get("players"),
                "fp": d.get("finish_pct"),
                "c": [[slug, qty] for slug, qty in mainboard.items()],
                "s": [[slug, qty] for slug, qty in sideboard.items()],
            }
        )
    cards_meta = {}
    for slug, m in raw["cards_meta"].items():
        cards_meta[slug] = {
            "name": m.get("name", slug),
            "type": m.get("type"),
            "domains": m.get("domains", []),
            "cost": m.get("cost"),
            "url": m.get("url"),
        }
    return {
        "archetype": raw["archetype"],
        "url": raw["url"],
        "scraped_at": raw["scraped_at"],
        "deck_count": raw["deck_count"],
        "decks": decks_slim,
        "cards_meta": cards_meta,
    }


def save_data_js(path: str, payload: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.__DATA__ = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    os.replace(tmp, path)


def slug_from_url(url: str) -> str:
    """Extract the archetype slug from a riftdecks URL."""
    m = re.search(r"/constructed/([^/?#]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"/legends/[^/]+/([^/?#]+)", url)
    if m:
        return m.group(1)
    return ""


def slugify(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "champion"


def rebuild_champions_index(directory: str = ".") -> list[dict]:
    """Scan data-*.js in `directory` and rewrite champions.js."""
    entries = []
    for fn in sorted(glob.glob(os.path.join(directory, "data-*.js"))):
        m = re.match(r"data-(.+)\.js$", os.path.basename(fn))
        if not m:
            continue
        slug = m.group(1)
        try:
            with open(fn, "r", encoding="utf-8") as f:
                txt = f.read()
            start = txt.index("=") + 1
            end = txt.rfind(";")
            data = json.loads(txt[start:end])
        except Exception as exc:
            print(f"      ! could not read {fn}: {exc}")
            continue
        entries.append(
            {
                "slug": slug,
                "name": data.get("archetype", slug),
                "url": data.get("url", ""),
                "scraped_at": data.get("scraped_at", ""),
                "deck_count": data.get("deck_count", 0),
            }
        )
    entries.sort(key=lambda e: e["name"])
    with open(os.path.join(directory, "champions.js"), "w", encoding="utf-8") as f:
        f.write("window.__CHAMPIONS__ = ")
        json.dump(entries, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    return entries


def aggregate(data: dict) -> dict:
    decks = data["decks"]
    n = len(decks)
    cards_meta = data["cards_meta"]
    # per-deck quantity tally per card
    per_deck_qty: list[dict[str, int]] = []
    seen_slugs: set[str] = set()
    for d in decks:
        totals: dict[str, int] = {}
        for c in d["cards"]:
            if c["board"] != "main":
                continue
            totals[c["slug"]] = totals.get(c["slug"], 0) + c["qty"]
        per_deck_qty.append(totals)
        seen_slugs.update(totals.keys())

    cards = []
    for slug in seen_slugs:
        meta = cards_meta.get(slug, {})
        # build the copies histogram across all n decks (decks not running the
        # card contribute a 0)
        buckets = {0: 0, 1: 0, 2: 0, "3+": 0}
        total_copies = 0
        decks_inc = 0
        for totals in per_deck_qty:
            qty = totals.get(slug, 0)
            if qty == 0:
                buckets[0] += 1
            elif qty == 1:
                buckets[1] += 1
            elif qty == 2:
                buckets[2] += 1
            else:
                buckets["3+"] += 1
            if qty > 0:
                decks_inc += 1
                total_copies += qty
        avg = total_copies / decks_inc if decks_inc else 0
        pct = {k: round(v / n * 100, 1) if n else 0 for k, v in buckets.items()}
        cards.append(
            {
                "slug": slug,
                "name": meta.get("name", slug),
                "type": meta.get("type"),
                "domains": meta.get("domains", []),
                "cost": meta.get("cost"),
                "rarity": meta.get("rarity"),
                "url": meta.get("url"),
                "decks_including": decks_inc,
                "inclusion_pct": round(decks_inc / n * 100, 1) if n else 0,
                "avg_copies_when_included": round(avg, 2),
                "copies_pct": {
                    "0": pct[0],
                    "1": pct[1],
                    "2": pct[2],
                    "3+": pct["3+"],
                },
            }
        )
    cards.sort(key=lambda c: c["decks_including"], reverse=True)
    return {
        "archetype": data["archetype"],
        "url": data["url"],
        "scraped_at": data["scraped_at"],
        "deck_count": n,
        "cards": cards,
    }


def main(archetype_url: str) -> None:
    print(f"[1/4] listing pages — fetching {archetype_url}")
    html = fetch(archetype_url)
    deck_links, max_page, archetype, total, deck_meta = parse_listing(html)
    print(f"      archetype={archetype!r} total={total} pages={max_page}")

    sep = "&" if "?" in archetype_url else "?"
    for p in range(2, max_page + 1):
        url = f"{archetype_url}{sep}page={p}"
        print(f"      page {p}/{max_page}")
        try:
            page_html = fetch(url)
        except Exception as exc:
            print(f"      ! failed: {exc}")
            continue
        more, _, _, _, more_meta = parse_listing(page_html)
        for u in more:
            if u not in deck_links:
                deck_links.append(u)
            if u not in deck_meta and u in more_meta:
                deck_meta[u] = more_meta[u]
        time.sleep(0.4)
    print(f"[1/4] collected {len(deck_links)} unique deck URLs")

    print(f"[2/4] scraping {len(deck_links)} decks")
    decks: list[dict] = []
    for i, durl in enumerate(deck_links, 1):
        try:
            page_html = fetch(durl)
            d = parse_deck(page_html, durl)
            if d:
                meta = deck_meta.get(durl, {})
                d["rank"] = meta.get("rank")
                d["players"] = meta.get("players")
                d["finish_pct"] = meta.get("finish_pct")
                decks.append(d)
            else:
                print(f"      ! no decklist parsed: {durl}")
        except Exception as exc:
            print(f"      ! deck {i} failed: {exc}")
        if i % 10 == 0:
            print(f"      {i}/{len(deck_links)} ({len(decks)} parsed)")
            save_json(
                "decks.json",
                {
                    "archetype": archetype,
                    "url": archetype_url,
                    "scraped_at": datetime.utcnow().isoformat() + "Z",
                    "deck_count": len(decks),
                    "decks": decks,
                    "cards_meta": {},
                },
            )
        time.sleep(0.3)
    print(f"[2/4] parsed {len(decks)} decks")

    print("[3/4] fetching unique-card metadata (type/domains/cost)")
    unique: dict[str, dict] = {}
    for d in decks:
        for c in d["cards"]:
            if c["slug"] not in unique:
                unique[c["slug"]] = {
                    "name": c["name"],
                    "url": c["url"],
                    "type": c["type"],
                }
    for i, (slug, info) in enumerate(unique.items(), 1):
        try:
            page_html = fetch(info["url"])
            fields = parse_card_detail(page_html)
            info["domains"] = fields.get("domains", [])
            cost_vals = fields.get("cost", [])
            info["cost"] = cost_vals[0] if cost_vals else None
            type_vals = fields.get("types", [])
            if type_vals:
                info["type"] = type_vals[0]
            info["rarity"] = fields.get("rarity", [None])[0]
        except Exception as exc:
            print(f"      ! card {slug} failed: {exc}")
        if i % 25 == 0:
            print(f"      card {i}/{len(unique)}")
        time.sleep(0.25)
    print(f"[3/4] enriched {len(unique)} cards")

    raw = {
        "archetype": archetype,
        "url": archetype_url,
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "deck_count": len(decks),
        "decks": decks,
        "cards_meta": unique,
    }
    slug = slug_from_url(archetype_url) or slugify(archetype)
    decks_path = f"decks-{slug}.json"
    data_path = f"data-{slug}.js"
    cards_path = f"cards-{slug}.json"
    save_json(decks_path, raw)

    print(f"[4/4] aggregating {cards_path} + {data_path}")
    aggregated = aggregate(raw)
    save_json(cards_path, aggregated)
    save_data_js(data_path, build_dashboard_payload(raw))
    rebuild_champions_index()
    print(f"      {len(aggregated['cards'])} unique cards over {raw['deck_count']} decks")
    print(f"      slug: {slug}")
    print("done.")


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    main(url)
