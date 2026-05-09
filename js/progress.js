/* 樱 · 通用进度覆盖层
 * 用法：
 *   const p = NavProgress.open("导入书签");
 *   p.step(0.35, "正在获取图标 35%");
 *   p.log("已处理 36 个链接");
 *   p.done("完成");     // 或 p.fail("出错了")
 *
 * 异步快捷：
 *   await NavProgress.run("导出静态站", async (p) => { p.step(0.2, "..."); ... });
 *
 * 不确定总量时：p.indeterminate(true); p.setLabel("…")
 */
(function () {
  "use strict";

  let rootEl = null;
  let titleEl = null;
  let labelEl = null;
  let barEl = null;
  let barInner = null;
  let logEl = null;
  let closeBtn = null;
  let active = null;

  function ensureDom() {
    if (rootEl) return;
    rootEl = document.createElement("div");
    rootEl.id = "nav-progress";
    rootEl.className = "nav-progress";
    rootEl.hidden = true;
    rootEl.innerHTML = `
      <div class="nav-progress-card glass">
        <div class="nav-progress-title" data-role="title">处理中…</div>
        <div class="nav-progress-label" data-role="label">准备中</div>
        <div class="nav-progress-bar" data-role="bar"><div class="nav-progress-bar-inner" data-role="barInner"></div></div>
        <div class="nav-progress-log" data-role="log" hidden></div>
        <div class="nav-progress-actions">
          <button type="button" class="btn-secondary" data-role="close" hidden>关闭</button>
        </div>
      </div>`;
    document.body.appendChild(rootEl);
    titleEl = rootEl.querySelector("[data-role=title]");
    labelEl = rootEl.querySelector("[data-role=label]");
    barEl = rootEl.querySelector("[data-role=bar]");
    barInner = rootEl.querySelector("[data-role=barInner]");
    logEl = rootEl.querySelector("[data-role=log]");
    closeBtn = rootEl.querySelector("[data-role=close]");
    closeBtn.addEventListener("click", () => { hide(); });
  }

  function show() { rootEl.hidden = false; requestAnimationFrame(() => rootEl.classList.add("show")); }
  function hide() {
    rootEl.classList.remove("show");
    setTimeout(() => { rootEl.hidden = true; }, 220);
    active = null;
  }

  function open(title) {
    ensureDom();
    titleEl.textContent = title || "处理中…";
    labelEl.textContent = "";
    logEl.innerHTML = "";
    logEl.hidden = true;
    closeBtn.hidden = true;
    barEl.classList.remove("indeterminate", "success", "error");
    barInner.style.width = "0%";
    show();

    const api = {
      step(ratio, label) {
        barEl.classList.remove("indeterminate");
        const pct = Math.max(0, Math.min(1, +ratio || 0)) * 100;
        barInner.style.width = pct.toFixed(1) + "%";
        if (label != null) labelEl.textContent = String(label);
      },
      setLabel(label) { if (label != null) labelEl.textContent = String(label); },
      indeterminate(on = true) {
        if (on) { barEl.classList.add("indeterminate"); barInner.style.width = "100%"; }
        else barEl.classList.remove("indeterminate");
      },
      log(line) {
        if (!line) return;
        logEl.hidden = false;
        const div = document.createElement("div");
        div.textContent = String(line);
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
      },
      done(msg) {
        barEl.classList.remove("indeterminate");
        barEl.classList.add("success");
        barInner.style.width = "100%";
        if (msg != null) labelEl.textContent = String(msg);
        closeBtn.hidden = false;
        setTimeout(() => { if (active === api) hide(); }, 1200);
      },
      fail(msg) {
        barEl.classList.remove("indeterminate");
        barEl.classList.add("error");
        if (msg != null) labelEl.textContent = String(msg);
        closeBtn.hidden = false;
      },
      close: hide,
    };
    active = api;
    return api;
  }

  async function run(title, fn) {
    const p = open(title);
    try {
      const ret = await fn(p);
      if (active === p) p.done("完成");
      return ret;
    } catch (e) {
      p.fail(String(e && e.message ? e.message : e));
      throw e;
    }
  }

  window.NavProgress = { open, run };
})();
