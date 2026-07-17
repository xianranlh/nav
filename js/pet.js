/* ===============================
   宠物乐园 pet.js（页面逻辑）
   依赖 pet-engine.js（SakuraPet）
   · 状态卡片 / 互动按钮 / 昼夜 / 花瓣
   · 上传图片生成自定义宠物（前端抠图）
   =============================== */
(() => {
  "use strict";
  const { Config, PetActor, LINES, pick, rand } = window.SakuraPet;
  const $ = (id) => document.getElementById(id);

  const cfg = Config.load();
  const playground = $("playground");
  const fxLayer = $("fx-layer");
  const DEFAULT_PORTRAIT = "assets/pet/xiaoying-portrait.png";

  /* ---------- 宠物本体 ---------- */
  const actor = new PetActor({
    container: playground,
    fxLayer,
    scale: 2,
    custom: cfg.custom ? cfg.custom.img : null,
    onPetClick(a) {
      a.hearts(3);
      gainAffection(1);
      a.say(pick(LINES.pat));
      a.emote(Math.random() < 0.5 ? "shy" : "joy");
    },
  });
  actor.onStateChange = refreshUI;

  // 点击草地：跑过去
  playground.addEventListener("click", (e) => {
    if (actor.el.contains(e.target)) return;
    if (actor.sleeping) return;
    const rect = playground.getBoundingClientRect();
    actor.runTo(e.clientX - rect.left - actor.w / 2);
  });

  /* ---------- 数值 / UI ---------- */
  function level() { return 1 + Math.floor(Math.sqrt(cfg.affection / 8)); }
  function refreshUI() {
    $("pet-name").textContent = cfg.name;
    $("pet-level").textContent = `Lv.${level()}`;
    const lvNext = 8 * Math.pow(level(), 2);
    $("affection-bar").style.width = `${Math.min(100, (cfg.affection / lvNext) * 100)}%`;
    $("affection-num").textContent = cfg.affection;
    $("hunger-bar").style.width = `${cfg.hunger}%`;
    $("hunger-num").textContent = cfg.hunger;
    const mood = actor.sleeping ? "😴 睡着了"
      : cfg.hunger < 25 ? "🥺 肚子饿了"
      : cfg.affection >= 80 ? "🥰 无比亲密"
      : cfg.affection >= 30 ? "😊 心情不错"
      : "🙂 慢慢熟悉中";
    $("pet-mood").textContent = mood;
    // 自定义宠物 → 立绘同步
    $("pet-portrait-img").src = cfg.custom ? cfg.custom.img : DEFAULT_PORTRAIT;
    $("btn-restore").hidden = !cfg.custom;
    $("chk-home").checked = cfg.homeWidget;
  }
  function gainAffection(n) {
    cfg.affection += n;
    Config.save(cfg);
    refreshUI();
  }

  /* ---------- 互动按钮 ---------- */
  const asleepGuard = () => { if (actor.sleeping) { actor.say("嘘——她睡着啦", 1600); return true; } return false; };
  $("btn-pat").addEventListener("click", () => {
    if (asleepGuard()) return;
    actor.hearts(4);
    gainAffection(2);
    actor.say(pick(LINES.pat));
    actor.emote("shy");
  });
  $("btn-feed").addEventListener("click", () => {
    if (asleepGuard()) return;
    if (cfg.hunger >= 100) { actor.say(pick(LINES.full)); actor.emote("shy", 1.6); return; }
    cfg.hunger = Math.min(100, cfg.hunger + 15);
    gainAffection(2);
    actor.spawnFx("pe-heart", "🍡", 2);
    actor.hearts(2);
    actor.say(pick(LINES.feed));
    actor.emote("joy");
  });
  $("btn-play").addEventListener("click", () => {
    if (asleepGuard()) return;
    gainAffection(3);
    actor.hearts(5);
    actor.say(pick(LINES.play));
    actor.emote("joy", 3);
  });
  $("btn-sleep").addEventListener("click", () => {
    actor.sleeping ? actor.wakeUp() : actor.fallAsleep();
    refreshUI();
  });

  /* ---------- 上传图片生成宠物 ---------- */
  $("btn-upload").addEventListener("click", () => $("pet-file").click());
  $("pet-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await processImage(file);
      cfg.custom = { img: dataUrl };
      cfg.name = (file.name.replace(/\.[^.]+$/, "").slice(0, 12)) || "我的宠物";
      Config.save(cfg);
      actor.setCustom(dataUrl);
      refreshUI();
      actor.hearts(5);
      actor.say("新形象登场！好看吗？", 3000);
      actor.emote("joy", 2.5);
    } catch (err) {
      console.error(err);
      actor.say("这张图片读取不了呢…", 2600);
    }
  });
  $("btn-restore").addEventListener("click", () => {
    cfg.custom = null;
    cfg.name = "小樱";
    Config.save(cfg);
    actor.setCustom(null);
    refreshUI();
    actor.say("小樱回来啦～", 2600);
    actor.emote("wave", 2.2);
  });

  // 点击名字改名
  $("pet-name").addEventListener("click", () => {
    const n = prompt("给宠物起个名字吧（12 字以内）", cfg.name);
    if (n && n.trim()) {
      cfg.name = n.trim().slice(0, 12);
      Config.save(cfg);
      refreshUI();
    }
  });

  /**
   * 前端抠图：缩放至 ≤240px → 若四角颜色一致则视作背景色，
   * 从边框 BFS 泛洪去除背景 → 裁剪空白 → PNG dataURL
   */
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
    // 图片本身带透明 → 不处理
    if (corners.some((i) => d[i + 3] < 250)) return;
    const cr = d[corners[0]], cg = d[corners[0] + 1], cb = d[corners[0] + 2];
    const dist = (i) => Math.abs(d[i] - cr) + Math.abs(d[i + 1] - cg) + Math.abs(d[i + 2] - cb);
    // 四角颜色需一致，否则认为没有纯色背景
    if (!corners.every((i) => dist(i) < 90)) return;
    const TOL = 110;
    const seen = new Uint8Array(w * h);
    const queue = [];
    for (let x = 0; x < w; x++) { queue.push(x, x + (h - 1) * w); }
    for (let y = 0; y < h; y++) { queue.push(y * w, y * w + w - 1); }
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
    if (maxX < 0) return cv; // 全透明？原样返回
    const pad = 2;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext("2d").drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /* ---------- 首页小宠物开关 ---------- */
  $("chk-home").addEventListener("change", (e) => {
    cfg.homeWidget = e.target.checked;
    Config.save(cfg);
    actor.say(cfg.homeWidget ? "我会去首页陪你哦～" : "那我就待在乐园里啦", 2400);
  });

  /* ---------- 饱食度随时间缓慢下降 ---------- */
  setInterval(() => {
    if (cfg.hunger > 0) {
      cfg.hunger = Math.max(0, cfg.hunger - 1);
      Config.save(cfg);
      refreshUI();
    }
  }, 45000);

  /* ---------- 时钟 & 昼夜 ---------- */
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

  /* ---------- 花瓣背景 ---------- */
  (function petals() {
    const cv = $("petal-canvas");
    const ctx = cv.getContext("2d");
    let W, H;
    const P = [];
    function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
    resize();
    addEventListener("resize", resize);
    for (let i = 0; i < 24; i++) {
      P.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        r: rand(4, 8), vy: rand(14, 34), vx: rand(-12, 12),
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
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = "rgba(255, 170, 195, 0.7)";
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(draw);
    })(prev);
  })();

  /* ---------- 启动 ---------- */
  refreshUI();
  setTimeout(() => {
    actor.say(pick(LINES.greet));
    actor.emote("wave", 2.4);
  }, 600);
})();
