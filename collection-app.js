"use strict";

// =====================================================================
// Collection explorer + deck builder
// =====================================================================

// RARITY + rarityGlyph + escapeHtml + readJSON/writeJSON + parseCost +
// attachHoverThumb all live in utils.js (loaded by builder.html before
// this file).
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, showcase: 4 };
const PLAYSET = 3;
// Riftbound deck-construction cap: no more than 3 copies of any single card
// in maindeck or sideboard (each tracked independently). Battlefields have
// their own bucket-size cap of 3 total. Runes are unrestricted and not
// tracked here. Legend and Champion slots are always exactly 1.
const MAX_COPIES = 3;
// Set of slugs known to be champions (window.__CHAMPION_SLUGS__ is a list
// of every slug observed as type=champion in any cached deck). Used to
// split the Champion: section out of MainDeck: in the riftdecks-style
// copy + the sidebar UI, and to enforce the 1-champion-per-deck cap.
const CHAMPION_SLUGS = new Set(window.__CHAMPION_SLUGS__ || []);

// Static enums used by the pill filters. Kept here (not derived from catalog)
// so empty categories always render — gives the UI predictable layout.
const RARITY_OPTS = ["common", "uncommon", "rare", "epic"];
const SET_OPTS = ["UNL", "OGN", "SFD", "OGS"];
const TYPE_OPTS = ["unit", "spell", "gear", "rune", "legend", "battlefield"];
const DOMAIN_OPTS = ["calm", "chaos", "fury", "mind", "order", "body", "colorless"];

const LS_FILTERS = "collection:filters";
const LS_ENROUTE = "collection:includeEnRoute";
const LS_DECK = "collection:deckDraft";
const LS_DECK_TAB = "collection:deckTab";

function energyOf(slug) {
  const c = catalog[slug];
  if (!c) return null;
  return parseCost(c.cost).energy;
}

// Energy buckets for the curve and energy filter pills: 0..6 each plus a
// 7+ catch-all. Kept as strings so they double as pill labels.
const CURVE_BUCKETS = ["0", "1", "2", "3", "4", "5", "6", "7+"];
function bucketIndexForEnergy(e) {
  if (e == null) return -1;
  if (e >= 7) return 7;
  return Math.max(0, Math.min(7, e));
}

// First letter of each domain — used to render the power "C" chars in the
// cost cell using the card's primary domain. Calm and Chaos collide on
// "C"; the colour disambiguates them.
const DOMAIN_LETTER = {
  calm: "C",
  chaos: "C",
  fury: "F",
  mind: "M",
  order: "O",
  body: "B",
  colorless: "C",
};
function primaryDomain(card) {
  const ds = card.domains || [];
  // Prefer non-colorless if the card is multi-domain with colorless mixed in
  // (unlikely given current data but defensive).
  return ds.find((d) => d !== "colorless") || ds[0] || null;
}
function renderPowerGlyphs(card, power) {
  if (!power) return "";
  const dom = primaryDomain(card);
  const letter = dom ? DOMAIN_LETTER[dom] || "C" : "C";
  const cls = dom ? `pwr-${dom}` : "pwr-colorless";
  const tip =
    (card.domains || []).length > 1
      ? `${power} power · any of: ${card.domains.join(", ")}`
      : dom
      ? `${power} ${dom} power`
      : `${power} power`;
  return `<span class="power ${cls}" title="${escapeHtml(tip)}">${letter.repeat(power)}</span>`;
}

// ---------- data ----------
const catalogRaw = window.__CATALOG__ || {};
const catalog = catalogRaw; // slug → card object
const champions = window.__CHAMPIONS__ || [];
const closeness = window.__CLOSENESS_DATA__ || { legends: [] };

// Invert closeness → card slug → [{ slug, name, qty }, ...]
const cardToLegends = new Map();
for (const L of closeness.legends || []) {
  for (const c of L.composite || []) {
    if (!cardToLegends.has(c.slug)) cardToLegends.set(c.slug, []);
    cardToLegends.get(c.slug).push({
      slug: L.slug,
      name: L.name,
      qty: c.qty,
    });
  }
}
// Sort each legend list by qty desc so chips show heaviest users first.
for (const list of cardToLegends.values()) list.sort((a, b) => b.qty - a.qty);

let owned = window.__OWNED_DEFAULTS__ || {};
let enRoute = window.__EN_ROUTE_DEFAULTS__ || {};

function ownedFor(slug) {
  const o = owned[slug] || 0;
  const er = includeEnRoute ? (enRoute[slug] || 0) : 0;
  const locked = lockedTotal(slug, "builder");
  return Math.max(0, o + er - locked);
}
function playsetFor(slug) {
  // Legends and champions are always 1-of in a deck per Riftbound rules,
  // so their playset is 1 (not 3). Champions are catalog-type=unit but
  // identified via window.__CHAMPION_SLUGS__.
  if (catalog[slug]?.type === "legend") return 1;
  if (CHAMPION_SLUGS.has(slug)) return 1;
  return PLAYSET;
}
function missingFor(slug) {
  return Math.max(0, playsetFor(slug) - ownedFor(slug));
}

// ---------- filter state ----------
const DEFAULT_FILTERS = {
  search: "",
  rarities: [],
  sets: [],
  types: [],
  domains: [],
  energies: [],     // pill labels from CURVE_BUCKETS — multi-select OR
  ownedMin: "",
  ownedMax: "",
  missingMin: "",
  missingMax: "",
  legend: "",
  sortCol: "name",
  sortDir: "asc",
};
let filters = { ...DEFAULT_FILTERS, ...readJSON(LS_FILTERS, {}) };
let includeEnRoute = readJSON(LS_ENROUTE, false);

function saveFilters() { writeJSON(LS_FILTERS, filters); }

// ---------- deck state ----------
const DEFAULT_DECK = { legend: null, battlefields: {}, main: {}, side: {} };
let deck = { ...DEFAULT_DECK, ...readJSON(LS_DECK, {}) };
// Defensive: ensure shape after potential schema drift.
for (const k of ["battlefields", "main", "side"]) {
  if (!deck[k] || typeof deck[k] !== "object") deck[k] = {};
}
let deckTab = readJSON(LS_DECK_TAB, "main");

