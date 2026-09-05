/* 闲然导航 · 星轨图标系统
 * 原创宇宙导航线性图标，统一替换首页的 emoji / 文字符号入口。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AstralIcons = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const paths = Object.freeze({
    star: '<path d="M12 2.5 14.2 9.8 21.5 12l-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2Z"/><circle cx="12" cy="12" r="8.7" opacity=".45"/>',
    install: '<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M5 17.5v2h14v-2"/><path d="m18.5 4 .5 1.5L20.5 6 19 6.5 18.5 8 18 6.5 16.5 6l1.5-.5Z"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3v5m8-5v5M4 10h16"/><path d="m12 12 .8 2.1L15 15l-2.2.8L12 18l-.8-2.2L9 15l2.2-.9Z"/>',
    tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 4.8m-3.5 7.1 1.2 1.2L7 10.7m-3.5 7.2 1.2 1.2L7 16.7"/>',
    pet: '<path d="M8.2 12.5c-2.4 1.5-3.6 3.4-3 5.2.8 2.4 3.5 2.5 6.8.7 3.3 1.8 6 1.7 6.8-.7.6-1.8-.6-3.7-3-5.2"/><circle cx="7" cy="7.7" r="2"/><circle cx="12" cy="5.5" r="2"/><circle cx="17" cy="7.7" r="2"/>',
    library: '<path d="M5 4.5h5v15H5zM14 4.5h5v15h-5z"/><path d="M10 7h4m-4 9h4"/><path d="m16.5 8 .6 1.5 1.4.5-1.4.6-.6 1.4-.5-1.4-1.5-.6 1.5-.5Z"/>',
    theme: '<path d="M19.5 14.2A8 8 0 1 1 9.8 4.5a6.3 6.3 0 0 0 9.7 9.7Z"/><path d="m17 3 .6 1.8L19.5 5l-1.9.7L17 7.5l-.7-1.8L14.5 5l1.8-.2Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v3m0 12.4v3M2.8 12h3m12.4 0h3M5.5 5.5l2.1 2.1m8.8 8.8 2.1 2.1m0-13-2.1 2.1m-8.8 8.8-2.1 2.1"/><circle cx="12" cy="12" r="8.5" opacity=".35"/>',
    logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/><path d="m17 3 .5 1.3L19 5l-1.5.5L17 7l-.5-1.5L15 5l1.5-.7Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m10.5 7 .7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z"/>',
    signal: '<path d="M4 15.5a11 11 0 0 1 16 0M7 18.5a7 7 0 0 1 10 0M10 21a3 3 0 0 1 4 0"/><path d="m12 3 .7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z"/>',
    weather: '<path d="M7.5 18h10a4 4 0 0 0 .2-8A6 6 0 0 0 6.2 9.4 4.4 4.4 0 0 0 7.5 18Z"/><path d="m17 3 .6 1.7 1.7.6-1.7.6L17 7.6l-.6-1.7-1.7-.6 1.7-.6Z"/>',
    station: '<path d="M5 19V8l7-4 7 4v11"/><path d="M3 19h18M8 19v-6h8v6M8 9h8"/><path d="m12 6 .7 1.7 1.8.6-1.8.7-.7 1.7-.7-1.7-1.8-.7 1.8-.6Z"/>',
    folder: '<path d="M3 7.5h7l2-2h9v13H3Z"/><path d="m16.5 9 .6 1.8 1.9.7-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.7Z"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    details: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16m3-11h7m-7 4h7m-7 4h4"/>',
    edit: '<path d="m5 16-.8 3.8L8 19l10.6-10.6-3-3Z"/><path d="m13.8 7.2 3 3"/><path d="m18 3 .7 1.7 1.8.6-1.8.7-.7 1.7-.7-1.7-1.8-.7 1.8-.6Z"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18h1.3a2.1 2.1 0 0 0 1.5-3.6 1.9 1.9 0 0 1 1.4-3.2H18A3 3 0 0 0 21 11a8 8 0 0 0-9-8Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.8" r="1"/><circle cx="14.5" cy="7" r="1"/>',
    up: '<path d="m6 14 6-6 6 6"/><path d="M12 8v11"/>',
    down: '<path d="m6 10 6 6 6-6"/><path d="M12 5v11"/>',
    previous: '<path d="m14.5 5-7 7 7 7"/><path d="M18.5 4.5v15" opacity=".35"/>',
    next: '<path d="m9.5 5 7 7-7 7"/><path d="M5.5 4.5v15" opacity=".35"/>',
    upload: '<path d="M12 21V10m0 0-4 4m4-4 4 4"/><path d="M5 6.5v-2h14v2"/><path d="m18.5 16 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/><circle cx="12" cy="12" r="9" opacity=".35"/>',
    add: '<path d="M12 5v14M5 12h14"/><path d="m18.5 3 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z"/>',
    music: '<path d="M9 18V6l11-2v11"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="15" r="3"/><path d="m4 5 .6 1.7 1.7.6-1.7.6L4 9.6l-.6-1.7-1.7-.6 1.7-.6Z"/>',
  });

  function markup(name, className) {
    const body = paths[name] || paths.star;
    const cls = className ? `astral-icon ${className}` : "astral-icon";
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  function mount(el, name) {
    if (!el || el.tagName === "IMG") return el;
    const iconName = name || el.dataset?.astralIcon || "star";
    el.innerHTML = markup(iconName);
    if (el.dataset) el.dataset.astralIcon = iconName;
    return el;
  }

  function mountAll(scope) {
    const root = scope || (typeof document !== "undefined" ? document : null);
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("[data-astral-icon]").forEach((el) => mount(el));
    root.querySelectorAll(".close-btn[data-close], .dialog-header .icon-btn[data-close], #cal-close, .music-close-btn, .ai-close-btn").forEach((button) => {
      button.classList.add("astral-close-btn");
      if (!button.querySelector(".astral-icon")) button.innerHTML = markup("close", "astral-close-icon");
    });
  }

  if (typeof document !== "undefined") mountAll(document);
  return { paths, markup, mount, mountAll };
});
