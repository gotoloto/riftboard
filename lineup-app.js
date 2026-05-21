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

// Allocation priority order. The household pool of any given card is
// distributed to decks in this order; whichever deck comes first 'claims'
// the copies, later decks see the remaining pool. This matches the
// user's mental model — A decks are the primary commitment, B decks
// are alternates that have to share the leftovers.
const LOCK_TABS = ["Travis A🔒", "Travis B🔒", "Santiago A🔒", "Santiago B🔒"];
// Just for the "this card is shared between players" informational
// signal — the actual allocation walks every deck independently.
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

function itemRow(slug, qty, usage, tab) {
  // Per-deck render. The card row's status depends on whether THIS deck
  // got its full allocation — if an earlier-priority deck used up the
  // household pool, this row is marked short with the missing count.
  const u = usage[slug];
  const own = u?.owned ?? ownedFor(slug);
  const here = u?.perDeck?.[tab] || { qty, allocated: qty, short: 0 };
  let cls = "";
  let marker = "";
  let qtyHtml = `<span class="qty">${qty}×</span>`;
  if (here.short > 0) {
    cls = "short";
    qtyHtml = `<span class="qty">${here.allocated}/${qty}×</span>`;
    marker = `<span class="share-mark" aria-hidden="true">⚠</span>`;
  } else if (u && u.shared) {
    cls = "shared";
    marker = `<span class="share-mark" aria-hidden="true" title="Used by another deck — copies were claimed by priority">⚠</span>`;
  }
  // Per-deck breakdown ('Travis A 3, Travis B 3, Santiago A 0…').
  let breakdown = "";
  if (u && u.shared) {
    breakdown = LOCK_TABS
      .filter((t) => u.perDeck[t].qty > 0)
      .map((t) => `${t.replace("🔒", "").trim()} ${u.perDeck[t].qty}`)
      .join(" + ");
  }
  const title = here.short > 0
    ? `Need ${here.qty} here, allocated ${here.allocated} (household pool exhausted by higher-priority decks) — short ${here.short}. Household need ${u.householdNeed}, own ${own}.${breakdown ? "  " + breakdown : ""}`
    : u && u.shared
      ? `Need ${here.qty} here. Also used by another deck. Household need ${u.householdNeed}, own ${own}.  ${breakdown}`
      : `Need ${here.qty}, own ${own}`;
  return `<li class="${cls}" data-slug="${escapeHtml(slug)}" title="${escapeHtml(title)}">
    ${qtyHtml}
    <span class="own">/${own}</span>
    <span class="card-name"${imgOf(slug)}>${escapeHtml(nameOf(slug))}${marker}</span>
  </li>`;
}

function tallyDeckTotals(deck) {
  // Returns { slug: total_copies_used_across_all_sections }.
  const t = {};
  const add = (slug, n) => { if (slug) t[slug] = (t[slug] || 0) + n; };
  if (deck.legend) add(deck.legend, 1);
  if (deck.champion) add(deck.champion, 1);
  for (const [s, q] of Object.entries(deck.main)) add(s, q);
  for (const [s, q] of Object.entries(deck.battlefields)) add(s, q);
  for (const [s, q] of Object.entries(deck.side)) add(s, q);
  return t;
}

function playerOfTab(tab) {
  // First word of the tab name, e.g. 'Travis A🔒' → 'Travis'.
  return (tab.match(/^(\S+)/) || [, ""])[1];
}