function saveDeck() { writeJSON(LS_DECK, deck); }

function deckQty(bucket, slug) {
  if (bucket === "legend") return deck.legend === slug ? 1 : 0;
  return deck[bucket][slug] || 0;
}
function deckTotalIn(slug) {
  // Total copies of a slug already used across all buckets — needed to
  // disable +M/+S when owned is exhausted.
  return (
    (deck.legend === slug ? 1 : 0) +
    (deck.battlefields[slug] || 0) +
    (deck.main[slug] || 0) +
    (deck.side[slug] || 0)
  );
}
function bucketTotal(bucket) {
  const m = deck[bucket];
  if (!m) return 0;
  return Object.values(m).reduce((s, v) => s + v, 0);
}
function mainTotal() { return bucketTotal("main"); }
function bucketTotalByType(type) {
  // For the Maindeck section breakdown (units / gear / spells).
  let n = 0;
  for (const [slug, qty] of Object.entries(deck.main)) {
    const c = catalog[slug];
    if (c && c.type === type) n += qty;
  }
  return n;
}

// ---------- toast ----------
const toastEl = document.getElementById("toast");
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 2200);
}

// ---------- card add/remove ----------
function bucketForType(type) {
  if (type === "legend") return "legend";
  if (type === "battlefield") return "battlefields";
  if (type === "unit" || type === "gear" || type === "spell") return "main";
  return null; // rune
}

function addToDeck(slug, side) {
  const c = catalog[slug];
  if (!c) return;
  if (c.type === "rune") {
    toast("Runes aren't tracked in the deck builder — you own 99 of each.");
    return;
  }
  if (side) {
    if (deckTotalIn(slug) >= ownedFor(slug)) return;
    if ((deck.side[slug] || 0) >= MAX_COPIES) return;
    deck.side[slug] = (deck.side[slug] || 0) + 1;
  } else {
    const bucket = bucketForType(c.type);
    if (!bucket) return;
    if (bucket === "legend") {
      // Replace any existing legend; no confirm — easy to undo by adding back.
      deck.legend = slug;
    } else if (CHAMPION_SLUGS.has(slug)) {
      // Champions are 1-of per deck per Riftbound rules. Adding a champion
      // (even a different one) replaces any existing champion in main —
      // same UX pattern as the Legend slot.
      for (const s of Object.keys(deck.main)) {
        if (CHAMPION_SLUGS.has(s)) delete deck.main[s];
      }
      if (deckTotalIn(slug) >= ownedFor(slug)) return;
      deck.main[slug] = 1;
    } else {
      if (deckTotalIn(slug) >= ownedFor(slug)) return;
      // Per-card cap for main + battlefields (3 max of any single card).
      if ((deck[bucket][slug] || 0) >= MAX_COPIES) return;
      deck[bucket][slug] = (deck[bucket][slug] || 0) + 1;
    }
  }
  saveDeck();
  renderDeck();
  // Re-render only the affected row's +M/+S buttons to keep things snappy.
  // Cheapest: re-render the whole table. ~535 rows is fast.
  renderTable();
}

function decFromDeck(bucket, slug) {
  if (bucket === "legend") {
    deck.legend = null;
  } else {
    const cur = deck[bucket][slug] || 0;
    if (cur <= 1) delete deck[bucket][slug];
    else deck[bucket][slug] = cur - 1;
  }
  saveDeck();
  renderDeck();
  renderTable();
}
function incFromDeck(bucket, slug) {
  if (bucket === "legend") return; // can't have 2 legends
  if (CHAMPION_SLUGS.has(slug)) return; // can't have 2 champions either
  if (deckTotalIn(slug) >= ownedFor(slug)) return;
  if ((deck[bucket][slug] || 0) >= MAX_COPIES) return;
  deck[bucket][slug] = (deck[bucket][slug] || 0) + 1;
  saveDeck();
  renderDeck();
  renderTable();
}
function removeFromDeck(bucket, slug) {
  if (bucket === "legend") deck.legend = null;
  else delete deck[bucket][slug];
  saveDeck();
  renderDeck();
  renderTable();
}

function newDeck() {
  deck = { legend: null, battlefields: {}, main: {}, side: {} };
  saveDeck();
  renderDeck();
  renderTable();
}

// ---------- paste-import: text decklist → deck state ----------

// Name → slug lookup. Built once on init; rebuilt on collection:updated so
// that legend-name fixes / catalog refreshes propagate. We index both the
// canonical catalog name and useful legend aliases (epithet-only) so
// pasted decklists from older Copy outputs ('Bashful Bloom') still resolve
// to the modern slug ('details-lillia-bashful-bloom').
let nameToSlug = new Map();
function rebuildNameIndex() {
  nameToSlug = new Map();
  for (const [slug, c] of Object.entries(catalog)) {
    const n = (c.name || "").trim();
    if (n) nameToSlug.set(n.toLowerCase(), slug);
    // Legend epithet alias: 'Lillia, Bashful Bloom' → also map 'Bashful Bloom'
    if (c.type === "legend" && n.includes(",")) {
      const epithet = n.split(",", 2)[1].trim();
      if (epithet) nameToSlug.set(epithet.toLowerCase(), slug);
    }
  }
}

// Accepts both riftdecks' own format ("Legend:", "Champion:", "MainDeck:",
// "Battlefields:", "Rune Pool:", "SideBoard:") and the legacy all-caps
// builder format with optional trailing "(N)" counts. CHAMPION lines route
// to the main bucket; RUNE POOL lines are parsed but skipped (builder
// doesn't track runes).
const SECTION_RE = /^(LEGEND|BATTLEFIELDS?|MAINDECK|MAIN\s*DECK|CHAMPION|SIDEBOARD|SIDE\s*BOARD|RUNE\s*POOL|RUNES?)(?:\s*\(\s*\d+\s*\))?\s*:?\s*$/i;
const LINE_RE = /^(\d+)\s+(.+)$/;

