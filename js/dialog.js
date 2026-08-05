/* 🪟 对话框统一管理器（window.Dlg）
 * - Dlg.open(idOrEl) / Dlg.close(idOrEl)：安全打开 + 带关闭动画（.closing → styles/dialogs.css）
 * - 全局行为集中于此：
 *     [data-close] 点击关闭（原在 app.js 杂项区）
 *     点击遮罩关闭 —— 仅对声明了 data-backdrop-close 的浏览型对话框（编辑表单类不启用，防误触丢输入）
 *     Esc（原生 cancel）拦截为动画关闭
 * - 派发 dialog:opened / dialog:closed 事件（bubbles），供模块监听
 * - 兼容：直调原生 showModal()/close() 仍可用，只是没有关闭动画
 */
(function () {
  "use strict";

  const CLOSING = "closing";
  const VANISH_FALLBACK_MS = 260; // 关闭动画 0.18s + 余量,防 animationend 丢失

  function el(x) {
    if (!x) return null;
    if (typeof x === "string") return document.getElementById(x.replace(/^#/, ""));
    return x;
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
    // Focus first focusable control (or dialog) after open
    requestAnimationFrame(() => {
      try {
        const focusable = d.querySelector(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        (focusable || d).focus?.({ preventScroll: true });
      } catch (_) {}
    });
    d.dispatchEvent(new CustomEvent("dialog:opened", { bubbles: true }));
    return d;
  }

  function close(x, returnValue) {
    const d = el(x);
    if (!d || !d.open || d.classList.contains(CLOSING)) return;
    const finish = () => {
      d.classList.remove(CLOSING);
      try {
        if (returnValue !== undefined) d.close(returnValue);
        else d.close();
      } catch (_) { d.removeAttribute("open"); }
      d.dispatchEvent(new CustomEvent("dialog:closed", { bubbles: true }));
    };
    const inner = d.querySelector(":scope > form, :scope > .dialog-form");
    if (!inner) { finish(); return; }
    d.classList.add(CLOSING);
    const timer = setTimeout(finish, VANISH_FALLBACK_MS);
    inner.addEventListener("animationend", () => { clearTimeout(timer); finish(); }, { once: true });
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

  window.Dlg = { open, close };
})();
