"use strict";

// Fallback "estimated price" per rarity for cards where cards-catalog.json
// has no listed TCGplayer market price (rare — usually only brand-new
// cards not yet on the market). Used so a missing-price card doesn't
// silently get treated as $0. Numbers are deliberately conservative
// medians from the current Riftbound market.
const RARITY_FALLBACK_PRICE = {
  common: 0.25,
  uncommon: 0.75,
  rare: 4,
  epic: 30,
  showcase: 30,
};

// escapeHtml lives in utils.js (loaded by closeness.html before this file).

// `let` so collection-sheet.js can swap in fresh values after its async
// fetch resolves (see collection:updated listener at the bottom).
let ownedRaw = window.__OWNED_DEFAULTS__ || {};
let enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
const data = window.__CLOSENESS_DATA__;
const catalog = window.__CATALOG__ || {};
const tbody = document.querySelector("#closeness-table tbody");
const metaEl = document.getElementById("meta");
const enrouteEl = document.getElementById("include-enroute");
const enrouteInfoEl = document.getElementById("enroute-info");

const LS_KEY = "closeness:includeEnRoute";
let includeEnRoute = false;
try {
  includeEnRoute = JSON.parse(localStorage.getItem(LS_KEY) || "false");
} catch (_) {}

function effectiveOwned() {
  // owned + (en-route if toggled) - sum(active-lock-tab quantities)
  const merged = { ...ownedRaw };
  if (includeEnRoute) {
    for (const [slug, q] of Object.entries(enRoute)) {
      merged[slug] = (merged[slug] || 0) + q;
    }
  }
  for (const slug of Object.keys(merged)) {
    const locked = lockedTotal(slug, "closeness");
    if (locked) merged[slug] = Math.max(0, merged[slug] - locked);
  }
  return merged;
}

let owned = effectiveOwned();

function priceFor(slug, rarity) {
  // Real TCGplayer market price wins; fall back to a rarity heuristic so
  // brand-new uncatalogued cards still contribute something to the cost.
  // Runes effectively never need to be bought (owned: 99) so they don't
  // matter here, but if one ever slipped through it'd use the fallback.
  const p = catalog[slug]?.price;
  if (typeof p === "number" && p > 0) {
    return { dollars: p, source: "catalog" };
  }
  const fallback = RARITY_FALLBACK_PRICE[(rarity || "").toLowerCase()] ?? 1;
  return { dollars: fallback, source: "fallback" };
}

function scoreLegend(L) {
  const missingCards = [];
  const missingByRarity = {};
  let cost = 0;
  let totalMissing = 0;
  let unpriced = 0;
  for (const c of L.composite) {
    const need = c.qty;
    const have = owned[c.slug] || 0;
    const short = Math.max(0, need - have);
    if (short <= 0) continue;
    const { dollars, source } = priceFor(c.slug, c.rarity);
    const subCost = short * dollars;
    cost += subCost;
    totalMissing += short;
    if (source === "fallback") unpriced += short;
    const rar = (c.rarity || "unknown").toLowerCase();
    missingByRarity[rar] = (missingByRarity[rar] || 0) + short;
    missingCards.push({
      slug: c.slug,
      name: c.name,
      need,
      have,
      short,
      rarity: rar,
      type: c.type,
      unitPrice: dollars,
      priceSource: source,
      subCost,
    });
  }
  // Order missing: most-expensive-line first, then by short qty desc, then name
  missingCards.sort(
    (a, b) => b.subCost - a.subCost || b.short - a.short || a.name.localeCompare(b.name)
  );
  return { cost, totalMissing, missingByRarity, missingCards, unpriced };
}

function rarityChips(byRar) {
  const order = ["common", "uncommon", "rare", "epic", "showcase"];
  const seen = new Set();
  const parts = [];
  for (const r of order) {
    if (byRar[r]) {
      parts.push(`<span class="rarity-tag rarity-${r}">${r} ${byRar[r]}</span>`);
      seen.add(r);
    }
  }
  // Unknown / other rarities
  for (const r of Object.keys(byRar)) {
    if (!seen.has(r)) {
      parts.push(`<span class="rarity-tag">${escapeHtml(r)} ${byRar[r]}</span>`);
    }
  }
  return parts.join(" ");
}

function fmtUSD(n) {
  if (n >= 100) return "$" + n.toFixed(0);
  if (n >= 10) return "$" + n.toFixed(1);
  return "$" + n.toFixed(2);
}