function parseDecklistText(text) {
  // Returns { deck: {legend, battlefields, main, side}, warnings: [...] }.
  // Sections are heuristic — if no section header is seen, lines route
  // by catalog type. Lines with N Card Name match LINE_RE. We strip
  // wrapping CSV double-quotes so the Google Sheet CSV-export format
  // ('"3 Defy"') also parses.
  const out = { legend: null, battlefields: {}, main: {}, side: {} };
  const warnings = [];
  let section = null;  // null | "legend" | "battlefields" | "main" | "side" | "rune"

  for (let raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // Strip surrounding double-quotes (CSV export from Sheets does this).
    if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1).trim();
    }
    if (!line) continue;
    const m = line.match(SECTION_RE);
    if (m) {
      const head = m[1].toUpperCase().replace(/\s+/g, "");
      if (head === "LEGEND") section = "legend";
      else if (head.startsWith("BATTLEFIELD")) section = "battlefields";
      else if (head === "MAINDECK" || head === "CHAMPION") section = "main";
      else if (head === "SIDEBOARD") section = "side";
      else if (head === "RUNEPOOL" || head === "RUNE" || head === "RUNES") section = "rune";
      continue;
    }
    const ln = line.match(LINE_RE);
    if (!ln) continue;
    const qty = parseInt(ln[1], 10);
    const name = ln[2].trim();
    // Skip everything inside a Rune Pool section silently — builder
    // doesn't track runes (you own 99 of each).
    if (section === "rune") continue;
    const slug = nameToSlug.get(name.toLowerCase());
    if (!slug) {
      warnings.push(`Unknown card: ${name}`);
      continue;
    }
    const c = catalog[slug];
    // If no section header was seen, infer the bucket from card type.
    let bucket = section;
    if (!bucket) {
      if (c.type === "legend") bucket = "legend";
      else if (c.type === "battlefield") bucket = "battlefields";
      else if (c.type === "rune") {
        warnings.push(`Skipped rune: ${name} (not tracked in builder)`);
        continue;
      } else bucket = "main";
    }
    if (bucket === "legend") {
      if (out.legend) warnings.push(`Multiple legends; using last: ${name}`);
      out.legend = slug;
    } else if (c.type === "rune") {
      // Runes never enter the builder regardless of section.
      warnings.push(`Skipped rune: ${name}`);
    } else {
      out[bucket][slug] = (out[bucket][slug] || 0) + qty;
    }
  }
  return { deck: out, warnings };
}

function importDecklistText(text) {
  const { deck: parsed, warnings } = parseDecklistText(text);
  deck = parsed;
  saveDeck();
  renderDeck();
  renderTable();
  return warnings;
}

// ---------- filter UI ----------
function renderPills(containerId, options, key) {
  const el = document.getElementById(containerId);
  el.innerHTML = options
    .map(
      (opt) =>
        `<button type="button" class="pill${
          filters[key].includes(opt) ? " active" : ""
        }" data-value="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`
    )
    .join("");
  el.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".pill");
    if (!btn) return;
    const v = btn.dataset.value;
    const arr = filters[key];
    const idx = arr.indexOf(v);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(v);
    saveFilters();
    btn.classList.toggle("active");
    renderTable();
  });
}

function populateLegendDropdown() {
  const sel = document.getElementById("legend-filter");
  const sorted = [...champions].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of sorted) {
    const opt = document.createElement("option");
    opt.value = c.slug;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = filters.legend || "";
}

// ---------- visibility predicate ----------
function buildVisibleRows() {
  const searchLc = filters.search.trim().toLowerCase();
  const rSet = filters.rarities.length ? new Set(filters.rarities) : null;
  const setSet = filters.sets.length ? new Set(filters.sets) : null;
  const tSet = filters.types.length ? new Set(filters.types) : null;
  const dSet = filters.domains.length ? new Set(filters.domains) : null;
  const eSet = filters.energies.length ? new Set(filters.energies) : null;
  const oMin = filters.ownedMin === "" ? null : parseInt(filters.ownedMin, 10);
  const oMax = filters.ownedMax === "" ? null : parseInt(filters.ownedMax, 10);
  const mMin = filters.missingMin === "" ? null : parseInt(filters.missingMin, 10);
  const mMax = filters.missingMax === "" ? null : parseInt(filters.missingMax, 10);
  const legendSlugSet = filters.legend
    ? new Set(
        (closeness.legends.find((L) => L.slug === filters.legend)?.composite || [])
          .map((c) => c.slug)
      )
    : null;

  // Iterate the union of owned + (en-route, when its toggle is on) so cards
  // you only have en-route still appear when the toggle includes them.
  // Previously this loop only walked Object.keys(owned), which meant a
  // card with 0 owned but N en-route was silently filtered out before the
  // ownedFor check ever ran.
  const allSlugs = new Set(Object.keys(owned));
  if (includeEnRoute) {
    for (const s of Object.keys(enRoute)) allSlugs.add(s);
  }
  const rows = [];
  for (const slug of allSlugs) {
    const c = catalog[slug];
    if (!c) continue; // unknown slug — skip rather than guess
    const ownedQty = ownedFor(slug);
    if (ownedQty <= 0) continue; // 'collection' = only what you own (incl. en-route if toggled)
    const missing = missingFor(slug);

    if (searchLc && !c.name.toLowerCase().includes(searchLc)) continue;
    if (rSet && !rSet.has(c.rarity)) continue;
    if (setSet && !setSet.has(c.set)) continue;
    if (tSet && !tSet.has(c.type)) continue;
    if (dSet) {
      const ds = c.domains || [];
      if (!ds.some((d) => dSet.has(d))) continue;
    }
    if (eSet) {
      const e = parseCost(c.cost).energy;
      const bIdx = bucketIndexForEnergy(e);
      if (bIdx < 0 || !eSet.has(CURVE_BUCKETS[bIdx])) continue;
    }
    if (oMin != null && ownedQty < oMin) continue;
    if (oMax != null && ownedQty > oMax) continue;
    if (mMin != null && missing < mMin) continue;
    if (mMax != null && missing > mMax) continue;
    if (legendSlugSet && !legendSlugSet.has(slug)) continue;

    rows.push({
      slug,
      card: c,
      owned: ownedQty,
      missing,
      legends: cardToLegends.get(slug) || [],
    });
  }
  sortRows(rows);
  return rows;
}

