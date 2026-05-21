"use strict";

const NUM_COLS = new Set([
  "cost",
  "decks_including",
  "inclusion_pct",
  "avg_copies_when_included",
  "copies_pct.1",
  "copies_pct.2",
  "copies_pct.3+",
]);

// RARITY + escapeHtml live in utils.js (loaded by index.html before this).

function rarityHtml(slug) {
  const r = state.cardsMeta[slug]?.rarity;
  const g = r && RARITY[String(r).toLowerCase()];
  if (!g) return "";
  return ` <span class="rarity rarity-${g.cls}" title="${escapeHtml(r)}" aria-hidden="true">${g.ch}</span>`;
}

function getField(obj, path) {
  if (!path.includes(".")) return obj[path];
  const [head, ...rest] = path.split(".");
  const tail = rest.join(".");
  const sub = obj[head];
  return sub ? sub[tail] : undefined;
}

const state = {
  rawDecks: [],
  cardsMeta: {},
  cards: [],
  archetypeDeckCount: 0,
  filteredDeckCount: 0,
  sortKey: "decks_including",
  sortDir: "desc",
  query: "",
  minDecks: 1,
  enabledTypes: null,
  maxFinishPct: 100,
  includeUnranked: true,
  minDate: null, // "YYYY-MM-DD" or null
  // Set of region buckets currently enabled. Empty = "All" (no filter).
  // Multi-select: clicking a pill toggles it; "All" clears the set.
  selectedRegions: new Set(), // subset of {"CN", "WEST", "ONLINE", "unknown"}
  board: "main", // "main" or "side"
  medianMode: "composite", // "composite" or "representative"
  expandedSlugs: new Set(), // card slugs whose deck-list is expanded
};

// ---- Region helpers (joined from tournaments.js at render time) ----
// Coarse buckets keyed by ISO country code. Tweak here; no re-scrape needed.
const CN_COUNTRIES = new Set(["CN", "HK", "TW", "MO"]);
const WEST_COUNTRIES = new Set([
  "US", "CA", "GB", "DE", "FR", "IT", "ES", "NL", "PL", "SE",
  "BE", "CH", "AT", "AU", "NZ", "BR", "MX", "AR", "PT", "IE",
  "NO", "FI", "DK", "CZ",
]);
function regionFor(countryCode) {
  if (!countryCode) return null;
  if (countryCode === "ONLINE") return "ONLINE";
  if (CN_COUNTRIES.has(countryCode)) return "CN";
  if (WEST_COUNTRIES.has(countryCode)) return "WEST";
  return null;
}

const __regionCache = new Map();
function regionForDeckUrl(url) {
  if (!url) return null;
  if (__regionCache.has(url)) return __regionCache.get(url);
  const T = window.__TOURNAMENTS__;
  let region = null;
  if (T) {
    const slug = T.deckToTournament?.[url];
    if (slug) {
      const t = T.tournaments?.find((x) => x.slug === slug);
      if (t) region = regionFor(t.country);
    }
  }
  __regionCache.set(url, region);
  return region;
}

const tbody = document.querySelector("#cards-table tbody");
const thead = document.querySelector("#cards-table thead");
const titleEl = document.getElementById("archetype-title");
const metaEl = document.getElementById("meta");
const searchEl = document.getElementById("search");
const minDecksEl = document.getElementById("min-decks");
const hideZeroEl = document.getElementById("hide-zero");
const rowCountEl = document.getElementById("row-count");
const emptyEl = document.getElementById("empty-state");
const typeFiltersEl = document.getElementById("type-filters");
const pctInputEl = document.getElementById("pct-input");
const includeUnrankedEl = document.getElementById("include-unranked");
const deckCountInfoEl = document.getElementById("deck-count-info");
const presetsEl = document.querySelector(".perf-filter .presets");
const medianContentEl = document.getElementById("median-content");
const medianContextEl = document.getElementById("median-context");
const medianMetaEl = document.getElementById("median-meta");
const medianModeToggleEl = document.querySelector(".median-mode-toggle");
const copyBtnEl = document.getElementById("copy-decklist");
const championSelectEl = document.getElementById("champion-select");
const minDateEl = document.getElementById("min-date");
const clearDateEl = document.getElementById("clear-date");
const dateRangeHintEl = document.getElementById("date-range-hint");
const LAST_CHAMPION_KEY = "riftbound:last-champion";

function compareValues(a, b, key, dir) {
  let va = getField(a, key);
  let vb = getField(b, key);
  if (Array.isArray(va)) va = va.join(",");
  if (Array.isArray(vb)) vb = vb.join(",");
  if (va == null) va = NUM_COLS.has(key) ? -Infinity : "";
  if (vb == null) vb = NUM_COLS.has(key) ? -Infinity : "";
  if (NUM_COLS.has(key)) {
    const na = Number(va);
    const nb = Number(vb);
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return dir === "asc" ? na - nb : nb - na;
  }
  return dir === "asc"
    ? String(va).localeCompare(String(vb))
    : String(vb).localeCompare(String(va));
}

function pctBar(p) {
  const clamped = Math.max(0, Math.min(100, p));
  return `<span class="bar"><span style="width:${clamped}%"></span></span>`;
}

function renderRow(card) {
  const domains = (card.domains || [])
    .map(
      (d) =>
        `<span class="tag domain-${escapeHtml(String(d).toLowerCase())}">${escapeHtml(d)}</span>`
    )
    .join("");
  const link = card.url
    ? `<a href="${card.url}" target="_blank" rel="noopener">${escapeHtml(
        card.name
      )}</a>${rarityHtml(card.slug)}`
    : `${escapeHtml(card.name)}${rarityHtml(card.slug)}`;
  const cost = card.cost == null || card.cost === "" ? "—" : card.cost;
  const inclusion = card.inclusion_pct.toFixed(1);
  const cp = card.copies_pct;
  const fmt = (v) => `${(v ?? 0).toFixed(1)}%`;
  const expanded = state.expandedSlugs.has(card.slug);
  const chevron = expanded ? "▾" : "▸";
  const rowClass = expanded ? ' class="expanded"' : "";
  let html = `
    <tr${rowClass} data-slug="${escapeHtml(card.slug)}">
      <td>${link}</td>
      <td>${card.type ? `<span class="tag">${card.type}</span>` : ""}</td>
      <td>${domains || ""}</td>
      <td class="num">${cost}</td>
      <td class="num clickable" data-action="toggle-decks" title="Click to list decks running this card"><span class="chev">${chevron}</span> ${card.decks_including} / ${state.filteredDeckCount}</td>
      <td class="num">${inclusion}%${pctBar(card.inclusion_pct)}</td>
      <td class="num">${card.avg_copies_when_included.toFixed(2)}</td>
      <td class="num">${fmt(cp["1"])}</td>
      <td class="num">${fmt(cp["2"])}</td>
      <td class="num">${fmt(cp["3+"])}</td>
    </tr>
  `;
  if (expanded) {
    html += `<tr class="deck-list-row"><td colspan="10">${renderDeckList(card.slug)}</td></tr>`;
  }
  return html;
}

