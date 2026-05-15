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
  const SHEETS_CSV_URL =
    "https://docs.google.com/spreadsheets/d/1Q7RCiWYiC52FIkkDIReUkfotIyGVRSUr/export?format=csv";

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

  function applyCollections(data, source) {
    // "Fully replace" semantics: sheet is the source of truth when fetched
    // successfully. Anything not in the sheet (or with qty 0) is treated as
    // not owned.
    window.__OWNED_DEFAULTS__ = data.owned;
    window.__EN_ROUTE_DEFAULTS__ = data.enroute;
    window.__COLLECTION_SOURCE__ = source;
    window.dispatchEvent(
      new CustomEvent("collection:updated", { detail: { source, data } })
    );
  }

  function updateStatus(text, kind) {
    const el = document.getElementById("sheet-status");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("ok", "err", "loading");
    if (kind) el.classList.add(kind);
  }

  // Fire immediately. Page-apps render once with the static .js values,
  // then re-render when the event lands. Typical fetch is ~200 ms.
  updateStatus("Syncing collection from Google Sheet…", "loading");
  const startedAt = Date.now();
  fetch(SHEETS_CSV_URL, { cache: "no-cache" })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then((text) => {
      const data = csvToCollections(text);
      if (!data) throw new Error("CSV parse failed");
      const elapsed = Date.now() - startedAt;
      applyCollections(data, "sheet");
      const ownedCount = Object.keys(data.owned).length;
      const erCount = Object.keys(data.enroute).length;
      updateStatus(
        `Collection from Google Sheet · ${ownedCount} owned · ${erCount} en-route · synced in ${elapsed} ms`,
        "ok"
      );
    })
    .catch((err) => {
      updateStatus(
        "Sheet fetch failed (" + err.message + ") · using local snapshot",
        "err"
      );
    });
})();