function sortRows(rows) {
  const dir = filters.sortDir === "desc" ? -1 : 1;
  const col = filters.sortCol;
  const cmpName = (a, b) => a.card.name.localeCompare(b.card.name);
  rows.sort((a, b) => {
    let diff = 0;
    switch (col) {
      case "name":
        diff = cmpName(a, b);
        break;
      case "set":
        diff = a.card.set.localeCompare(b.card.set) || a.card.set_num - b.card.set_num;
        break;
      case "rarity":
        diff =
          (RARITY_ORDER[a.card.rarity] ?? 99) -
          (RARITY_ORDER[b.card.rarity] ?? 99);
        if (diff === 0) diff = cmpName(a, b);
        break;
      case "type":
        diff = a.card.type.localeCompare(b.card.type) || cmpName(a, b);
        break;
      case "owned":
        diff = a.owned - b.owned;
        if (diff === 0) diff = cmpName(a, b);
        break;
      case "missing":
        diff = a.missing - b.missing;
        if (diff === 0) diff = cmpName(a, b);
        break;
      case "cost": {
        const ca = parseCost(a.card.cost);
        const cb = parseCost(b.card.cost);
        // Null energy (cost "-") sorts to the end on asc.
        const ea = ca.energy == null ? Infinity : ca.energy;
        const eb = cb.energy == null ? Infinity : cb.energy;
        diff = ea - eb || ca.power - cb.power;
        if (diff === 0) diff = cmpName(a, b);
        break;
      }
      default:
        diff = cmpName(a, b);
    }
    return diff * dir;
  });
}

// ---------- table render ----------
const tbodyEl = document.querySelector("#collection-table tbody");
const emptyEl = document.getElementById("empty-state");
const rowCountEl = document.getElementById("row-count");

function legendChipsHtml(legends, max = 4) {
  if (!legends.length) return `<span class="muted">—</span>`;
  const shown = legends.slice(0, max);
  const rest = legends.length - shown.length;
  const cls = legends.length === 1 ? "legend-chip solo" : "legend-chip";
  const parts = shown.map(
    (L) =>
      `<a class="${cls}" href="./?champion=${encodeURIComponent(L.slug)}" title="${escapeHtml(L.name)} — ${L.qty}×">${escapeHtml(L.name)}<span class="qty">×${L.qty}</span></a>`
  );
  if (rest > 0) parts.push(`<span class="muted">+${rest} more</span>`);
  return parts.join("");
}

function renderRow(row, idx) {
  const c = row.card;
  const domains = (c.domains || [])
    .map(
      (d) =>
        `<span class="tag domain-${escapeHtml(String(d).toLowerCase())}">${escapeHtml(d)}</span>`
    )
    .join(" ");
  const missingCls = row.missing > 0 ? "num missing missing-pos" : "num missing";
  const img = c.image_url ? ` data-img="${escapeHtml(c.image_url)}"` : "";
  const nameLink = c.url
    ? `<a href="${escapeHtml(c.url)}"${img} target="_blank" rel="noopener">${escapeHtml(c.name)}</a>`
    : `<span${img}>${escapeHtml(c.name)}</span>`;

  // +M / +S disabled state. Two reasons to disable:
  // 1. No more owned copies left to assign anywhere.
  // 2. The destination bucket is already at MAX_COPIES (3) for this slug.
  const remaining = row.owned - deckTotalIn(row.slug);
  const isRune = c.type === "rune";
  const mainBucket = bucketForType(c.type); // "legend" | "battlefields" | "main" | null
  const mainBucketCount =
    mainBucket && mainBucket !== "legend" ? (deck[mainBucket][row.slug] || 0) : 0;
  const sideCount = deck.side[row.slug] || 0;
  const mainAtCap = mainBucket && mainBucket !== "legend" && mainBucketCount >= MAX_COPIES;
  const sideAtCap = sideCount >= MAX_COPIES;
  const mainDisabled =
    isRune || remaining <= 0 || (c.type === "legend" && deck.legend === row.slug) || mainAtCap;
  const sideDisabled = remaining <= 0 || sideAtCap;
  const mTitle = isRune
    ? "Runes aren't tracked"
    : c.type === "legend"
    ? "Add as legend"
    : mainAtCap
    ? `Already at ${MAX_COPIES} copies`
    : c.type === "battlefield"
    ? "Add to battlefields"
    : `Add to maindeck (${c.type})`;

  const { energy, power } = parseCost(c.cost);
  const costCell =
    energy == null
      ? `<td class="cost-cell no-cost">—</td>`
      : `<td class="cost-cell">${energy}${renderPowerGlyphs(c, power)}</td>`;

  return `
    <tr data-slug="${escapeHtml(row.slug)}">
      <td class="rank">${idx + 1}</td>
      <td class="actions">
        <button class="add-btn" data-action="add-main" data-slug="${escapeHtml(row.slug)}"${mainDisabled ? " disabled" : ""} title="${escapeHtml(mTitle)}">+M</button>
        <button class="add-btn" data-action="add-side" data-slug="${escapeHtml(row.slug)}"${sideDisabled ? " disabled" : ""} title="Add to sideboard">+S</button>
      </td>
      <td class="name">${nameLink} ${rarityGlyph(c.rarity)}</td>
      <td class="set-cell">${escapeHtml(c.set)} <span class="muted">#${c.set_num}</span></td>
      <td class="rarity-cell">${escapeHtml(c.rarity)}</td>
      <td class="type">${escapeHtml(c.type)}</td>
      ${costCell}
      <td class="domains">${domains}</td>
      <td class="num">${row.owned}</td>
      <td class="${missingCls}">${row.missing}</td>
    </tr>
  `;
}