function renderMissingList(missing) {
  if (!missing.length) {
    return `<p class="muted">Nothing missing — this deck is buildable from your collection.</p>`;
  }
  const items = missing
    .map((m) => {
      const priceLabel = `${fmtUSD(m.unitPrice)} × ${m.short} = ${fmtUSD(m.subCost)}`;
      const priceCls = m.priceSource === "fallback" ? "pts muted" : "pts";
      const priceTitle =
        m.priceSource === "fallback"
          ? "Estimated from rarity (no TCGplayer price cached)"
          : "TCGplayer market price (cached from riftdecks)";
      const imgUrl = catalog[m.slug]?.image_url;
      const imgAttr = imgUrl ? ` data-img="${escapeHtml(imgUrl)}"` : "";
      return `<li data-slug="${escapeHtml(m.slug)}">
        <span class="qty">${m.short} of ${m.need}</span>
        <span class="rarity-tag rarity-${escapeHtml(m.rarity)}">${escapeHtml(m.rarity)}</span>
        <span class="name"${imgAttr}>${escapeHtml(m.name)}</span>
        <span class="${priceCls}" title="${escapeHtml(priceTitle)}">${priceLabel}</span>
      </li>`;
    })
    .join("");
  return `<ul class="missing-list">${items}</ul>`;
}

let currentRows = [];

function render() {
  if (!data) {
    metaEl.textContent =
      "closeness-data.js missing. Run `python3 scrape.py --closeness`.";
    return;
  }
  const rows = data.legends
    .map((L) => ({ legend: L, score: scoreLegend(L) }))
    .sort(
      (a, b) =>
        a.score.cost - b.score.cost ||
        a.legend.name.localeCompare(b.legend.name)
    );
  currentRows = rows;

  const ts = data.scraped_at
    ? new Date(data.scraped_at).toLocaleString()
    : "—";
  const ownedDistinct = Object.keys(owned).length;
  const ownedTotal = Object.values(owned).reduce((s, v) => s + v, 0);
  const enRouteDistinct = Object.keys(enRoute).length;
  const enRouteTotal = Object.values(enRoute).reduce((s, v) => s + v, 0);
  metaEl.innerHTML = `${rows.length} legends · composite at top-${data.percentile}% finishers · collection: ${ownedDistinct.toLocaleString()} distinct cards, ${ownedTotal.toLocaleString()} copies${includeEnRoute && enRouteDistinct ? " <em>(incl. en route)</em>" : ""} · generated ${ts}`;
  enrouteInfoEl.textContent = enRouteDistinct
    ? `(${enRouteDistinct} distinct · ${enRouteTotal} copies)`
    : "(none in collection)";
  enrouteEl.checked = includeEnRoute;
  enrouteEl.disabled = enRouteDistinct === 0;

  tbody.innerHTML = rows
    .map((r, i) => {
      const cost = r.score.cost;
      const fmtCost = cost === 0 ? "$0" : fmtUSD(cost);
      const fbTag =
        r.score.unpriced > 0
          ? ` <span class="muted" title="${r.score.unpriced} missing copy/ies have no TCGplayer price; rarity fallback used">(~${r.score.unpriced} est.)</span>`
          : "";
      return `
      <tr class="legend-row" data-slug="${escapeHtml(r.legend.slug)}">
        <td class="rank">${i + 1}</td>
        <td>${escapeHtml(r.legend.name)}</td>
        <td class="num distance">${fmtCost}${fbTag}</td>
        <td class="num">${r.score.totalMissing}</td>
        <td>${rarityChips(r.score.missingByRarity)}</td>
      </tr>`;
    })
    .join("");

}

// One click handler, attached once. Reads from `currentRows` so each render
// stays in sync without stacking duplicate listeners.
tbody.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr.legend-row");
    if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("expanded-row")) {
      next.remove();
      return;
    }
    // Close any other open expansion
    tbody.querySelectorAll("tr.expanded-row").forEach((el) => el.remove());
    const slug = tr.dataset.slug;
    const row = currentRows.find((r) => r.legend.slug === slug);
    if (!row) return;
    const expanded = document.createElement("tr");
    expanded.className = "expanded-row";
    expanded.innerHTML = `<td colspan="5">${renderMissingList(row.score.missingCards)}</td>`;
    tr.after(expanded);
});

enrouteEl.addEventListener("change", () => {
  includeEnRoute = enrouteEl.checked;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(includeEnRoute));
  } catch (_) {}
  owned = effectiveOwned();
  render();
});

window.addEventListener("collection:updated", () => {
  ownedRaw = window.__OWNED_DEFAULTS__ || {};
  enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
  ensureLockToggles(document.getElementById("lock-toggles"), "closeness", () => {
    owned = effectiveOwned();
    render();
  });
  owned = effectiveOwned();
  render();
});

ensureLockToggles(document.getElementById("lock-toggles"), "closeness", () => {
  owned = effectiveOwned();
  render();
});
render();
// Delegated hover preview — attaches to document.body once, so dynamically
// inserted expanded-rows pick it up automatically. Battlefields rotate
// (catalog is loaded on this page so type detection works).
attachHoverThumb();
