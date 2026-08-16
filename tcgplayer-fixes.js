"use strict";

/**
 * Card-name overrides for TCGplayer's mass-entry format.
 *
 * 2026-06 correction: TCGplayer lists Riftbound cards as "Name, Epithet"
 * with a COMMA — legends included ("Rengar, Pridestalker", "Kha'Zix,
 * Voidreaver"; verified via live product search). The old default rule
 * here rewrote commas to " - ", which was wrong across the board, so the
 * default is now identity: emit the card name exactly as our catalog has
 * it.
 *
 * The fixes table only handles true SPELLING divergences between
 * riftdecks' names (our catalog) and TCGplayer's:
 *   - riftdecks drops the apostrophe/caps on the Kha'Zix legend.
 *   - riftdecks lowercases the S in the Kai'Sa legend.
 *
 * Keys: the exact card name as it appears in our catalog.
 * Values: the literal string to emit in plaintext copies.
 */
window.__TCGPLAYER_FIXES__ = {
  "Khazix, Voidreaver": "Kha'Zix, Voidreaver",
  "Kai'sa, Daughter of the Void": "Kai'Sa, Daughter of the Void",
};

function tcgplayerName(rawName) {
  const fixes = window.__TCGPLAYER_FIXES__ || {};
  if (Object.prototype.hasOwnProperty.call(fixes, rawName)) {
    return fixes[rawName];
  }
  return String(rawName);
}