function updateSortHeaders() {
  for (const th of document.querySelectorAll("#collection-table th.sortable")) {
    th.classList.remove("sort-active", "sort-desc");
    if (th.dataset.sort === filters.sortCol) {
      th.classList.add("sort-active");
      if (filters.sortDir === "desc") th.classList.add("sort-desc");
    }
  }
}

function renderTable() {
  const rows = buildVisibleRows();
  if (rows.length === 0) {
    tbodyEl.innerHTML = "";
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
    tbodyEl.innerHTML = rows.map(renderRow).join("");
  }
  // Same union as buildVisibleRows for the 'of N' denominator — otherwise
  // en-route-only cards would appear in the table but not in the count.
  const denom = new Set(Object.keys(owned));
  if (includeEnRoute) for (const s of Object.keys(enRoute)) denom.add(s);
  const ownedCount = [...denom].filter((s) => ownedFor(s) > 0).length;
  rowCountEl.textContent = `Showing ${rows.length.toLocaleString()} of ${ownedCount.toLocaleString()} owned card${
    ownedCount === 1 ? "" : "s"
  }`;
  updateSortHeaders();
}

// ---------- deck render ----------
function listItemHtml(bucket, slug, qty, allowQtyControls) {
  const c = catalog[slug];
  const name = c ? c.name : slug;
  const img = c && c.image_url ? ` data-img="${escapeHtml(c.image_url)}"` : "";
  const owned = ownedFor(slug);
  const usedInDeck = deckTotalIn(slug);
  const remaining = owned - usedInDeck;
  // "short" means the deck uses more copies of this card than the user
  // owns — e.g. after toggling off en-route or lock-included copies, a
  // pasted decklist may have rows we can't actually field. Names turn red.
  const isShort = usedInDeck > owned;
  const deficit = isShort ? usedInDeck - owned : 0;
  const liCls = (allowQtyControls ? "" : "with-remove") + (isShort ? " short" : "");
  const liTitle = isShort
    ? ` title="Short ${deficit} cop${deficit === 1 ? "y" : "ies"} (deck uses ${usedInDeck}, you have ${owned})"`
    : "";
  // Per-bucket cap of 3 copies applies to main/battlefields/side. Legend
  // is implicitly capped at 1 by being a single slot.
  const bucketAtCap = bucket !== "legend" && qty >= MAX_COPIES;
  const incDisabled = remaining <= 0 || bucketAtCap;
  const qtyHtml = `<span class="qty">${qty} ×</span>`;
  const nameHtml = `<span class="card-name"${img}>${escapeHtml(name)}</span>`;
  if (!allowQtyControls) {
    // Legend slot: just a remove button. Layout: × | qty | name
    return `<li class="${liCls}" data-slug="${escapeHtml(slug)}"${liTitle}><button class="remove" data-action="remove" data-bucket="${bucket}" data-slug="${escapeHtml(slug)}" title="Remove">×</button>${qtyHtml}${nameHtml}</li>`;
  }
  // Layout: − | + | qty | name (controls grouped left, name truncates on the right)
  return `<li${liCls.trim() ? ` class="${liCls.trim()}"` : ""} data-slug="${escapeHtml(slug)}"${liTitle}><button data-action="dec" data-bucket="${bucket}" data-slug="${escapeHtml(slug)}" title="Remove one">−</button><button data-action="inc" data-bucket="${bucket}" data-slug="${escapeHtml(slug)}"${incDisabled ? " disabled" : ""} title="Add one">+</button>${qtyHtml}${nameHtml}</li>`;
}

function computeEnergyCurve(slugQtyMap) {
  // Returns { buckets: {unit, gear, spell, total}[8], avg, totalCounted }.
  // Cards with no energy cost (cost "-": legend, battlefield, rune) are
  // excluded from the curve and from the average. We split per-bucket by
  // card type so the bars can be rendered as stacks (unit base, gear,
  // spell on top).
  const buckets = Array.from({ length: 8 }, () => ({
    unit: 0,
    gear: 0,
    spell: 0,
    total: 0,
  }));
  let sumE = 0;
  let totalCounted = 0;
  for (const [slug, qty] of Object.entries(slugQtyMap || {})) {
    const e = energyOf(slug);
    if (e == null) continue;
    const idx = bucketIndexForEnergy(e);
    if (idx < 0) continue;
    const t = catalog[slug]?.type;
    const seg = t === "unit" || t === "gear" || t === "spell" ? t : "spell";
    buckets[idx][seg] += qty;
    buckets[idx].total += qty;
    sumE += e * qty;
    totalCounted += qty;
  }
  const avg = totalCounted > 0 ? sumE / totalCounted : null;
  return { buckets, avg, totalCounted };
}

function computePowerByDomain(slugQtyMap) {
  // For each card with power > 0, attribute the full power × qty to EACH of
  // the card's domains (multi-domain cards count in both columns). This
  // matches mana-base planning: a "calm or body" card needs you to be able
  // to cover it from either side.
  const totals = {};
  for (const [slug, qty] of Object.entries(slugQtyMap || {})) {
    const c = catalog[slug];
    if (!c) continue;
    const { power } = parseCost(c.cost);
    if (power <= 0) continue;
    const ds = (c.domains || []).filter((d) => d !== "colorless");
    const targets = ds.length ? ds : c.domains || [];
    for (const d of targets) {
      totals[d] = (totals[d] || 0) + power * qty;
    }
  }
  return totals;
}

function renderPowerByDomain(containerEl, label, totals) {
  // Render order matches DOMAIN_OPTS so the layout doesn't jiggle as the
  // deck composition changes.
  const rows = DOMAIN_OPTS.filter((d) => totals[d] > 0).map((d) => {
    const letter = DOMAIN_LETTER[d] || "?";
    return `<span class="pbd-row" title="${escapeHtml(d)} — ${totals[d]} power"><span class="pbd-letter pwr-${d}">${letter}</span> ${totals[d]}<span class="domain-name">${escapeHtml(d)}</span></span>`;
  });
  containerEl.innerHTML = `
    <div class="pbd-title">${escapeHtml(label)}</div>
    ${rows.length ? rows.join("") : `<span class="pbd-empty">No power requirements yet.</span>`}
  `;
}

