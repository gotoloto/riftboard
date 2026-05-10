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
  board: "main", // "main" or "side"
};

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
const championSelectEl = document.getElementById("champion-select");
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderRow(card) {
  const domains = (card.domains || [])
    .map((d) => `<span class="tag">${d}</span>`)
    .join("");
  const link = card.url
    ? `<a href="${card.url}" target="_blank" rel="noopener">${escapeHtml(
        card.name
      )}</a>`
    : escapeHtml(card.name);
  const cost = card.cost == null || card.cost === "" ? "—" : card.cost;
  const inclusion = card.inclusion_pct.toFixed(1);
  const cp = card.copies_pct;
  const fmt = (v) => `${(v ?? 0).toFixed(1)}%`;
  return `
    <tr>
      <td>${link}</td>
      <td>${card.type ? `<span class="tag">${card.type}</span>` : ""}</td>
      <td>${domains || ""}</td>
      <td class="num">${cost}</td>
      <td class="num">${card.decks_including} / ${state.filteredDeckCount}</td>
      <td class="num">${inclusion}%${pctBar(card.inclusion_pct)}</td>
      <td class="num">${card.avg_copies_when_included.toFixed(2)}</td>
      <td class="num">${fmt(cp["1"])}</td>
      <td class="num">${fmt(cp["2"])}</td>
      <td class="num">${fmt(cp["3+"])}</td>
    </tr>
  `;
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

function slotFor(card) {
  const t = (card.type || "").toLowerCase();
  return KNOWN_TYPES.includes(t) ? t : "other";
}

// Hardcoded slot targets dictated by Riftbound deck-building rules.
// Unit / spell / gear are computed dynamically (their split varies per deck).
const STATIC_TARGETS = { legend: 1, battlefield: 3, rune: 12 };
const SLOT_LABELS = {
  legend: "Legend",
  battlefield: "Battlefields",
  rune: "Runes",
  unit: "Units",
  spell: "Spells",
  gear: "Gear",
  other: "Other",
};
const SLOT_ORDER = [
  "legend",
  "battlefield",
  "rune",
  "unit",
  "spell",
  "gear",
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

function buildMedianDeckSections() {
  if (state.board === "side") {
    // Median sideboard: use median sideboard size from filtered decks.
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
  const filteredMain = state.rawDecks
    .filter(deckPasses)
    .filter((d) => (d.c || []).length > 0);
  const dyn = computeDynamicTargets(filteredMain);
  const targets = { ...STATIC_TARGETS, ...dyn };

  const grouped = Object.fromEntries(SLOT_ORDER.map((k) => [k, []]));
  for (const c of state.cards) grouped[slotFor(c)].push(c);

  const sections = [];
  for (const key of SLOT_ORDER) {
    const target = targets[key] ?? 0;
    if (key === "other" && grouped.other.length === 0) continue;
    const { picks, filled } = pickByMedian(grouped[key], target);
    sections.push({ key, label: SLOT_LABELS[key], target, filled, picks });
  }
  return sections;
}

function renderMedianDeck() {
  const sections = buildMedianDeckSections();
  const totalTarget = sections.reduce((s, x) => s + x.target, 0);
  const totalFilled = sections.reduce((s, x) => s + x.filled, 0);
  const boardLabel = state.board === "side" ? "sideboard" : "mainboard";
  medianContextEl.textContent = `· ${boardLabel} · ${totalFilled}/${totalTarget} cards (median copies of top-included cards)`;

  medianContentEl.innerHTML = sections
    .map((sec) => {
      if (sec.target === 0)
        return `<div class="median-section"><h3>${escapeHtml(
          sec.label
        )} <span class="target">(0)</span></h3><ul><li class="muted">No decks in this slice</li></ul></div>`;
      const short = sec.filled < sec.target;
      const targetStr = `<span class="target${
        short ? " short" : ""
      }">(${sec.filled}/${sec.target})</span>`;
      const items = sec.picks.length
        ? sec.picks
            .map((p) => {
              const link = p.url
                ? `<a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(
                    p.name
                  )}</a>`
                : escapeHtml(p.name);
              return `<li><span class="qty">${p.picked_copies}×</span><span class="name">${link}</span><span class="pct">${p.inclusion_pct.toFixed(
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

function deckPasses(deck) {
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
  renderMedianDeck();
  render();
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
  state.board = "main";
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
    attachBoardToggle();
    dashboardInitialised = true;
  }
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
    s.src = `data-${slug}.js`;
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
