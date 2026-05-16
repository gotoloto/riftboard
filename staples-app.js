"use strict";

// RARITY, escapeHtml, rarityGlyph, attachHoverThumb all live in utils.js
// (loaded by staples.html before this file).

const PLAYSET = 3;

// `let` so collection-sheet.js can swap in fresh values after its async
// fetch resolves (see collection:updated listener at the bottom).
let ownedRaw = window.__OWNED_DEFAULTS__ || {};
let enRoute = window.__EN_ROUTE_DEFAULTS__ || {};

const LS_INCLUDE_ENROUTE = "staples:includeEnRoute";
const LS_HIDE_COMPLETE = "staples:hideComplete";

let includeEnRoute = false;
let hideComplete = false;
try {
  includeEnRoute = JSON.parse(localStorage.getItem(LS_INCLUDE_ENROUTE) || "false");
} catch (_) {}
try {
  hideComplete = JSON.parse(localStorage.getItem(LS_HIDE_COMPLETE) || "false");
} catch (_) {}

function ownedFor(slug) {
  const o = ownedRaw[slug] || 0;
  const er = includeEnRoute ? (enRoute[slug] || 0) : 0;
  const locked = lockedTotal(slug, "staples");
  return Math.max(0, o + er - locked);
}

function missingFor(slug) {
  return Math.max(0, PLAYSET - ownedFor(slug));
}

function renderRow(card, index) {
  const img = card.img ? ` data-img="${escapeHtml(card.img)}"` : "";
  const nameLink = card.url
    ? `<a href="${card.url}"${img} target="_blank" rel="noopener">${escapeHtml(card.name)}</a>`
    : `<span${img}>${escapeHtml(card.name)}</span>`;
  const type = card.type
    ? `<span class="tag" style="text-transform:capitalize">${escapeHtml(card.type)}</span>`
    : "";
  const domains = (card.domains || [])
    .map(
      (d) =>
        `<span class="tag domain-${escapeHtml(String(d).toLowerCase())}" style="text-transform:capitalize">${escapeHtml(d)}</span>`
    )
    .join(" ");
  const legends = card.legends_above_50pct || [];
  const chipClass = legends.length === 1 ? "legend-chip solo" : "legend-chip";
  const legendChips = legends.length
    ? legends
        .map(
          (l) =>
            `<a class="${chipClass}" href="./?champion=${encodeURIComponent(
              l.slug
            )}" title="${escapeHtml(l.name)} — ${l.decks_including} decks">${escapeHtml(
              l.name
            )}<span class="pct">${l.inclusion_pct.toFixed(1)}%</span></a>`
        )
        .join("")
    : `<span class="muted">no legend &gt; 50%</span>`;
  const owned = ownedFor(card.slug);
  const missing = missingFor(card.slug);
  const missingCls = missing > 0 ? "missing missing-pos" : "missing";
  return `
    <tr>
      <td class="rank">${index + 1}</td>
      <td class="name">${nameLink} ${rarityGlyph(card.rarity)}</td>
      <td class="type">${type}</td>
      <td class="domains">${domains}</td>
      <td class="total">${card.total_decks_including.toLocaleString()}</td>
      <td class="owned">${owned}</td>
      <td class="${missingCls}">${missing}</td>
      <td class="legends">${legendChips}</td>
    </tr>
  `;
}

function renderSection(rarity, cards) {
  const labels = { common: "commons", uncommon: "uncommons", rare: "rares" };
  const visible = hideComplete
    ? cards.filter((c) => missingFor(c.slug) > 0)
    : cards;
  const hiddenNote =
    hideComplete && visible.length < cards.length
      ? ` <span class="muted">(${cards.length - visible.length} hidden as complete)</span>`
      : "";
  return `
    <section class="rarity-section" id="${rarity}-section">
      <h2>${rarityGlyph(rarity)} Top ${cards.length} ${labels[rarity]}${hiddenNote}</h2>
      <div class="table-scroll">
        <table class="staples">
          <thead>
            <tr>
              <th>#</th>
              <th>Card</th>
              <th>Type</th>
              <th>Domains</th>
              <th class="total">Total decks</th>
              <th class="num">Owned</th>
              <th class="num">Missing</th>
              <th>Legends where >50% inclusion</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(renderRow).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// attachHoverThumb lives in utils.js.

let stapleData = null;

function renderAll() {
  const root = document.getElementById("rarities");
  if (!stapleData) return;
  root.innerHTML =
    renderSection("rare", stapleData.rarities.rare || []) +
    renderSection("uncommon", stapleData.rarities.uncommon || []) +
    renderSection("common", stapleData.rarities.common || []);
}

function updateEnrouteInfo() {
  const info = document.getElementById("enroute-info");
  if (!info) return;
  const totalEnroute = Object.values(enRoute).reduce((a, b) => a + b, 0);
  info.textContent = totalEnroute
    ? `· ${totalEnroute} en-route cards across ${Object.keys(enRoute).length} slugs`
    : "";
}

function load() {
  const data = window.__STAPLES__;
  const meta = document.getElementById("meta");
  if (!data) {
    meta.textContent = "staples.js missing. Run `python3 scrape.py --staples`.";
    return;
  }
  stapleData = data;
  const ts = data.scraped_at ? new Date(data.scraped_at).toLocaleString() : "";
  meta.innerHTML = `${data.total_decks.toLocaleString()} decks across ${data.total_legends} legends · top ${data.top_per_rarity} per rarity · generated ${ts}`;

  const enrouteToggle = document.getElementById("include-enroute");
  const hideToggle = document.getElementById("hide-complete");
  enrouteToggle.checked = includeEnRoute;
  hideToggle.checked = hideComplete;
  updateEnrouteInfo();

  enrouteToggle.addEventListener("change", () => {
    includeEnRoute = enrouteToggle.checked;
    try {
      localStorage.setItem(LS_INCLUDE_ENROUTE, JSON.stringify(includeEnRoute));
    } catch (_) {}
    renderAll();
  });
  hideToggle.addEventListener("change", () => {
    hideComplete = hideToggle.checked;
    try {
      localStorage.setItem(LS_HIDE_COMPLETE, JSON.stringify(hideComplete));
    } catch (_) {}
    renderAll();
  });

  ensureLockToggles(document.getElementById("lock-toggles"), "staples", renderAll);
  renderAll();
  attachHoverThumb();
}

window.addEventListener("collection:updated", () => {
  ownedRaw = window.__OWNED_DEFAULTS__ || {};
  enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
  updateEnrouteInfo();
  ensureLockToggles(document.getElementById("lock-toggles"), "staples", renderAll);
  renderAll();
});

load();
