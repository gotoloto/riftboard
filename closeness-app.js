"use strict";

const RARITY_WEIGHT = {
  common: 1,
  uncommon: 2.333,
  rare: 3.5,
  epic: 28,
  showcase: 28,
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ownedRaw = window.__OWNED_DEFAULTS__ || {};
const enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
const data = window.__CLOSENESS_DATA__;
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
  if (!includeEnRoute) return ownedRaw;
  const merged = { ...ownedRaw };
  for (const [slug, q] of Object.entries(enRoute)) {
    merged[slug] = (merged[slug] || 0) + q;
  }
  return merged;
}

let owned = effectiveOwned();

function weightFor(rarity) {
  return RARITY_WEIGHT[(rarity || "").toLowerCase()] ?? 1;
}

function scoreLegend(L) {
  const missingCards = [];
  const missingByRarity = {};
  let points = 0;
  let totalMissing = 0;
  for (const c of L.composite) {
    const need = c.qty;
    const have = owned[c.slug] || 0;
    const short = Math.max(0, need - have);
    if (short <= 0) continue;
    const w = weightFor(c.rarity);
    const pts = short * w;
    points += pts;
    totalMissing += short;
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
      pts,
    });
  }
  // Order missing: highest points first, then by short qty desc, then name
  missingCards.sort((a, b) => b.pts - a.pts || b.short - a.short || a.name.localeCompare(b.name));
  return { points, totalMissing, missingByRarity, missingCards };
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

function renderMissingList(missing) {
  if (!missing.length) {
    return `<p class="muted">Nothing missing — this deck is buildable from your collection.</p>`;
  }
  const items = missing
    .map((m) => {
      return `<li>
        <span class="qty">${m.short} of ${m.need}</span>
        <span class="rarity-tag rarity-${escapeHtml(m.rarity)}">${escapeHtml(m.rarity)}</span>
        <span class="name">${escapeHtml(m.name)}</span>
        <span class="pts">${m.pts.toFixed(1)} pts</span>
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
        a.score.points - b.score.points ||
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
      const dist = r.score.points;
      const fmtDist = dist === 0 ? "0" : dist.toFixed(1);
      return `
      <tr class="legend-row" data-slug="${escapeHtml(r.legend.slug)}">
        <td class="rank">${i + 1}</td>
        <td>${escapeHtml(r.legend.name)}</td>
        <td class="num distance">${fmtDist}</td>
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

render();
