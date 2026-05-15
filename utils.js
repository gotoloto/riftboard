"use strict";

// =====================================================================
// Shared utilities for every page-app.js.
//
// Loaded as a plain <script> before *-app.js — no module system, so
// everything here ends up on the global scope. Keep the surface area
// small and obvious.
// =====================================================================

// ---------- string ----------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- rarity glyph map ----------

const RARITY = {
  common:   { ch: "●", cls: "common" },
  uncommon: { ch: "▲", cls: "uncommon" },
  rare:     { ch: "◆", cls: "rare" },
  epic:     { ch: "⬟", cls: "epic" },
  showcase: { ch: "⬢", cls: "showcase" },
};

function rarityGlyph(rarity) {
  const r = rarity && RARITY[String(rarity).toLowerCase()];
  if (!r) return "";
  return `<span class="rarity rarity-${r.cls}" title="${escapeHtml(rarity)}" aria-hidden="true">${r.ch}</span>`;
}

// ---------- localStorage JSON helpers ----------

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

// ---------- catalog cost parser ----------
// Cost strings are "-" (no cost; battlefields, legends, runes) or a leading
// energy followed by zero or more "C" power chars: "0C", "2", "5CC",
// "10CCCC". Returns { energy: number|null, power: number }.

function parseCost(costStr) {
  if (!costStr || costStr === "-") return { energy: null, power: 0 };
  const m = String(costStr).match(/^(\d+)(C*)$/);
  if (!m) return { energy: null, power: 0 };
  return { energy: parseInt(m[1], 10), power: m[2].length };
}

// ---------- hover thumbnail ----------
// All pages with table rows showing card names use `data-img="<url>"` on
// the name element. attachHoverThumb wires a 200ms-debounced preview that
// follows the cursor. The thumb element must exist in the page DOM as
// <img id="card-thumb" alt="" hidden />.

function __positionThumb(ev, thumbEl) {
  const pad = 16;
  // Read width from CSS so each page's #card-thumb { width: ... } wins
  // (collection page uses 240, others 260). Falls back to 260 if computed
  // style is somehow unavailable.
  const w = parseInt(getComputedStyle(thumbEl).width, 10) || 260;
  const ratio = thumbEl.naturalWidth
    ? thumbEl.naturalHeight / thumbEl.naturalWidth
    : 1.4;
  const h = w * ratio;
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + w > window.innerWidth) x = ev.clientX - w - pad;
  x = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
  y = Math.max(pad, Math.min(y, window.innerHeight - h - pad));
  thumbEl.style.left = x + "px";
  thumbEl.style.top = y + "px";
}

function attachHoverThumb() {
  const thumbEl = document.getElementById("card-thumb");
  if (!thumbEl) return;
  let timer = 0;
  document.body.addEventListener("mouseover", (ev) => {
    const el = ev.target.closest("[data-img]");
    if (!el) return;
    const img = el.dataset.img;
    if (!img) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (thumbEl.src !== img) thumbEl.src = img;
      thumbEl.hidden = false;
      __positionThumb(ev, thumbEl);
    }, 200);
  });
  document.body.addEventListener("mousemove", (ev) => {
    if (!thumbEl.hidden) __positionThumb(ev, thumbEl);
  });
  document.body.addEventListener("mouseout", (ev) => {
    if (!ev.target.closest("[data-img]")) return;
    clearTimeout(timer);
    thumbEl.hidden = true;
  });
}
