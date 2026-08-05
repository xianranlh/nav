/* ===============================
   pet-widget.js —— 首页 Codex 风格状态桌宠
   · 站岗：右下角定点（可拖拽）
   · 巡逻：底部横向来回走动
   · 右键菜单切换活动方式
   · 单击互动 · 双击打开 pet.html
   =============================== */
(() => {
  "use strict";
  if (!window.SakuraPet) return;
  const { Config, PetActor, Status, LINES, STATUS_META, pick } = window.SakuraPet;

  let cfg = Config.load();
  if (!cfg.homeWidget) return;

  function boot() {
    const shell = document.createElement("div");
    shell.id = "home-pet-shell";
    shell.innerHTML = `
      <div class="hp-stage" id="hp-stage"></div>
      <div class="hp-meta" id="hp-meta">
        <div class="hp-badge" id="hp-badge" hidden>
          <span class="hp-badge-emoji" id="hp-badge-emoji">💤</span>
          <span class="hp-badge-text" id="hp-badge-text">待命</span>
        </div>
        <div class="hp-name" id="hp-name"></div>
      </div>
    `;
    document.body.appendChild(shell);

    // 右键菜单
    const ctx = document.createElement("div");
    ctx.id = "home-pet-ctx";
    ctx.hidden = true;
    ctx.innerHTML = `
      <button type="button" data-mode="guard">🛡 站岗<span class="hp-ctx-check" data-for="guard"></span></button>
      <button type="button" data-mode="patrol">🚶 巡逻<span class="hp-ctx-check" data-for="patrol"></span></button>
      <div class="hp-ctx-sep"></div>
      <button type="button" data-act="settings">⚙ 桌宠设置</button>
    `;
    document.body.appendChild(ctx);

    if (!document.getElementById("home-pet-widget-css")) {
      const st = document.createElement("style");
      st.id = "home-pet-widget-css";
      st.textContent = `
#home-pet-shell{
  position:fixed;z-index:960;width:132px;height:148px;
  right:18px;bottom:18px;
  pointer-events:none;
  font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
  transition:width .25s ease,height .2s ease;
}
#home-pet-shell.dragging{opacity:.92;cursor:grabbing}
#home-pet-shell.is-patrol{
  left:0 !important;right:0 !important;width:100% !important;
  height:128px;bottom:0 !important;
}
#home-pet-shell .hp-stage{
  position:absolute;left:0;right:0;top:0;bottom:36px;
  pointer-events:none;overflow:visible;
}
#home-pet-shell.is-patrol .hp-stage{ bottom:22px; }
#home-pet-shell .pe-bubble{
  z-index:20 !important;
  bottom:calc(100% + 6px) !important;
  max-width:min(200px,72vw) !important;
  white-space:normal !important;
  text-align:center;
  line-height:1.35;
}
#home-pet-shell .hp-stage .pe-sprite{pointer-events:auto;cursor:grab}
#home-pet-shell.is-patrol .hp-stage .pe-sprite{cursor:pointer}
#home-pet-shell .hp-meta{
  position:absolute;left:0;right:0;bottom:0;
  display:flex;flex-direction:column;align-items:center;gap:2px;
  pointer-events:none;z-index:2;
  transition:left .05s linear;
}
#home-pet-shell.is-patrol .hp-meta{
  right:auto;width:max-content;max-width:140px;
  transform:translateX(-50%);
}
#home-pet-shell .hp-badge{
  display:inline-flex;align-items:center;gap:3px;
  max-width:124px;padding:2px 8px;border-radius:999px;
  background:rgba(255,255,255,.94);border:1px solid rgba(229,99,138,.28);
  box-shadow:0 2px 10px rgba(74,59,82,.1);
  font-size:10.5px;color:#4a3b52;white-space:nowrap;
  line-height:1.2;
}
#home-pet-shell .hp-badge[hidden]{display:none !important}
#home-pet-shell .hp-badge[data-status="thinking"],
#home-pet-shell .hp-badge[data-status="working"],
#home-pet-shell .hp-badge[data-status="syncing"]{
  background:linear-gradient(135deg,rgba(255,240,246,.95),rgba(232,240,255,.95));
}
#home-pet-shell .hp-badge[data-status="done"]{background:rgba(220,255,230,.95)}
#home-pet-shell .hp-badge[data-status="error"]{background:rgba(255,230,230,.95)}
#home-pet-shell .hp-badge[data-status="offline"]{background:rgba(230,230,240,.95);opacity:.9}
#home-pet-shell .hp-badge-emoji{font-size:11px}
#home-pet-shell .hp-badge-text{overflow:hidden;text-overflow:ellipsis;max-width:7.5em}
#home-pet-shell .hp-name{
  font-size:11px;color:rgba(74,59,82,.72);
  text-shadow:0 1px 0 rgba(255,255,255,.85);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:124px;
}
#home-pet-ctx{
  position:fixed;z-index:10050;min-width:148px;
  padding:6px;border-radius:12px;
  background:rgba(255,255,255,.96);
  border:1px solid rgba(229,99,138,.28);
  box-shadow:0 10px 32px rgba(74,59,82,.18);
  backdrop-filter:blur(12px);
  font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
}
#home-pet-ctx[hidden]{display:none !important}
#home-pet-ctx button{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  width:100%;border:none;background:transparent;
  text-align:left;padding:8px 10px;border-radius:8px;
  font-size:13px;color:#4a3b52;cursor:pointer;font-family:inherit;
}
#home-pet-ctx button:hover{background:rgba(255,143,171,.16)}
#home-pet-ctx button.is-active{color:#e5638a;font-weight:600}
#home-pet-ctx .hp-ctx-check{font-size:12px;min-width:1em;color:#e5638a}
#home-pet-ctx .hp-ctx-sep{height:1px;margin:4px 6px;background:rgba(0,0,0,.08)}
@media (max-width:560px){
  #home-pet-shell:not(.is-patrol){right:8px;bottom:8px;transform:scale(.92);transform-origin:bottom right}
}
`;
      document.head.appendChild(st);
    }

    const stage = shell.querySelector("#hp-stage");
    const badge = shell.querySelector("#hp-badge");
    const badgeEmoji = shell.querySelector("#hp-badge-emoji");
    const badgeText = shell.querySelector("#hp-badge-text");
    const nameEl = shell.querySelector("#hp-name");
    const metaEl = shell.querySelector("#hp-meta");
    nameEl.textContent = cfg.name;

    const mode = cfg.activityMode === "patrol" ? "patrol" : "guard";

    const actor = new PetActor({
      container: stage,
      fxLayer: stage,
      scale: 1.55,
      speed: mode === "patrol" ? 72 : 40,
      groundBottom: 2,
      autonomous: mode === "patrol",
      chatty: false,
      statusDriven: true,
      activityMode: mode,
      custom: cfg.custom ? cfg.custom.img : null,
      onPetClick(a) {
        const st = Status.get().status;
        const lines = LINES[st] || LINES.idle;
        a.say(pick(lines), 2200);
        a.hearts(2);
        a.emote(st === "error" ? "shy" : "wave", 1.6);
        showBadge(true);
      },
    });

    function applyShellLayout() {
      const m = cfg.activityMode === "patrol" ? "patrol" : "guard";
      shell.classList.toggle("is-patrol", m === "patrol");
      actor.setActivityMode(m);
      actor.speed = m === "patrol" ? 72 : 40;

      if (m === "patrol") {
        shell.style.left = "0";
        shell.style.right = "0";
        shell.style.width = "100%";
        shell.style.bottom = "0";
        // 巡逻时从当前可视区中间附近起步
        requestAnimationFrame(() => {
          const w = stage.clientWidth || window.innerWidth;
          actor.s.x = Math.max(8, Math.min(w - actor.w - 8, w * 0.45));
          actor.s.stateTimer = 0.4;
        });
      } else {
        shell.style.width = "";
        shell.style.right = "";
        shell.style.left = "";
        shell.style.bottom = "";
        if (typeof cfg.homeX === "number" && typeof cfg.homeY === "number") {
          shell.style.left = cfg.homeX + "px";
          shell.style.bottom = cfg.homeY + "px";
          shell.style.right = "auto";
        } else {
          shell.style.right = "18px";
          shell.style.bottom = "18px";
          shell.style.left = "auto";
        }
        requestAnimationFrame(() => {
          actor.s.x = Math.max(8, (stage.clientWidth || 120) / 2 - actor.w / 2);
          actor.s.targetX = null;
        });
        metaEl.style.left = "";
        metaEl.style.transform = "";
      }
      refreshTitle();
      syncCtxChecks();
    }

    function refreshTitle() {
      const { status, detail } = Status.get();
      const meta = STATUS_META[status] || STATUS_META.idle;
      const act = cfg.activityMode === "patrol" ? "巡逻" : "站岗";
      actor.el.title =
        `${cfg.name} · ${meta.label}${detail ? " · " + detail : ""}\n` +
        `活动：${act}\n单击互动 · 右键切换站岗/巡逻 · 双击打开设置`;
      actor.el.setAttribute("aria-label", `${cfg.name}，${meta.label}，${act}`);
    }

    let badgeHideTimer = 0;
    let speaking = false;

    function setBadgeVisible(vis) {
      if (!badge) return;
      if (speaking) {
        badge.hidden = true;
        return;
      }
      badge.hidden = !vis;
    }

    function showBadge(force) {
      const { status, detail } = Status.get();
      const meta = STATUS_META[status] || STATUS_META.idle;
      badge.dataset.status = status;
      badgeEmoji.textContent = meta.emoji;
      badgeText.textContent = detail ? String(detail).slice(0, 14) : meta.label;
      clearTimeout(badgeHideTimer);
      if (status === "idle") {
        setBadgeVisible(true);
        badgeHideTimer = setTimeout(() => setBadgeVisible(false), force ? 2800 : 2200);
      } else {
        setBadgeVisible(true);
      }
    }

    const _origSay = actor.say.bind(actor);
    actor.say = (text, ms = 2600) => {
      speaking = true;
      setBadgeVisible(false);
      _origSay(text, ms);
      clearTimeout(actor._badgeResumeTimer);
      actor._badgeResumeTimer = setTimeout(() => {
        speaking = false;
        const st = Status.get().status;
        if (st !== "idle") setBadgeVisible(true);
      }, ms + 40);
    };

    function onStatus() {
      refreshTitle();
      showBadge(Status.get().status !== "idle");
      const status = Status.get().status;
      if (status === "done") actor.hearts(2);
      if (status === "error") actor.say(pick(LINES.error), 2200);
      if (status === "done" && Math.random() < 0.6) actor.say(pick(LINES.done), 2000);
      if (status === "thinking" || status === "working") {
        if (Math.random() < 0.35) actor.say(pick(LINES[status] || LINES.thinking), 1600);
      }
    }
    Status.on(onStatus);
    applyShellLayout();
    showBadge(true);

    // 巡逻时 meta 跟随角色
    let metaRaf = 0;
    function trackMeta() {
      if (cfg.activityMode === "patrol" && !actor.destroyed) {
        const cx = actor.s.x + actor.w / 2;
        metaEl.style.left = cx + "px";
      }
      metaRaf = requestAnimationFrame(trackMeta);
    }
    metaRaf = requestAnimationFrame(trackMeta);

    /* ---------- 右键菜单 ---------- */
    function hideCtx() {
      ctx.hidden = true;
    }
    function syncCtxChecks() {
      const m = cfg.activityMode === "patrol" ? "patrol" : "guard";
      ctx.querySelectorAll("button[data-mode]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.mode === m);
        const ck = b.querySelector(".hp-ctx-check");
        if (ck) ck.textContent = b.dataset.mode === m ? "✓" : "";
      });
    }
    function showCtx(x, y) {
      syncCtxChecks();
      ctx.hidden = false;
      const pad = 8;
      const rect = { w: 160, h: 130 };
      let left = x;
      let top = y;
      if (left + rect.w > window.innerWidth - pad) left = window.innerWidth - rect.w - pad;
      if (top + rect.h > window.innerHeight - pad) top = window.innerHeight - rect.h - pad;
      if (left < pad) left = pad;
      if (top < pad) top = pad;
      ctx.style.left = left + "px";
      ctx.style.top = top + "px";
    }

    actor.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY);
    });
    // 防止拖拽时的 pointer 把菜单冲掉后仍可选
    document.addEventListener("pointerdown", (e) => {
      if (!ctx.hidden && !ctx.contains(e.target) && e.target !== actor.el) hideCtx();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideCtx();
    });
    window.addEventListener("scroll", hideCtx, true);
    window.addEventListener("blur", hideCtx);

    ctx.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.mode) {
        const next = btn.dataset.mode === "patrol" ? "patrol" : "guard";
        cfg = Config.load();
        cfg.activityMode = next;
        Config.save(cfg);
        applyShellLayout();
        actor.say(pick(LINES[next] || LINES.idle), 2200);
        if (next === "patrol") actor.emote("runR", 1.2);
        else actor.emote("wave", 1.6);
        hideCtx();
        return;
      }
      if (btn.dataset.act === "settings") {
        hideCtx();
        location.href = "pet.html";
      }
    });

    // 双击 → 宠物页（避免与拖拽冲突：仅未拖动时）
    let lastTap = 0;
    let suppressClick = false;
    actor.el.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const now = Date.now();
      if (now - lastTap < 320) location.href = "pet.html";
      lastTap = now;
    });
    actor.el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      location.href = "pet.html";
    });

    /* ---------- 拖拽（仅站岗） ---------- */
    let drag = null;
    actor.el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      if (cfg.activityMode === "patrol") return; // 巡逻不拖壳
      const rect = shell.getBoundingClientRect();
      drag = {
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        moved: false,
      };
      actor.el.setPointerCapture?.(e.pointerId);
      shell.classList.add("dragging");
      e.preventDefault();
    });
    const onMove = (e) => {
      if (!drag) return;
      drag.moved = true;
      const x = Math.max(0, Math.min(window.innerWidth - shell.offsetWidth, e.clientX - drag.dx));
      const yFromTop = Math.max(0, Math.min(window.innerHeight - shell.offsetHeight, e.clientY - drag.dy));
      const bottom = window.innerHeight - yFromTop - shell.offsetHeight;
      shell.style.left = x + "px";
      shell.style.bottom = bottom + "px";
      shell.style.right = "auto";
    };
    const onUp = () => {
      if (!drag) return;
      shell.classList.remove("dragging");
      if (drag.moved) {
        suppressClick = true;
        const left = parseFloat(shell.style.left) || 0;
        const bottom = parseFloat(shell.style.bottom) || 18;
        cfg = Config.load();
        cfg.homeX = left;
        cfg.homeY = bottom;
        Config.save(cfg);
      }
      drag = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    /* ---------- 状态源 ---------- */
    function wireStatusSources() {
      const syncNet = () => {
        if (!navigator.onLine) Status.set("offline");
        else if (Status.get().status === "offline") Status.set("idle");
      };
      window.addEventListener("offline", () => Status.set("offline"));
      window.addEventListener("online", () => Status.pulse("done", "已恢复联网", 2000));
      syncNet();

      const panel = document.getElementById("ai-panel");
      if (panel) {
        let wasSending = panel.classList.contains("is-sending");
        const readImgMode = () =>
          panel.classList.contains("img-mode") ||
          !!panel.querySelector(
            ".ai-img-mode.active, [data-img-mode].active, #ai-img-toggle.active, #btn-img-mode.active"
          );
        const mo = new MutationObserver(() => {
          if (!navigator.onLine) return;
          const sending = panel.classList.contains("is-sending");
          if (sending) {
            Status.set(readImgMode() ? "working" : "thinking", readImgMode() ? "生图中" : "AI 回复中");
          } else if (wasSending) {
            const tip = panel.querySelector(".ai-tip.err, #ai-tip.err, .tip.err");
            if (tip && String(tip.textContent || "").trim()) {
              Status.pulse("error", "AI 出错", 3200);
            } else {
              Status.pulse("done", "AI 完成", 2600);
            }
          }
          wasSending = sending;
        });
        mo.observe(panel, { attributes: true, attributeFilter: ["class"] });
      }

      window.addEventListener("sakura-pet-cmd", (e) => {
        const d = e.detail || {};
        if (d.pulse) Status.pulse(d.status || "idle", d.detail || "", d.ms || 2800);
        else if (d.status) Status.set(d.status, d.detail || "");
      });
    }
    wireStatusSources();

    addEventListener("storage", (e) => {
      if (e.key !== window.SakuraPet.SAVE_KEY) return;
      cfg = Config.load();
      if (!cfg.homeWidget) {
        cancelAnimationFrame(metaRaf);
        actor.destroy();
        shell.remove();
        ctx.remove();
        return;
      }
      const img = cfg.custom ? cfg.custom.img : null;
      if (img !== actor.custom) actor.setCustom(img);
      nameEl.textContent = cfg.name;
      applyShellLayout();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