function computeUsage(parsedByTab) {
  // For every slug used by any deck, walk the 4 decks in LOCK_TABS order
  // and allocate owned copies greedily — A decks claim first, B decks get
  // what's left. No deck shares with any other deck (intra- or cross-
  // player) because the cards are committed once locked into a deck.
  //
  // Returns { slug: {
  //   perDeck: {tab: {qty, allocated, short}},
  //   householdNeed:   sum of qty across all 4 decks,
  //   owned:           ownedFor(slug),
  //   short:           any deck couldn't get all its copies,
  //   shared:          ≥2 decks use this card (informational),
  //   sharedByPlayers: ≥2 distinct players use it (subset of shared)
  // }}
  const tallies = {};
  const allSlugs = new Set();
  for (const tab of LOCK_TABS) {
    const t = tallyDeckTotals(parsedByTab[tab] || {});
    tallies[tab] = t;
    for (const s of Object.keys(t)) allSlugs.add(s);
  }
  const usage = {};
  for (const slug of allSlugs) {
    let pool = ownedFor(slug);
    const perDeck = {};
    let totalNeeded = 0;
    let decksUsingCount = 0;
    const playersSet = new Set();
    for (const tab of LOCK_TABS) {
      const qty = tallies[tab][slug] || 0;
      totalNeeded += qty;
      if (qty <= 0) {
        perDeck[tab] = { qty: 0, allocated: 0, short: 0 };
        continue;
      }
      decksUsingCount += 1;
      playersSet.add(playerOfTab(tab));
      const allocated = Math.max(0, Math.min(pool, qty));
      const short = qty - allocated;
      perDeck[tab] = { qty, allocated, short };
      pool = Math.max(0, pool - allocated);
    }
    const isShort = Object.values(perDeck).some((d) => d.short > 0);
    usage[slug] = {
      perDeck,
      householdNeed: totalNeeded,
      owned: ownedFor(slug),
      short: isShort,
      shared: decksUsingCount >= 2,
      sharedByPlayers: playersSet.size >= 2,
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
  // Per-card status IN THIS DECK — uses the per-deck allocation from
  // computeUsage. A card is short here if higher-priority decks already
  // claimed the household's copies.
  let shortCards = 0;
  let shortCopies = 0;
  let sharedCards = 0;
  for (const slug of Object.keys(totals)) {
    const u = usage[slug];
    if (!u) continue;
    const here = u.perDeck[tabName] || { qty: 0, short: 0 };
    if (here.short > 0) {
      shortCards += 1;
      shortCopies += here.short;
    } else if (u.shared) {
      sharedCards += 1;
    }
  }
  let completionTxt, completionCls;
  if (shortCards > 0) {
    completionTxt = `Short ${shortCopies} cop${shortCopies === 1 ? "y" : "ies"} (${shortCards} card${shortCards === 1 ? "" : "s"})`;
    completionCls = "completion short";
  } else if (sharedCards > 0) {
    completionTxt = `Have all · ${sharedCards} shared`;
    completionCls = "completion shared";
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
      <ul class="deck-list">${itemRow(deck.legend, 1, usage, tabName)}</ul>
    </section>`);
  }
  // Champion
  if (deck.champion) {
    sections.push(`<section class="deck-section">
      <header><span>Champion</span><span>1/1</span></header>
      <ul class="deck-list">${itemRow(deck.champion, 1, usage, tabName)}</ul>
    </section>`);
  }
  // Battlefields
  const bfEntries = sortByName(Object.entries(deck.battlefields));
  if (bfEntries.length) {
    const bfTotal = bfEntries.reduce((s, [, q]) => s + q, 0);
    sections.push(`<section class="deck-section">
      <header><span>Battlefields</span><span>${bfTotal}/3</span></header>
      <ul class="deck-list">${bfEntries.map(([s, q]) => itemRow(s, q, usage, tabName)).join("")}</ul>
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
      <ul class="deck-list">${list.map(([s, q]) => itemRow(s, q, usage, tabName)).join("")}</ul>
    </section>`);
  }
  // Sideboard
  const sideEntries = sortByName(Object.entries(deck.side));
  if (sideEntries.length) {
    const sideTotal = sideEntries.reduce((s, [, q]) => s + q, 0);
    sections.push(`<section class="deck-section">
      <header><span>Sideboard</span><span>${sideTotal}/8</span></header>
      <ul class="deck-list">${sideEntries.map(([s, q]) => itemRow(s, q, usage, tabName)).join("")}</ul>
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
  renderHouseholdSummary(usage);
  const panels = LOCK_TABS.map((tab) => renderDeckPanel(tab, parsedByTab[tab], usage));
  grid.innerHTML = panels.join("");
  attachHoverThumb();
}

function renderHouseholdSummary(usage) {
  // Banner above the grid summarising cross-player sharing/shortfalls.
  let host = document.getElementById("household-summary");
  if (!host) {
    host = document.createElement("section");
    host.id = "household-summary";
    host.className = "household-summary";
    const grid = document.getElementById("lineup-grid");
    grid.parentNode.insertBefore(host, grid);
  }
  const entries = Object.values(usage);
  if (!entries.length) { host.innerHTML = ""; return; }
  const shortEntries = Object.entries(usage)
    .filter(([, u]) => u.short)
    .sort((a, b) => (b[1].householdNeed - b[1].owned) - (a[1].householdNeed - a[1].owned));
  const sharedEntries = Object.entries(usage)
    .filter(([, u]) => !u.short && u.shared)
    .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  const breakdownOf = (u) =>
    LOCK_TABS
      .filter((t) => u.perDeck[t].qty > 0)
      .map((t) => {
        const d = u.perDeck[t];
        const tabLabel = t.replace("🔒", "").trim();
        return d.short > 0 ? `${tabLabel} ${d.qty} (need ${d.short})` : `${tabLabel} ${d.qty}`;
      })
      .join(" + ");
  const totalShort = (u) =>
    Object.values(u.perDeck).reduce((s, d) => s + d.short, 0);
  const shortListItems = shortEntries
    .slice(0, 20)
    .map(([slug, u]) => {
      return `<li><span class="card-name" data-slug="${escapeHtml(slug)}"${imgOf(slug)}>${escapeHtml(nameOf(slug))}</span>
        <span class="need">need <strong>${u.householdNeed}</strong> (${escapeHtml(breakdownOf(u))}) · own ${u.owned} · <strong>short ${totalShort(u)}</strong></span></li>`;
    })
    .join("");
  const sharedListItems = sharedEntries
    .slice(0, 20)
    .map(([slug, u]) => {
      return `<li><span class="card-name" data-slug="${escapeHtml(slug)}"${imgOf(slug)}>${escapeHtml(nameOf(slug))}</span>
        <span class="need">${escapeHtml(breakdownOf(u))} · own ${u.owned}</span></li>`;
    })
    .join("");
  const blocks = [];
  if (shortEntries.length) {
    blocks.push(`<details class="hh-block hh-short" open>
      <summary>⚠ <strong>${shortEntries.length}</strong> card${shortEntries.length === 1 ? "" : "s"} short — the household pool can't satisfy every deck. Lower-priority decks (B over A, Santiago over Travis) take the hit.</summary>
      <ul>${shortListItems}${shortEntries.length > 20 ? `<li class="more">… +${shortEntries.length - 20} more</li>` : ""}</ul>
    </details>`);
  }
  if (sharedEntries.length) {
    blocks.push(`<details class="hh-block hh-shared">
      <summary>👥 ${sharedEntries.length} card${sharedEntries.length === 1 ? "" : "s"} used by multiple decks (household has enough copies)</summary>
      <ul>${sharedListItems}${sharedEntries.length > 20 ? `<li class="more">… +${sharedEntries.length - 20} more</li>` : ""}</ul>
    </details>`);
  }
  host.innerHTML = blocks.length
    ? blocks.join("")
    : `<p class="hh-ok">✓ Every deck can be fielded simultaneously — no card is over-claimed.</p>`;
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
