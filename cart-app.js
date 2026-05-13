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
};

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

function rarityHtml(rarity) {
  const g = rarity && RARITY[String(rarity).toLowerCase()];
  if (!g) return "";
  return ` <span class="rarity rarity-${g.cls}" title="${escapeHtml(rarity)}" aria-hidden="true">${g.ch}</span>`;
}

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

const data = window.__CART_DATA__;
const legendBySlug = new Map(data ? data.legends.map((L) => [L.slug, L]) : []);

const state = {
  selectedLegends: new Set(readJSON(LS.legends, DEFAULT_LEGENDS)),
  ownedOverride: readJSON(LS.owned, {}),
  wantedOverride: readJSON(LS.wanted, {}),
};

// Drop selections referring to legends not in data (e.g. one was removed).
for (const s of [...state.selectedLegends]) {
  if (!legendBySlug.has(s)) state.selectedLegends.delete(s);
}

function persistSelections() {
  writeJSON(LS.legends, [...state.selectedLegends]);
}
function persistOwned() {
  writeJSON(LS.owned, state.ownedOverride);
}
function persistWanted() {
  writeJSON(LS.wanted, state.wantedOverride);
}

function buildRows() {
  const merged = new Map();
  for (const slug of state.selectedLegends) {
    const L = legendBySlug.get(slug);
    if (!L) continue;
    for (const c of L.top_cards) {
      let m = merged.get(c.slug);
      if (!m) {
        m = { ...c, perLegend: [], defaultWanted: 0 };
        merged.set(c.slug, m);
      }
      m.perLegend.push({ slug: L.slug, name: L.name, qty: c.qty });
      m.defaultWanted += c.qty;
    }
  }
  const rows = [];
  for (const m of merged.values()) {
    const wOverride = state.wantedOverride[m.slug];
    const wanted = wOverride != null ? wOverride : m.defaultWanted;
    const owned = state.ownedOverride[m.slug] || 0;
    const needed = Math.max(0, wanted - owned);
    m.perLegend.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    rows.push({ ...m, wanted, owned, needed });
  }
  rows.sort(
    (a, b) =>
      b.needed - a.needed || b.wanted - a.wanted || a.name.localeCompare(b.name)
  );
  return rows;
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
  const usedIn = row.perLegend
    .map(
      (l) =>
        `<a class="used-chip" href="./?champion=${encodeURIComponent(
          l.slug
        )}" title="${escapeHtml(l.name)}">${escapeHtml(l.name)}<span class="qty">×${l.qty}</span></a>`
    )
    .join("");
  const wOverridden = state.wantedOverride[row.slug] != null;
  const oOverridden = (state.ownedOverride[row.slug] || 0) > 0;
  return `
    <tr data-slug="${escapeHtml(row.slug)}">
      <td>${link}</td>
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

function render() {
  if (!data) {
    metaEl.textContent = "cart.js missing. Run `python3 scrape.py --cart`.";
    return;
  }
  const ts = data.scraped_at ? new Date(data.scraped_at).toLocaleString() : "";
  metaEl.innerHTML = `${data.legends.length} legends cached · generated ${ts}`;

  // Render legend pills
  pillsEl.innerHTML = data.legends
    .map((L) => {
      const on = state.selectedLegends.has(L.slug);
      return `<button type="button" class="legend-pill${on ? " on" : ""}" data-slug="${escapeHtml(L.slug)}" title="Top-25% sample: ${L.filtered_deck_count} of ${L.deck_count} decks">${escapeHtml(L.name)} <span class="deck-count">${L.filtered_deck_count}</span></button>`;
    })
    .join("");

  // Build rows
  const rows = buildRows();
  if (state.selectedLegends.size === 0) {
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    summaryEl.textContent = "";
    pickerCountEl.textContent = "0 selected";
    return;
  }
  emptyEl.hidden = rows.length > 0;
  tbody.innerHTML = rows.map(renderRow).join("");

  const totalNeeded = rows.reduce((s, r) => s + r.needed, 0);
  const distinctNeeded = rows.filter((r) => r.needed > 0).length;
  pickerCountEl.textContent = `${state.selectedLegends.size} selected`;
  summaryEl.textContent = `${rows.length} cards · ${totalNeeded} copies needed across ${distinctNeeded} cards`;
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
  persistWanted();

  ownedEl.classList.toggle("overridden", owned > 0);
  if (owned > 0) state.ownedOverride[slug] = owned;
  else delete state.ownedOverride[slug];
  persistOwned();

  refreshSummary();
}

function refreshSummary() {
  const rows = [...tbody.querySelectorAll("tr")];
  let totalNeeded = 0;
  let distinct = 0;
  for (const tr of rows) {
    const need = parseInt(tr.querySelector(".needed")?.textContent || "0", 10);
    if (need > 0) {
      totalNeeded += need;
      distinct += 1;
    }
  }
  summaryEl.textContent = `${rows.length} cards · ${totalNeeded} copies needed across ${distinct} cards`;
}

function attachHandlers() {
  pillsEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".legend-pill");
    if (!btn) return;
    const slug = btn.dataset.slug;
    if (state.selectedLegends.has(slug)) state.selectedLegends.delete(slug);
    else state.selectedLegends.add(slug);
    persistSelections();
    render();
  });

  document.getElementById("defaults-btn").addEventListener("click", () => {
    state.selectedLegends = new Set(DEFAULT_LEGENDS.filter((s) => legendBySlug.has(s)));
    persistSelections();
    render();
  });
  document.getElementById("all-btn").addEventListener("click", () => {
    state.selectedLegends = new Set(data.legends.map((L) => L.slug));
    persistSelections();
    render();
  });
  document.getElementById("none-btn").addEventListener("click", () => {
    state.selectedLegends.clear();
    persistSelections();
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
    persistOwned();
    persistWanted();
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
    if (!text) {
      flash("Nothing to copy", false);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied!");
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
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
    let name = (nameEl?.textContent || "").trim();
    name = name.replace(/,\s*/g, " - ");
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
