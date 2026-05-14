"use strict";

const RARITY_WEIGHT = {
  common: 1,
  uncommon: 2.333,
  rare: 3.5,
  epic: 28,
  showcase: 28,
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

const owned = window.__OWNED_DEFAULTS__ || {};
const catalog = window.__CATALOG__ || {};
const lookup = window.__DECK_LOOKUP__;

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
  metaEl.innerHTML = `${lookup.deck_count.toLocaleString()} cached decks · ${Object.keys(catalog).length.toLocaleString()} known cards · collection: ${Object.keys(owned).length.toLocaleString()} distinct cards owned`;
}

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
  let totalMissing = 0;
  const missingByRarity = {};
  for (const [slug, n] of need) {
    const have = owned[slug] || 0;
    const miss = Math.max(0, n - have);
    if (miss <= 0) continue;
    const meta = catalog[slug] || {};
    const rar = (meta.rarity || "").toLowerCase();
    const w = RARITY_WEIGHT[rar] ?? 1;
    const pts = miss * w;
    points += pts;
    totalMissing += miss;
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
    });
  }
  rows.sort(
    (a, b) =>
      b.pts - a.pts ||
      b.missing - a.missing ||
      a.name.localeCompare(b.name)
  );
  return { rows, points, totalMissing, missingByRarity };
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
    ? `<a href="${r.url}"${img} target="_blank" rel="noopener">${escapeHtml(r.name)}</a>${rarityHtml(r.rarity)}`
    : `<span${img}>${escapeHtml(r.name)}</span>${rarityHtml(r.rarity)}`;
  const typeTag = r.type
    ? `<span class="tag" style="text-transform:capitalize">${escapeHtml(r.type)}</span>`
    : "";
  return `
    <tr>
      <td>${link}</td>
      <td>${typeTag}</td>
      <td>${escapeHtml(r.set || "")}</td>
      <td class="num">${r.need}</td>
      <td class="num">${r.have}</td>
      <td class="num missing">${r.missing}</td>
      <td class="num">${r.pts.toFixed(1)}</td>
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
  const { rows, points, totalMissing, missingByRarity } = compute(key, deck);
  renderInfo(key, deck);
  if (rows.length === 0) {
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.innerHTML = `<strong>You can build this deck.</strong> Nothing missing.`;
    summaryEl.innerHTML = `0 missing · 0.0 distance pts`;
  } else {
    emptyEl.hidden = true;
    tbody.innerHTML = rows.map(renderRow).join("");
    summaryEl.innerHTML = `${totalMissing} missing copies across ${rows.length} cards · ${points.toFixed(1)} distance pts · ${rarityChips(missingByRarity)}`;
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

// Hover thumbnail (same logic as other pages)
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

// Auto-run if a URL is pasted via querystring (?url=…)
const params = new URLSearchParams(location.search);
const presetUrl = params.get("url") || params.get("deck");
if (presetUrl) {
  inputEl.value = presetUrl;
  runDiff();
}
