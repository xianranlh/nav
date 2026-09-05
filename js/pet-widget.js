/* ===============================
   pet-widget.js —— 首页 Codex 风格状态桌宠
   · 站岗：右下角定点（可拖拽）
   · 巡逻：底部横向来回走动
   · 单击互动 · 双击快捷星轨
   · 长按/右键菜单 · 拖动与点击互斥
   =============================== */
(() => {
  "use strict";
  if (!window.SakuraPet) return;
  const { Config, PetActor, Status, LINES, STATUS_META, pick } = window.SakuraPet;

  let cfg = null;
  const configImage = (value) => Config.imageUrl ? Config.imageUrl(value) : "";
  const effectiveMode = () => cfg?.activityMode === "patrol" && window.innerWidth >= 720 ? "patrol" : "guard";

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
      <div class="hp-quick" aria-label="桌宠快捷操作">
        <button type="button" data-quick="actions" title="打开快捷星轨" aria-label="打开快捷星轨">捷</button>
        <button type="button" data-quick="mode" title="切换站岗/巡逻" aria-label="切换站岗或巡逻"><span id="hp-mode-icon">巡</span></button>
        <a href="pet.html" title="打开桌宠设置" aria-label="打开桌宠设置">设</a>
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
      <button type="button" data-act="mute">🔈 静音对白<span class="hp-ctx-check" data-for="mute"></span></button>
      <button type="button" data-act="hide">◌ 本次页面隐藏</button>
      <button type="button" data-act="settings">⚙ 桌宠设置</button>
    `;
    document.body.appendChild(ctx);

    const wheel = document.createElement("div");
    wheel.id = "home-pet-wheel";
    wheel.hidden = true;
    wheel.setAttribute("role", "menu");
    wheel.setAttribute("aria-label", "桌宠快捷星轨");
    document.body.appendChild(wheel);

    if (!document.getElementById("home-pet-widget-css")) {
      const st = document.createElement("style");
      st.id = "home-pet-widget-css";
      st.textContent = `
#home-pet-shell{
  position:fixed;z-index:960;width:168px;height:188px;
  right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));
  pointer-events:none;
  font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
  transition:width .25s ease,height .2s ease,opacity .18s ease;
}
#home-pet-shell[data-size="sm"]{width:144px;height:166px}
#home-pet-shell[data-size="lg"]{width:194px;height:214px}
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
#home-pet-shell .hp-stage .pe-sprite:focus-visible{
  outline:2px solid #58cfff;outline-offset:4px;border-radius:22px;
}
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
  padding:2px 9px;border:1px solid rgba(216,173,105,.3);border-radius:999px;
  background:rgba(6,27,57,.86);backdrop-filter:blur(10px);
  font-size:11.5px;color:#eef7ff;
  text-shadow:0 1px 8px rgba(0,0,0,.3);box-shadow:0 5px 16px rgba(0,16,38,.18);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;
}
#home-pet-shell .hp-quick{
  position:absolute;right:2px;top:48px;z-index:8;
  display:flex;flex-direction:column;gap:6px;
  opacity:0;transform:translateX(5px);transition:opacity .16s ease,transform .16s ease;
  pointer-events:none;
}
#home-pet-shell:hover .hp-quick,
#home-pet-shell:focus-within .hp-quick{opacity:1;transform:none;pointer-events:auto}
#home-pet-shell .hp-quick button,
#home-pet-shell .hp-quick a{
  display:grid;place-items:center;width:30px;height:30px;padding:0;
  border:1px solid rgba(216,173,105,.42);border-radius:10px;
  background:linear-gradient(145deg,rgba(17,63,105,.96),rgba(6,25,55,.96));
  color:#f5deb0;font:700 11px/1 inherit;text-decoration:none;cursor:pointer;
  box-shadow:0 5px 14px rgba(0,16,38,.24);backdrop-filter:blur(10px);
}
#home-pet-shell .hp-quick button:hover,
#home-pet-shell .hp-quick a:hover{color:#fff;border-color:rgba(88,207,255,.7);transform:translateY(-1px)}
#home-pet-shell .hp-quick button:focus-visible,
#home-pet-shell .hp-quick a:focus-visible{outline:2px solid #58cfff;outline-offset:2px}
#home-pet-shell.is-patrol .hp-quick{position:fixed;right:18px;top:auto;bottom:22px}
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
#home-pet-wheel{
  position:fixed;z-index:10049;width:184px;height:184px;
  border:1px solid rgba(216,173,105,.5);border-radius:50%;
  background:radial-gradient(circle,rgba(16,55,93,.98) 0 25%,rgba(7,27,58,.94) 26% 60%,rgba(7,27,58,.42) 61% 70%,transparent 71%);
  box-shadow:0 16px 48px rgba(0,16,38,.3),inset 0 0 28px rgba(88,207,255,.1);
  backdrop-filter:blur(12px);font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
  transform-origin:center;animation:hp-wheel-in .18s ease-out;
}
#home-pet-wheel[hidden]{display:none !important}
#home-pet-wheel::after{content:"星轨";position:absolute;inset:0;display:grid;place-items:center;color:#f6ddb0;font-size:11px;font-weight:700;letter-spacing:.12em;pointer-events:none}
#home-pet-wheel button{
  position:absolute;display:grid;place-items:center;gap:1px;width:52px;height:52px;padding:4px;
  transform:translate(-50%,-50%);border:1px solid rgba(88,207,255,.42);border-radius:16px;
  background:linear-gradient(145deg,rgba(21,77,123,.98),rgba(7,30,63,.98));color:#eef8ff;
  box-shadow:0 7px 17px rgba(0,10,28,.28);font:700 10px/1.1 inherit;cursor:pointer;
}
#home-pet-wheel button span{font-size:17px;color:#f6d58e}
#home-pet-wheel button:hover,#home-pet-wheel button:focus-visible{border-color:#f6d58e;color:#fff;outline:none;transform:translate(-50%,-50%) scale(1.06)}
@keyframes hp-wheel-in{from{opacity:0;transform:scale(.78) rotate(-9deg)}to{opacity:1;transform:none}}
@media (max-width:560px){
  #home-pet-shell:not(.is-patrol){right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom))}
  #home-pet-shell .hp-quick{opacity:.92;transform:none;pointer-events:auto}
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
    const modeIcon = shell.querySelector("#hp-mode-icon");
    nameEl.textContent = cfg.name;

    const mode = effectiveMode();
    const scaleBySize = { sm: 1.65, md: 1.95, lg: 2.25 };
    shell.dataset.size = cfg.homeScale || "md";

    const actor = new PetActor({
      container: stage,
      fxLayer: stage,
      scale: scaleBySize[cfg.homeScale] || scaleBySize.md,
      speed: mode === "patrol" ? 72 : 40,
      groundBottom: 2,
      autonomous: mode === "patrol",
      chatty: false,
      statusDriven: true,
      activityMode: mode,
      custom: configImage(cfg) || null,
      onPetClick: null,
    });

    function applyShellLayout() {
      const m = effectiveMode();
      const size = ["sm", "md", "lg"].includes(cfg.homeScale) ? cfg.homeScale : "md";
      shell.dataset.size = size;
      actor.setScale(scaleBySize[size]);
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
        const maxX = Math.max(8, window.innerWidth - shell.offsetWidth - 8);
        const safeBottom = 72;
        const maxY = Math.max(safeBottom, window.innerHeight - shell.offsetHeight - 8);
        const xRatio = Math.max(0, Math.min(1, Number(cfg.anchor?.xRatio ?? 0.88)));
        const yRatio = Math.max(0, Math.min(1, Number(cfg.anchor?.yRatio ?? 0.08)));
        shell.style.left = (8 + (maxX - 8) * xRatio) + "px";
        shell.style.bottom = (safeBottom + (maxY - safeBottom) * yRatio) + "px";
        shell.style.right = "auto";
        requestAnimationFrame(() => {
          actor.s.x = Math.max(8, (stage.clientWidth || 120) / 2 - actor.w / 2);
          actor.s.targetX = null;
        });
        metaEl.style.left = "";
        metaEl.style.transform = "";
      }
      if (modeIcon) modeIcon.textContent = m === "patrol" ? "岗" : "巡";
      refreshTitle();
      syncCtxChecks();
    }

    function refreshTitle() {
      const { status, detail } = Status.get();
      const meta = STATUS_META[status] || STATUS_META.idle;
      const actual = effectiveMode();
      const act = cfg.activityMode === "patrol" && actual === "guard" ? "巡逻（窄屏自动站岗）" : actual === "patrol" ? "巡逻" : "站岗";
      actor.el.title =
        `${cfg.name} · ${meta.label}${detail ? " · " + detail : ""}\n` +
        `活动：${act}\n单击互动 · 双击快捷星轨 · 长按更多操作`;
      actor.el.setAttribute("aria-label", `${cfg.name}，${meta.label}，${act}`);
    }

    let badgeHideTimer = 0;
    let speaking = false;

    function setBadgeVisible(vis) {
      if (!badge) return;
      if (cfg.showStatusBadge === false) {
        badge.hidden = true;
        return;
      }
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
      const speechChance = cfg.speechFrequency === "quiet" ? 0 : cfg.speechFrequency === "lively" ? 0.9 : 0.5;
      if (status === "error" && Math.random() < speechChance) actor.say(pick(LINES.error), 2200);
      if (status === "done" && Math.random() < speechChance) actor.say(pick(LINES.done), 2000);
      if (status === "thinking" || status === "working") {
        if (Math.random() < speechChance * 0.55) actor.say(pick(LINES[status] || LINES.thinking), 1600);
      }
    }
    Status.on(onStatus);
    applyShellLayout();
    showBadge(true);

    // 巡逻时 meta 跟随角色
    let metaRaf = 0;
    function trackMeta() {
      if (effectiveMode() === "patrol" && !actor.destroyed) {
        const cx = actor.s.x + actor.w / 2;
        metaEl.style.left = cx + "px";
      }
      if (!document.hidden) metaRaf = requestAnimationFrame(trackMeta);
    }
    function syncMetaVisibility() {
      cancelAnimationFrame(metaRaf);
      metaRaf = 0;
      if (!document.hidden && !actor.destroyed) metaRaf = requestAnimationFrame(trackMeta);
    }
    document.addEventListener("visibilitychange", syncMetaVisibility);
    syncMetaVisibility();

    /* ---------- 快捷星轨与长按/右键菜单 ---------- */
    const quickMeta = {
      todo: { icon: "✓", label: "待办" },
      calendar: { icon: "◫", label: "日历" },
      ai: { icon: "✦", label: "AI" },
      knowledge: { icon: "⌁", label: "知识" },
      "recent-note": { icon: "↺", label: "最近笔记" },
      settings: { icon: "⚙", label: "设置" },
    };

    function notifyUnavailable(label) {
      const message = `${label}当前不可用`;
      if (window.toast) window.toast(message, 2600);
      else actor.say(message, 2200);
    }

    function runQuickAction(action) {
      hideWheel();
      const targetByAction = {
        todo: "#btn-todo",
        calendar: "#btn-calendar",
        ai: "#ai-fab",
        settings: "#btn-settings",
      };
      if (action === "knowledge" && window.SakuraKnowledgeUI?.open) {
        window.SakuraKnowledgeUI.open();
        return;
      }
      if (action === "recent-note" && window.SakuraKnowledgeUI?.openRecent) {
        window.SakuraKnowledgeUI.openRecent();
        return;
      }
      const target = document.querySelector(targetByAction[action] || "[data-never-match]");
      if (target) target.click();
      else notifyUnavailable(quickMeta[action]?.label || "该功能");
    }

    function hideWheel() {
      wheel.hidden = true;
      wheel.replaceChildren();
    }

    function showWheel(x, y) {
      hideCtx();
      wheel.replaceChildren();
      const actions = (cfg.quickActions || []).slice(0, 4);
      if (!actions.length) {
        notifyUnavailable("快捷星轨");
        return;
      }
      const positions = actions.length === 1
        ? [[50, 18]]
        : actions.length === 2 ? [[27, 27], [73, 73]]
          : actions.length === 3 ? [[50, 16], [20, 72], [80, 72]]
            : [[50, 15], [85, 50], [50, 85], [15, 50]];
      actions.forEach((action, index) => {
        const meta = quickMeta[action] || { icon: "·", label: action };
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action;
        button.setAttribute("role", "menuitem");
        button.setAttribute("aria-label", meta.label);
        button.style.left = `${positions[index][0]}%`;
        button.style.top = `${positions[index][1]}%`;
        button.append(nodeForWheel("span", meta.icon), nodeForWheel("small", meta.label));
        button.addEventListener("click", () => runQuickAction(action));
        wheel.append(button);
      });
      const size = 184;
      const pad = 8;
      wheel.style.left = `${Math.max(pad, Math.min(window.innerWidth - size - pad, x - size / 2))}px`;
      wheel.style.top = `${Math.max(pad, Math.min(window.innerHeight - size - pad, y - size / 2))}px`;
      wheel.hidden = false;
      wheel.querySelector("button")?.focus({ preventScroll: true });
    }

    function nodeForWheel(tag, text) {
      const element = document.createElement(tag);
      element.textContent = text;
      return element;
    }

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
      const muteCheck = ctx.querySelector('[data-for="mute"]');
      if (muteCheck) muteCheck.textContent = cfg.speechFrequency === "quiet" ? "✓" : "";
    }
    function showCtx(x, y) {
      syncCtxChecks();
      ctx.hidden = false;
      const pad = 8;
      const rect = { w: 178, h: 224 };
      let left = x;
      let top = y;
      if (left + rect.w > window.innerWidth - pad) left = window.innerWidth - rect.w - pad;
      if (top + rect.h > window.innerHeight - pad) top = window.innerHeight - rect.h - pad;
      if (left < pad) left = pad;
      if (top < pad) top = pad;
      ctx.style.left = left + "px";
      ctx.style.top = top + "px";
    }

    function changeMode(next) {
      cfg = Config.load();
      cfg.activityMode = next === "patrol" ? "patrol" : "guard";
      Config.save(cfg);
      applyShellLayout();
      actor.say(pick(LINES[cfg.activityMode] || LINES.idle), 2200);
      if (cfg.activityMode === "patrol") actor.emote("runR", 1.2);
      else actor.emote("wave", 1.6);
    }

    actor.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e.clientX, e.clientY);
    });
    // 防止拖拽时的 pointer 把菜单冲掉后仍可选
    document.addEventListener("pointerdown", (e) => {
      if (!ctx.hidden && !ctx.contains(e.target) && e.target !== actor.el) hideCtx();
      if (!wheel.hidden && !wheel.contains(e.target) && e.target !== actor.el) hideWheel();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hideCtx(); hideWheel(); }
    });
    window.addEventListener("scroll", () => { hideCtx(); hideWheel(); }, true);
    window.addEventListener("blur", () => { hideCtx(); hideWheel(); });

    ctx.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.mode) {
        changeMode(btn.dataset.mode);
        hideCtx();
        return;
      }
      if (btn.dataset.act === "settings") {
        hideCtx();
        location.href = "pet.html";
      } else if (btn.dataset.act === "mute") {
        cfg = Config.load();
        cfg.speechFrequency = cfg.speechFrequency === "quiet" ? "normal" : "quiet";
        Config.save(cfg);
        syncCtxChecks();
        actor.say(cfg.speechFrequency === "quiet" ? "对白已静音，我会安静陪着你。" : "对白恢复啦！", 2100);
      } else if (btn.dataset.act === "hide") {
        hideCtx();
        hideWheel();
        cancelAnimationFrame(metaRaf);
        document.removeEventListener("visibilitychange", syncMetaVisibility);
        actor.destroy();
        shell.remove();
        ctx.remove();
        wheel.remove();
      }
    });

    shell.querySelector('[data-quick="mode"]')?.addEventListener("click", () => {
      changeMode(cfg.activityMode === "patrol" ? "guard" : "patrol");
    });

    shell.querySelector('[data-quick="actions"]')?.addEventListener("click", (event) => {
      const rect = actor.el.getBoundingClientRect();
      showWheel(rect.left + rect.width / 2, rect.top + rect.height / 2);
      event.stopPropagation();
    });

    // 单击延迟确认，双击只打开快捷星轨；拖动/长按会抑制点击。
    let clickTimer = 0;
    let suppressClick = false;
    function interact() {
      const st = Status.get().status;
      const lines = LINES[st] || LINES.idle;
      actor.say(pick(lines), 2200);
      actor.hearts(2);
      actor.emote(st === "error" ? "shy" : "wave", 1.6);
      showBadge(true);
    }
    actor.el.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      clearTimeout(clickTimer);
      clickTimer = setTimeout(interact, 280);
      event.stopPropagation();
    });
    actor.el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      clearTimeout(clickTimer);
      suppressClick = false;
      showWheel(e.clientX, e.clientY);
    });

    /* ---------- 拖拽（仅站岗） ---------- */
    let drag = null;
    let pressTimer = 0;
    let pressOrigin = null;
    let longPressed = false;
    function cancelLongPress() {
      clearTimeout(pressTimer);
      pressTimer = 0;
    }
    actor.el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      hideWheel();
      longPressed = false;
      pressOrigin = { x: e.clientX, y: e.clientY };
      cancelLongPress();
      pressTimer = setTimeout(() => {
        longPressed = true;
        suppressClick = true;
        drag = null;
        shell.classList.remove("dragging");
        showCtx(pressOrigin?.x || e.clientX, pressOrigin?.y || e.clientY);
      }, 560);
      actor.el.setPointerCapture?.(e.pointerId);
      if (effectiveMode() === "patrol") return;
      const rect = shell.getBoundingClientRect();
      drag = {
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      e.preventDefault();
    });
    const onMove = (e) => {
      if (pressOrigin && Math.hypot(e.clientX - pressOrigin.x, e.clientY - pressOrigin.y) > 8) cancelLongPress();
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 7) return;
      drag.moved = true;
      shell.classList.add("dragging");
      const x = Math.max(0, Math.min(window.innerWidth - shell.offsetWidth, e.clientX - drag.dx));
      const yFromTop = Math.max(0, Math.min(window.innerHeight - shell.offsetHeight, e.clientY - drag.dy));
      const bottom = window.innerHeight - yFromTop - shell.offsetHeight;
      shell.style.left = x + "px";
      shell.style.bottom = bottom + "px";
      shell.style.right = "auto";
    };
    const onUp = () => {
      cancelLongPress();
      pressOrigin = null;
      shell.classList.remove("dragging");
      if (drag?.moved) {
        suppressClick = true;
        const left = parseFloat(shell.style.left) || 0;
        const bottom = parseFloat(shell.style.bottom) || 18;
        cfg = Config.load();
        const maxX = Math.max(1, window.innerWidth - shell.offsetWidth - 8);
        const safeBottom = 72;
        const maxY = Math.max(safeBottom + 1, window.innerHeight - shell.offsetHeight - 8);
        cfg.anchor = {
          xRatio: Math.max(0, Math.min(1, (left - 8) / Math.max(1, maxX - 8))),
          yRatio: Math.max(0, Math.min(1, (bottom - safeBottom) / Math.max(1, maxY - safeBottom))),
        };
        Config.save(cfg);
      }
      drag = null;
      if (longPressed) suppressClick = true;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", () => {
      if (!actor.destroyed) applyShellLayout();
    });

    /* ---------- 状态源 ---------- */
    function wireStatusSources() {
      const syncNet = () => {
        if (!navigator.onLine) window.SakuraPetEvents.emit("nav:network:offline");
        else window.SakuraPetEvents.bus.clear("network");
      };
      window.addEventListener("offline", () => window.SakuraPetEvents.emit("nav:network:offline"));
      window.addEventListener("online", () => window.SakuraPetEvents.emit("nav:network:online"));
      syncNet();

      window.addEventListener("sakura-pet-cmd", (e) => {
        const d = e.detail || {};
        if (d.pulse) Status.pulse(d.status || "idle", d.detail || "", d.ms || 2800);
        else if (d.status) Status.set(d.status, d.detail || "");
      });
    }
    wireStatusSources();

    function reloadConfig() {
      cfg = Config.load();
      if (!cfg.homeWidget) {
        cancelAnimationFrame(metaRaf);
        document.removeEventListener("visibilitychange", syncMetaVisibility);
        actor.destroy();
        shell.remove();
        ctx.remove();
        wheel.remove();
        return;
      }
      const img = configImage(cfg) || null;
      if (img !== actor.custom) actor.setCustom(img);
      nameEl.textContent = cfg.name;
      applyShellLayout();
      showBadge(true);
    }
    addEventListener("storage", (e) => {
      if (e.key === window.SakuraPet.SAVE_KEY || e.key === window.SakuraPet.V2_KEY) reloadConfig();
    });
    addEventListener("sakura-pet-config", reloadConfig);
    try {
      const channel = new BroadcastChannel("sakura-pet-config");
      channel.addEventListener("message", reloadConfig);
    } catch (_) {}
  }

  async function start() {
    if (window.SakuraRemote?.ready) {
      try { await window.SakuraRemote.ready; } catch (_) {}
    }
    cfg = Config.load();
    try { cfg = await Config.ensureMigrated(cfg); } catch (error) {
      console.warn("[pet] v2 自定义图片迁移暂未完成：", error?.message || error);
    }
    if (!cfg.homeWidget) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }
  start();
})();
