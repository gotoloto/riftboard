"use strict";

/**
 * Card-name overrides for TCGplayer's mass-entry format.
 *
 * The default rule is "replace any comma + space with ' - '" (e.g.
 * "Lillia, Fae Fawn" → "Lillia - Fae Fawn"). A handful of cards don't follow
 * that pattern — either because the source spells the name without a needed
 * apostrophe (Kha'zix), or because TCGplayer keeps the comma rather than
 * splitting (Allay). Add entries here as you discover them.
 *
 * Keys: the exact card name as it appears in our dashboard.
 * Values: the literal string we should emit in the plaintext copy.
 */
window.__TCGPLAYER_FIXES__ = {
  "Khazix, Voidreaver": "Kha'zix - Voidreaver",
  "Allay, Eager Admirer": "Allay, Eager Admirer",
};

function tcgplayerName(rawName) {
  const fixes = window.__TCGPLAYER_FIXES__ || {};
  if (Object.prototype.hasOwnProperty.call(fixes, rawName)) {
    return fixes[rawName];
  }
  return String(rawName).replace(/,\s*/g, " - ");
}