function renderEnergyCurve(containerEl, label, curve) {
  if (curve.totalCounted === 0) {
    containerEl.innerHTML = `<div class="curve-title"><span>${escapeHtml(
      label
    )}</span><span>—</span></div>`;
    return;
  }
  const max = Math.max(1, ...curve.buckets.map((b) => b.total));
  // Aggregate totals per type for the legend chip in the header.
  const tot = curve.buckets.reduce(
    (a, b) => ({ unit: a.unit + b.unit, gear: a.gear + b.gear, spell: a.spell + b.spell }),
    { unit: 0, gear: 0, spell: 0 }
  );
  const COLOR = { unit: "#60a5fa", gear: "#fbbf24", spell: "#f472b6" };
  const rowsHtml = CURVE_BUCKETS.map((bk, i) => {
    const b = curve.buckets[i];
    const cls = b.total === 0 ? "curve-row empty" : "curve-row";
    // Render the stack as a SINGLE bar with a hard-stop linear-gradient,
    // not as multiple flex children — adjacent flex children round to
    // different sub-pixel boundaries and leave hairline gaps between
    // segments. Hard-stop gradient = pixel-perfect adjacency.
    const railPct = ((b.total / max) * 100).toFixed(2);
    let cum = 0;
    const stops = [];
    for (const seg of ["unit", "gear", "spell"]) {
      const n = b[seg];
      if (n <= 0) continue;
      const start = cum;
      const end = cum + (n / b.total) * 100;
      stops.push(`${COLOR[seg]} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
      cum = end;
    }
    const title = [
      b.unit && `${b.unit} unit`,
      b.gear && `${b.gear} gear`,
      b.spell && `${b.spell} spell`,
    ].filter(Boolean).join(" · ");
    const bg = stops.length ? `background:linear-gradient(to right, ${stops.join(", ")});` : "";
    return `
      <div class="${cls}">
        <span class="bucket">${escapeHtml(bk)}</span>
        <div class="bar-wrap"><div class="bar stacked" style="width:${railPct}%;${bg}" title="${escapeHtml(title)}"></div></div>
        <span class="count">${b.total}</span>
      </div>`;
  }).join("");
  // Legend chips. Only show segments that have any cards.
  const legendBits = [];
  if (tot.unit > 0) legendBits.push(`<span class="curve-key key-unit"></span>unit ${tot.unit}`);
  if (tot.gear > 0) legendBits.push(`<span class="curve-key key-gear"></span>gear ${tot.gear}`);
  if (tot.spell > 0) legendBits.push(`<span class="curve-key key-spell"></span>spell ${tot.spell}`);
  containerEl.innerHTML = `
    <div class="curve-title">
      <span>${escapeHtml(label)}</span>
      <span>avg ${curve.avg.toFixed(2)} · ${curve.totalCounted} cards</span>
    </div>
    <div class="curve-legend">${legendBits.join(" · ")}</div>
    ${rowsHtml}`;
}

function renderDeck() {
  const sections = document.querySelectorAll(".deck-section");
  // Legend
  const legendUl = document.querySelector('.deck-section[data-bucket="legend"] .deck-list');
  if (deck.legend) {
    legendUl.innerHTML = listItemHtml("legend", deck.legend, 1, false);
  } else {
    legendUl.innerHTML = `<li class="empty">— pick a legend with +M —</li>`;
  }
  document.getElementById("cnt-legend").textContent = deck.legend ? 1 : 0;

  // Battlefields
  const bfUl = document.querySelector('.deck-section[data-bucket="battlefields"] .deck-list');
  const bfEntries = Object.entries(deck.battlefields).sort((a, b) =>
    (catalog[a[0]]?.name || a[0]).localeCompare(catalog[b[0]]?.name || b[0])
  );
  bfUl.innerHTML = bfEntries.length
    ? bfEntries.map(([slug, qty]) => listItemHtml("battlefields", slug, qty, true)).join("")
    : `<li class="empty">— +M on a battlefield —</li>`;
  const bfTotal = bucketTotal("battlefields");
  document.getElementById("cnt-bf").textContent = bfTotal;

  // Maindeck — split by type. Champions live in deck.main (catalog type =
  // unit) but get their own sub-section per riftdecks' convention. Identified
  // via window.__CHAMPION_SLUGS__.
  const sortByName = (a, b) =>
    (catalog[a[0]]?.name || a[0]).localeCompare(catalog[b[0]]?.name || b[0]);
  const mainEntries = Object.entries(deck.main).sort(sortByName);
  const byType = { champion: [], unit: [], gear: [], spell: [] };
  for (const [slug, qty] of mainEntries) {
    if (CHAMPION_SLUGS.has(slug)) {
      byType.champion.push([slug, qty]);
      continue;
    }
    const t = catalog[slug]?.type;
    if (t && byType[t]) byType[t].push([slug, qty]);
  }
  for (const [type, ul, countId, sectionLabel] of [
    ["champion", "champion", "cnt-champion", "champion"],
    ["unit", "units", "cnt-units", "units"],
    ["gear", "gear", "cnt-gear", "gear"],
    ["spell", "spells", "cnt-spells", "spells"],
  ]) {
    const sectionUl = document.querySelector(
      `.deck-section[data-bucket="${ul}"] .deck-list`
    );
    const list = byType[type];
    const emptyText =
      type === "champion"
        ? "— +M on a champion —"
        : `— no ${sectionLabel} added —`;
    sectionUl.innerHTML = list.length
      ? list.map(([slug, qty]) => listItemHtml("main", slug, qty, true)).join("")
      : `<li class="empty">${emptyText}</li>`;
    const subtotal = list.reduce((s, [, q]) => s + q, 0);
    document.getElementById(countId).textContent = subtotal;
  }
  // Visual flag if champion overrun (>1).
  document
    .querySelector('.deck-section[data-bucket="champion"]')
    .classList.toggle("over", byType.champion.reduce((s, [, q]) => s + q, 0) > 1);
  const mTotal = mainTotal();
  document.getElementById("cnt-main").textContent = mTotal;

  // Sideboard
  const sideUl = document.querySelector('.deck-section[data-bucket="side"] .deck-list');
  const sideEntries = Object.entries(deck.side).sort(sortByName);
  sideUl.innerHTML = sideEntries.length
    ? sideEntries.map(([slug, qty]) => listItemHtml("side", slug, qty, true)).join("")
    : `<li class="empty">— +S on any card —</li>`;
  const sideTotalN = bucketTotal("side");
  document.getElementById("cnt-side").textContent = sideTotalN;

  // Over-cap red-flags
  document
    .querySelector('.deck-section[data-bucket="battlefields"]')
    .classList.toggle("over", bfTotal > 3);
  document
    .querySelector('.deck-section[data-bucket="side"]')
    .classList.toggle("over", sideTotalN > 8);
  const totalEl = document.querySelector(".deck-total");
  totalEl.classList.toggle("over", mTotal > 40);

  // Energy curves (one per pane).
  renderEnergyCurve(
    document.getElementById("curve-main"),
    "Maindeck energy",
    computeEnergyCurve(deck.main)
  );
  renderEnergyCurve(
    document.getElementById("curve-side"),
    "Sideboard energy",
    computeEnergyCurve(deck.side)
  );

  // Per-domain power demand (one per pane).
  renderPowerByDomain(
    document.getElementById("power-main"),
    "Power demand",
    computePowerByDomain(deck.main)
  );
  renderPowerByDomain(
    document.getElementById("power-side"),
    "Power demand",
    computePowerByDomain(deck.side)
  );

  // Tabs
  document.getElementById("deck-main").hidden = deckTab !== "main";
  document.getElementById("deck-side").hidden = deckTab !== "side";
  for (const t of document.querySelectorAll(".deck-tab")) {
    t.classList.toggle("active", t.dataset.tab === deckTab);
    t.setAttribute("aria-selected", t.dataset.tab === deckTab ? "true" : "false");
  }
}

// ---------- copy ----------
function buildDecklistText() {
  // Matches riftdecks' own deck-export format:
  //   Legend:
  //   1 <legend name>
  //
  //   Champion:
  //   1 <champion name>
  //
  //   MainDeck:
  //   <copies> <name>
  //   …
  //
  //   Battlefields:
  //   …
  //
  //   SideBoard:
  //   …
  //
  // (Rune Pool: omitted — the builder doesn't track runes.)
  const lines = [];
  const nameOf = (slug) => catalog[slug]?.name || slug;
  const sortEntries = (entries) =>
    entries.sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  const sec = (header, body) => {
    if (!body.length) return;
    if (lines.length) lines.push("");
    lines.push(`${header}:`);
    for (const line of body) lines.push(line);
  };

  // Legend
  if (deck.legend) sec("Legend", [`1 ${nameOf(deck.legend)}`]);

  // Champion — extracted from maindeck (champions are units that
  // happen to be marked type=champion in the deck listings). At most
  // one per deck in standard Riftbound, but tolerate multiple.
  const mainEntries = sortEntries(Object.entries(deck.main));
  const championEntries = mainEntries.filter(([s]) => CHAMPION_SLUGS.has(s));
  const nonChampMain = mainEntries.filter(([s]) => !CHAMPION_SLUGS.has(s));
  if (championEntries.length) {
    sec(
      "Champion",
      championEntries.map(([s, q]) => `${q} ${nameOf(s)}`)
    );
  }

  // MainDeck (units + spells + gear minus the champion)
  if (nonChampMain.length) {
    sec(
      "MainDeck",
      nonChampMain.map(([s, q]) => `${q} ${nameOf(s)}`)
    );
  }

  // Battlefields
  const bfEntries = sortEntries(Object.entries(deck.battlefields));
  if (bfEntries.length) {
    sec(
      "Battlefields",
      bfEntries.map(([s, q]) => `${q} ${nameOf(s)}`)
    );
  }

  // SideBoard
  const sEntries = sortEntries(Object.entries(deck.side));
  if (sEntries.length) {
    sec(
      "SideBoard",
      sEntries.map(([s, q]) => `${q} ${nameOf(s)}`)
    );
  }

  return lines.join("\n");
}

async function copyDeck() {
  const text = buildDecklistText();
  const btn = document.getElementById("copy-deck");
  if (!text) {
    toast("Deck is empty");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback: textarea trick.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
  }
  btn.classList.add("copied");
  btn.textContent = "Copied ✓";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = "Copy decklist";
  }, 1600);
}

// attachHoverThumb lives in utils.js (reads the rendered #card-thumb width
// via getComputedStyle so the 240px override in collection.css still wins).

// ---------- wire up ----------
function init() {
  const meta = document.getElementById("meta");
  meta.innerHTML = `${Object.keys(catalog).length.toLocaleString()} cards in catalog · ${champions.length} legends · click +M/+S to build a deck`;

  renderPills("pills-rarity", RARITY_OPTS, "rarities");
  renderPills("pills-set", SET_OPTS, "sets");
  renderPills("pills-type", TYPE_OPTS, "types");
  renderPills("pills-domain", DOMAIN_OPTS, "domains");
  renderPills("pills-energy", CURVE_BUCKETS, "energies");
  populateLegendDropdown();

  // Restore filter widget values from saved state.
  const searchEl = document.getElementById("search");
  searchEl.value = filters.search;
  searchEl.addEventListener("input", () => {
    filters.search = searchEl.value;
    saveFilters();
    renderTable();
  });

  for (const [id, key] of [
    ["owned-min", "ownedMin"],
    ["owned-max", "ownedMax"],
    ["missing-min", "missingMin"],
    ["missing-max", "missingMax"],
  ]) {
    const el = document.getElementById(id);
    el.value = filters[key];
    el.addEventListener("input", () => {
      filters[key] = el.value;
      saveFilters();
      renderTable();
    });
  }

  const legendSel = document.getElementById("legend-filter");
  legendSel.addEventListener("change", () => {
    filters.legend = legendSel.value;
    saveFilters();
    renderTable();
  });

  const enrouteEl = document.getElementById("include-enroute");
  enrouteEl.checked = includeEnRoute;
  enrouteEl.addEventListener("change", () => {
    includeEnRoute = enrouteEl.checked;
    writeJSON(LS_ENROUTE, includeEnRoute);
    renderTable();
    renderDeck();
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    filters = { ...DEFAULT_FILTERS };
    saveFilters();
    // Reset DOM widgets
    searchEl.value = "";
    document.getElementById("owned-min").value = "";
    document.getElementById("owned-max").value = "";
    document.getElementById("missing-min").value = "";
    document.getElementById("missing-max").value = "";
    legendSel.value = "";
    for (const p of document.querySelectorAll(".pill.active")) p.classList.remove("active");
    renderTable();
  });

  // Sortable headers
  for (const th of document.querySelectorAll("#collection-table th.sortable")) {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (filters.sortCol === col) {
        filters.sortDir = filters.sortDir === "asc" ? "desc" : "asc";
      } else {
        filters.sortCol = col;
        // Sensible default direction per column.
        filters.sortDir = (col === "owned" || col === "missing") ? "desc" : "asc";
        if (col === "cost") filters.sortDir = "asc";
      }
      saveFilters();
      renderTable();
    });
  }

  // Add-to-deck buttons (event delegation)
  tbodyEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".add-btn");
    if (!btn || btn.disabled) return;
    const slug = btn.dataset.slug;
    if (btn.dataset.action === "add-main") addToDeck(slug, false);
    else if (btn.dataset.action === "add-side") addToDeck(slug, true);
  });

  // Deck sidebar controls (event delegation)
  document.querySelector(".deck-sidebar").addEventListener("click", (ev) => {
    const tab = ev.target.closest(".deck-tab");
    if (tab) {
      deckTab = tab.dataset.tab;
      writeJSON(LS_DECK_TAB, deckTab);
      renderDeck();
      return;
    }
    const btn = ev.target.closest("button[data-action]");
    if (!btn || btn.disabled) return;
    const bucket = btn.dataset.bucket;
    const slug = btn.dataset.slug;
    if (btn.dataset.action === "inc") incFromDeck(bucket, slug);
    else if (btn.dataset.action === "dec") decFromDeck(bucket, slug);
    else if (btn.dataset.action === "remove") removeFromDeck(bucket, slug);
  });

  document.getElementById("copy-deck").addEventListener("click", copyDeck);
  document.getElementById("new-deck").addEventListener("click", newDeck);

  // Paste-import UI
  const pasteBtn = document.getElementById("import-deck");
  const pastePanel = document.getElementById("paste-panel");
  const pasteText = document.getElementById("paste-text");
  const pasteLoad = document.getElementById("paste-load");
  const pasteCancel = document.getElementById("paste-cancel");
  const pasteResult = document.getElementById("paste-result");
  pasteBtn.addEventListener("click", () => {
    pastePanel.hidden = !pastePanel.hidden;
    if (!pastePanel.hidden) pasteText.focus();
  });
  pasteCancel.addEventListener("click", () => {
    pastePanel.hidden = true;
    pasteText.value = "";
    pasteResult.textContent = "";
    pasteResult.className = "muted footnote";
  });
  pasteLoad.addEventListener("click", () => {
    const text = pasteText.value;
    if (!text.trim()) return;
    const warnings = importDecklistText(text);
    if (warnings.length) {
      pasteResult.textContent = `Loaded with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? ` (+${warnings.length - 3} more)` : ""}`;
      pasteResult.className = "footnote has-warn";
    } else {
      pasteResult.textContent = "Loaded.";
      pasteResult.className = "footnote ok";
    }
  });

  rebuildNameIndex();
  ensureLockToggles(document.getElementById("lock-toggles"), "builder", () => {
    renderTable();
    renderDeck();
  });
  ensureReadLockButtons();
  attachHoverThumb();
  renderTable();
  renderDeck();
}

// Render a "Read from <tab>" button for each known lock tab into the
// deck-footer. Idempotent — replaces existing buttons when called again
// (on collection:updated). Each button loads the lock's raw decklist
// text into the builder via importDecklistText.
function ensureReadLockButtons() {
  const containerEl = document.getElementById("read-lock-buttons");
  if (!containerEl) return;
  const tabs = lockTabNames();
  // Cache-key off the tab list so we don't recreate buttons unnecessarily.
  const key = tabs.join("|");
  if (containerEl.dataset.tabs === key) return;
  containerEl.dataset.tabs = key;
  containerEl.innerHTML = "";
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = `Read ${tab}`;
    btn.title = `Load the decklist pasted into the ${tab} tab of the collection sheet`;
    btn.addEventListener("click", () => loadFromLock(tab, btn));
    containerEl.appendChild(btn);
  }
}

function loadFromLock(tabName, btnEl) {
  const raw = (window.__LOCKS_RAW__ || {})[tabName];
  if (!raw || !raw.trim()) {
    toast(`${tabName} is empty.`);
    return;
  }
  const warnings = importDecklistText(raw);
  if (warnings.length) {
    toast(
      `Loaded from ${tabName} — ${warnings.length} warning${
        warnings.length === 1 ? "" : "s"
      } (see console)`
    );
    console.warn(`[Read from ${tabName}] ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  · ${w}`);
  } else {
    toast(`Loaded from ${tabName}.`);
  }
  if (btnEl) {
    const orig = btnEl.textContent;
    btnEl.classList.add("copied");
    btnEl.textContent = "Loaded ✓";
    setTimeout(() => {
      btnEl.classList.remove("copied");
      btnEl.textContent = orig;
    }, 1200);
  }
}

window.addEventListener("collection:updated", () => {
  owned = window.__OWNED_DEFAULTS__ || {};
  enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
  rebuildNameIndex();
  ensureLockToggles(document.getElementById("lock-toggles"), "builder", () => {
    renderTable();
    renderDeck();
  });
  ensureReadLockButtons();
  renderTable();
  renderDeck();
});

init();
