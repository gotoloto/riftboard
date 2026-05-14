"use strict";

const DEFAULT_LEGENDS = [
  "lillia-bashful-bloom",
  "azir-emperor-of-the-sands",
  "diana-scorn-of-the-moon",
  "khazix-voidreaver",
  "leblanc-deceiver",
  "vex-gloomist",
];

const LS = {
  legends: "cart:legends",
  owned: "cart:owned",
  wanted: "cart:wanted",
  percentile: "cart:percentile",
  qty: "cart:qty",
  includeSideboard: "cart:includeSideboard",
  capRarity: "cart:capRarity",
  legendTeams: "cart:legendTeams",
};

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "showcase"];

function shouldCap(rarity, threshold) {
  if (!threshold) return false;
  const ri = RARITY_ORDER.indexOf((rarity || "").toLowerCase());
  const ti = RARITY_ORDER.indexOf(threshold);
  return ri >= 0 && ti >= 0 && ri >= ti;
}

const RARITY = {
  common:   { ch: "●", cls: "common" },
  uncommon: { ch: "▲", cls: "uncommon" },
  rare:     { ch: "◆", cls: "rare" },
  epic:     { ch: "⬟", cls: "epic" },
  showcase: { ch: "⬢", cls: "showcase" },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setFromImg(img) {
  if (!img) return null;
  const m = String(img).match(/\/img\/cards\/[^/]+\/+([A-Z][A-Z0-9]+)\//);
  return m ? m[1] : null;
}

function rarityHtml(rarity) {
  const g = rarity && RARITY[String(rarity).toLowerCase()];
  if (!g) return "";
  return ` <span class="rarity rarity-${g.cls}" title="${escapeHtml(rarity)}" aria-hidden="true">${g.ch}</span>`;
}

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

const champions = window.__CHAMPIONS__ || [];
const championBySlug = new Map(champions.map((c) => [c.slug, c]));
// Baseline owned counts loaded from collection-owned.js (the user's collection
// import). Per-row overrides in state.ownedOverride win when present.
const defaultOwned = window.__OWNED_DEFAULTS__ || {};

function ownedFor(slug) {
  if (Object.prototype.hasOwnProperty.call(state.ownedOverride, slug)) {
    return state.ownedOverride[slug];
  }
  return defaultOwned[slug] || 0;
}

const state = {
  selectedLegends: new Set(readJSON(LS.legends, DEFAULT_LEGENDS)),
  ownedOverride: readJSON(LS.owned, {}),
  wantedOverride: readJSON(LS.wanted, {}),
  percentile: readJSON(LS.percentile, 25),
  qtyTarget: readJSON(LS.qty, 60),
  includeSideboard: readJSON(LS.includeSideboard, true),
  capRarity: readJSON(LS.capRarity, ""),
  // Per-legend team assignments — { slug: "A" | "B" }. Slugs without an entry
  // are treated as solo (their qty contributes in full to Wanted, same as
  // every other solo legend or team).
  legendTeams: readJSON(LS.legendTeams, {}),
};
for (const s of [...state.selectedLegends]) {
  if (!championBySlug.has(s)) state.selectedLegends.delete(s);
}

const dataCache = new Map(); // slug -> __DATA__ payload
function loadLegendData(slug) {
  if (dataCache.has(slug)) return Promise.resolve(dataCache.get(slug));
  return new Promise((resolve) => {
    const prev = window.__DATA__;
    window.__DATA__ = null;
    const s = document.createElement("script");
    s.src = `legends/${slug}/data.js`;
    s.onload = () => {
      const d = window.__DATA__;
      window.__DATA__ = prev;
      if (d) dataCache.set(slug, d);
      resolve(d || null);
    };
    s.onerror = () => {
      window.__DATA__ = prev;
      resolve(null);
    };
    document.body.appendChild(s);
  });
}
async function ensureDataLoaded(slugs) {
  await Promise.all(slugs.map(loadLegendData));
}

function medianOfSorted(arr) {
  if (!arr.length) return 0;
  const mid = (arr.length / 2) | 0;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function aggregateLegend(data, percentile, includeSideboard) {
  const decks = (data.decks || []).filter(
    (d) => d.fp != null && d.fp <= percentile
  );
  const n = decks.length;
  const perCard = new Map();
  for (const d of decks) {
    const main = new Map();
    for (const [slug, q] of d.c || [])
      main.set(slug, (main.get(slug) || 0) + q);
    const side = new Map();
    if (includeSideboard)
      for (const [slug, q] of d.s || [])
        side.set(slug, (side.get(slug) || 0) + q);
    const all = new Set([...main.keys(), ...side.keys()]);
    for (const slug of all) {
      const m = main.get(slug) || 0;
      const s = side.get(slug) || 0;
      if (m + s <= 0) continue;
      let e = perCard.get(slug);
      if (!e) {
        e = { qtys: [], main_qtys: [], side_qtys: [] };
        perCard.set(slug, e);
      }
      e.qtys.push(m + s);
      e.main_qtys.push(m);
      e.side_qtys.push(s);
    }
  }
  const out = [];
  for (const [slug, e] of perCard) {
    const meta = (data.cards_meta || {})[slug] || {};
    e.qtys.sort((a, b) => a - b);
    const mainSorted = e.main_qtys.slice().sort((a, b) => a - b);
    const sideSorted = e.side_qtys.slice().sort((a, b) => a - b);
    out.push({
      slug,
      name: meta.name || slug,
      type: (meta.type || "").toLowerCase(),
      domains: meta.domains || [],
      rarity: meta.rarity,
      url: meta.url,
      img: meta.img,
      set: setFromImg(meta.img),
      decks_including: e.qtys.length,
      inclusion_pct: n ? (e.qtys.length / n) * 100 : 0,
      median_copies: Math.round(medianOfSorted(e.qtys)),
      median_main: Math.round(medianOfSorted(mainSorted)),
      median_side: Math.round(medianOfSorted(sideSorted)),
      qtys: e.qtys, // sorted ascending; used by the marginal-copy picker
    });
  }
  out.sort((a, b) =>
    b.decks_including - a.decks_including ||
    b.median_copies - a.median_copies ||
    a.name.localeCompare(b.name)
  );
  return { filteredDeckCount: n, allCards: out };
}

function legendShoppingList(allCards, qtyTarget) {
  const excluded = new Set(["rune", "legend", "battlefield"]);
  // Marginal-copy ranking: each card expands into copy-slots (1st, 2nd, 3rd, …).
  // Each slot's score is the count of filtered decks running AT LEAST that many
  // copies of the card. Greedy-pick the top qtyTarget slots across the whole
  // pool; a card's picked Wanted is just the number of its slots that landed.
  // Beats "sort cards by inclusion, take each card's median" because a card's
  // 2nd or 3rd copy can be more common than another card's lone copy.
  const slots = [];
  for (const c of allCards) {
    if (excluded.has(c.type)) continue;
    const maxQty = c.qtys.length ? c.qtys[c.qtys.length - 1] : 1;
    for (let i = 1; i <= maxQty; i++) {
      // qtys is sorted asc; count of entries >= i = length - first-ge-i index.
      let lo = 0, hi = c.qtys.length;
      while (lo < hi) {
        const m = (lo + hi) >>> 1;
        if (c.qtys[m] < i) lo = m + 1;
        else hi = m;
      }
      const cnt = c.qtys.length - lo;
      if (cnt <= 0) break;
      slots.push({ slug: c.slug, copyIndex: i, count: cnt });
    }
  }
  // Most common copy-slots first. Tie-break: keep a card's earlier copies
  // contiguous (alphabetical, then copyIndex asc) so the pick order is
  // stable.
  slots.sort(
    (a, b) =>
      b.count - a.count ||
      a.slug.localeCompare(b.slug) ||
      a.copyIndex - b.copyIndex
  );

  const cardQtys = new Map();
  for (let i = 0; i < slots.length && i < qtyTarget; i++) {
    const s = slots[i];
    cardQtys.set(s.slug, (cardQtys.get(s.slug) || 0) + 1);
  }

  const bySlug = new Map(allCards.map((c) => [c.slug, c]));
  const main = [...cardQtys.entries()]
    .map(([slug, qty]) => ({ ...bySlug.get(slug), qty }))
    .sort(
      (a, b) =>
        b.qty - a.qty ||
        b.decks_including - a.decks_including ||
        a.name.localeCompare(b.name)
    );

  // Legend card and battlefields stay mainboard-only — they don't sit in
  // sideboards in practice, so attribute their full qty to mainboard.
  const legend = allCards.find((c) => c.type === "legend");
  const battlefields = allCards
    .filter((c) => c.type === "battlefield")
    .slice(0, 6)
    .map((c) => ({ ...c, qty: 1, median_main: 1, median_side: 0 }));
  return [
    ...(legend ? [{ ...legend, qty: 1, median_main: 1, median_side: 0 }] : []),
    ...battlefields,
    ...main,
  ];
}

function buildRows() {
  const merged = new Map();
  const filteredCounts = new Map();
  for (const slug of state.selectedLegends) {
    const data = dataCache.get(slug);
    const champ = championBySlug.get(slug);
    if (!data || !champ) continue;
    const { filteredDeckCount, allCards } = aggregateLegend(
      data,
      state.percentile,
      state.includeSideboard
    );
    filteredCounts.set(slug, filteredDeckCount);
    const list = legendShoppingList(allCards, state.qtyTarget);
    for (const c of list) {
      let m = merged.get(c.slug);
      if (!m) {
        m = { ...c, perLegend: [], defaultWanted: 0 };
        merged.set(c.slug, m);
      }
      // Split the picked qty into main and side parts proportional to the
      // medians, capped at qty. Lets the chip's tooltip show "3 main + 2 side"
      // without re-running the picker per board.
      const medMain = c.median_main || 0;
      const medSide = c.median_side || 0;
      let mainQty = Math.min(c.qty, medMain);
      let sideQty = c.qty - mainQty;
      if (sideQty < 0) { mainQty = c.qty; sideQty = 0; }
      m.perLegend.push({ slug, name: champ.name, qty: c.qty, mainQty, sideQty });
      m.defaultWanted += c.qty;
    }
  }
  const rows = [];
  for (const m of merged.values()) {
    // Wanted aggregation across selected legends has two knobs:
    //   1. Team assignments (state.legendTeams) — legends on the same team
    //      share, so within-team contribution is the *max* qty across that
    //      team's legends. Solo legends (no team set) each count for their
    //      full qty. Total = sum of per-team maxes.
    //   2. Rarity cap (state.capRarity) — for cards at or above the chosen
    //      tier, override teams and collapse *all* selected legends to a
    //      single shared pool (max across everyone). Useful for expensive
    //      tiers where one playset is enough for the whole household.
    let defaultWanted;
    if (shouldCap(m.rarity, state.capRarity)) {
      defaultWanted = m.perLegend.length
        ? Math.max(...m.perLegend.map((l) => l.qty))
        : 0;
    } else {
      const groups = new Map();
      for (const l of m.perLegend) {
        const team = state.legendTeams[l.slug];
        const key = team ? `team:${team}` : `solo:${l.slug}`;
        groups.set(key, Math.max(groups.get(key) || 0, l.qty));
      }
      defaultWanted = [...groups.values()].reduce((s, x) => s + x, 0);
    }
    const wOverride = state.wantedOverride[m.slug];
    const wanted = wOverride != null ? wOverride : defaultWanted;
    const owned = ownedFor(m.slug);
    const needed = Math.max(0, wanted - owned);
    m.perLegend.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    rows.push({ ...m, defaultWanted, wanted, owned, needed });
  }
  rows.sort(
    (a, b) =>
      b.wanted - a.wanted || b.needed - a.needed || a.name.localeCompare(b.name)
  );
  return { rows, filteredCounts };
}

function renderRow(row) {
  const link = row.url
    ? `<a href="${row.url}" data-img="${escapeHtml(row.img || "")}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a>${rarityHtml(row.rarity)}`
    : `<span data-img="${escapeHtml(row.img || "")}">${escapeHtml(row.name)}</span>${rarityHtml(row.rarity)}`;
  const domains = (row.domains || [])
    .map(
      (d) =>
        `<span class="tag domain-${escapeHtml(String(d).toLowerCase())}" style="text-transform:capitalize">${escapeHtml(d)}</span>`
    )
    .join(" ");
  const typeTag = row.type
    ? ` <span class="tag" style="text-transform:capitalize">${escapeHtml(row.type)}</span>`
    : "";
  const usedIn = row.perLegend
    .map((l) => {
      const split =
        l.sideQty > 0
          ? `${l.mainQty} main + ${l.sideQty} side`
          : `${l.qty} main`;
      const sbBadge =
        l.sideQty > 0 ? `<span class="sb-badge">SB ${l.sideQty}</span>` : "";
      return `<a class="used-chip" href="./?champion=${encodeURIComponent(
        l.slug
      )}" title="${escapeHtml(l.name)} — ${split}">${escapeHtml(
        l.name
      )}<span class="qty">×${l.qty}</span>${sbBadge}</a>`;
    })
    .join("");
  const wOverridden = state.wantedOverride[row.slug] != null;
  // Override styling = user edited (regardless of value); baseline from the
  // imported collection isn't highlighted.
  const oOverridden = Object.prototype.hasOwnProperty.call(state.ownedOverride, row.slug);
  return `
    <tr data-slug="${escapeHtml(row.slug)}" data-set="${escapeHtml(row.set || "?")}">
      <td>${link}${typeTag}</td>
      <td>${domains}</td>
      <td class="used-in">${usedIn}</td>
      <td class="num"><input class="qty-input wanted${wOverridden ? " overridden" : ""}" type="number" min="0" step="1" value="${row.wanted}" data-default="${row.defaultWanted}" /></td>
      <td class="num"><input class="qty-input owned${oOverridden ? " overridden" : ""}" type="number" min="0" step="1" value="${row.owned}" /></td>
      <td class="num needed${row.needed === 0 ? " zero" : ""}">${row.needed}</td>
    </tr>
  `;
}

const tbody = document.querySelector("#cart-table tbody");
const emptyEl = document.getElementById("empty-state");
const summaryEl = document.getElementById("cart-summary");
const pickerCountEl = document.getElementById("picker-count");
const pillsEl = document.getElementById("legend-pills");
const metaEl = document.getElementById("meta");
const percentileInputEl = document.getElementById("percentile-input");
const qtyInputEl = document.getElementById("qty-input");
const sideboardToggleEl = document.getElementById("sideboard-toggle");
const capRaritySelectEl = document.getElementById("cap-rarity-select");

function renderPicker(filteredCounts) {
  pillsEl.innerHTML = champions
    .map((c) => {
      const on = state.selectedLegends.has(c.slug);
      const team = state.legendTeams[c.slug];
      const filt = filteredCounts.get(c.slug);
      const loaded = dataCache.has(c.slug);
      const countText = on
        ? loaded && filt != null
          ? `${filt}`
          : "…"
        : `${c.deck_count}`;
      const teamClass = on && team ? ` team-${team}` : "";
      const teamBadge = on
        ? `<span class="team-badge ${team ? `team-${team}` : "team-none"}" data-team-control title="Click to cycle — / A / B">${team || "—"}</span>`
        : "";
      return `<button type="button" class="legend-pill${on ? " on" : ""}${teamClass}" data-slug="${escapeHtml(c.slug)}" title="${escapeHtml(c.name)} — total ${c.deck_count} decks${filt != null ? `; ${filt} match the filter` : ""}">${escapeHtml(c.name)} <span class="deck-count">${countText}</span>${teamBadge}</button>`;
    })
    .join("");
  const teamCounts = { A: 0, B: 0 };
  for (const slug of state.selectedLegends) {
    const t = state.legendTeams[slug];
    if (t === "A" || t === "B") teamCounts[t]++;
  }
  const soloCount = state.selectedLegends.size - teamCounts.A - teamCounts.B;
  const parts = [];
  if (teamCounts.A) parts.push(`Team A ${teamCounts.A}`);
  if (teamCounts.B) parts.push(`Team B ${teamCounts.B}`);
  if (soloCount) parts.push(`solo ${soloCount}`);
  pickerCountEl.textContent =
    state.selectedLegends.size === 0
      ? "0 selected"
      : `${state.selectedLegends.size} selected · ${parts.join(" · ")}`;
}

function render() {
  metaEl.innerHTML = `${champions.length} legends cached`;
  percentileInputEl.value = state.percentile;
  qtyInputEl.value = state.qtyTarget;
  sideboardToggleEl.checked = state.includeSideboard;
  capRaritySelectEl.value = state.capRarity || "";

  if (state.selectedLegends.size === 0) {
    renderPicker(new Map());
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "Pick at least one legend above to build your cart.";
    summaryEl.textContent = "";
    return;
  }

  // If selected legends haven't been loaded yet, show a loading state.
  const missing = [...state.selectedLegends].filter((s) => !dataCache.has(s));
  if (missing.length) {
    renderPicker(new Map());
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = `Loading data for ${missing.length} legend${missing.length === 1 ? "" : "s"}…`;
    summaryEl.textContent = "";
    return;
  }

  const { rows, filteredCounts } = buildRows();
  renderPicker(filteredCounts);
  emptyEl.hidden = rows.length > 0;
  tbody.innerHTML = rows.map(renderRow).join("");
  refreshSummary();
}

async function recompute() {
  await ensureDataLoaded([...state.selectedLegends]);
  render();
}

function recomputeRow(tr) {
  const slug = tr.dataset.slug;
  const wantedEl = tr.querySelector(".qty-input.wanted");
  const ownedEl = tr.querySelector(".qty-input.owned");
  const neededEl = tr.querySelector(".needed");

  let wanted = parseInt(wantedEl.value, 10);
  if (!Number.isFinite(wanted) || wanted < 0) wanted = 0;
  let owned = parseInt(ownedEl.value, 10);
  if (!Number.isFinite(owned) || owned < 0) owned = 0;
  const needed = Math.max(0, wanted - owned);
  neededEl.textContent = needed;
  neededEl.classList.toggle("zero", needed === 0);

  const defaultWanted = parseInt(wantedEl.dataset.default, 10);
  const wOverridden = Number.isFinite(defaultWanted) && wanted !== defaultWanted;
  wantedEl.classList.toggle("overridden", wOverridden);
  if (wOverridden) state.wantedOverride[slug] = wanted;
  else delete state.wantedOverride[slug];
  writeJSON(LS.wanted, state.wantedOverride);

  // Owned override = anything that differs from the imported baseline.
  // If the user types the same value as their baseline, drop the override so
  // future collection imports stay in sync naturally.
  const baseline = defaultOwned[slug] || 0;
  if (owned === baseline) {
    delete state.ownedOverride[slug];
    ownedEl.classList.remove("overridden");
  } else {
    state.ownedOverride[slug] = owned;
    ownedEl.classList.add("overridden");
  }
  writeJSON(LS.owned, state.ownedOverride);

  refreshSummary();
}

function refreshSummary() {
  const rows = [...tbody.querySelectorAll("tr")];
  let totalNeeded = 0;
  let distinct = 0;
  const setCounts = new Map();
  for (const tr of rows) {
    const need = parseInt(tr.querySelector(".needed")?.textContent || "0", 10);
    if (need <= 0) continue;
    totalNeeded += need;
    distinct += 1;
    const s = tr.dataset.set || "?";
    setCounts.set(s, (setCounts.get(s) || 0) + need);
  }
  const setBreakdown = [...setCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([s, c]) => `${s} ${c}`)
    .join(" · ");
  const tail = setBreakdown ? ` · ${setBreakdown}` : "";
  summaryEl.textContent = `${rows.length} cards · ${totalNeeded} copies needed across ${distinct} cards${tail}`;
}

function attachHandlers() {
  pillsEl.addEventListener("click", async (ev) => {
    const teamCtrl = ev.target.closest("[data-team-control]");
    const btn = ev.target.closest(".legend-pill");
    if (!btn) return;
    const slug = btn.dataset.slug;
    if (teamCtrl) {
      // Click on the team badge cycles —/A/B without toggling selection.
      ev.preventDefault();
      ev.stopPropagation();
      const cur = state.legendTeams[slug];
      const next = !cur ? "A" : cur === "A" ? "B" : null;
      if (next) state.legendTeams[slug] = next;
      else delete state.legendTeams[slug];
      writeJSON(LS.legendTeams, state.legendTeams);
      render();
      return;
    }
    if (state.selectedLegends.has(slug)) state.selectedLegends.delete(slug);
    else state.selectedLegends.add(slug);
    writeJSON(LS.legends, [...state.selectedLegends]);
    await recompute();
  });

  document.getElementById("defaults-btn").addEventListener("click", async () => {
    state.selectedLegends = new Set(
      DEFAULT_LEGENDS.filter((s) => championBySlug.has(s))
    );
    writeJSON(LS.legends, [...state.selectedLegends]);
    await recompute();
  });
  document.getElementById("all-btn").addEventListener("click", async () => {
    state.selectedLegends = new Set(champions.map((c) => c.slug));
    writeJSON(LS.legends, [...state.selectedLegends]);
    await recompute();
  });
  document.getElementById("none-btn").addEventListener("click", () => {
    state.selectedLegends.clear();
    writeJSON(LS.legends, [...state.selectedLegends]);
    render();
  });

  percentileInputEl.addEventListener("input", () => {
    let v = parseInt(percentileInputEl.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 100) v = 100;
    state.percentile = v;
    writeJSON(LS.percentile, v);
    render();
  });
  qtyInputEl.addEventListener("input", () => {
    let v = parseInt(qtyInputEl.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 500) v = 500;
    state.qtyTarget = v;
    writeJSON(LS.qty, v);
    render();
  });
  sideboardToggleEl.addEventListener("change", () => {
    state.includeSideboard = sideboardToggleEl.checked;
    writeJSON(LS.includeSideboard, state.includeSideboard);
    render();
  });
  capRaritySelectEl.addEventListener("change", () => {
    state.capRarity = capRaritySelectEl.value || "";
    writeJSON(LS.capRarity, state.capRarity);
    render();
  });

  tbody.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr[data-slug]");
    if (!tr) return;
    if (!ev.target.classList.contains("qty-input")) return;
    recomputeRow(tr);
  });

  document.getElementById("cap-3-btn").addEventListener("click", () => {
    for (const tr of tbody.querySelectorAll("tr")) {
      const wantedEl = tr.querySelector(".qty-input.wanted");
      const cur = parseInt(wantedEl.value, 10) || 0;
      if (cur > 3) {
        wantedEl.value = 3;
        recomputeRow(tr);
      }
    }
  });

  document.getElementById("reset-overrides-btn").addEventListener("click", () => {
    state.ownedOverride = {};
    state.wantedOverride = {};
    writeJSON(LS.owned, state.ownedOverride);
    writeJSON(LS.wanted, state.wantedOverride);
    render();
  });

  const copyBtn = document.getElementById("copy-cart-btn");
  copyBtn.addEventListener("click", async () => {
    const text = formatPlaintext();
    const flash = (msg, ok = true) => {
      copyBtn.textContent = msg;
      copyBtn.classList.toggle("copied", ok);
      window.clearTimeout(copyBtn._t);
      copyBtn._t = window.setTimeout(() => {
        copyBtn.textContent = "Copy needed cards";
        copyBtn.classList.remove("copied");
      }, 1500);
    };
    if (!text) { flash("Nothing to copy", false); return; }
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
      flash(ok ? "Copied!" : "Copy failed", ok);
    }
  });
}

function formatPlaintext() {
  const lines = [];
  for (const tr of tbody.querySelectorAll("tr")) {
    const needed = parseInt(tr.querySelector(".needed").textContent, 10) || 0;
    if (needed <= 0) continue;
    const nameEl = tr.querySelector("td:first-child a, td:first-child span");
    const name = tcgplayerName((nameEl?.textContent || "").trim());
    if (!name) continue;
    lines.push(`${needed} ${name}`);
  }
  return lines.join("\n");
}

// Hover thumbnail
const cardThumbEl = document.getElementById("card-thumb");
let thumbTimer = 0;
const THUMB_W = 260;
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
    if (!el || !el.dataset.img) return;
    clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => {
      if (cardThumbEl.src !== el.dataset.img) cardThumbEl.src = el.dataset.img;
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

attachHandlers();
attachHoverThumb();
render();
recompute();
