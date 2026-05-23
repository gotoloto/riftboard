// Lineup view — renders every locked deck side-by-side, read-only,
// with an "enough cards?" check against owned/en-route. Mirrors the
// builder's sidebar visually but strips the +/− controls.
//
// Data sources:
//   window.__CATALOG__         — every card (slug → meta)
//   window.__CHAMPION_SLUGS__  — set of slugs that count as champions
//   window.__OWNED_DEFAULTS__  — owned counts (live-updated by collection-sheet.js)
//   window.__EN_ROUTE_DEFAULTS__ — same shape, en-route copies
//   window.__LOCKS_RAW__       — raw decklist CSV per lock-tab name
//
// We re-parse the raw text per tab (rather than reusing the {slug:qty}
// summary built for lockedTotal()) because we need section structure:
// Legend / Champion / MainDeck / Battlefields / SideBoard.

const catalog = window.__CATALOG__ || {};
const CHAMPION_SLUGS = new Set(window.__CHAMPION_SLUGS__ || []);
let owned = window.__OWNED_DEFAULTS__ || {};
let enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
let includeEnRoute = false;

const LOCK_TABS = ["Travis A🔒", "Travis B🔒", "Santiago A🔒", "Santiago B🔒"];
// Sharing model: within one player A + B can share cards (one Travis at
// a time, swaps Defies between his own decks between games). ACROSS
// players, no sharing — they sit at the same table. So per-player need
// is max(A_qty, B_qty) and household need is the sum across players.
const PLAYERS = ["Travis", "Santiago"];

const MAX_COPIES = 3;

// Name → slug lookup, with legend epithet alias.
const nameToSlug = new Map();
(function rebuildNameIndex() {
  nameToSlug.clear();
  for (const [slug, c] of Object.entries(catalog)) {
    const n = (c.name || "").trim().toLowerCase();
    if (n) nameToSlug.set(n, slug);
    if (c.type === "legend" && n.includes(",")) {
      const ep = n.split(",", 2)[1].trim();
      if (ep) nameToSlug.set(ep.toLowerCase(), slug);
    }
  }
})();

// ---------- parser (matches collection-app.js / collection-sheet.js) ----------
const SECTION_RE = /^(LEGEND|BATTLEFIELDS?|MAINDECK|MAIN\s*DECK|CHAMPION|SIDEBOARD|SIDE\s*BOARD|RUNE\s*POOL|RUNES?)(?:\s*\(\s*\d+\s*\))?\s*:?\s*$/i;
const LINE_RE = /^(\d+)\s+(.+)$/;

function parseLockText(text) {
  // Returns { legend, champion, battlefields, main, side, warnings }.
  // Mirrors parseDecklistText but walks both row-major CSV layouts (one
  // cell per line) AND the single-cell-with-newlines layout.
  const out = {
    legend: null,
    champion: null,
    battlefields: {},
    main: {},
    side: {},
    warnings: [],
  };
  if (!text) return out;
  let section = null;
  // Strip outer CSV quoting (Sheets wraps multi-line cells in quotes,
  // doubling embedded quotes — gviz/tq export only un-escapes them
  // partially. Handle defensively.)
  for (let rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('"') && line.endsWith('"')) {
      line = line.slice(1, -1).trim();
    }
    if (!line) continue;
    const m = line.match(SECTION_RE);
    if (m) {
      const head = m[1].toUpperCase().replace(/\s+/g, "");
      if (head === "LEGEND") section = "legend";
      else if (head === "CHAMPION") section = "champion";
      else if (head.startsWith("BATTLEFIELD")) section = "battlefields";
      else if (head === "MAINDECK") section = "main";
      else if (head === "SIDEBOARD") section = "side";
      else if (head === "RUNEPOOL" || head === "RUNE" || head === "RUNES") section = "rune";
      continue;
    }
    if (section === "rune") continue;
    const ln = line.match(LINE_RE);
    if (!ln) continue;
    const qty = parseInt(ln[1], 10);
    const name = ln[2].trim();
    const slug = nameToSlug.get(name.toLowerCase());
    if (!slug) {
      out.warnings.push(`Unknown card: ${name}`);
      continue;
    }
    const c = catalog[slug];
    let bucket = section;
    if (!bucket) {
      if (c.type === "legend") bucket = "legend";
      else if (c.type === "battlefield") bucket = "battlefields";
      else if (c.type === "rune") continue;
      else bucket = "main";
    }
    if (bucket === "legend") {
      out.legend = slug;
    } else if (bucket === "champion") {
      out.champion = slug;
    } else if (c.type === "rune") {
      // skip
    } else {
      out[bucket][slug] = (out[bucket][slug] || 0) + qty;
    }
  }
  return out;
}

