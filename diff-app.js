"use strict";

// Fallback prices (USD) when the catalog has no TCGplayer market price for
// a slug — mirrors closeness-app.js. Lets brand-new uncatalogued cards
// still contribute a sensible dollar value to the missing-cost total.
const RARITY_FALLBACK_PRICE = {
  common: 0.25,
  uncommon: 0.75,
  rare: 4,
  epic: 30,
  showcase: 30,
};

function priceFor(slug, rarity) {
  const p = (catalog[slug] || {}).price;
  if (typeof p === "number" && p > 0) return { dollars: p, source: "catalog" };
  const fb = RARITY_FALLBACK_PRICE[(rarity || "").toLowerCase()] ?? 1;
  return { dollars: fb, source: "fallback" };
}

function fmtUSD(n) {
  if (n >= 100) return "$" + n.toFixed(0);
  if (n >= 10) return "$" + n.toFixed(1);
  return "$" + n.toFixed(2);
}

const RARITY_WEIGHT = {
  common: 1,
  uncommon: 2.333,
  rare: 3.5,
  epic: 28,
  showcase: 28,
};

// RARITY, escapeHtml, rarityGlyph, attachHoverThumb all live in utils.js
// (loaded by diff.html before this file).

// `let` so collection-sheet.js can swap in fresh values after its async
// fetch resolves (collection:updated listener at the bottom).
let ownedRaw = window.__OWNED_DEFAULTS__ || {};
let enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
const catalog = window.__CATALOG__ || {};
const lookup = window.__DECK_LOOKUP__;

const LS_INCLUDE_ENROUTE = "diff:includeEnRoute";
let includeEnRoute = false;
try {
  includeEnRoute = JSON.parse(localStorage.getItem(LS_INCLUDE_ENROUTE) || "false");
} catch (_) {}

function ownedFor(slug) {
  const o = ownedRaw[slug] || 0;
  const er = includeEnRoute ? (enRoute[slug] || 0) : 0;
  const locked = lockedTotal(slug, "diff");
  return Math.max(0, o + er - locked);
}

const metaEl = document.getElementById("meta");
const inputEl = document.getElementById("deck-url");
const findBtn = document.getElementById("find-btn");
const resultEl = document.getElementById("result");
const deckInfoEl = document.getElementById("deck-info");
const summaryEl = document.getElementById("diff-summary");
const errorEl = document.getElementById("error-state");
const tbody = document.querySelector("#diff-table tbody");
const emptyEl = document.getElementById("empty-state");
const copyBtn = document.getElementById("copy-btn");

if (!lookup) {
  metaEl.textContent = "deck-lookup.js missing. Run `python3 scrape.py --deck-lookup`.";
} else {
  metaEl.innerHTML = `${lookup.deck_count.toLocaleString()} cached decks · ${Object.keys(catalog).length.toLocaleString()} known cards · collection: ${Object.keys(ownedRaw).length.toLocaleString()} distinct cards owned`;
}

const enrouteToggleEl = document.getElementById("include-enroute");
const enrouteInfoEl = document.getElementById("enroute-info");
const enRouteDistinct = Object.keys(enRoute).length;
const enRouteTotal = Object.values(enRoute).reduce((s, v) => s + v, 0);
enrouteToggleEl.checked = includeEnRoute;
enrouteToggleEl.disabled = enRouteDistinct === 0;
enrouteInfoEl.textContent = enRouteDistinct
  ? `(${enRouteDistinct} distinct · ${enRouteTotal} copies)`
  : "(none in collection)";
enrouteToggleEl.addEventListener("change", () => {
  includeEnRoute = enrouteToggleEl.checked;
  try {
    localStorage.setItem(LS_INCLUDE_ENROUTE, JSON.stringify(includeEnRoute));
  } catch (_) {}
  // If a diff is already on screen, re-run it.
  if (!resultEl.hidden) runDiff();
});

