/* ===============================
   宠物页 pet.js —— 精简版
   改名 / 换装 / 首页开关 / 状态预览 / 轻互动
   =============================== */
(() => {
  "use strict";
  const { Config, PetActor, Status, LINES, pick, rand } = window.SakuraPet;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_PORTRAIT = "assets/pet/xiaoying-portrait.png";

  const cfg = Config.load();
  const playground = $("playground");
  const fxLayer = $("fx-layer");

  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const el = $("pet-toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 250);
    }, ms);
  }

  const actor = new PetActor({
    container: playground,
    fxLayer,
    scale: 2,
    custom: cfg.custom ? cfg.custom.img : null,
    autonomous: true,
    chatty: true,
    statusDriven: false,
    onPetClick(a) {
      a.hearts(3);
      a.say(pick(LINES.pat));
      a.emote(Math.random() < 0.5 ? "shy" : "joy");
    },
  });

  playground.addEventListener("click", (e) => {
    if (actor.el.contains(e.target)) return;
    // 站岗模式：点草地不跑；巡逻才跑过去
    if ((cfg.activityMode || "guard") === "guard") return;
    const rect = playground.getBoundingClientRect();
    actor.runTo(e.clientX - rect.left - actor.w / 2);
    $("pg-hint")?.classList.add("fade");
  });

  // 右键：切换站岗 / 巡逻（与首页桌宠一致）
  (function bindActivityCtx() {
    let menu = document.getElementById("pet-page-ctx");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "pet-page-ctx";
      menu.hidden = true;
      menu.innerHTML = `
        <button type="button" data-mode="guard">🛡 站岗</button>
        <button type="button" data-mode="patrol">🚶 巡逻</button>
      `;
      document.body.appendChild(menu);
      if (!document.getElementById("pet-page-ctx-css")) {
        const st = document.createElement("style");
        st.id = "pet-page-ctx-css";
        st.textContent = `
#pet-page-ctx{position:fixed;z-index:10050;min-width:140px;padding:6px;border-radius:12px;
  background:rgba(255,255,255,.96);border:1px solid rgba(229,99,138,.28);
  box-shadow:0 10px 28px rgba(74,59,82,.16);font-family:inherit}
#pet-page-ctx[hidden]{display:none!important}
#pet-page-ctx button{display:block;width:100%;border:none;background:transparent;text-align:left;
  padding:8px 10px;border-radius:8px;font-size:13px;color:#4a3b52;cursor:pointer;font-family:inherit}
#pet-page-ctx button:hover{background:rgba(255,143,171,.16)}
#pet-page-ctx button.is-active{color:#e5638a;font-weight:600}
`;
        document.head.appendChild(st);
      }
    }
    function hide() { menu.hidden = true; }
    function show(x, y) {
      const m = cfg.activityMode === "patrol" ? "patrol" : "guard";
      menu.querySelectorAll("button[data-mode]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.mode === m);
        b.textContent = (b.dataset.mode === "guard" ? "🛡 站岗" : "🚶 巡逻") + (b.dataset.mode === m ? "  ✓" : "");
      });
      menu.hidden = false;
      const left = Math.min(x, window.innerWidth - 160);
      const top = Math.min(y, window.innerHeight - 100);
      menu.style.left = Math.max(8, left) + "px";
      menu.style.top = Math.max(8, top) + "px";
    }
    actor.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      show(e.clientX, e.clientY);
    });
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      const next = btn.dataset.mode === "patrol" ? "patrol" : "guard";
      cfg.activityMode = next;
      Config.save(cfg);
      actor.setActivityMode(next);
      actor.speed = next === "patrol" ? 95 : 60;
      actor.say(pick(LINES[next] || LINES.idle), 2200);
      if (next === "patrol") {
        actor.s.stateTimer = 0.3;
      } else {
        actor.s.targetX = null;
        actor.setAnim("idle", true);
      }
      const hint = $("pg-hint");
      if (hint) {
        hint.textContent = next === "patrol" ? "巡逻中 · 点击地面移动" : "站岗中 · 右键可切换巡逻";
        hint.classList.remove("fade");
      }
      toast(next === "patrol" ? "已切换为巡逻" : "已切换为站岗");
      hide();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== actor.el) hide();
    });
    // 应用存档中的活动方式
    actor.setActivityMode(cfg.activityMode === "patrol" ? "patrol" : "guard");
    actor.speed = cfg.activityMode === "patrol" ? 95 : 60;
    if (cfg.activityMode !== "patrol") {
      actor.s.targetX = null;
      actor.setAnim("idle", true);
    }
  })();

  function refreshUI() {
    $("pet-name").textContent = cfg.name;
    $("pet-portrait-img").src = cfg.custom ? cfg.custom.img : DEFAULT_PORTRAIT;
    $("btn-restore").hidden = !cfg.custom;
    $("chk-home").checked = cfg.homeWidget;
    actor.el.setAttribute("aria-label", cfg.name);
  }

  $("btn-pat").addEventListener("click", () => {
    actor.hearts(3);
    actor.say(pick(LINES.greet));
    actor.emote("wave", 2.2);
  });

  // 状态预览（仅本页演示动作，不污染首页全局 Status 太久）
  $("status-demo")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-st]");
    if (!btn) return;
    const st = btn.dataset.st;
    $("status-demo").querySelectorAll(".st-chip").forEach((c) => c.classList.toggle("active", c === btn));
    // 本页 actor 不是 statusDriven，直接套动作
    const map = {
      idle: "idle", thinking: "walk", working: "runR",
      done: "joy", error: "shy", offline: "sleep",
    };
    actor.s.sleeping = st === "offline";
    actor.s.busy = st === "thinking" || st === "working";
    actor.s.targetX = null;
    actor.setAnim(map[st] || "idle", true);
    actor.say(pick(LINES[st] || LINES.idle), 2000);
    // 同步全局一次 pulse，方便用户回到首页立刻看到
    if (st === "idle") Status.set("idle");
    else if (st === "offline") Status.set("offline");
    else Status.pulse(st, "预览", 3200);
  });

  /* ---------- 换装 ---------- */
  $("btn-upload").addEventListener("click", () => $("pet-file").click());
  $("pet-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      toast("处理图片中…");
      const dataUrl = await processImage(file);
      cfg.custom = { img: dataUrl };
      const base = (file.name.replace(/\.[^.]+$/, "").slice(0, 12)) || "我的宠物";
      if (!cfg.name || cfg.name === "小樱") cfg.name = base;
      Config.save(cfg);
      actor.setCustom(dataUrl);
      refreshUI();
      actor.hearts(4);
      actor.say("新形象登场！", 2800);
      actor.emote("joy", 2.2);
      toast("形象已更新");
    } catch (err) {
      console.error(err);
      toast("图片处理失败");
      actor.say("这张图读不了…", 2200);
    }
  });
  $("btn-restore").addEventListener("click", () => {
    cfg.custom = null;
    if (!cfg.name || cfg.name === "我的宠物") cfg.name = "小樱";
    Config.save(cfg);
    actor.setCustom(null);
    refreshUI();
    actor.say("默认形象回来了～", 2400);
    actor.emote("wave", 2);
  });

  /* ---------- 改名 ---------- */
  function openRename() {
    const dlg = $("dlg-rename");
    const input = $("rename-input");
    if (!dlg || !input) return;
    input.value = cfg.name;
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
    setTimeout(() => { input.focus(); input.select(); }, 40);
  }
  $("pet-name").addEventListener("click", openRename);
  $("btn-rename").addEventListener("click", openRename);
  $("form-rename")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = ($("rename-input").value || "").trim().slice(0, 12);
    if (!n) { toast("名字不能为空"); return; }
    cfg.name = n;
    Config.save(cfg);
    refreshUI();
    actor.say(`叫我「${n}」吧`, 2400);
    $("dlg-rename")?.close?.();
    $("dlg-rename")?.removeAttribute("open");
  });
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlg = btn.closest("dialog");
      if (dlg?.close) dlg.close();
      else dlg?.removeAttribute("open");
    });
  });
  $("btn-help")?.addEventListener("click", () => {
    const dlg = $("dlg-help");
    if (dlg?.showModal) dlg.showModal();
    else dlg?.setAttribute("open", "");
  });

  $("chk-home").addEventListener("change", (e) => {
    cfg.homeWidget = e.target.checked;
    Config.save(cfg);
    toast(cfg.homeWidget ? "已开启首页桌宠" : "已关闭首页桌宠");
    actor.say(cfg.homeWidget ? "我会去首页陪你～" : "那我待在这里", 2200);
  });

  /* ---------- 抠图 ---------- */
  function processImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const MAX = 240;
          const k = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * k));
          const h = Math.max(1, Math.round(img.height * k));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const id = ctx.getImageData(0, 0, w, h);
          removeUniformBg(id, w, h);
          ctx.putImageData(id, 0, 0);
          resolve(trimCanvas(cv, id, w, h).toDataURL("image/png"));
        } catch (err) { reject(err); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }
  function removeUniformBg(id, w, h) {
    const d = id.data;
    const px = (x, y) => (y * w + x) * 4;
    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    if (corners.some((i) => d[i + 3] < 250)) return;
    const cr = d[corners[0]], cg = d[corners[0] + 1], cb = d[corners[0] + 2];
    const dist = (i) => Math.abs(d[i] - cr) + Math.abs(d[i + 1] - cg) + Math.abs(d[i + 2] - cb);
    if (!corners.every((i) => dist(i) < 90)) return;
    const TOL = 110;
    const seen = new Uint8Array(w * h);
    const queue = [];
    for (let x = 0; x < w; x++) queue.push(x, x + (h - 1) * w);
    for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1);
    while (queue.length) {
      const p = queue.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (dist(i) > TOL) continue;
      d[i + 3] = 0;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) queue.push(p - 1);
      if (x < w - 1) queue.push(p + 1);
      if (y > 0) queue.push(p - w);
      if (y < h - 1) queue.push(p + w);
    }
  }
  function trimCanvas(cv, id, w, h) {
    const d = id.data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return cv;
    const pad = 2;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /* ---------- 时钟 / 花瓣 ---------- */
  function tickClock() {
    const d = new Date();
    $("pet-clock").textContent =
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const night = d.getHours() >= 19 || d.getHours() < 6;
    document.body.classList.toggle("night", night);
    $("pg-sun").textContent = night ? "🌙" : "☀️";
  }
  tickClock();
  setInterval(tickClock, 30000);

  (function petals() {
    const cv = $("petal-canvas");
    if (!cv || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d");
    let W, H;
    const P = [];
    function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
    resize();
    addEventListener("resize", resize);
    for (let i = 0; i < 16; i++) {
      P.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        r: rand(4, 7), vy: rand(14, 30), vx: rand(-10, 10),
        rot: rand(0, Math.PI * 2), vr: rand(-1, 1),
      });
    }
    let prev = performance.now();
    (function draw(ts) {
      const dt = Math.min(0.05, (ts - prev) / 1000);
      prev = ts;
      ctx.clearRect(0, 0, W, H);
      for (const p of P) {
        p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.y / 40) * 8) * dt; p.rot += p.vr * dt;
        if (p.y > H + 12) { p.y = -12; p.x = Math.random() * W; }
        if (p.x > W + 12) p.x = -12; else if (p.x < -12) p.x = W + 12;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = "rgba(255, 170, 195, 0.65)";
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(draw);
    })(prev);
  })();

  refreshUI();
  setTimeout(() => {
    actor.say(pick(LINES.greet));
    actor.emote("wave", 2.2);
  }, 500);
})();