function renderDeckList(slug) {
  const boardKey = state.board === "side" ? "s" : "c";
  const matches = [];
  for (const d of state.rawDecks) {
    if (!deckPasses(d)) continue;
    const cardList = d[boardKey] || [];
    const entry = cardList.find(([s]) => s === slug);
    if (!entry) continue;
    matches.push({ deck: d, qty: entry[1] });
  }
  // Best finish first, then date desc as a tie-break.
  matches.sort((a, b) => {
    const fa = a.deck.fp == null ? Infinity : a.deck.fp;
    const fb = b.deck.fp == null ? Infinity : b.deck.fp;
    if (fa !== fb) return fa - fb;
    return (b.deck.dt || "").localeCompare(a.deck.dt || "");
  });

  if (!matches.length) {
    return `<p class="muted">No matching decks for the current filters.</p>`;
  }

  const items = matches
    .map(({ deck, qty }) => {
      const finish =
        deck.rk != null && deck.pl != null
          ? `<span class="rank">${deck.rk}/${deck.pl}${
              deck.fp != null ? ` (${deck.fp.toFixed(1)}%)` : ""
            }</span>`
          : `<span class="rank muted">unranked</span>`;
      const date = deck.dt || "—";
      return `<li>
        <span class="qty">${qty}×</span>
        ${finish}
        <a href="${deck.u}" target="_blank" rel="noopener">${escapeHtml(
        deckTitle(deck)
      )} ↗</a>
        <span class="date muted">${date}</span>
      </li>`;
    })
    .join("");

  return `<div class="deck-list-wrap"><p class="deck-list-summary muted">${matches.length} ${
    state.board === "side" ? "sideboards" : "decks"
  } running this card · ${state.board === "side" ? "in sideboard" : "in mainboard"}, sorted by best finish</p><ul class="deck-list">${items}</ul></div>`;
}

