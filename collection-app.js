"use strict";

// =====================================================================
// Collection explorer + deck builder
// =====================================================================

const RARITY = {
  common:   { ch: "●", cls: "common" },
  uncommon: { ch: "▲", cls: "uncommon" },
  rare:     { ch: "◆", cls: "rare" },
  epic:     { ch: "⬟", cls: "epic" },
  showcase: { ch: "⬢", cls: "showcase" },
};
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, showcase: 4 };
const PLAYSET = 3;

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

// ---------- utils ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}
function rarityGlyph(rarity) {
  const r = rarity && RARITY[String(rarity).toLowerCase()];
  if (!r) return "";
  return `<span class="rarity rarity-${r.cls}" title="${escapeHtml(rarity)}" aria-hidden="true">${r.ch}</span>`;
}

// Cost strings are either "-" (no cost; battlefields, legends, runes) or a
// leading-energy followed by zero or more "C" power chars: "0C", "2",
// "5CC", "10CCCC". Returns { energy: number|null, power: number }.
function parseCost(costStr) {
  if (!costStr || costStr === "-") return { energy: null, power: 0 };
  const m = String(costStr).match(/^(\d+)(C*)$/);
  if (!m) return { energy: null, power: 0 };
  return { energy: parseInt(m[1], 10), power: m[2].length };
}
function energyOf(slug) {
  const c = catalog[slug];
  if (!c) return null;
  return parseCost(c.cost).energy;
}

// Energy buckets for the curve: 0..6 each, plus a 7+ catch-all.
const CURVE_BUCKETS = ["0", "1", "2", "3", "4", "5", "6", "7+"];
function bucketIndexForEnergy(e) {
  if (e == null) return -1;
  if (e >= 7) return 7;
  return Math.max(0, Math.min(7, e));
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
  return o + (includeEnRoute ? (enRoute[slug] || 0) : 0);
}
function missingFor(slug) {
  return Math.max(0, PLAYSET - ownedFor(slug));
}

