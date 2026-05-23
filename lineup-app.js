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

function itemRow(slug, qty, usage, tab) {
  // Per-deck render. Severity (red > amber > default) drives the row
  // background; an extra ⇄ marker shows when this card needs to be
  // physically swapped between the current player's A and B decks
  // (informational — same player so it's fine, just a logistics note).
  const u = usage[slug];
  const own = u?.owned ?? ownedFor(slug);
  const player = playerOfTab(tab);
  const myPlayerNeed = u?.perPlayer?.[player] ?? qty;

  let cls = "";
  let severityMark = "";
  const here = u?.perDeck?.[tab] || { qty, swap: false };
  if (u?.short) {
    cls = "short";
    severityMark = `<span class="severity-mark" aria-hidden="true">⚠</span>`;
  } else if (u?.enrouteDependent) {
    // Household need exceeds raw owned but owned + en-route covers it.
    // The deck literally can't be assembled until the en-route copies
    // arrive — flag it distinctly.
    cls = "enroute";
    severityMark = `<span class="severity-mark" aria-hidden="true">✈</span>`;
  } else if (u?.crossPlayerShared) {
    cls = "shared";
    severityMark = `<span class="severity-mark" aria-hidden="true">⚠</span>`;
  } else if (here.swap) {
    // Pure intra-player swap (not short, not cross-player-shared) — give
    // it a blue tint so the row pops in BOTH A and B for that player.
    cls = "swap";
  }
  // Swap marker always shows when this row needs shuttling between the
  // player's A and B decks, regardless of the severity class above.
  // Glyph is ⇄ (U+21C4) — a text-class arrow that picks up the current
  // CSS color, unlike the 🔄 emoji which always renders multicolor.
  const swapMark = here.swap
    ? `<span class="swap-mark" title="Swap this card between your A and B decks between games">⇄</span>`
    : "";

  // Per-player breakdown ('Travis 3 + Santi 3').
  const playerBreakdown = u
    ? Object.entries(u.perPlayer)
        .filter(([, v]) => v > 0)
        .map(([p, v]) => `${p} ${v}`)
        .join(" + ")
    : "";

  let title;
  if (u?.short) {
    title = `Cross-player conflict: household needs ${u.householdNeed} (${playerBreakdown}), own ${own} — short ${u.householdNeed - own}.`;
  } else if (u?.enrouteDependent) {
    const ownRaw = u.ownedRaw;
    const enr = u.enroute;
    title = `Needs en-route copies: household need ${u.householdNeed} (${playerBreakdown}), owned ${ownRaw} + en-route ${enr} = ${ownRaw + enr}. Card can't be fielded until it arrives.`;
  } else if (u?.crossPlayerShared) {
    title = `Both players use this. ${playerBreakdown} · own ${own}.`;
  } else if (u?.intraPlayerSwap) {
    title = `${player} runs this in both A and B (${qty}× here) — swap between decks between games. Own ${own}.`;
  } else {
    title = `Need ${qty}, own ${own}.`;
  }

  return `<li class="${cls}" data-slug="${escapeHtml(slug)}" title="${escapeHtml(title)}">
    <span class="qty">${qty}×</span>
    <span class="own">/${own}</span>
    <span class="card-name"${imgOf(slug)}>${escapeHtml(nameOf(slug))}${severityMark}${swapMark}</span>
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
  // For every slug used by any deck, compute:
  //   perPlayer[player]    — max(qty across that player's A + B)
  //   perDeck[tab].qty     — copies that deck explicitly lists
  //   perDeck[tab].swap    — true if the same player's OTHER deck also
  //                           uses this card (needs to be physically
  //                           shuttled between decks between games)
  //   householdNeed         — sum across players (cross-player no-share)
  //   owned                 — ownedFor(slug) at current toggle state
  //   short                 — householdNeed > owned (cross-player conflict)
  //   crossPlayerShared     — both Travis AND Santi want this card
  //   intraPlayerSwap       — any one player uses it in both A and B
  const tallies = {};
  const allSlugs = new Set();
  for (const tab of LOCK_TABS) {
    const t = tallyDeckTotals(parsedByTab[tab] || {});
    tallies[tab] = t;
    for (const s of Object.keys(t)) allSlugs.add(s);
  }
  const usage = {};
  for (const slug of allSlugs) {
    const perPlayer = {};
    const usedByDecks = {}; // {player: [tab1, tab2]} that need ≥1 copy
    for (const player of PLAYERS) {
      let maxNeed = 0;
      const decks = [];
      for (const tab of LOCK_TABS) {
        if (playerOfTab(tab) !== player) continue;
        const q = tallies[tab][slug] || 0;
        if (q > 0) {
          maxNeed = Math.max(maxNeed, q);
          decks.push(tab);
        }
      }
      perPlayer[player] = maxNeed;
      usedByDecks[player] = decks;
    }
    const householdNeed = Object.values(perPlayer).reduce((s, v) => s + v, 0);
    const own = ownedFor(slug);
    // Independent en-route classification: ignores the include-en-route
    // toggle entirely and asks 'does this deck need en-route copies?'
    const ownedRaw = window.__OWNED_DEFAULTS__?.[slug] || 0;
    const enr = window.__EN_ROUTE_DEFAULTS__?.[slug] || 0;
    const short = householdNeed > ownedRaw + enr;
    const enrouteDependent = !short && householdNeed > ownedRaw;
    const playersUsing = Object.values(perPlayer).filter((v) => v > 0).length;
    const intraPlayerSwap = Object.values(usedByDecks).some((arr) => arr.length >= 2);

    // Per-deck info: what this specific deck explicitly lists + whether
    // the same player's other deck also wants it (=> swap required).
    const perDeck = {};
    for (const tab of LOCK_TABS) {
      const qty = tallies[tab][slug] || 0;
      const playersOtherDecks = usedByDecks[playerOfTab(tab)].filter(
        (t) => t !== tab
      );
      perDeck[tab] = {
        qty,
        swap: qty > 0 && playersOtherDecks.length > 0,
      };
    }
    usage[slug] = {
      perPlayer,
      perDeck,
      householdNeed,
      owned: own,
      ownedRaw,
      enroute: enr,
      short,
      enrouteDependent,
      crossPlayerShared: playersUsing >= 2,
      intraPlayerSwap,
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
  // Roll up the deck's own status from the per-card usage.
  let shortCards = 0;
  let shortCopies = 0;
  let enrouteCards = 0;
  let crossSharedCards = 0;
  let swapCards = 0;
  for (const slug of Object.keys(totals)) {
    const u = usage[slug];
    if (!u) continue;
    if (u.short) {
      shortCards += 1;
      shortCopies += (u.householdNeed - u.ownedRaw - u.enroute);
    } else if (u.enrouteDependent) {
      enrouteCards += 1;
    } else if (u.crossPlayerShared) {
      crossSharedCards += 1;
    }
    const here = u.perDeck[tabName];
    if (here && here.swap) swapCards += 1;
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
  const enrouteEntries = Object.entries(usage)
    .filter(([, u]) => !u.short && u.enrouteDependent)
    .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  const sharedEntries = Object.entries(usage)
    .filter(([, u]) => !u.short && !u.enrouteDependent && u.crossPlayerShared)
    .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  const swapEntries = Object.entries(usage)
    .filter(([, u]) => !u.short && !u.enrouteDependent && !u.crossPlayerShared && u.intraPlayerSwap)
    .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])));
  const playerBreakdownOf = (u) =>
    Object.entries(u.perPlayer)
      .filter(([, v]) => v > 0)
      .map(([p, v]) => `${p} ${v}`)
      .join(" + ");
  const shortListItems = shortEntries
    .slice(0, 20)
    .map(([slug, u]) => {
      return `<li><span class="card-name" data-slug="${escapeHtml(slug)}"${imgOf(slug)}>${escapeHtml(nameOf(slug))}</span>
        <span class="need">need <strong>${u.householdNeed}</strong> (${escapeHtml(playerBreakdownOf(u))}) · own ${u.owned} · <strong>short ${u.householdNeed - u.owned}</strong></span></li>`;
    })
    .join("");
  const sharedListItems = sharedEntries
    .slice(0, 20)
    .map(([slug, u]) => {
      return `<li><span class="card-name" data-slug="${escapeHtml(slug)}"${imgOf(slug)}>${escapeHtml(nameOf(slug))}</span>
        <span class="need">${escapeHtml(playerBreakdownOf(u))} · own ${u.owned}</span></li>`;
    })
    .join("");
  const enrouteListItems = enrouteEntries
    .slice(0, 20)
    .map(([slug, u]) => {
      return `<li><span class="card-name" data-slug="${escapeHtml(slug)}"${imgOf(slug)}>${escapeHtml(nameOf(slug))}</span>
        <span class="need">need <strong>${u.householdNeed}</strong> (${escapeHtml(playerBreakdownOf(u))}) · owned ${u.ownedRaw} + en-route ${u.enroute} = ${u.ownedRaw + u.enroute}</span></li>`;
    })
    .join("");
  const swapListItems = swapEntries
    .slice(0, 20)
    .map(([slug, u]) => {
      // Show which player(s) need to swap. The card might be in Travis A
      // & B (Travis swaps), Santi A & B (Santi swaps), or both.
      const swappers = PLAYERS.filter((p) =>
        LOCK_TABS.filter((t) => playerOfTab(t) === p && u.perDeck[t].qty > 0).length >= 2
      ).join(" + ");
      return `<li><span class="card-name" data-slug="${escapeHtml(slug)}"${imgOf(slug)}>${escapeHtml(nameOf(slug))}</span>
        <span class="need">${escapeHtml(swappers)} swap${swappers.includes("+") ? "" : "s"} between decks · own ${u.owned}</span></li>`;
    })
    .join("");
  const blocks = [];
  if (shortEntries.length) {
    blocks.push(`<details class="hh-block hh-short" open>
      <summary>⚠ <strong>${shortEntries.length}</strong> card${shortEntries.length === 1 ? "" : "s"} short — Travis and Santiago both want copies but the household pool (owned + en-route) can't cover both at the same table.</summary>
      <ul>${shortListItems}${shortEntries.length > 20 ? `<li class="more">… +${shortEntries.length - 20} more</li>` : ""}</ul>
    </details>`);
  }
  if (enrouteEntries.length) {
    blocks.push(`<details class="hh-block hh-enroute" open>
      <summary>✈ ${enrouteEntries.length} card${enrouteEntries.length === 1 ? "" : "s"} depend on en-route copies — these decks can't be assembled until shipments arrive.</summary>
      <ul>${enrouteListItems}${enrouteEntries.length > 20 ? `<li class="more">… +${enrouteEntries.length - 20} more</li>` : ""}</ul>
    </details>`);
  }
  if (sharedEntries.length) {
    blocks.push(`<details class="hh-block hh-shared">
      <summary>👥 ${sharedEntries.length} card${sharedEntries.length === 1 ? "" : "s"} required by both players (household has enough copies for each)</summary>
      <ul>${sharedListItems}${sharedEntries.length > 20 ? `<li class="more">… +${sharedEntries.length - 20} more</li>` : ""}</ul>
    </details>`);
  }
  if (swapEntries.length) {
    blocks.push(`<details class="hh-block hh-swap">
      <summary>⇄ ${swapEntries.length} card${swapEntries.length === 1 ? "" : "s"} need swapping between one player's A and B decks (logistics only — no shortfall)</summary>
      <ul>${swapListItems}${swapEntries.length > 20 ? `<li class="more">… +${swapEntries.length - 20} more</li>` : ""}</ul>
    </details>`);
  }
  host.innerHTML = blocks.length
    ? blocks.join("")
    : `<p class="hh-ok">✓ No conflicts — both players can field their decks simultaneously.</p>`;
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