function median(sortedAsc) {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

function aggregateCards(decks) {
  const boardKey = state.board === "side" ? "s" : "c";
  // Count only decks that *have a board of this kind* — a deck with no
  // sideboard isn't running 0 copies of every card, it just didn't sideboard.
  const decksWithBoard = decks.filter((d) => (d[boardKey] || []).length > 0);
  const n = decksWithBoard.length;
  const perCard = new Map();
  for (const d of decksWithBoard) {
    for (const [slug, qty] of d[boardKey]) {
      let e = perCard.get(slug);
      if (!e) {
        e = { di: 0, sum: 0, b1: 0, b2: 0, b3: 0, qtys: [] };
        perCard.set(slug, e);
      }
      e.di += 1;
      e.sum += qty;
      e.qtys.push(qty);
      if (qty === 1) e.b1 += 1;
      else if (qty === 2) e.b2 += 1;
      else if (qty >= 3) e.b3 += 1;
    }
  }
  const out = [];
  const round1 = (x) => Math.round(x * 10) / 10;
  const round2 = (x) => Math.round(x * 100) / 100;
  for (const [slug, e] of perCard) {
    const meta = state.cardsMeta[slug] || {};
    e.qtys.sort((a, b) => a - b);
    const med = median(e.qtys);
    out.push({
      slug,
      name: meta.name || slug,
      type: meta.type,
      domains: meta.domains || [],
      cost: meta.cost,
      url: meta.url,
      decks_including: e.di,
      inclusion_pct: n ? round1((e.di / n) * 100) : 0,
      avg_copies_when_included: e.di ? round2(e.sum / e.di) : 0,
      median_copies_when_included: med,
      copies_pct: {
        "1": e.di ? round1((e.b1 / e.di) * 100) : 0,
        "2": e.di ? round1((e.b2 / e.di) * 100) : 0,
        "3+": e.di ? round1((e.b3 / e.di) * 100) : 0,
      },
    });
  }
  return out;
}

const KNOWN_TYPES = ["legend", "battlefield", "rune", "unit", "spell", "gear"];
// Champion catalog (sourced from cached deck data via build_champion_slugs).
// Cards in this set are units in catalog terms but get displayed in their
// own Champion section per riftdecks' deck-export convention.
const CHAMPION_SLUGS_SET = new Set(window.__CHAMPION_SLUGS__ || []);

function slotFor(card) {
  // Slug-based check first so champion units (catalog type=unit but special
  // role per deck) get pulled out of the units pool.
  if (card.slug && CHAMPION_SLUGS_SET.has(card.slug)) return "champion";
  const t = (card.type || "").toLowerCase();
  return KNOWN_TYPES.includes(t) ? t : "other";
}

// Hardcoded slot targets dictated by Riftbound deck-building rules.
// Champion + battlefield + rune sum to 16 fixed; the remaining 39 of the
// 40-card maindeck split between unit/spell/gear dynamically.
const STATIC_TARGETS = { legend: 1, champion: 1, battlefield: 3, rune: 12 };
const SLOT_LABELS = {
  legend: "Legend",
  champion: "Champion",
  battlefield: "Battlefields",
  rune: "Runes",
  unit: "Units",
  spell: "Spells",
  gear: "Gear",
  other: "Other",
};
const SLOT_ORDER = [
  "legend",
  "champion",
  "unit",
  "spell",
  "gear",
  "battlefield",
  "rune",
  "other",
];

function computeDynamicTargets(filteredDecks) {
  const buckets = { unit: [], spell: [], gear: [] };
  for (const d of filteredDecks) {
    const tally = { unit: 0, spell: 0, gear: 0 };
    for (const [slug, qty] of d.c || []) {
      const t = (state.cardsMeta[slug]?.type || "").toLowerCase();
      if (t in tally) tally[t] += qty;
    }
    for (const k of Object.keys(buckets)) buckets[k].push(tally[k]);
  }
  const out = {};
  for (const [k, arr] of Object.entries(buckets)) {
    arr.sort((a, b) => a - b);
    out[k] = Math.round(median(arr));
  }
  return out;
}

function pickByMedian(cards, target) {
  // Sort by inclusion desc, tie-break by median copies desc, then name asc.
  const sorted = cards.slice().sort((a, b) => {
    if (b.decks_including !== a.decks_including)
      return b.decks_including - a.decks_including;
    if (b.median_copies_when_included !== a.median_copies_when_included)
      return b.median_copies_when_included - a.median_copies_when_included;
    return a.name.localeCompare(b.name);
  });
  const picks = [];
  let filled = 0;
  for (const c of sorted) {
    if (filled >= target) break;
    const wanted = Math.max(1, Math.round(c.median_copies_when_included));
    const copies = Math.min(wanted, target - filled);
    picks.push({ ...c, picked_copies: copies });
    filled += copies;
  }
  return { picks, filled };
}

const MAINDECK_TARGET = 40;
// Of the 40-card maindeck, 1 slot is the champion; the unit/spell/gear/other
// pool fills the remaining 39.
const MAINDECK_NON_CHAMPION_TARGET = 39;

function buildCompositeSections() {
  if (state.board === "side") {
    const filteredDecks = state.rawDecks
      .filter(deckPasses)
      .filter((d) => (d.s || []).length > 0);
    const sizes = filteredDecks
      .map((d) => d.s.reduce((sum, [, q]) => sum + q, 0))
      .sort((a, b) => a - b);
    const medianSize = Math.round(median(sizes)) || 0;
    const { picks, filled } = pickByMedian(state.cards, medianSize);
    return [
      {
        key: "side",
        label: "Sideboard",
        target: medianSize,
        filled,
        picks,
      },
    ];
  }

  const grouped = Object.fromEntries(SLOT_ORDER.map((k) => [k, []]));
  for (const c of state.cards) grouped[slotFor(c)].push(c);

  const sections = [];

  // Maindeck pool (unit + spell + gear + other) — champion already pulled
  // out into its own slot. Target 39 so champion(1) + pool(39) = 40.
  const pool = [
    ...grouped.unit,
    ...grouped.spell,
    ...grouped.gear,
    ...grouped.other,
  ];
  const { picks: mdPicks, filled: mdFilled } = pickByMedian(
    pool,
    MAINDECK_NON_CHAMPION_TARGET
  );
  const subGroups = { unit: [], spell: [], gear: [], other: [] };
  for (const p of mdPicks) subGroups[slotFor(p)].push(p);

  // Render order: Legend → Champion → Units → Spells → Gear → Battlefields → Runes
  // (matches riftdecks' deck-export convention: legend/champion first, then
  // the variable maindeck split, then fixed-target slots).
  {
    const target = STATIC_TARGETS.legend;
    const { picks, filled } = pickByMedian(grouped.legend, target);
    sections.push({ key: "legend", label: SLOT_LABELS.legend, target, filled, picks });
  }
  {
    const target = STATIC_TARGETS.champion;
    const { picks, filled } = pickByMedian(grouped.champion, target);
    sections.push({ key: "champion", label: SLOT_LABELS.champion, target, filled, picks });
  }
  for (const sub of ["unit", "spell", "gear", "other"]) {
    if (subGroups[sub].length === 0 && sub === "other") continue;
    const filled = subGroups[sub].reduce((s, p) => s + p.picked_copies, 0);
    sections.push({
      key: sub,
      label: SLOT_LABELS[sub],
      target: MAINDECK_NON_CHAMPION_TARGET,
      filled,
      picks: subGroups[sub],
      subOfMaindeck: true,
    });
  }
  for (const key of ["battlefield", "rune"]) {
    const target = STATIC_TARGETS[key];
    const { picks, filled } = pickByMedian(grouped[key], target);
    sections.push({ key, label: SLOT_LABELS[key], target, filled, picks });
  }
  // Track maindeck under-fill (rare: if the non-champion pool can't hit 39)
  if (mdFilled < MAINDECK_NON_CHAMPION_TARGET) {
    sections.push({
      key: "_warning",
      label: `Maindeck pool exhausted (${mdFilled}/${MAINDECK_NON_CHAMPION_TARGET})`,
      target: 0,
      filled: 0,
      picks: [],
    });
  }
  return sections;
}

function renderCompositeDeck() {
  medianMetaEl.innerHTML = "";
  const sections = buildCompositeSections();
  const boardLabel = state.board === "side" ? "sideboard" : "mainboard";
  if (state.board === "side") {
    const sec = sections[0];
    medianContextEl.textContent = `· ${boardLabel} · ${sec.filled}/${sec.target} cards (median copies of top-included cards)`;
  } else {
    const fixed =
      (sections.find((s) => s.key === "legend")?.filled || 0) +
      (sections.find((s) => s.key === "battlefield")?.filled || 0) +
      (sections.find((s) => s.key === "rune")?.filled || 0);
    const champ = sections.find((s) => s.key === "champion")?.filled || 0;
    const md = sections
      .filter((s) => s.subOfMaindeck)
      .reduce((sum, s) => sum + s.filled, 0);
    medianContextEl.textContent = `· ${boardLabel} · ${
      fixed + champ + md
    } cards (1 + 1 + 3 + 12 + ${md}/39 maindeck)`;
  }

  medianContentEl.innerHTML = sections
    .map((sec) => {
      if (sec.key === "_warning") {
        return `<div class="median-section"><h3 class="muted">${escapeHtml(
          sec.label
        )}</h3></div>`;
      }
      if (sec.target === 0 && !sec.subOfMaindeck)
        return `<div class="median-section"><h3>${escapeHtml(
          sec.label
        )} <span class="target">(0)</span></h3><ul><li class="muted">No decks in this slice</li></ul></div>`;
      const short = !sec.subOfMaindeck && sec.filled < sec.target;
      const targetStr = sec.subOfMaindeck
        ? `<span class="target">(${sec.filled} of 40)</span>`
        : `<span class="target${short ? " short" : ""}">(${sec.filled}/${sec.target})</span>`;
      const items = sec.picks.length
        ? sec.picks
            .map((p) => {
              const link = p.url
                ? `<a href="${p.url}" data-slug="${escapeHtml(p.slug)}" target="_blank" rel="noopener">${escapeHtml(
                    p.name
                  )}</a>`
                : escapeHtml(p.name);
              return `<li><span class="qty">${p.picked_copies}×</span><span class="name">${link}</span>${rarityHtml(p.slug)}<span class="pct">${p.inclusion_pct.toFixed(
                1
              )}%</span></li>`;
            })
            .join("")
        : `<li class="muted">No data</li>`;
      return `<div class="median-section"><h3>${escapeHtml(
        sec.label
      )} ${targetStr}</h3><ul>${items}</ul></div>`;
    })
    .join("");
}

function findRepresentativeDeck() {
  const boardKey = state.board === "side" ? "s" : "c";
  const decks = state.rawDecks
    .filter(deckPasses)
    .filter((d) => (d[boardKey] || []).length > 0);
  if (!decks.length) return null;

  // Build the composite as a slug → qty map (the same picks that Composite
  // mode renders). The representative deck is the real deck whose own
  // (slug, qty) profile is closest to that composite. Distance is Manhattan
  // — sum of |composite_qty(s) − deck_qty(s)| across every slug either
  // side mentions. Much more meaningful than matching unit/spell/gear
  // totals, which can tie wildly different decks.
  const composite = new Map();
  for (const sec of buildCompositeSections()) {
    for (const p of sec.picks || []) {
      composite.set(p.slug, (composite.get(p.slug) || 0) + p.picked_copies);
    }
  }

  let best = null;
  let bestDist = Infinity;
  for (const d of decks) {
    const tally = new Map();
    for (const [slug, qty] of d[boardKey] || []) {
      tally.set(slug, (tally.get(slug) || 0) + qty);
    }
    const slugs = new Set([...composite.keys(), ...tally.keys()]);
    let dist = 0;
    for (const s of slugs) {
      dist += Math.abs((composite.get(s) || 0) - (tally.get(s) || 0));
    }
    const fp = d.fp == null ? Infinity : d.fp;
    const bestFp = best == null || best.fp == null ? Infinity : best.fp;
    if (dist < bestDist || (dist === bestDist && fp < bestFp)) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function deckTitle(deck) {
  // The scraped title is the page <title>: "<name> by <player> | riftDecks.com".
  // Strip the site suffix.
  const t = (deck.t || "").replace(/\s*\|\s*riftDecks\.com$/i, "").trim();
  return t || "Representative deck";
}

function renderRepresentativeDeck() {
  const deck = findRepresentativeDeck();
  const boardLabel = state.board === "side" ? "sideboard" : "mainboard";
  if (!deck) {
    medianMetaEl.innerHTML = "";
    medianContextEl.textContent = `· ${boardLabel} · no matching decks`;
    medianContentEl.innerHTML = `<div class="median-section"><p class="muted">No decks match the current filters.</p></div>`;
    return;
  }

  const cardList = state.board === "side" ? deck.s || [] : deck.c || [];
  const total = cardList.reduce((s, [, q]) => s + q, 0);

  // Build sections by slot, using actual quantities from this deck.
  const sectionsBySlot = {
    legend: [],
    champion: [],
    battlefield: [],
    rune: [],
    unit: [],
    spell: [],
    gear: [],
    other: [],
  };
  for (const [slug, qty] of cardList) {
    const meta = state.cardsMeta[slug] || {};
    const card = state.cards.find((c) => c.slug === slug) || {};
    // Pass slug so champion units get sorted into the Champion slot.
    const slot = slotFor({ slug, type: meta.type });
    sectionsBySlot[slot].push({
      slug,
      name: meta.name || slug,
      url: meta.url,
      type: meta.type,
      qty,
      inclusion_pct: card.inclusion_pct ?? 0,
    });
  }
  // Sort within each slot by qty desc, then name.
  for (const arr of Object.values(sectionsBySlot)) {
    arr.sort(
      (a, b) =>
        b.qty - a.qty || (a.name || "").localeCompare(b.name || "")
    );
  }

  // Header line: deck title, finisher info, date, source link.
  const finishStr =
    deck.rk != null && deck.pl != null
      ? `${deck.rk} of ${deck.pl}${
          deck.fp != null ? ` (${deck.fp.toFixed(1)}%)` : ""
        }`
      : "—";
  const dateStr = deck.dt || "—";
  medianMetaEl.innerHTML = `<strong>${escapeHtml(
    deckTitle(deck)
  )}</strong> · ${finishStr} · ${dateStr} · <a href="${
    deck.u
  }" target="_blank" rel="noopener">view on riftdecks ↗</a> <span class="muted" title="Riftdecks' backend serves different deck content depending on the visitor's source IP (see CLAUDE.md). What we cached and what you see live can be entirely different decks, not just edits.">(snapshot — your live view may differ)</span>`;

  medianContextEl.textContent = `· ${boardLabel} · ${total} cards (closest real deck to median split)`;

  // Layout: matches Composite — Legend → Champion → Units → Spells → Gear → Battlefields → Runes
  const order =
    state.board === "side"
      ? ["unit", "spell", "gear", "other", "battlefield", "rune", "champion", "legend"]
      : ["legend", "champion", "unit", "spell", "gear", "battlefield", "rune", "other"];

  medianContentEl.innerHTML = order
    .filter((k) => sectionsBySlot[k].length > 0)
    .map((k) => {
      const arr = sectionsBySlot[k];
      const subtotal = arr.reduce((s, c) => s + c.qty, 0);
      const items = arr
        .map((c) => {
          const link = c.url
            ? `<a href="${c.url}" data-slug="${escapeHtml(c.slug)}" target="_blank" rel="noopener">${escapeHtml(
                c.name
              )}</a>`
            : escapeHtml(c.name);
          return `<li><span class="qty">${c.qty}×</span><span class="name">${link}</span>${rarityHtml(c.slug)}<span class="pct">${c.inclusion_pct.toFixed(
            1
          )}%</span></li>`;
        })
        .join("");
      return `<div class="median-section"><h3>${escapeHtml(
        SLOT_LABELS[k]
      )} <span class="target">(${subtotal})</span></h3><ul>${items}</ul></div>`;
    })
    .join("");
}

function renderMedianDeck() {
  if (state.medianMode === "representative") {
    renderRepresentativeDeck();
  } else {
    renderCompositeDeck();
  }
}

function deckPasses(deck) {
  if (state.minDate && deck.dt && deck.dt < state.minDate) return false;
  if (state.selectedRegions.size > 0) {
    const r = regionForDeckUrl(deck.u);
    // "unknown" pill matches any deck whose region resolves to null
    const bucket = r || "unknown";
    if (!state.selectedRegions.has(bucket)) return false;
  }
  if (deck.fp == null) return state.includeUnranked;
  return deck.fp <= state.maxFinishPct;
}

function recompute() {
  const decks = state.rawDecks.filter(deckPasses);
  const boardKey = state.board === "side" ? "s" : "c";
  const withBoard = decks.filter((d) => (d[boardKey] || []).length > 0).length;
  state.filteredDeckCount = withBoard;
  state.cards = aggregateCards(decks);
  const noun = state.board === "side" ? "sideboards" : "decks";
  if (decks.length === state.archetypeDeckCount) {
    if (withBoard === decks.length) {
      deckCountInfoEl.textContent = `${withBoard} ${noun} (all)`;
    } else {
      deckCountInfoEl.textContent = `${withBoard} ${noun} (of ${decks.length} decks)`;
    }
  } else {
    deckCountInfoEl.textContent = `${withBoard} ${noun} · ${decks.length} of ${state.archetypeDeckCount} decks match`;
  }
}

function applyFilters() {
  const q = state.query.trim().toLowerCase();
  const min = state.minDecks;
  const types = state.enabledTypes;
  return state.cards.filter((c) => {
    if (c.decks_including < min) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (types) {
      const t = c.type || "(unknown)";
      if (!types.has(t)) return false;
    }
    return true;
  });
}

function render() {
  const rows = applyFilters().slice().sort((a, b) =>
    compareValues(a, b, state.sortKey, state.sortDir)
  );
  tbody.innerHTML = rows.map(renderRow).join("");
  emptyEl.hidden = rows.length > 0;
  rowCountEl.textContent = `${rows.length} of ${state.cards.length} cards`;
  for (const th of thead.querySelectorAll("th")) {
    th.classList.toggle("sort-active", th.dataset.sort === state.sortKey);
    const arrow = th.querySelector(".arrow");
    if (arrow) {
      arrow.textContent =
        th.dataset.sort === state.sortKey
          ? state.sortDir === "asc"
            ? "▲"
            : "▼"
          : "↕";
    }
  }
}

function recomputeAndRender() {
  recompute();
  refreshTypeFilterCounts();
  renderPerformanceStats();
  renderTrendSparkline();
  renderMedianDeck();
  renderCompositionVariance();
  render();
}

// ---- Tournament-performance stats ----
function renderPerformanceStats() {
  const decks = state.rawDecks.filter(deckPasses);
  const ranked = decks.filter((d) => d.rk != null && d.fp != null);
  // Median finish_pct
  let median = null;
  if (ranked.length) {
    const sorted = ranked.map((d) => d.fp).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    median = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  // Top-8 rate (over ranked decks)
  const top8 = ranked.filter((d) => d.rk <= 8).length;
  const top8Rate = ranked.length ? (top8 / ranked.length) : null;
  // Best-ever finish
  let best = null;
  for (const d of ranked) {
    if (!best || d.rk < best.rk || (d.rk === best.rk && (d.pl || 0) > (best.pl || 0))) {
      best = d;
    }
  }
  // Distinct events via tournament slug
  const T = window.__TOURNAMENTS__;
  const slugs = new Set();
  if (T && T.deckToTournament) {
    for (const d of decks) {
      const s = T.deckToTournament[d.u];
      if (s) slugs.add(s);
    }
  }

  const set = (id, html, title) => {
    const el = document.querySelector(`#${id} .stat-value`);
    if (!el) return;
    el.innerHTML = html;
    if (title) el.title = title;
  };
  set("stat-median", median != null ? `${median.toFixed(1)}%` : "—",
      median != null ? `Median finish percentile across ${ranked.length} ranked deck(s)` : "");
  set("stat-top8",
      top8Rate != null ? `${(top8Rate * 100).toFixed(1)}%` : "—",
      ranked.length ? `${top8} Top-8 finishes out of ${ranked.length} ranked decks` : "");
  if (best) {
    const placeStr = best.pl ? `${best.rk} of ${best.pl}` : `Rank ${best.rk}`;
    const link = `<a href="${escapeHtml(best.u)}" target="_blank" rel="noopener" title="${escapeHtml(deckTitle(best))} (${best.dt || "?"})">${escapeHtml(placeStr)}</a>`;
    set("stat-best", link);
  } else {
    set("stat-best", "—");
  }
  set("stat-events", slugs.size ? slugs.size.toLocaleString() : "—",
      slugs.size ? `${slugs.size} distinct tournament(s) in the filtered set` : "");
}

// ---- Time-trend sparkline ----
function renderTrendSparkline() {
  const svg = document.getElementById("trend-sparkline");
  const deltaEl = document.getElementById("stat-sparkline-delta");
  if (!svg) return;
  const decks = state.rawDecks.filter(deckPasses).filter((d) => d.dt);
  if (!decks.length) {
    svg.innerHTML = "";
    if (deltaEl) deltaEl.textContent = "";
    return;
  }
  // Bucket by ISO week (Mon-start). Use the latest deck date as the anchor.
  function weekKey(d) {
    const dt = new Date(d + "T00:00:00Z");
    const day = dt.getUTCDay() || 7; // Mon=1..Sun=7
    dt.setUTCDate(dt.getUTCDate() - (day - 1));
    return dt.toISOString().slice(0, 10);
  }
  const counts = new Map();
  for (const d of decks) {
    const k = weekKey(d.dt);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  // Anchor to latest week, walk back 12 weeks
  const sortedKeys = [...counts.keys()].sort();
  const latest = sortedKeys[sortedKeys.length - 1];
  const buckets = [];
  const cursor = new Date(latest + "T00:00:00Z");
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(cursor.getTime() - i * 7 * 86400000);
    const k = dt.toISOString().slice(0, 10);
    buckets.push({ key: k, count: counts.get(k) || 0 });
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const W = 200, H = 30, barW = W / buckets.length;
  const pad = 1;
  const bars = buckets
    .map((b, i) => {
      const h = Math.max(b.count > 0 ? 2 : 0, (b.count / max) * (H - 2));
      const x = i * barW + pad;
      const y = H - h;
      const w = Math.max(2, barW - pad * 2);
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="var(--accent)"><title>Week of ${b.key}: ${b.count} deck${b.count === 1 ? "" : "s"}</title></rect>`;
    })
    .join("");
  svg.innerHTML = bars;

  // Delta: trailing 30 days vs prior 30
  const today = new Date(latest + "T00:00:00Z");
  let recent = 0, prior = 0;
  for (const d of decks) {
    const dt = new Date(d.dt + "T00:00:00Z");
    const daysAgo = (today - dt) / 86400000;
    if (daysAgo <= 30) recent++;
    else if (daysAgo <= 60) prior++;
  }
  if (deltaEl) {
    if (prior === 0) {
      deltaEl.textContent = recent > 0 ? `· ${recent} new in last 30d` : "";
      deltaEl.className = "";
    } else {
      const pct = ((recent - prior) / prior) * 100;
      const arrow = pct >= 0 ? "↑" : "↓";
      const cls = Math.abs(pct) < 5 ? "trend-flat" : pct > 0 ? "trend-up" : "trend-down";
      deltaEl.textContent = `· ${arrow} ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs prior 30d`;
      deltaEl.className = cls;
    }
  }
}

// ---- Composition variance ----
// Group filtered decks by champion-card slug (one type=champion per deck),
// then for each group with ≥5 decks compute card inclusion rates and surface
// core (≥80% inclusion within group) + flex (20–80%) slots. Groups with <5
// decks roll into 'Other'.
function renderCompositionVariance() {
  const el = document.getElementById("composition-variance");
  const sumEl = document.getElementById("cv-summary");
  if (!el) return;
  const decks = state.rawDecks.filter(deckPasses);
  if (!decks.length) {
    el.innerHTML = "";
    if (sumEl) sumEl.textContent = "";
    return;
  }
  // Champion slug is pre-resolved per deck during scrape (deck.ch). cards_meta
  // doesn't carry a "champion" type — champions are stored as units in the
  // card library; the champion *slot* designation only exists per-deck. The
  // build_dashboard_payload step captures it explicitly so we don't have to
  // re-parse decks.json client-side.
  function championSlugOf(deck) {
    return deck.ch || null;
  }

  // Bucket decks by champion
  const byChamp = new Map();
  let unrouted = 0;
  for (const d of decks) {
    const champ = championSlugOf(d);
    if (!champ) { unrouted++; continue; }
    if (!byChamp.has(champ)) byChamp.set(champ, []);
    byChamp.get(champ).push(d);
  }

  // Sort groups by deck count desc
  const groups = [...byChamp.entries()]
    .map(([slug, decks]) => ({
      slug,
      name: state.cardsMeta[slug]?.name || slug,
      url: state.cardsMeta[slug]?.url,
      decks,
      count: decks.length,
    }))
    .sort((a, b) => b.count - a.count);

  const big = groups.filter((g) => g.count >= 5);
  const small = groups.filter((g) => g.count < 5);

  // For each big group: inclusion rate per slug (only c/mainboard) and core list
  function inclusionMap(decks) {
    const seen = new Map();
    for (const d of decks) {
      const ids = new Set((d.c || []).map(([s]) => s));
      for (const s of ids) seen.set(s, (seen.get(s) || 0) + 1);
    }
    return seen;
  }
  const groupCores = big.map((g) => {
    const incl = inclusionMap(g.decks);
    // Core: ≥80% inclusion. Exclude legend (always 1) and runes (placeholder).
    const core = [...incl.entries()]
      .map(([slug, n]) => ({ slug, n, pct: n / g.decks.length }))
      .filter((x) => x.pct >= 0.8)
      .filter((x) => {
        const t = (state.cardsMeta[x.slug]?.type || "").toLowerCase();
        return t !== "legend" && t !== "rune" && t !== "champion";
      })
      .sort((a, b) => b.pct - a.pct || a.slug.localeCompare(b.slug));
    return { ...g, core };
  });

  // Flex slots: card slugs that vary widely BETWEEN groups (high in some, low in
  // others). Compute per-slug max-min across groups, top ones are interesting.
  let flex = [];
  if (big.length >= 2) {
    const allSlugs = new Set();
    for (const g of big) for (const d of g.decks) for (const [s] of (d.c || [])) allSlugs.add(s);
    const perSlugPcts = new Map();
    for (const s of allSlugs) {
      const pcts = big.map((g) => {
        const incl = g.decks.filter((d) => (d.c || []).some(([slug]) => slug === s)).length;
        return incl / g.decks.length;
      });
      // Skip runes / legends / champions, and pure noise (<5% everywhere)
      const t = (state.cardsMeta[s]?.type || "").toLowerCase();
      if (t === "rune" || t === "legend" || t === "champion") continue;
      const max = Math.max(...pcts), min = Math.min(...pcts);
      if (max < 0.2) continue;
      perSlugPcts.set(s, { max, min, range: max - min, pcts });
    }
    flex = [...perSlugPcts.entries()]
      .map(([s, x]) => ({ slug: s, ...x }))
      .filter((x) => x.range >= 0.4) // flex = ≥40 percentage points of spread
      .sort((a, b) => b.range - a.range)
      .slice(0, 8);
  }

  // Render
  if (sumEl) {
    const totalInBig = big.reduce((s, g) => s + g.count, 0);
    sumEl.textContent =
      `· ${big.length} flavor${big.length === 1 ? "" : "s"} across ${totalInBig} deck${totalInBig === 1 ? "" : "s"}` +
      (small.length ? ` (+${small.length} niche)` : "") +
      (unrouted ? ` · ${unrouted} unrouted (no champion)` : "");
  }
  const linkName = (slug, name) => {
    const url = state.cardsMeta[slug]?.url;
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`
      : escapeHtml(name);
  };
  const fmtCore = (core) => {
    if (!core.length) return `<span class="muted">no consensus core (high variance)</span>`;
    return core
      .slice(0, 10)
      .map((c) => {
        const nm = state.cardsMeta[c.slug]?.name || c.slug;
        return `<span class="cv-pill" title="${escapeHtml(nm)} — ${(c.pct * 100).toFixed(0)}%">${linkName(c.slug, nm)} <span class="muted">${(c.pct * 100).toFixed(0)}%</span></span>`;
      })
      .join(" ");
  };

  const groupHtml = groupCores
    .map((g, i) => {
      const pct = ((g.count / decks.length) * 100).toFixed(0);
      return `<div class="cv-group">
        <div class="cv-group-header">
          <span class="cv-rank">${i + 1}</span>
          <span class="cv-name">${linkName(g.slug, g.name)}</span>
          <span class="cv-count">${g.count} deck${g.count === 1 ? "" : "s"} · ${pct}%</span>
        </div>
        <div class="cv-core">${fmtCore(g.core)}</div>
      </div>`;
    })
    .join("");

  const flexHtml = flex.length
    ? `<div class="cv-flex">
         <div class="cv-flex-label">Flex slots that vary by flavor:</div>
         ${flex
           .map((x) => {
             const nm = state.cardsMeta[x.slug]?.name || x.slug;
             const range = `${(x.min * 100).toFixed(0)}-${(x.max * 100).toFixed(0)}%`;
             return `<span class="cv-pill" title="${escapeHtml(nm)} — ${range} across flavors">${linkName(x.slug, nm)} <span class="muted">${range}</span></span>`;
           })
           .join(" ")}
       </div>`
    : "";

  el.innerHTML = (groupHtml || `<p class="muted">No champion-anchored flavors found in the filtered set.</p>`) + flexHtml;
}

function refreshTypeFilterCounts() {
  const counts = new Map();
  for (const c of state.cards) {
    const t = c.type || "(unknown)";
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  for (const pill of typeFiltersEl.querySelectorAll(".pill")) {
    const t = pill.dataset.type;
    if (t == null) continue;
    pill.querySelector(".count").textContent = `(${counts.get(t) || 0})`;
  }
}

function buildTypeFilters() {
  const counts = new Map();
  for (const c of state.cards) {
    const t = c.type || "(unknown)";
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const types = [...counts.keys()].sort();
  state.enabledTypes = new Set(types);

  typeFiltersEl.innerHTML = "";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Types:";
  typeFiltersEl.appendChild(label);

  for (const t of types) {
    const pill = document.createElement("label");
    pill.className = "pill";
    pill.dataset.type = t;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      if (cb.checked) state.enabledTypes.add(t);
      else state.enabledTypes.delete(t);
      pill.classList.toggle("off", !cb.checked);
      render();
    });
    pill.appendChild(cb);
    pill.append(`${t} `);
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `(${counts.get(t)})`;
    pill.appendChild(count);
    typeFiltersEl.appendChild(pill);
  }

  const all = document.createElement("button");
  all.type = "button";
  all.className = "toggle-all";
  all.textContent = "Toggle all";
  all.addEventListener("click", () => {
    const anyOff = [...typeFiltersEl.querySelectorAll("input")].some(
      (cb) => !cb.checked
    );
    const target = anyOff;
    typeFiltersEl.querySelectorAll(".pill").forEach((pill) => {
      const cb = pill.querySelector("input");
      cb.checked = target;
      pill.classList.toggle("off", !target);
    });
    state.enabledTypes = new Set(target ? types : []);
    render();
  });
  typeFiltersEl.appendChild(all);
}

function attachExpandHandler() {
  tbody.addEventListener("click", (ev) => {
    const cell = ev.target.closest("[data-action='toggle-decks']");
    if (!cell) return;
    const tr = cell.closest("tr");
    const slug = tr?.dataset.slug;
    if (!slug) return;
    if (state.expandedSlugs.has(slug)) state.expandedSlugs.delete(slug);
    else state.expandedSlugs.add(slug);
    render();
  });
}

const cardThumbEl = document.getElementById("card-thumb");
let thumbTimer = 0;
const THUMB_W = 260;

function positionThumb(ev) {
  const pad = 16;
  const ratio = cardThumbEl.naturalWidth
    ? cardThumbEl.naturalHeight / cardThumbEl.naturalWidth
    : 1.4; // tall card aspect as a default before the image loads
  const h = THUMB_W * ratio;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + THUMB_W > window.innerWidth) x = ev.clientX - THUMB_W - pad;
  // Clamp to viewport so we never render off-screen on narrow windows.
  x = Math.max(pad, Math.min(x, window.innerWidth - THUMB_W - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - h - pad));
  cardThumbEl.style.left = x + "px";
  cardThumbEl.style.top = y + "px";
}

function findCardLinkSlug(target) {
  // Look for an explicit data-slug on the link itself first (median panels),
  // then fall back to the row's data-slug (cards table).
  const a = target.closest("a[data-slug], #cards-table tbody td:first-child a");
  if (!a) return null;
  return a.dataset.slug || a.closest("tr[data-slug]")?.dataset.slug || null;
}

function attachHoverThumb() {
  if (!cardThumbEl) return;
  document.body.addEventListener("mouseover", (ev) => {
    const slug = findCardLinkSlug(ev.target);
    const img = slug && state.cardsMeta[slug]?.img;
    if (!img) return;
    clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => {
      if (cardThumbEl.src !== img) cardThumbEl.src = img;
      cardThumbEl.hidden = false;
      positionThumb(ev);
    }, 200);
  });
  document.body.addEventListener("mousemove", (ev) => {
    if (!cardThumbEl.hidden) positionThumb(ev);
  });
  document.body.addEventListener("mouseout", (ev) => {
    if (!findCardLinkSlug(ev.target)) return;
    clearTimeout(thumbTimer);
    cardThumbEl.hidden = true;
  });
}

function attachSortHandlers() {
  for (const th of thead.querySelectorAll("th[data-sort]")) {
    if (!th.querySelector(".arrow")) {
      const span = document.createElement("span");
      span.className = "arrow";
      span.textContent = "↕";
      th.appendChild(span);
    }
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = NUM_COLS.has(key) ? "desc" : "asc";
      }
      render();
    });
  }
}

function setMaxFinishPct(value, opts = {}) {
  const v = Math.max(1, Math.min(100, Number(value) || 100));
  state.maxFinishPct = v;
  pctInputEl.value = v;
  for (const btn of presetsEl.querySelectorAll(".preset")) {
    btn.classList.toggle("active", Number(btn.dataset.pct) === v);
  }
  if (!opts.skipRender) recomputeAndRender();
}

function attachDateFilterHandlers() {
  minDateEl.addEventListener("input", () => {
    state.minDate = minDateEl.value || null;
    clearDateEl.hidden = !state.minDate;
    recomputeAndRender();
  });
  clearDateEl.addEventListener("click", () => {
    minDateEl.value = "";
    state.minDate = null;
    clearDateEl.hidden = true;
    recomputeAndRender();
  });
}

const LS_REGION = "main:selectedRegions";
// Legacy single-region key — read-once for one-way migration.
const LS_REGION_LEGACY = "main:selectedRegion";

function attachRegionFilterHandlers() {
  const pills = document.querySelectorAll(".region-pill");
  // Restore persisted selection. New format is a JSON array of region
  // codes; legacy format was a single string. Migrate on first load.
  try {
    const raw = localStorage.getItem(LS_REGION);
    if (raw != null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) state.selectedRegions = new Set(parsed);
    } else {
      const legacy = localStorage.getItem(LS_REGION_LEGACY);
      if (legacy) state.selectedRegions = new Set([legacy]);
      // Migrate forward; leave legacy in place as a one-time fallback.
      localStorage.setItem(
        LS_REGION,
        JSON.stringify([...state.selectedRegions])
      );
    }
  } catch (_) {}
  function persist() {
    try {
      localStorage.setItem(
        LS_REGION,
        JSON.stringify([...state.selectedRegions])
      );
    } catch (_) {}
  }
  function syncPillUI() {
    const noneSelected = state.selectedRegions.size === 0;
    pills.forEach((p) => {
      const code = p.dataset.region || "";
      if (code === "") {
        // The "All" pill is active iff no specific regions are selected.
        p.classList.toggle("active", noneSelected);
      } else {
        p.classList.toggle("active", state.selectedRegions.has(code));
      }
    });
  }
  pills.forEach((p) => {
    p.addEventListener("click", () => {
      const code = p.dataset.region || "";
      if (code === "") {
        // "All" clears the multi-selection.
        state.selectedRegions.clear();
      } else if (state.selectedRegions.has(code)) {
        state.selectedRegions.delete(code);
      } else {
        state.selectedRegions.add(code);
      }
      persist();
      syncPillUI();
      recomputeAndRender();
    });
  });
  syncPillUI();
  // Side-channel info: how many tournaments / decks are in the catalog
  const infoEl = document.getElementById("region-info");
  const T = window.__TOURNAMENTS__;
  if (infoEl && T) {
    const tn = T.tournaments?.length ?? 0;
    const mapped = Object.keys(T.deckToTournament || {}).length;
    infoEl.textContent = `· ${tn} tournaments / ${mapped.toLocaleString()} decks mapped`;
  } else if (infoEl) {
    infoEl.textContent = "· tournaments.js not loaded — region filter disabled";
  }
}

