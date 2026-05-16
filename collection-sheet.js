"use strict";

// Pulls collection counts from a shared Google Sheet (CSV export) so you
// can edit owned / en-route values without re-running scrape.py.
//
// The sheet must have at least these column headers (case-insensitive):
//   Slug       — card slug, e.g. "details-blazing-scorcher"
//   Qty Owned  — integer
//   En route   — integer (or "Qty En Route"; either name works)
//
// Falls back silently to the static collection-owned.js + collection-enroute.js
// values if the fetch fails (network down, sheet revoked, etc).

(function () {
  const SHEETS_ID = "1Q7RCiWYiC52FIkkDIReUkfotIyGVRSUr";
  const SHEETS_CSV_URL =
    `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/export?format=csv`;
  // Lock tabs — each one is a deck (or stack of decks) committed by one
  // person. The site treats those cards as 'unavailable' when the
  // corresponding 'Include lock' toggle is on. Add new lock tabs here.
  // Display label (the part before the emoji or whatever) appears in the
  // toggle text.
  const LOCK_TABS = ["Travis 🔒", "Santiago 🔒"];
  const lockTabUrl = (name) =>
    `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;

  // ---------- CSV parser (RFC-4180-ish, handles quoted fields) ----------
  function parseCSV(text) {
    const rows = [];
    let cur = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { cur.push(cell); cell = ""; }
        else if (ch === "\r") { /* skip */ }
        else if (ch === "\n") { cur.push(cell); rows.push(cur); cur = []; cell = ""; }
        else cell += ch;
      }
    }
    if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
    return rows;
  }

  function csvToCollections(text) {
    const rows = parseCSV(text);
    if (!rows.length) return null;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const slugIdx = header.indexOf("slug");
    const ownedIdx = header.findIndex(
      (h) => h === "qty owned" || h === "owned"
    );
    const enrouteIdx = header.findIndex(
      (h) => h === "en route" || h === "qty en route" || h === "enroute"
    );
    if (slugIdx < 0 || ownedIdx < 0) return null;
    const owned = {};
    const enroute = {};
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const slug = (row[slugIdx] || "").trim();
      if (!slug) continue;
      const o = parseInt(row[ownedIdx] || "0", 10) || 0;
      if (o > 0) owned[slug] = o;
      if (enrouteIdx >= 0) {
        const e = parseInt(row[enrouteIdx] || "0", 10) || 0;
        if (e > 0) enroute[slug] = e;
      }
    }
    return { owned, enroute };
  }

  // Parse a lock-tab CSV. Each row is a single quoted cell from the deck
  // text the user pasted ('"3 Defy"'). Section headers like "LEGEND",
  // "BATTLEFIELDS (3)", "MAINDECK (40)", "SIDEBOARD (8)" are skipped.
  // Names are matched against the catalog by case-insensitive lookup,
  // with a legend-epithet alias so older pastes ("Bashful Bloom") still
  // resolve. Returns { slug: total_qty } across whatever decks the tab
  // contains.
  function parseLockTab(text) {
    const out = {};
    const rows = parseCSV(text);
    const catalog = window.__CATALOG__ || {};
    if (!Object.keys(catalog).length) return out; // catalog not loaded yet
    const nameToSlug = new Map();
    for (const [slug, c] of Object.entries(catalog)) {
      const n = (c.name || "").trim().toLowerCase();
      if (n) nameToSlug.set(n, slug);
      if (c.type === "legend" && n.includes(",")) {
        const ep = n.split(",", 2)[1].trim();
        if (ep) nameToSlug.set(ep, slug);
      }
    }
    const lineRe = /^(\d+)\s+(.+)$/;
    for (const row of rows) {
      const line = (row[0] || "").trim();
      if (!line) continue;
      const ln = line.match(lineRe);
      if (!ln) continue;
      const qty = parseInt(ln[1], 10);
      const name = ln[2].trim();
      const slug = nameToSlug.get(name.toLowerCase());
      if (!slug) continue;
      out[slug] = (out[slug] || 0) + qty;
    }
    return out;
  }

  function applyState(state, source) {
    // "Fully replace" semantics: sheet is the source of truth when fetched
    // successfully. Anything not in the sheet (or with qty 0) is treated as
    // not owned.
    window.__OWNED_DEFAULTS__ = state.owned;
    window.__EN_ROUTE_DEFAULTS__ = state.enroute;
    window.__LOCKS__ = state.locks || {};
    window.__COLLECTION_SOURCE__ = source;
    window.dispatchEvent(
      new CustomEvent("collection:updated", { detail: { source, state } })
    );
  }

  function updateStatus(text, kind) {
    const el = document.getElementById("sheet-status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("ok", "err", "loading");
    if (kind) el.classList.add(kind);
  }

  // Fetch everything (collection + each lock tab) in parallel. Page-apps
  // render once with the static .js values, then re-render when this
  // resolves. Typical: ~250-500 ms.
  updateStatus("Syncing collection from Google Sheet…", "loading");
  const startedAt = Date.now();

  const fetchAsText = (url) =>
    fetch(url, { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });

  Promise.allSettled([
    fetchAsText(SHEETS_CSV_URL),
    ...LOCK_TABS.map((name) => fetchAsText(lockTabUrl(name))),
  ]).then((results) => {
    const elapsed = Date.now() - startedAt;
    const [collectionRes, ...lockRes] = results;
    if (collectionRes.status !== "fulfilled") {
      updateStatus(
        "Sheet fetch failed (" + (collectionRes.reason?.message || "?") + ") · using local snapshot",
        "err"
      );
      return;
    }
    const data = csvToCollections(collectionRes.value);
    if (!data) {
      updateStatus("Sheet CSV parse failed · using local snapshot", "err");
      return;
    }
    // Lock tabs: keyed by display name (e.g. "Travis 🔒"). Missing/empty
    // tabs just contribute {}.
    const locks = {};
    LOCK_TABS.forEach((name, i) => {
      const r = lockRes[i];
      if (r.status === "fulfilled") {
        try { locks[name] = parseLockTab(r.value); }
        catch (_) { locks[name] = {}; }
      } else {
        locks[name] = {};
      }
    });
    applyState({ owned: data.owned, enroute: data.enroute, locks }, "sheet");
    const ownedCount = Object.keys(data.owned).length;
    const erCount = Object.keys(data.enroute).length;
    const lockSummary = LOCK_TABS
      .map((n) => {
        const slugs = Object.keys(locks[n]);
        const copies = Object.values(locks[n]).reduce((a, b) => a + b, 0);
        return `${n} ${copies}/${slugs.length}`;
      })
      .join(" · ");
    updateStatus(
      `Sheet · ${ownedCount} owned · ${erCount} en-route · ${lockSummary} · synced in ${elapsed} ms`,
      "ok"
    );
  });
})();
