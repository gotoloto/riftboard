"use strict";

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
  const legends = card.legends_above_10pct || [];
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
    : `<span class="muted">no legend &gt; 10%</span>`;
  return `
    <tr>
      <td class="rank">${index + 1}</td>
      <td class="name">${nameLink} ${rarityGlyph(card.rarity)}</td>
      <td class="type">${type}</td>
      <td class="total">${card.total_decks_including.toLocaleString()}</td>
      <td class="legends">${legendChips}</td>
    </tr>
  `;
}

function renderSection(rarity, cards) {
  const labels = { common: "commons", uncommon: "uncommons", rare: "rares" };
  return `
    <section class="rarity-section" id="${rarity}-section">
      <h2>${rarityGlyph(rarity)} Top ${cards.length} ${labels[rarity]}</h2>
      <div class="table-scroll">
        <table class="staples">
          <thead>
            <tr>
              <th>#</th>
              <th>Card</th>
              <th>Type</th>
              <th class="total">Total decks</th>
              <th>Legends where >10% inclusion</th>
            </tr>
          </thead>
          <tbody>
            ${cards.map(renderRow).join("")}
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

function load() {
  const data = window.__STAPLES__;
  const meta = document.getElementById("meta");
  const root = document.getElementById("rarities");
  if (!data) {
    meta.textContent = "staples.js missing. Run `python3 scrape.py --staples`.";
    return;
  }
  const ts = data.scraped_at ? new Date(data.scraped_at).toLocaleString() : "";
  meta.innerHTML = `${data.total_decks.toLocaleString()} decks across ${data.total_legends} legends · top ${data.top_per_rarity} per rarity · generated ${ts}`;

  root.innerHTML =
    renderSection("rare", data.rarities.rare || []) +
    renderSection("uncommon", data.rarities.uncommon || []) +
    renderSection("common", data.rarities.common || []);

  attachHoverThumb();
}

load();