function formatPlaintextDeck() {
  // Matches riftdecks' deck-export format (which the builder's
  // buildDecklistText() also emits):
  //
  //   Legend:           Champion:        MainDeck:
  //   1 <name>          1 <name>         3 Defy
  //                                      …
  //   Battlefields:     Rune Pool:       SideBoard:
  //   1 <name>          8 Mind Rune      …
  //
  // Round-trips through the builder's paste-import. Champions are
  // detected via window.__CHAMPION_SLUGS__; everything else in the
  // unit/spell/gear panels stays in MainDeck.
  const championSlugs = new Set(window.__CHAMPION_SLUGS__ || []);
  const buckets = {
    legend: [],
    champion: [],
    maindeck: [],
    battlefield: [],
    rune: [],
    side: [],
  };
  // Each .median-section's h3 first text node is the slot label
  // ("Legend", "Champion", "Battlefields", "Runes", "Units", "Spells",
  // "Gear", "Sideboard"). Map to our output buckets.
  const labelToBucket = {
    legend: "legend",
    champion: "champion",
    battlefields: "battlefield",
    runes: "rune",
    units: "maindeck",
    spells: "maindeck",
    gear: "maindeck",
    sideboard: "side",
  };
  for (const sec of medianContentEl.querySelectorAll(".median-section")) {
    const rawLabel = sec.querySelector("h3")?.firstChild?.textContent?.trim().toLowerCase();
    const targetBucket = labelToBucket[rawLabel];
    if (!targetBucket) continue;
    for (const li of sec.querySelectorAll("li")) {
      const qtyText = li.querySelector(".qty")?.textContent ?? "";
      const nameEl = li.querySelector(".name");
      const nameText = nameEl?.textContent ?? "";
      const qty = parseInt(qtyText, 10);
      if (!Number.isFinite(qty) || qty < 1) continue;
      const name = nameText.trim();
      if (!name) continue;
      // The Units section may include the champion — split it out.
      let bucket = targetBucket;
      if (targetBucket === "maindeck") {
        const slug = nameEl?.querySelector?.("a")?.dataset?.slug;
        if (slug && championSlugs.has(slug)) bucket = "champion";
      }
      buckets[bucket].push({ qty, name });
    }
  }
  // Alphabetize within each section.
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => a.name.localeCompare(b.name));
  }
  const lines = [];
  const sec = (header, body) => {
    if (!body.length) return;
    if (lines.length) lines.push("");
    lines.push(`${header}:`);
    for (const c of body) lines.push(`${c.qty} ${c.name}`);
  };
  sec("Legend", buckets.legend);
  sec("Champion", buckets.champion);
  sec("MainDeck", buckets.maindeck);
  sec("Battlefields", buckets.battlefield);
  sec("Rune Pool", buckets.rune);
  sec("SideBoard", buckets.side);
  return lines.join("\n");
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function flashCopyButton(msg) {
  if (!copyBtnEl) return;
  copyBtnEl.textContent = msg;
  copyBtnEl.classList.add("copied");
  window.clearTimeout(flashCopyButton._t);
  flashCopyButton._t = window.setTimeout(() => {
    copyBtnEl.textContent = "Copy plaintext";
    copyBtnEl.classList.remove("copied");
  }, 1500);
}

