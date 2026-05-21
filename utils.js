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

// ---------- lock-tab toggles ----------
// window.__LOCKS__ is populated by collection-sheet.js from the Google Sheet
// tabs ("Travis 🔒", "Santiago 🔒"). Each entry is { slug: qty } describing
// cards committed to that person's decks and therefore unavailable for
// new builds. Pages render an "Include <tab>?" checkbox per tab; when
// checked, that tab's qtys subtract from owned.

function lockTabNames() {
  return Object.keys(window.__LOCKS__ || {});
}

function lockPlayerNames() {
  // Group lock tabs by their first whitespace-delimited token (the
  // player's name). Order preserved: lockTabNames() returns the Sheet's
  // declared order, e.g. Travis A, Travis B, Santiago A, Santiago B —
  // so unique-by-first-word yields [Travis, Santiago].
  const seen = new Set();
  const ordered = [];
  for (const tab of lockTabNames()) {
    const m = tab.match(/^(\S+)/);
    if (!m) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    ordered.push(m[1]);
  }
  return ordered;
}

function tabsForPlayer(player) {
  return lockTabNames().filter((tab) => tab.startsWith(player));
}

// Toggle semantics — the label is "Include <tab>?":
//   checked   = include those cards in the available pool (lock ignored,
//               cards count toward owned)
//   unchecked = exclude those cards (lock applies, cards subtracted)
// Default: unchecked. Realistic view of your collection = locks apply.
//
// Note: LS key was renamed from <page>:lock:<tab> to <page>:includeLock:<tab>
// when the semantics flipped (previously checked = apply lock). Any value
// stored under the old key is silently ignored — users get the new default.
// Reads the include-lock toggle for a player. Key is keyed by player
// name now (was per-tab in an earlier iteration; old keys silently
// ignored, default false = lock applies).
function readLockToggle(pagePrefix, player) {
  try {
    const raw = localStorage.getItem(`${pagePrefix}:includeLock:${player}`);
    return raw == null ? false : JSON.parse(raw);
  } catch (_) {
    return false;
  }
}

function lockedTotal(slug, pagePrefix) {
  // For each player whose Include toggle is OFF, subtract the MAX of
  // their A/B tabs (intra-player sharing — Travis swaps a single physical
  // copy of Defy between his own decks between games, so his lock for
  // Defy is max(A_qty, B_qty), not A+B). Different players still sum,
  // because both play at the same table simultaneously.
  const locks = window.__LOCKS__ || {};
  let total = 0;
  for (const player of lockPlayerNames()) {
    if (readLockToggle(pagePrefix, player)) continue;
    let max = 0;
    for (const tab of tabsForPlayer(player)) {
      max = Math.max(max, locks[tab]?.[slug] || 0);
    }
    total += max;
  }
  return total;
}

// Render a checkbox per known lock tab into containerEl. Idempotent — if
// the tab set hasn't changed since the last call, it's a no-op (keeps
// existing DOM + listeners). onChange() fires when any toggle flips.
function ensureLockToggles(containerEl, pagePrefix, onChange) {
  if (!containerEl) return;
  // One checkbox per PLAYER (collapses A/B into a single toggle — that
  // matches the intra-player sharing rule and keeps the UI tidy).
  const players = lockPlayerNames();
  const key = players.join("|");
  if (containerEl.dataset.tabs === key) return;
  containerEl.dataset.tabs = key;
  containerEl.innerHTML = "";
  for (const player of players) {
    const lsKey = `${pagePrefix}:includeLock:${player}`;
    const on = readLockToggle(pagePrefix, player);
    const label = document.createElement("label");
    label.className = "enroute-toggle lock-toggle";
    label.innerHTML = `<input type="checkbox"${on ? " checked" : ""}/> Include ${escapeHtml(player)} 🔒?`;
    const input = label.querySelector("input");
    input.addEventListener("change", () => {
      try {
        localStorage.setItem(lsKey, JSON.stringify(input.checked));
      } catch (_) {}
      if (typeof onChange === "function") onChange();
    });
    containerEl.appendChild(label);
  }
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