// ---------- helpers shared with builder ----------
function ownedFor(slug) {
  const o = owned[slug] || 0;
  const er = includeEnRoute ? (enRoute[slug] || 0) : 0;
  return Math.max(0, o + er);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---------- energy curve (subset of collection-app.js) ----------
const CURVE_BUCKETS = ["0", "1", "2", "3", "4", "5", "6", "7+"];
function bucketIndexForEnergy(e) {
  if (e == null || e < 0) return -1;
  if (e >= 7) return 7;
  return e;
}
function energyOf(slug) {
  const c = catalog[slug];
  if (!c || !c.cost) return null;
  const m = String(c.cost).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function computeEnergyCurve(slugQtyMap) {
  const buckets = Array.from({ length: 8 }, () => ({ unit: 0, gear: 0, spell: 0, total: 0 }));
  let sumE = 0, totalCounted = 0;
  for (const [slug, qty] of Object.entries(slugQtyMap || {})) {
    const e = energyOf(slug);
    if (e == null) continue;
    const idx = bucketIndexForEnergy(e);
    if (idx < 0) continue;
    const t = catalog[slug]?.type;
    const seg = t === "unit" || t === "gear" || t === "spell" ? t : "spell";
    buckets[idx][seg] += qty;
    buckets[idx].total += qty;
    sumE += e * qty;
    totalCounted += qty;
  }
  const avg = totalCounted > 0 ? sumE / totalCounted : null;
  return { buckets, avg, totalCounted };
}
function renderEnergyCurve(label, curve) {
  if (curve.totalCounted === 0) {
    return `<div class="energy-curve"><div class="curve-title"><span>${escapeHtml(label)}</span><span>—</span></div></div>`;
  }
  const max = Math.max(1, ...curve.buckets.map((b) => b.total));
  const tot = curve.buckets.reduce(
    (a, b) => ({ unit: a.unit + b.unit, gear: a.gear + b.gear, spell: a.spell + b.spell }),
    { unit: 0, gear: 0, spell: 0 }
  );
  const COLOR = { unit: "#60a5fa", gear: "#fbbf24", spell: "#f472b6" };
  const rowsHtml = CURVE_BUCKETS.map((bk, i) => {
    const b = curve.buckets[i];
    const cls = b.total === 0 ? "curve-row empty" : "curve-row";
    const railPct = ((b.total / max) * 100).toFixed(2);
    let cum = 0;
    const stops = [];
    for (const seg of ["unit", "gear", "spell"]) {
      const n = b[seg];
      if (n <= 0) continue;
      const start = cum;
      const end = cum + (n / b.total) * 100;
      stops.push(`${COLOR[seg]} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
      cum = end;
    }
    const title = [b.unit && `${b.unit} unit`, b.gear && `${b.gear} gear`, b.spell && `${b.spell} spell`]
      .filter(Boolean).join(" · ");
    const bg = stops.length ? `background:linear-gradient(to right, ${stops.join(", ")});` : "";
    return `
      <div class="${cls}">
        <span class="bucket">${escapeHtml(bk)}</span>
        <div class="bar-wrap"><div class="bar stacked" style="width:${railPct}%;${bg}" title="${escapeHtml(title)}"></div></div>
        <span class="count">${b.total}</span>
      </div>`;
  }).join("");
  const legendBits = [];
  if (tot.unit > 0) legendBits.push(`<span class="curve-key key-unit"></span>unit ${tot.unit}`);
  if (tot.gear > 0) legendBits.push(`<span class="curve-key key-gear"></span>gear ${tot.gear}`);
  if (tot.spell > 0) legendBits.push(`<span class="curve-key key-spell"></span>spell ${tot.spell}`);
  return `
    <div class="energy-curve">
      <div class="curve-title">
        <span>${escapeHtml(label)}</span>
        <span>avg ${curve.avg.toFixed(2)} · ${curve.totalCounted} cards</span>
      </div>
      <div class="curve-legend">${legendBits.join(" · ")}</div>
      ${rowsHtml}
    </div>`;
}

// ---------- per-domain power demand ----------
const DOMAIN_OPTS = ["calm", "chaos", "fury", "mind", "order", "body", "colorless"];
const DOMAIN_LETTER = {
  calm: "C", chaos: "X", fury: "F", mind: "M", order: "O", body: "B", colorless: "·",
};
function parseCostLocal(costStr) {
  if (!costStr || costStr === "-") return { energy: null, power: 0 };
  const m = String(costStr).match(/^(\d+)(C*)$/);
  if (!m) return { energy: null, power: 0 };
  return { energy: parseInt(m[1], 10), power: m[2].length };
}
function computePowerByDomain(slugQtyMap) {
  const totals = {};
  for (const [slug, qty] of Object.entries(slugQtyMap || {})) {
    const c = catalog[slug];
    if (!c) continue;
    const { power } = parseCostLocal(c.cost);
    if (power <= 0) continue;
    const ds = (c.domains || []).filter((d) => d !== "colorless");
    const targets = ds.length ? ds : c.domains || [];
    for (const d of targets) totals[d] = (totals[d] || 0) + power * qty;
  }
  return totals;
}
function renderPowerByDomain(totals) {
  const rows = DOMAIN_OPTS.filter((d) => totals[d] > 0).map((d) => {
    const letter = DOMAIN_LETTER[d] || "?";
    return `<span class="pbd-row" title="${escapeHtml(d)} — ${totals[d]} power"><span class="pbd-letter pwr-${d}">${letter}</span> ${totals[d]}<span class="domain-name">${escapeHtml(d)}</span></span>`;
  });
  if (!rows.length) return "";
  return `<div class="power-by-domain">
    <div class="pbd-title">Power demand</div>
    ${rows.join("")}
  </div>`;
}

// ---------- deck panel ----------
function nameOf(slug) {
  return catalog[slug]?.name || slug;
}
function imgOf(slug) {
  const u = catalog[slug]?.image_url;
  return u ? ` data-img="${escapeHtml(u)}"` : "";
}

function itemRow(slug, qty, usage, tab, section) {
  // section ∈ {"main", "side"}. The row's short/enroute status is now
  // computed per-section: a card split across maindeck + sideboard only
  // marks the sideboard row short if the household pool can't cover
  // both. The card-level signals (cross-player shared, intra-player
  // swap) remain card-wide.
  const u = usage[slug];
  const own = u?.owned ?? ownedFor(slug);
  const player = playerOfTab(tab);

  const here = u?.perDeck?.[tab] || {};
  const sectionShort = section === "side" ? here.sideShort || 0 : here.mainShort || 0;
  const sectionEnr   = section === "side" ? here.sideEnr   || false : here.mainEnr   || false;

  let cls = "";
  let severityMark = "";
  if (sectionShort > 0) {
    cls = "short";
    severityMark = `<span class="severity-mark" aria-hidden="true">⚠</span>`;
  } else if (sectionEnr) {
    cls = "enroute";
    severityMark = `<span class="severity-mark" aria-hidden="true">✈</span>`;
  } else if (u?.crossPlayerShared) {
    cls = "shared";
    severityMark = `<span class="severity-mark" aria-hidden="true">⚠</span>`;
  } else if (here.swap) {
    cls = "swap";
  }

  // Swap marker always shows when this row needs shuttling between
  // the player's A and B decks, regardless of severity class. Glyph is
  // ⇄ (U+21C4) — a text-class arrow that inherits the CSS color.
  const swapMark = here.swap
    ? `<span class="swap-mark" title="Swap this card between your A and B decks between games">⇄</span>`
    : "";

  // Build qty display. When section is short, render allocated/needed
  // so the user sees how many made it in (e.g. '0/2×').
  const allocated = Math.max(0, qty - sectionShort);
  const qtyHtml = sectionShort > 0
    ? `<span class="qty">${allocated}/${qty}×</span>`
    : `<span class="qty">${qty}×</span>`;

  const playerBreakdown = u
    ? Object.entries(u.perPlayer)
        .filter(([, v]) => v > 0)
        .map(([p, v]) => `${p} ${v}`)
        .join(" + ")
    : "";

  let title;
  if (sectionShort > 0) {
    const where = section === "side" ? "sideboard" : "main";
    title = `${where[0].toUpperCase()}${where.slice(1)} short ${sectionShort}: deck needs ${qty} here, allocated ${allocated} from the household pool. Household total ${u.householdNeed} (${playerBreakdown}), own ${own}. Maindeck takes priority over sideboard.`;
  } else if (sectionEnr) {
    const ownRaw = u.ownedRaw, enr = u.enroute;
    title = `Awaiting en-route copies: owned ${ownRaw} + en-route ${enr} covers the deck. Household need ${u.householdNeed} (${playerBreakdown}).`;
  } else if (u?.crossPlayerShared) {
    title = `Both players use this. ${playerBreakdown} · own ${own}.`;
  } else if (here.swap) {
    title = `${player} runs this in both A and B — swap between decks between games. Own ${own}.`;
  } else {
    title = `Need ${qty}, own ${own}.`;
  }

  return `<li class="${cls}" data-slug="${escapeHtml(slug)}" title="${escapeHtml(title)}">
    ${qtyHtml}
    <span class="own">/${own}</span>
    <span class="card-name"${imgOf(slug)}>${escapeHtml(nameOf(slug))}${severityMark}${swapMark}</span>
  </li>`;
}

function tallyDeckTotals(deck) {
  // Flat tally: { slug: copies_across_all_sections }. Used by callers
  // that don't care about main-vs-side (energy curve, power-by-domain).
  const t = {};
  const add = (slug, n) => { if (slug) t[slug] = (t[slug] || 0) + n; };
  if (deck.legend) add(deck.legend, 1);
  if (deck.champion) add(deck.champion, 1);
  for (const [s, q] of Object.entries(deck.main)) add(s, q);
  for (const [s, q] of Object.entries(deck.battlefields)) add(s, q);
  for (const [s, q] of Object.entries(deck.side)) add(s, q);
  return t;
}

function tallyDeckSections(deck) {
  // Section-aware tally: { mainBlock: {slug: qty}, side: {slug: qty} }.
  // 'mainBlock' lumps Legend + Champion + Battlefields + Maindeck —
  // anything that must be available when you sit down to play. The
  // sideboard is treated as a lower-priority bucket so a card split
  // across both only marks the sideboard portion short if the household
  // pool can't cover both.
  const mainBlock = {};
  const side = {};
  const addTo = (target, slug, n) => {
    if (slug) target[slug] = (target[slug] || 0) + n;
  };
  if (deck.legend) addTo(mainBlock, deck.legend, 1);
  if (deck.champion) addTo(mainBlock, deck.champion, 1);
  for (const [s, q] of Object.entries(deck.main)) addTo(mainBlock, s, q);
  for (const [s, q] of Object.entries(deck.battlefields)) addTo(mainBlock, s, q);
  for (const [s, q] of Object.entries(deck.side)) addTo(side, s, q);
  return { mainBlock, side };
}

function playerOfTab(tab) {
  // First word of the tab name, e.g. 'Travis A🔒' → 'Travis'.
  return (tab.match(/^(\S+)/) || [, ""])[1];
}

function computeUsage(parsedByTab) {
  // For every slug used by any deck, compute per-deck per-SECTION status.
  // Maindeck (legend+champion+bf+main) takes priority over sideboard
  // when allocating the household pool, so a card split across both in
  // a single deck only marks the sideboard portion short if the pool
  // truly can't cover both. Intra-player A/B sharing still uses max
  // (one player at a time); cross-player still sums.
  //
  // Per-slug output:
  //   perPlayer[player]      — max(full qty across that player's A + B)
  //   perDeck[tab].mainQty   — copies in this deck's mainBlock
  //   perDeck[tab].sideQty   — copies in this deck's sideboard
  //   perDeck[tab].mainShort — main copies missing even with en-route
  //   perDeck[tab].sideShort — side copies missing even with en-route
  //   perDeck[tab].mainEnr   — main short under raw, OK with en-route
  //   perDeck[tab].sideEnr   — side short under raw, OK with en-route
  //   perDeck[tab].swap      — same player's OTHER deck also uses it
  //   householdNeed           — sum across players (cross-player no-share)
  //   owned                   — ownedFor(slug) (respects toggle)
  //   ownedRaw, enroute       — for independent en-route classification
  //   short                   — at least one deck/section short under en-route
  //   enrouteDependent        — short under raw only, OK with en-route
  //   crossPlayerShared       — both Travis AND Santi want this card
  //   intraPlayerSwap         — any one player uses it in both A and B
  const sectionTallies = {};
  const allSlugs = new Set();
  for (const tab of LOCK_TABS) {
    const t = tallyDeckSections(parsedByTab[tab] || {});
    sectionTallies[tab] = t;
    for (const s of Object.keys(t.mainBlock)) allSlugs.add(s);
    for (const s of Object.keys(t.side)) allSlugs.add(s);
  }

  // Two-pass allocator: pool is the household supply for this slug.
  // Pass 1 fills each player's maindeck need (max across their A/B).
  // Pass 2 fills each player's "sideboard extras" — the additional
  // copies beyond their main-max that they'd need to play their fuller
  // deck. Returns { Travis: {mainAlloc, sideAlloc}, Santiago: {…} }.
  function allocate(pool, perPlayerStats) {
    const out = {};
    for (const player of PLAYERS) out[player] = { mainAlloc: 0, sideAlloc: 0 };
    // Maindecks first.
    for (const player of PLAYERS) {
      const need = perPlayerStats[player].mainMax;
      const give = Math.max(0, Math.min(pool, need));
      out[player].mainAlloc = give;
      pool -= give;
    }
    // Sideboard extras (only the appetite beyond what main already covered).
    for (const player of PLAYERS) {
      const need = Math.max(
        0,
        perPlayerStats[player].fullMax - perPlayerStats[player].mainMax
      );
      const give = Math.max(0, Math.min(pool, need));
      out[player].sideAlloc = give;
      pool -= give;
    }
    return out;
  }

  const usage = {};
  for (const slug of allSlugs) {
    // Per-player max(mainBlock) and max(full) across that player's decks.
    const perPlayerStats = {};
    const usedByDecks = {};
    for (const player of PLAYERS) {
      let mainMax = 0;
      let fullMax = 0;
      const decks = [];
      for (const tab of LOCK_TABS) {
        if (playerOfTab(tab) !== player) continue;
        const m = sectionTallies[tab].mainBlock[slug] || 0;
        const s = sectionTallies[tab].side[slug] || 0;
        if (m + s > 0) decks.push(tab);
        mainMax = Math.max(mainMax, m);
        fullMax = Math.max(fullMax, m + s);
      }
      perPlayerStats[player] = { mainMax, fullMax };
      usedByDecks[player] = decks;
    }
    const householdNeed = PLAYERS.reduce(
      (s, p) => s + perPlayerStats[p].fullMax,
      0
    );
    const ownedRaw = window.__OWNED_DEFAULTS__?.[slug] || 0;
    const enr = window.__EN_ROUTE_DEFAULTS__?.[slug] || 0;
    // Two passes: strict (raw owned) and lax (owned + en-route).
    const allocRaw = allocate(ownedRaw, perPlayerStats);
    const allocLax = allocate(ownedRaw + enr, perPlayerStats);

    // Per-deck per-section short. For each deck X (player P), the
    // shortage is (X_full_qty - P_total_alloc), clamped ≥0. The
    // shortage falls on the sideboard first (lowest priority), then
    // spills into mainBlock if there's still more to lose.
    const perDeck = {};
    let anyShort = false;
    let anyEnr = false;
    for (const tab of LOCK_TABS) {
      const player = playerOfTab(tab);
      const mainQty = sectionTallies[tab].mainBlock[slug] || 0;
      const sideQty = sectionTallies[tab].side[slug] || 0;
      const fullQty = mainQty + sideQty;
      const otherDecks = usedByDecks[player].filter((t) => t !== tab);

      function sectionShort(allocForPlayer) {
        const alloc = allocForPlayer.mainAlloc + allocForPlayer.sideAlloc;
        const shortage = Math.max(0, fullQty - alloc);
        const sShort = Math.min(shortage, sideQty);
        const mShort = Math.max(0, shortage - sideQty);
        return { mShort, sShort };
      }
      const rawShort = sectionShort(allocRaw[player]);
      const laxShort = sectionShort(allocLax[player]);

      const mainShort = laxShort.mShort;
      const sideShort = laxShort.sShort;
      const mainEnr = mainShort === 0 && rawShort.mShort > 0;
      const sideEnr = sideShort === 0 && rawShort.sShort > 0;

      perDeck[tab] = {
        mainQty,
        sideQty,
        mainShort, sideShort,
        mainEnr, sideEnr,
        swap: fullQty > 0 && otherDecks.length > 0,
        // Legacy field — flat qty, kept for callers that don't yet
        // distinguish sections.
        qty: fullQty,
      };
      if (mainShort > 0 || sideShort > 0) anyShort = true;
      else if (mainEnr || sideEnr) anyEnr = true;
    }

    const playersUsing = PLAYERS.filter((p) => perPlayerStats[p].fullMax > 0).length;
    usage[slug] = {
      // Card-level (compatibility with existing fields)
      perPlayer: Object.fromEntries(
        PLAYERS.map((p) => [p, perPlayerStats[p].fullMax])
      ),
      perDeck,
      householdNeed,
      owned: ownedFor(slug),
      ownedRaw,
      enroute: enr,
      short: anyShort,
      enrouteDependent: anyEnr && !anyShort,
      crossPlayerShared: playersUsing >= 2,
      intraPlayerSwap: Object.values(usedByDecks).some((arr) => arr.length >= 2),
    };
  }
  return usage;
}

function sortByName(entries) {
  return entries.sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
}

function renderDeckPanel(tabName, deck, usage) {
  // Headline counts
  const isEmpty = !deck.legend && !deck.champion &&
    !Object.keys(deck.main).length &&
    !Object.keys(deck.battlefields).length &&
    !Object.keys(deck.side).length;
  if (isEmpty) {
    return `<section class="deck-panel">
      <header class="deck-panel-header">
        <h2>${escapeHtml(tabName)}</h2>
        <span class="completion empty">empty</span>
      </header>
      <p class="empty-deck">No deck pasted into this tab yet.</p>
    </section>`;
  }
  const totals = tallyDeckTotals(deck);
  // Roll up THIS deck's own status from the per-card usage. A card
  // counts as short here iff at least one section (main or side) in
  // THIS deck can't get its allocation; the row's copy count is the
  // missing copies for THIS deck only.
  let shortCards = 0;
  let shortCopies = 0;
  let enrouteCards = 0;
  let crossSharedCards = 0;
  let swapCards = 0;
  for (const slug of Object.keys(totals)) {
    const u = usage[slug];
    if (!u) continue;
    const here = u.perDeck[tabName];
    if (!here) continue;
    const localShort = (here.mainShort || 0) + (here.sideShort || 0);
    const localEnr = !localShort && (here.mainEnr || here.sideEnr);
    if (localShort > 0) {
      shortCards += 1;
      shortCopies += localShort;
    } else if (localEnr) {
      enrouteCards += 1;
    } else if (u.crossPlayerShared) {
      crossSharedCards += 1;
    }
    if (here.swap) swapCards += 1;
  }
  let completionTxt, completionCls;
  if (shortCards > 0) {
    completionTxt = `Short ${shortCopies} cop${shortCopies === 1 ? "y" : "ies"} (${shortCards} card${shortCards === 1 ? "" : "s"})`;
    completionCls = "completion short";
  } else if (enrouteCards > 0) {
    completionTxt = `Need en-route · ${enrouteCards} card${enrouteCards === 1 ? "" : "s"}`;
    completionCls = "completion enroute";
  } else if (crossSharedCards > 0) {
    completionTxt = `Have all · ${crossSharedCards} shared w/ other player`;
    completionCls = "completion shared";
  } else if (swapCards > 0) {
    completionTxt = `Have all · ${swapCards} swap${swapCards === 1 ? "" : "s"} w/ ${playerOfTab(tabName)}'s other deck`;
    completionCls = "completion swap";
  } else {
    completionTxt = "Have all cards ✓";
    completionCls = "completion";
  }

  const mainBySort = sortByName(Object.entries(deck.main));
  const byType = { unit: [], gear: [], spell: [] };
  for (const [slug, qty] of mainBySort) {
    const t = catalog[slug]?.type;
    if (t && byType[t]) byType[t].push([slug, qty]);
  }

  const sections = [];
  // Legend
  if (deck.legend) {
    sections.push(`<section class="deck-section">
      <header><span>Legend</span><span>1/1</span></header>
      <ul class="deck-list">${itemRow(deck.legend, 1, usage, tabName, "main")}</ul>
    </section>`);
  }
  // Champion
  if (deck.champion) {
    sections.push(`<section class="deck-section">
      <header><span>Champion</span><span>1/1</span></header>
      <ul class="deck-list">${itemRow(deck.champion, 1, usage, tabName, "main")}</ul>
    </section>`);
  }
  // Battlefields
  const bfEntries = sortByName(Object.entries(deck.battlefields));
  if (bfEntries.length) {
    const bfTotal = bfEntries.reduce((s, [, q]) => s + q, 0);
    sections.push(`<section class="deck-section">
      <header><span>Battlefields</span><span>${bfTotal}/3</span></header>
      <ul class="deck-list">${bfEntries.map(([s, q]) => itemRow(s, q, usage, tabName, "main")).join("")}</ul>
    </section>`);
  }
  // Maindeck — units / gear / spells. Champion is already shown above; if
  // duplicate copies of the same champion live in main as units, they still
  // render here (catalog type is unit), and their "owned vs need" check
  // already counts the +1 from the slot via the totals map.
  const mainTotalCount =
    (deck.champion ? 1 : 0) +
    Object.values(deck.main).reduce((a, b) => a + b, 0);
  if (mainTotalCount > 0) {
    sections.push(`<p class="muted small" style="font-size:11px;margin:4px 0 0;">
      Maindeck (incl. champion): <strong>${mainTotalCount}/40</strong>
    </p>`);
  }
  for (const [type, sectionLabel] of [
    ["unit", "Units"], ["gear", "Gear"], ["spell", "Spells"],
  ]) {
    const list = byType[type];
    if (!list.length) continue;
    const subtotal = list.reduce((s, [, q]) => s + q, 0);
    sections.push(`<section class="deck-section">
      <header><span>${sectionLabel}</span><span>${subtotal}</span></header>
      <ul class="deck-list">${list.map(([s, q]) => itemRow(s, q, usage, tabName, "main")).join("")}</ul>
    </section>`);
  }
  // Sideboard
  const sideEntries = sortByName(Object.entries(deck.side));
  if (sideEntries.length) {
    const sideTotal = sideEntries.reduce((s, [, q]) => s + q, 0);
    sections.push(`<section class="deck-section">
      <header><span>Sideboard</span><span>${sideTotal}/8</span></header>
      <ul class="deck-list">${sideEntries.map(([s, q]) => itemRow(s, q, usage, tabName, "side")).join("")}</ul>
    </section>`);
  }

  // Energy curve + power demand — include the champion slot
  const mainPlusChampion = deck.champion
    ? { ...deck.main, [deck.champion]: (deck.main[deck.champion] || 0) + 1 }
    : deck.main;
  const curveHtml = renderEnergyCurve("Maindeck energy", computeEnergyCurve(mainPlusChampion));
  const powerHtml = renderPowerByDomain(computePowerByDomain(mainPlusChampion));

  const legendName = deck.legend ? nameOf(deck.legend) : "—";

  return `<section class="deck-panel">
    <header class="deck-panel-header">
      <div>
        <h2>${escapeHtml(tabName)}</h2>
        <div class="legend-name">${escapeHtml(legendName)}</div>
      </div>
      <span class="${completionCls}">${escapeHtml(completionTxt)}</span>
    </header>
    ${sections.join("")}
    ${curveHtml}
    ${powerHtml}
  </section>`;
}

// ---------- main render ----------
function renderAll() {
  const grid = document.getElementById("lineup-grid");
  if (!grid) return;
  const locksRaw = window.__LOCKS_RAW__ || {};
  const parsedByTab = {};
  for (const tab of LOCK_TABS) parsedByTab[tab] = parseLockText(locksRaw[tab] || "");
  const usage = computeUsage(parsedByTab);
  // Household summary banner removed — the per-deck panels already
  // surface every shortage/en-route/swap signal inline next to the
  // affected card, so the banner was duplicative noise.
  const panels = LOCK_TABS.map((tab) => renderDeckPanel(tab, parsedByTab[tab], usage));
  grid.innerHTML = panels.join("");
  // If a previously-rendered banner still exists in the DOM (from a
  // cached render pass), drop it so we don't leave stale chrome behind.
  const stale = document.getElementById("household-summary");
  if (stale) stale.remove();
  attachHoverThumb();
}

// First paint: empty placeholders. The collection:updated event fires after
// the Sheet fetch resolves (or fails — in which case __LOCKS_RAW__ stays
// empty and we show empty panels).
function renderSkeleton() {
  const grid = document.getElementById("lineup-grid");
  if (!grid) return;
  grid.innerHTML = LOCK_TABS.map(
    (tab) => `<section class="deck-panel"><header class="deck-panel-header">
      <h2>${escapeHtml(tab)}</h2>
      <span class="completion empty">loading…</span>
    </header><p class="empty-deck">Fetching from the Google Sheet…</p></section>`
  ).join("");
}

// En-route toggle persists across page loads.
const LS_ENROUTE = "lineup:includeEnRoute";
const enrouteEl = document.getElementById("include-enroute");
includeEnRoute = readJSON(LS_ENROUTE, false);
if (enrouteEl) {
  enrouteEl.checked = includeEnRoute;
  enrouteEl.addEventListener("change", () => {
    includeEnRoute = enrouteEl.checked;
    writeJSON(LS_ENROUTE, includeEnRoute);
    renderAll();
  });
}

renderSkeleton();
// If the static defaults already have data and the sheet has loaded its
// raw locks (rare race — usually we wait for the event), render now too.
if (window.__LOCKS_RAW__) renderAll();

window.addEventListener("collection:updated", () => {
  owned = window.__OWNED_DEFAULTS__ || {};
  enRoute = window.__EN_ROUTE_DEFAULTS__ || {};
  renderAll();
});