function normalizeDeckKey(input) {
  let k = (input || "").trim();
  // Strip query/fragment
  k = k.replace(/[?#].*$/, "");
  // Drop trailing slash
  k = k.replace(/\/+$/, "");
  // Strip the known URL prefix (with or without protocol)
  k = k.replace(/^https?:\/\/(?:www\.)?riftdecks\.com\/riftbound-metagame\//i, "");
  k = k.replace(/^\/+/, "");
  return k;
}

function findDeck(input) {
  const key = normalizeDeckKey(input);
  const d = (lookup && lookup.decks && lookup.decks[key]) || null;
  return d ? { key, deck: d } : null;
}

function showError(html) {
  errorEl.innerHTML = html;
  errorEl.hidden = false;
  resultEl.hidden = true;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.innerHTML = "";
}

function deckTitle(d) {
  const t = (d.t || "").replace(/\s*\|\s*riftDecks\.com$/i, "").trim();
  return t || "(untitled deck)";
}

function setFromImg(img) {
  if (!img) return null;
  const m = String(img).match(/\/img\/cards\/[^/]+\/+([A-Z][A-Z0-9]+)\//);
  return m ? m[1] : null;
}

function compute(key, d) {
  const slugs = lookup.slugs;
  // Sum mainboard + sideboard so the user can build the whole 56+sb pile.
  const need = new Map();
  for (const [sid, qty] of d.c || []) {
    const slug = slugs[sid];
    need.set(slug, (need.get(slug) || 0) + qty);
  }
  for (const [sid, qty] of d.s || []) {
    const slug = slugs[sid];
    need.set(slug, (need.get(slug) || 0) + qty);
  }

  const rows = [];
  let points = 0;
  let totalCost = 0;
  let totalMissing = 0;
  let unpricedCopies = 0;
  const missingByRarity = {};
  for (const [slug, n] of need) {
    const have = ownedFor(slug);
    const miss = Math.max(0, n - have);
    if (miss <= 0) continue;
    const meta = catalog[slug] || {};
    const rar = (meta.rarity || "").toLowerCase();
    const w = RARITY_WEIGHT[rar] ?? 1;
    const pts = miss * w;
    const { dollars: unitPrice, source: priceSource } = priceFor(slug, rar);
    const lineCost = miss * unitPrice;
    points += pts;
    totalCost += lineCost;
    totalMissing += miss;
    if (priceSource === "fallback") unpricedCopies += miss;
    missingByRarity[rar || "?"] = (missingByRarity[rar || "?"] || 0) + miss;
    rows.push({
      slug,
      name: meta.name || slug,
      type: (meta.type || "").toLowerCase(),
      rarity: rar,
      set: meta.set || setFromImg(meta.image_url),
      img: meta.image_url,
      url: meta.url,
      need: n,
      have,
      missing: miss,
      pts,
      unitPrice,
      priceSource,
      lineCost,
    });
  }
  // Sort by line cost descending — biggest dollar items at the top, so
  // the user can decide what to prioritize buying. Ties: most missing
  // copies first, then name.
  rows.sort(
    (a, b) =>
      b.lineCost - a.lineCost ||
      b.missing - a.missing ||
      a.name.localeCompare(b.name)
  );
  return { rows, points, totalCost, totalMissing, missingByRarity, unpricedCopies };
}

function rarityChips(byRar) {
  const order = ["common", "uncommon", "rare", "epic", "showcase"];
  const parts = [];
  for (const r of order) {
    if (byRar[r])
      parts.push(`<span class="rarity-tag rarity-${r}">${r} ${byRar[r]}</span>`);
  }
  for (const r of Object.keys(byRar)) {
    if (!order.includes(r))
      parts.push(`<span class="rarity-tag">${escapeHtml(r)} ${byRar[r]}</span>`);
  }
  return parts.join(" ");
}

function renderInfo(key, d) {
  const url = (lookup.url_prefix || "") + key;
  const title = deckTitle(d);
  const finish =
    d.rk != null && d.pl != null
      ? `${d.rk} of ${d.pl}${d.fp != null ? ` (${d.fp.toFixed(1)}%)` : ""}`
      : "—";
  const date = d.dt || "—";
  deckInfoEl.innerHTML = `
    <div class="title">${escapeHtml(title)}</div>
    <div class="meta-line">${escapeHtml(d.ln || "")} · ${finish} · ${date} · <a href="${url}" target="_blank" rel="noopener">view on riftdecks ↗</a></div>
  `;
}

function renderRow(r) {
  const img = r.img ? ` data-img="${escapeHtml(r.img)}"` : "";
  const link = r.url
    ? `<a href="${r.url}"${img} target="_blank" rel="noopener">${escapeHtml(r.name)}</a> ${rarityGlyph(r.rarity)}`
    : `<span${img}>${escapeHtml(r.name)}</span> ${rarityGlyph(r.rarity)}`;
  const typeTag = r.type
    ? `<span class="tag" style="text-transform:capitalize">${escapeHtml(r.type)}</span>`
    : "";
  const costTitle =
    r.priceSource === "fallback"
      ? `Rarity-based estimate (no TCGplayer price cached) · ${fmtUSD(r.unitPrice)} × ${r.missing}`
      : `TCGplayer market · ${fmtUSD(r.unitPrice)} × ${r.missing}`;
  const costCls = r.priceSource === "fallback" ? "num cost muted" : "num cost";
  return `
    <tr>
      <td>${link}</td>
      <td>${typeTag}</td>
      <td>${escapeHtml(r.set || "")}</td>
      <td class="num">${r.need}</td>
      <td class="num">${r.have}</td>
      <td class="num missing">${r.missing}</td>
      <td class="${costCls}" title="${escapeHtml(costTitle)}">${fmtUSD(r.lineCost)}</td>
    </tr>`;
}

function runDiff() {
  clearError();
  copyBtn.classList.remove("copied");
  copyBtn.textContent = "Copy missing (TCGplayer)";

  const input = inputEl.value.trim();
  if (!input) {
    showError("Paste a riftdecks deck URL first.");
    return;
  }
  const hit = findDeck(input);
  if (!hit) {
    const key = normalizeDeckKey(input);
    showError(
      `No cached deck for <code>${escapeHtml(key)}</code>. ` +
        "We only cache decks under the 40 tracked legends — see <a href='closeness.html'>/closeness</a> for the list."
    );
    return;
  }
  const { key, deck } = hit;
  const { rows, totalCost, totalMissing, missingByRarity, unpricedCopies } = compute(key, deck);
  renderInfo(key, deck);
  if (rows.length === 0) {
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.innerHTML = `<strong>You can build this deck.</strong> Nothing missing.`;
    summaryEl.innerHTML = `0 missing · $0`;
  } else {
    emptyEl.hidden = true;
    tbody.innerHTML = rows.map(renderRow).join("");
    const estTag = unpricedCopies > 0
      ? ` <span class="muted" title="${unpricedCopies} missing copy/ies have no TCGplayer price cached; rarity fallback used">(~${unpricedCopies} est.)</span>`
      : "";
    summaryEl.innerHTML = `${totalMissing} missing copies across ${rows.length} cards · <strong>${fmtUSD(totalCost)}</strong> to complete${estTag} · ${rarityChips(missingByRarity)}`;
  }
  resultEl.hidden = false;
}

function formatPlaintext() {
  const lines = [];
  for (const tr of tbody.querySelectorAll("tr")) {
    const missing = parseInt(tr.cells[5].textContent, 10) || 0;
    if (missing <= 0) continue;
    const nameEl = tr.cells[0].querySelector("a, span");
    const raw = (nameEl?.textContent || "").trim();
    const name = tcgplayerName(raw);
    if (!name) continue;
    lines.push(`${missing} ${name}`);
  }
  return lines.join("\n");
}

findBtn.addEventListener("click", runDiff);
inputEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") runDiff();
});

window.addEventListener("collection:updated", () => {
  ownedRaw = window.__OWNED_DEFAULTS__ || {};
  enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
  // Refresh the en-route count badge in the toggle row.
  const newDistinct = Object.keys(enRoute).length;
  const newTotal = Object.values(enRoute).reduce((s, v) => s + v, 0);
  enrouteToggleEl.disabled = newDistinct === 0;
  enrouteInfoEl.textContent = newDistinct
    ? `(${newDistinct} distinct · ${newTotal} copies)`
    : "(none in collection)";
  if (lookup) {
    metaEl.innerHTML = `${lookup.deck_count.toLocaleString()} cached decks · ${Object.keys(catalog).length.toLocaleString()} known cards · collection: ${Object.keys(ownedRaw).length.toLocaleString()} distinct cards owned`;
  }
  ensureLockToggles(document.getElementById("lock-toggles"), "diff", () => {
    if (!resultEl.hidden) runDiff();
  });
  if (!resultEl.hidden) runDiff();
});

ensureLockToggles(document.getElementById("lock-toggles"), "diff", () => {
  if (!resultEl.hidden) runDiff();
});

copyBtn.addEventListener("click", async () => {
  const text = formatPlaintext();
  const flash = (msg, ok = true) => {
    copyBtn.textContent = msg;
    copyBtn.classList.toggle("copied", ok);
    window.clearTimeout(copyBtn._t);
    copyBtn._t = window.setTimeout(() => {
      copyBtn.textContent = "Copy missing (TCGplayer)";
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

attachHoverThumb();

// Auto-run if a URL is pasted via querystring (?url=…)
const params = new URLSearchParams(location.search);
const presetUrl = params.get("url") || params.get("deck");
if (presetUrl) {
  inputEl.value = presetUrl;
  runDiff();
}
