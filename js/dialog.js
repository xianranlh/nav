/* 🪟 对话框统一管理器（window.Dlg）
 * - Dlg.open(idOrEl) / Dlg.close(idOrEl)：安全打开 + 带关闭动画（.closing → styles/dialogs.css）
 * - 全局行为集中于此：
 *     [data-close] 点击关闭（原在 app.js 杂项区）
 *     点击遮罩关闭 —— 仅对声明了 data-backdrop-close 的浏览型对话框（编辑表单类不启用，防误触丢输入）
 *     Esc（原生 cancel）拦截为动画关闭
 *     未保存离开提示（data-guard-unsaved 表单 / 默认识别编辑类 method=dialog 表单）
 * - 派发 dialog:opened / dialog:closed 事件（bubbles），供模块监听
 * - 兼容：直调原生 showModal()/close() 仍可用，只是没有关闭动画
 */
(function () {
  "use strict";

  const CLOSING = "closing";
  const VANISH_FALLBACK_MS = 260; // 关闭动画 0.18s + 余量,防 animationend 丢失
  const CLEAN = "data-dlg-clean";
  const GUARD = "data-guard-unsaved";

  function el(x) {
    if (!x) return null;
    if (typeof x === "string") return document.getElementById(x.replace(/^#/, ""));
    return x;
  }

  function formsOf(d) {
    return [...d.querySelectorAll("form")];
  }

  function serializeForm(form) {
    try {
      const parts = [];
      const fd = new FormData(form);
      for (const [k, v] of fd.entries()) parts.push(k + "=" + String(v));
      // unchecked checkboxes/radios not in FormData — include explicit off state
      form.querySelectorAll('input[type="checkbox"][name]').forEach((cb) => {
        if (!fd.has(cb.name)) parts.push(cb.name + "=");
      });
      return parts.sort().join("\n");
    } catch (_) {
      return "";
    }
  }

  function shouldGuard(form) {
    if (!form) return false;
    if (form.getAttribute("data-no-guard") != null) return false;
    if (form.hasAttribute(GUARD)) return true;
    // default: known editor forms only (settings auto-save live — do not guard)
    const id = form.id || "";
    if (/^form-(link|group|task|music|persona|provider)/.test(id)) return true;
    return false;
  }

  function markClean(form) {
    if (!form) return;
    form.setAttribute(CLEAN, serializeForm(form));
  }

  function isDirty(form) {
    if (!form || !shouldGuard(form)) return false;
    const snap = form.getAttribute(CLEAN);
    if (snap == null) return false;
    return serializeForm(form) !== snap;
  }

  function dialogIsDirty(d) {
    return formsOf(d).some(isDirty);
  }

  function confirmDiscard(d) {
    if (!dialogIsDirty(d)) return true;
    try {
      return window.confirm("有未保存的更改，确定关闭？");
    } catch (_) {
      return true;
    }
  }

  function open(x) {
    const d = el(x);
    if (!d) return null;
    d.classList.remove(CLOSING);
    if (d.open) return d;
    // Web Interface Guidelines: modal dialogs announce as modal
    try {
      d.setAttribute("aria-modal", "true");
      if (!d.getAttribute("role")) d.setAttribute("role", "dialog");
    } catch (_) {}
    if (typeof d.showModal === "function") {
      try { d.showModal(); } catch (_) { try { d.setAttribute("open", ""); } catch (_) {} }
    } else {
      try { d.setAttribute("open", ""); } catch (_) {}
    }
    // Focus first focusable control (or dialog) after open; snapshot clean form state
    requestAnimationFrame(() => {
      try {
        formsOf(d).forEach((f) => { if (shouldGuard(f)) markClean(f); });
        const focusable = d.querySelector(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        (focusable || d).focus?.({ preventScroll: true });
      } catch (_) {}
    });
    d.dispatchEvent(new CustomEvent("dialog:opened", { bubbles: true }));
    return d;
  }

  let submitCloseGuard = false;

  function close(x, returnValue, opts) {
    const d = el(x);
    if (!d || !d.open || d.classList.contains(CLOSING)) return;
    const force = !!(opts && opts.force) || submitCloseGuard;
    if (!force && !confirmDiscard(d)) return;
    // save/submit paths skip discard confirm and reset snap
    if (force) formsOf(d).forEach(markClean);
    const finish = () => {
      d.classList.remove(CLOSING);
      try {
        if (returnValue !== undefined) d.close(returnValue);
        else d.close();
      } catch (_) { d.removeAttribute("open"); }
      formsOf(d).forEach((f) => f.removeAttribute(CLEAN));
      d.dispatchEvent(new CustomEvent("dialog:closed", { bubbles: true }));
    };
    const inner = d.querySelector(":scope > form, :scope > .dialog-form");
    if (!inner) { finish(); return; }
    d.classList.add(CLOSING);
    const timer = setTimeout(finish, VANISH_FALLBACK_MS);
    inner.addEventListener("animationend", () => { clearTimeout(timer); finish(); }, { once: true });
  }

  function markFormClean(formOrId) {
    const f = typeof formOrId === "string" ? document.getElementById(formOrId) : formOrId;
    if (f) markClean(f);
  }

  // ===== 全局：[data-close] + 遮罩点击 =====
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-close]");
    if (btn) {
      const d = btn.closest("dialog");
      if (d) close(d);
      return;
    }
    // 点击遮罩：target 是 <dialog> 本身且坐标落在内容矩形之外
    const d = e.target;
    if (
      d instanceof HTMLDialogElement && d.open &&
      d.hasAttribute("data-backdrop-close") && !d.classList.contains(CLOSING)
    ) {
      const r = d.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) close(d);
    }
  });

  // ===== Esc（原生 cancel，不冒泡 → 捕获阶段）拦截为动画关闭 =====
  document.addEventListener("cancel", (e) => {
    const d = e.target;
    if (d instanceof HTMLDialogElement && d.open && !d.classList.contains(CLOSING)) {
      e.preventDefault();
      close(d);
    }
  }, true);

  // 表单 submit 后常紧接着 Dlg.close：短时放行，避免「保存后仍弹出未保存提示」
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form || form.tagName !== "FORM" || !shouldGuard(form)) return;
    submitCloseGuard = true;
    setTimeout(() => { submitCloseGuard = false; }, 0);
  }, true);

  // 离开页面：若有打开且脏的对话框则提示
  window.addEventListener("beforeunload", (e) => {
    const dirty = [...document.querySelectorAll("dialog[open]")].some(dialogIsDirty);
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  window.Dlg = { open, close, markClean: markFormClean, isDirty: (x) => {
    const d = el(x);
    return d ? dialogIsDirty(d) : false;
  } };
})();