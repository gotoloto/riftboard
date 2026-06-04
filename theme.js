// Light/dark theme toggle. Each page loads theme.js once. The boot
// script in <head> sets html[data-theme] from localStorage (or system
// preference) BEFORE the CSS applies, avoiding a flash; this file
// just renders the toggle button + wires the click.
//
// State lives in localStorage under "theme" — values "light" | "dark".
// Absence = no manual choice; we mirror system preference.
(function () {
  const KEY = "theme";

  function systemPrefersDark() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function currentTheme() {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
    return systemPrefersDark() ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }

  function flip() {
    apply(currentTheme() === "dark" ? "light" : "dark");
    renderBtn();
  }

  function renderBtn() {
    let btn = document.getElementById("theme-toggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "theme-toggle";
      btn.type = "button";
      btn.className = "theme-toggle";
      btn.setAttribute("aria-label", "Toggle theme");
      btn.addEventListener("click", flip);
      document.body.appendChild(btn);
    }
    const dark = currentTheme() === "dark";
    // ☾ = waxing crescent (text glyph, no emoji rendering). ☀ = sun.
    btn.textContent = dark ? "☀" : "☾";
    btn.title = dark ? "Switch to light mode" : "Switch to dark mode";
  }

  // Boot: in case the inline <head> snippet didn't run (or this file is
  // loaded standalone), make sure data-theme is set.
  if (!document.documentElement.dataset.theme) {
    apply(currentTheme());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBtn);
  } else {
    renderBtn();
  }
})();