// ---------- filter state ----------
const DEFAULT_FILTERS = {
  search: "",
  rarities: [],
  sets: [],
  types: [],
  domains: [],
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
    deck.side[slug] = (deck.side[slug] || 0) + 1;
  } else {
    const bucket = bucketForType(c.type);
    if (!bucket) return;
    if (bucket === "legend") {
      // Replace any existing legend; no confirm — easy to undo by adding back.
      deck.legend = slug;
    } else {
      if (deckTotalIn(slug) >= ownedFor(slug)) return;
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
  if (deckTotalIn(slug) >= ownedFor(slug)) return;
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

  const rows = [];
  for (const slug of Object.keys(owned)) {
    const c = catalog[slug];
    if (!c) continue; // unknown slug — skip rather than guess
    const ownedQty = ownedFor(slug);
    if (ownedQty <= 0) continue; // 'collection' = only what you own
    const missing = missingFor(slug);

    if (searchLc && !c.name.toLowerCase().includes(searchLc)) continue;
    if (rSet && !rSet.has(c.rarity)) continue;
    if (setSet && !setSet.has(c.set)) continue;
    if (tSet && !tSet.has(c.type)) continue;
    if (dSet) {
      const ds = c.domains || [];
      if (!ds.some((d) => dSet.has(d))) continue;
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

  // +M / +S disabled state.
  const remaining = row.owned - deckTotalIn(row.slug);
  const isRune = c.type === "rune";
  const mainDisabled =
    isRune || remaining <= 0 || (c.type === "legend" && deck.legend === row.slug);
  const sideDisabled = remaining <= 0;
  const mTitle = isRune
    ? "Runes aren't tracked"
    : c.type === "legend"
    ? "Add as legend"
    : c.type === "battlefield"
    ? "Add to battlefields"
    : `Add to maindeck (${c.type})`;

  const { energy, power } = parseCost(c.cost);
  const costCell =
    energy == null
      ? `<td class="cost-cell no-cost">—</td>`
      : `<td class="cost-cell">${energy}${
          power > 0 ? `<span class="power" title="${power} power">${"C".repeat(power)}</span>` : ""
        }</td>`;

  return `
    <tr data-slug="${escapeHtml(row.slug)}">
      <td class="rank">${idx + 1}</td>
      <td class="name">${nameLink} ${rarityGlyph(c.rarity)}</td>
      <td class="set-cell">${escapeHtml(c.set)} <span class="muted">#${c.set_num}</span></td>
      <td class="rarity-cell">${escapeHtml(c.rarity)}</td>
      <td class="type">${escapeHtml(c.type)}</td>
      ${costCell}
      <td class="domains">${domains}</td>
      <td class="num">${row.owned}</td>
      <td class="${missingCls}">${row.missing}</td>
      <td class="actions">
        <button class="add-btn" data-action="add-main" data-slug="${escapeHtml(row.slug)}"${mainDisabled ? " disabled" : ""} title="${escapeHtml(mTitle)}">+M</button>
        <button class="add-btn" data-action="add-side" data-slug="${escapeHtml(row.slug)}"${sideDisabled ? " disabled" : ""} title="Add to sideboard">+S</button>
      </td>
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
  const ownedCount = Object.keys(owned).filter((s) => ownedFor(s) > 0).length;
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
  const remaining = ownedFor(slug) - deckTotalIn(slug);
  const incDisabled = remaining <= 0;
  const qtyHtml = `<span class="qty">${qty} ×</span>`;
  const nameHtml = `<span class="card-name"${img}>${escapeHtml(name)}</span>`;
  if (!allowQtyControls) {
    // Legend slot: just a remove button.
    return `<li data-slug="${escapeHtml(slug)}">${qtyHtml}${nameHtml}<button class="remove" data-action="remove" data-bucket="${bucket}" data-slug="${escapeHtml(slug)}" title="Remove">×</button></li>`;
  }
  return `<li data-slug="${escapeHtml(slug)}">${qtyHtml}${nameHtml}<button data-action="dec" data-bucket="${bucket}" data-slug="${escapeHtml(slug)}" title="Remove one">−</button><button data-action="inc" data-bucket="${bucket}" data-slug="${escapeHtml(slug)}"${incDisabled ? " disabled" : ""} title="Add one">+</button></li>`;
}

function computeEnergyCurve(slugQtyMap) {
  // Returns { buckets: number[8], avg: number|null, totalCounted: number }.
  // Cards with no energy cost (cost "-": legend, battlefield, rune) are
  // excluded from the curve and from the average.
  const buckets = new Array(8).fill(0);
  let sumE = 0;
  let totalCounted = 0;
  for (const [slug, qty] of Object.entries(slugQtyMap || {})) {
    const e = energyOf(slug);
    if (e == null) continue;
    const idx = bucketIndexForEnergy(e);
    if (idx < 0) continue;
    buckets[idx] += qty;
    sumE += e * qty;
    totalCounted += qty;
  }
  const avg = totalCounted > 0 ? sumE / totalCounted : null;
  return { buckets, avg, totalCounted };
}

function renderEnergyCurve(containerEl, label, curve) {
  if (curve.totalCounted === 0) {
    containerEl.innerHTML = `<div class="curve-title"><span>${escapeHtml(
      label
    )}</span><span>—</span></div>`;
    return;
  }
  const max = Math.max(1, ...curve.buckets);
  const rowsHtml = CURVE_BUCKETS.map((bk, i) => {
    const n = curve.buckets[i];
    const pct = (n / max) * 100;
    const cls = n === 0 ? "curve-row empty" : "curve-row";
    return `
      <div class="${cls}">
        <span class="bucket">${escapeHtml(bk)}</span>
        <div class="bar-wrap"><div class="bar" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="count">${n}</span>
      </div>`;
  }).join("");
  containerEl.innerHTML = `
    <div class="curve-title">
      <span>${escapeHtml(label)}</span>
      <span>avg ${curve.avg.toFixed(2)} · ${curve.totalCounted} cards</span>
    </div>
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

  // Maindeck — split by type
  const sortByName = (a, b) =>
    (catalog[a[0]]?.name || a[0]).localeCompare(catalog[b[0]]?.name || b[0]);
  const mainEntries = Object.entries(deck.main).sort(sortByName);
  const byType = { unit: [], gear: [], spell: [] };
  for (const [slug, qty] of mainEntries) {
    const t = catalog[slug]?.type;
    if (t && byType[t]) byType[t].push([slug, qty]);
  }
  for (const [type, ul, countId, sectionLabel] of [
    ["unit", "units", "cnt-units", "units"],
    ["gear", "gear", "cnt-gear", "gear"],
    ["spell", "spells", "cnt-spells", "spells"],
  ]) {
    const sectionUl = document.querySelector(
      `.deck-section[data-bucket="${ul}"] .deck-list`
    );
    const list = byType[type];
    sectionUl.innerHTML = list.length
      ? list.map(([slug, qty]) => listItemHtml("main", slug, qty, true)).join("")
      : `<li class="empty">— no ${sectionLabel} added —</li>`;
    const subtotal = list.reduce((s, [, q]) => s + q, 0);
    document.getElementById(countId).textContent = subtotal;
  }
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
  const lines = [];
  const nameOf = (slug) => catalog[slug]?.name || slug;
  const sortEntries = (entries) =>
    entries.sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));

  if (deck.legend) {
    lines.push("LEGEND");
    lines.push(`1 ${nameOf(deck.legend)}`);
    lines.push("");
  }
  const bfEntries = sortEntries(Object.entries(deck.battlefields));
  if (bfEntries.length) {
    lines.push(`BATTLEFIELDS (${bucketTotal("battlefields")})`);
    for (const [slug, qty] of bfEntries) lines.push(`${qty} ${nameOf(slug)}`);
    lines.push("");
  }
  const mEntries = sortEntries(Object.entries(deck.main));
  if (mEntries.length) {
    lines.push(`MAINDECK (${mainTotal()})`);
    for (const [slug, qty] of mEntries) lines.push(`${qty} ${nameOf(slug)}`);
    lines.push("");
  }
  const sEntries = sortEntries(Object.entries(deck.side));
  if (sEntries.length) {
    lines.push(`SIDEBOARD (${bucketTotal("side")})`);
    for (const [slug, qty] of sEntries) lines.push(`${qty} ${nameOf(slug)}`);
    lines.push("");
  }
  // Trim trailing blank line
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
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

// ---------- hover thumb ----------
const cardThumbEl = document.getElementById("card-thumb");
let thumbTimer = 0;
const THUMB_W = 240;

function positionThumb(ev) {
  const pad = 16;
  const ratio = cardThumbEl.naturalWidth
    ? cardThumbEl.naturalHeight / cardThumbEl.naturalWidth
    : 1.4;
  const h = THUMB_W * ratio;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + THUMB_W > window.innerWidth) x = ev.clientX - THUMB_W - pad;
  x = Math.max(pad, Math.min(x, window.innerWidth - THUMB_W - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - h - pad));
  cardThumbEl.style.left = x + "px";
  cardThumbEl.style.top = y + "px";
}
function attachHoverThumb() {
  document.body.addEventListener("mouseover", (ev) => {
    const el = ev.target.closest("[data-img]");
    if (!el) return;
    const img = el.dataset.img;
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
    if (!ev.target.closest("[data-img]")) return;
    clearTimeout(thumbTimer);
    cardThumbEl.hidden = true;
  });
}

// ---------- wire up ----------
function init() {
  const meta = document.getElementById("meta");
  meta.innerHTML = `${Object.keys(catalog).length.toLocaleString()} cards in catalog · ${champions.length} legends · click +M/+S to build a deck`;

  renderPills("pills-rarity", RARITY_OPTS, "rarities");
  renderPills("pills-set", SET_OPTS, "sets");
  renderPills("pills-type", TYPE_OPTS, "types");
  renderPills("pills-domain", DOMAIN_OPTS, "domains");
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

  attachHoverThumb();
  renderTable();
  renderDeck();
}

window.addEventListener("collection:updated", () => {
  owned = window.__OWNED_DEFAULTS__ || {};
  enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
  renderTable();
  renderDeck();
});

init();
