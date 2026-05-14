"use strict";

const RARITY = {
  common:   { ch: "●", cls: "common" },
  uncommon: { ch: "▲", cls: "uncommon" },
  rare:     { ch: "◆", cls: "rare" },
  epic:     { ch: "⬟", cls: "epic" },
  showcase: { ch: "⬢", cls: "showcase" },
};

const PLAYSET = 3;

const ownedRaw = window.__OWNED_DEFAULTS__ || {};
const enRoute = window.__EN_ROUTE_DEFAULTS__ || {};

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
  return o + (includeEnRoute ? (enRoute[slug] || 0) : 0);
}

function missingFor(slug) {
  return Math.max(0, PLAYSET - ownedFor(slug));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rarityGlyph(rarity) {
  const r = rarity && RARITY[String(rarity).toLowerCase()];
  if (!r) return "";
  return `<span class="rarity rarity-${r.cls}" title="${escapeHtml(rarity)}" aria-hidden="true">${r.ch}</span>`;
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

  renderAll();
  attachHoverThumb();
}

load();