async function copyDecklist() {
  const text = formatPlaintextDeck();
  if (!text) {
    flashCopyButton("Nothing to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    flashCopyButton("Copied!");
  } catch {
    if (fallbackCopy(text)) flashCopyButton("Copied!");
    else flashCopyButton("Copy failed");
  }
}

function attachCopyButton() {
  if (!copyBtnEl) return;
  copyBtnEl.addEventListener("click", (ev) => {
    // Don't toggle the <details> open state.
    ev.preventDefault();
    ev.stopPropagation();
    copyDecklist();
  });
}

function attachMedianModeToggle() {
  for (const btn of medianModeToggleEl.querySelectorAll(".mode-btn")) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation(); // don't toggle the <details> open state
      const mode = btn.dataset.mode;
      if (state.medianMode === mode) return;
      state.medianMode = mode;
      for (const b of medianModeToggleEl.querySelectorAll(".mode-btn")) {
        const active = b.dataset.mode === mode;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      }
      renderMedianDeck();
    });
  }
}

function attachBoardToggle() {
  for (const btn of document.querySelectorAll(".board-btn")) {
    btn.addEventListener("click", () => {
      if (state.board === btn.dataset.board) return;
      state.board = btn.dataset.board;
      for (const b of document.querySelectorAll(".board-btn")) {
        const active = b.dataset.board === state.board;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      }
      recomputeAndRender();
    });
  }
}

