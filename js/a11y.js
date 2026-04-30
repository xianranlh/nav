/* Accessibility helpers for dialogs and keyboard focus. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageA11y = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  function stripTags(html) {
    return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function buttonLabelAudit(html) {
    const missing = [];
    const buttons = [];
    const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
    let match;
    while ((match = re.exec(String(html || "")))) {
      const attrs = match[1] || "";
      const body = stripTags(match[2] || "");
      const id = (/id=(["'])(.*?)\1/i.exec(attrs) || [])[2] || "";
      const aria = (/aria-label=(["'])(.*?)\1/i.exec(attrs) || [])[2] || "";
      const title = (/title=(["'])(.*?)\1/i.exec(attrs) || [])[2] || "";
      const ok = !!(aria || title || body);
      const item = { id, text: body, hasLabel: ok };
      buttons.push(item);
      if (!ok) missing.push(item);
    }
    return { buttons, missing };
  }

  function focusableElements(container) {
    return [...(container?.querySelectorAll?.(focusableSelector) || [])]
      .filter((el) => !el.hidden && el.offsetParent !== null);
  }

  function trapFocus(container, event) {
    if (!container || !event || event.key !== "Tab") return false;
    const items = focusableElements(container);
    if (!items.length) return false;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function enhanceDialog(dialog) {
    if (!dialog || dialog.dataset.a11yEnhanced === "1") return;
    dialog.dataset.a11yEnhanced = "1";
    dialog.setAttribute("role", "dialog");
    dialog.addEventListener("keydown", (event) => trapFocus(dialog, event));
  }

  return {
    focusableSelector,
    buttonLabelAudit,
    trapFocus,
    enhanceDialog,
  };
});