function attachPerfFilterHandlers() {
  for (const btn of presetsEl.querySelectorAll(".preset")) {
    btn.addEventListener("click", () => setMaxFinishPct(btn.dataset.pct));
  }
  pctInputEl.addEventListener("input", () => setMaxFinishPct(pctInputEl.value));
  includeUnrankedEl.addEventListener("change", () => {
    state.includeUnranked = includeUnrankedEl.checked;
    recomputeAndRender();
  });
}

let dashboardInitialised = false;

function loadChampionData() {
  const data = window.__DATA__;
  if (!data) {
    titleEl.textContent = "No data loaded";
    metaEl.textContent =
      "Could not load champion data file. Re-run `python3 scrape.py <url>`.";
    return;
  }
  state.rawDecks = data.decks || [];
  state.cardsMeta = data.cards_meta || {};
  state.archetypeDeckCount = data.deck_count || state.rawDecks.length;
  titleEl.textContent = data.archetype || "Riftbound archetype";
  const ts = data.scraped_at ? new Date(data.scraped_at).toLocaleString() : "";
  const rankedCount = state.rawDecks.filter((d) => d.fp != null).length;
  metaEl.innerHTML = `${state.archetypeDeckCount} tournament decks (${rankedCount} with rank info) · scraped ${ts} · <a href="${data.url}" target="_blank" rel="noopener">source</a>`;

  // Reset filters to defaults so cross-champion state doesn't bleed.
  state.query = "";
  searchEl.value = "";
  state.minDecks = 1;
  minDecksEl.value = 1;
  hideZeroEl.checked = false;
  state.includeUnranked = true;
  includeUnrankedEl.checked = true;
  state.minDate = null;
  minDateEl.value = "";
  clearDateEl.hidden = true;
  state.board = "main";

  // Set the date input bounds and hint based on this champion's data.
  const dates = state.rawDecks
    .map((d) => d.dt)
    .filter(Boolean)
    .sort();
  if (dates.length) {
    minDateEl.min = dates[0];
    minDateEl.max = dates[dates.length - 1];
    dateRangeHintEl.textContent = `(${dates[0]} → ${dates[dates.length - 1]})`;
  } else {
    minDateEl.min = "";
    minDateEl.max = "";
    dateRangeHintEl.textContent = "";
  }
  for (const b of document.querySelectorAll(".board-btn")) {
    b.classList.toggle("active", b.dataset.board === "main");
    b.setAttribute(
      "aria-selected",
      b.dataset.board === "main" ? "true" : "false"
    );
  }

  recompute();
  buildTypeFilters();
  if (!dashboardInitialised) {
    attachSortHandlers();
    attachPerfFilterHandlers();
    attachDateFilterHandlers();
    attachRegionFilterHandlers();
    attachBoardToggle();
    attachMedianModeToggle();
    attachCopyButton();
    attachExpandHandler();
    attachHoverThumb();
    dashboardInitialised = true;
  }
  // Reset any previously-expanded rows when switching champion.
  state.expandedSlugs.clear();
  setMaxFinishPct(100, { skipRender: true });
  renderMedianDeck();
  render();
}

function injectChampionScript(slug) {
  return new Promise((resolve, reject) => {
    window.__DATA__ = null;
    const old = document.getElementById("champion-data-script");
    if (old) old.remove();
    const s = document.createElement("script");
    s.id = "champion-data-script";
    s.src = `legends/${slug}/data.js`;
    s.onload = () => resolve();
    s.onerror = () =>
      reject(new Error(`failed to load data-${slug}.js`));
    document.body.appendChild(s);
  });
}

async function selectChampion(slug) {
  try {
    await injectChampionScript(slug);
  } catch (err) {
    titleEl.textContent = `Could not load ${slug}`;
    metaEl.textContent =
      "data-<slug>.js missing. Re-scrape this champion or pick another.";
    console.error(err);
    return;
  }
  try {
    localStorage.setItem(LAST_CHAMPION_KEY, slug);
  } catch (_) {}
  loadChampionData();
}

function populateChampionSelect(champions, currentSlug) {
  championSelectEl.innerHTML = "";
  for (const c of champions) {
    const opt = document.createElement("option");
    opt.value = c.slug;
    opt.textContent = `${c.name} (${c.deck_count})`;
    if (c.slug === currentSlug) opt.selected = true;
    championSelectEl.appendChild(opt);
  }
  championSelectEl.disabled = champions.length <= 1;
  championSelectEl.onchange = () => selectChampion(championSelectEl.value);
}

async function init() {
  const champions = window.__CHAMPIONS__ || [];
  if (champions.length === 0) {
    titleEl.textContent = "No champions cached";
    metaEl.textContent =
      "Run `python3 scrape.py <archetype URL>` to scrape your first champion.";
    championSelectEl.hidden = true;
    return;
  }
  let preferred = null;
  try {
    preferred = localStorage.getItem(LAST_CHAMPION_KEY);
  } catch (_) {}
  const initial =
    champions.find((c) => c.slug === preferred) || champions[0];
  populateChampionSelect(champions, initial.slug);
  await selectChampion(initial.slug);
}

searchEl.addEventListener("input", () => {
  state.query = searchEl.value;
  render();
});
minDecksEl.addEventListener("input", () => {
  const v = parseInt(minDecksEl.value, 10);
  state.minDecks = Number.isFinite(v) && v > 0 ? v : 1;
  render();
});
hideZeroEl.addEventListener("change", () => {
  state.minDecks = hideZeroEl.checked ? Math.max(2, state.minDecks) : 1;
  minDecksEl.value = state.minDecks;
  render();
});

init();
