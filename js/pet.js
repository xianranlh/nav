/* ===============================
   宠物乐园 pet.js
   小樱 —— 精灵图逐帧动画 + 行为状态机
   精灵图：assets/pet/xiaoying-sheet.png
   网格：8 列 × 9 行，单帧 52 × 56
   =============================== */
(() => {
  "use strict";

  /* ---------- 精灵图动作表 ---------- */
  // row: 精灵图行号；frames: 帧数；fps: 播放速度
  // once: 只播一遍并停在最后一帧（如入睡）
  const ANIM = {
    idle:   { row: 0, frames: 6, fps: 4 },   // 站立眨眼
    runR:   { row: 1, frames: 8, fps: 10 },  // 向右跑
    runL:   { row: 2, frames: 8, fps: 10 },  // 向左跑
    walk:   { row: 3, frames: 4, fps: 5 },   // 原地踏步
    sit:    { row: 4, frames: 5, fps: 4 },   // 坐下休息
    sleep:  { row: 5, frames: 8, fps: 2.2, once: true }, // 揉眼→躺下入睡
    joy:    { row: 6, frames: 6, fps: 7 },   // 开心蹦跳
    wave:   { row: 7, frames: 6, fps: 6 },   // 打招呼
    shy:    { row: 8, frames: 6, fps: 6 },   // 害羞扭捏
  };
  const CELL_W = 52, CELL_H = 56, SCALE = 2;
  const RUN_SPEED = 95; // px / s

  /* ---------- 台词 ---------- */
  const LINES = {
    greet:  ["主人来啦～", "今天也要元气满满！", "想我了吗？", "嘿嘿，欢迎回来～"],
    pat:    ["嘿嘿，好舒服～", "再摸一下嘛…", "♪(´▽｀)", "最喜欢主人了！"],
    feed:   ["开动啦～", "唔，好好吃！", "谢谢主人的点心！", "甜甜的～"],
    play:   ["一起玩耍吧！", "转圈圈～", "耶！好开心！", "看我的舞步～"],
    sleepy: ["有点困了呢…", "晚安，主人…", "呼…呼…", "zzZ…"],
    wake:   ["唔…早上好？", "醒来啦！", "睡得好香呀～"],
    run:    ["马上到！", "冲鸭！", "跑起来～"],
    bored:  ["主人在忙什么呀？", "陪我玩嘛～", "看看花开得多好呀", "哼哼哼～♪"],
    full:   ["吃不下啦…", "肚子圆滚滚了～"],
  };
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const rand = (min, max) => min + Math.random() * (max - min);

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const sprite = $("pet-sprite");
  const bubble = $("pet-bubble");
  const playground = $("playground");
  const fxLayer = $("fx-layer");

  /* ---------- 存档 ---------- */
  const SAVE_KEY = "sakura-pet@1";
  const save = loadSave();
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return { affection: 0, hunger: 60, last: 0 };
      return { affection: s.affection | 0, hunger: Math.min(100, s.hunger | 0), last: s.last || 0 };
    } catch { return { affection: 0, hunger: 60, last: 0 }; }
  }
  function persist() {
    save.last = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
  }

  /* ---------- 状态 ---------- */
  const pet = {
    x: 0,               // 相对游乐场左边缘
    targetX: null,      // 跑动目标
    anim: "idle",
    frame: 0,
    frameTimer: 0,
    stateTimer: 0,      // 当前行为剩余时间（秒）
    sleeping: false,
    busy: false,        // 播放一次性动作（emote）中
  };
  const petW = CELL_W * SCALE;

  function bounds() {
    return { min: 8, max: playground.clientWidth - petW - 8 };
  }

  /* ---------- 渲染 ---------- */
  function applyFrame() {
    const a = ANIM[pet.anim];
    sprite.style.backgroundPosition =
      `${-pet.frame * CELL_W * SCALE}px ${-a.row * CELL_H * SCALE}px`;
    sprite.style.left = `${pet.x}px`;
  }

  function setAnim(name) {
    if (pet.anim === name) return;
    pet.anim = name;
    pet.frame = 0;
    pet.frameTimer = 0;
    applyFrame();
  }

  /* ---------- 气泡 ---------- */
  let bubbleTimer = 0;
  function say(text, ms = 2600) {
    bubble.textContent = text;
    bubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { bubble.hidden = true; }, ms);
  }

  /* ---------- 粒子 ---------- */
  function spawnFx(cls, emoji, n = 1) {
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = emoji;
      el.style.left = `${pet.x + petW / 2 + rand(-24, 24)}px`;
      el.style.bottom = `${34 + petW * 0.9 + rand(-8, 12)}px`;
      el.style.animationDelay = `${i * 0.12}s`;
      fxLayer.appendChild(el);
      setTimeout(() => el.remove(), 2800);
    }
  }
  const hearts = (n = 3) => spawnFx("fx-heart", pick(["💗", "💕", "🩷", "✨"]), n);

  /* ---------- 行为状态机 ---------- */
  function decide() {
    if (pet.sleeping || pet.busy) return;
    const roll = Math.random();
    const { min, max } = bounds();
    if (roll < 0.42) {                      // 去别处逛逛
      pet.targetX = rand(min, max);
      pet.stateTimer = 99;
    } else if (roll < 0.58) {               // 坐下休息
      setAnim("sit");
      pet.stateTimer = rand(3, 6);
    } else if (roll < 0.7) {                // 原地踏步
      setAnim("walk");
      pet.stateTimer = rand(2, 4);
    } else if (roll < 0.78) {               // 自言自语
      setAnim("wave");
      say(pick(LINES.bored));
      pet.stateTimer = rand(2, 3.5);
    } else if (roll < 0.86) {               // 开心一下
      setAnim("joy");
      pet.stateTimer = rand(2, 3.5);
    } else {                                // 发呆
      setAnim("idle");
      pet.stateTimer = rand(2.5, 5);
    }
  }

  // 播放一段一次性动作（互动反馈），结束后回到 idle
  function emote(name, dur = 2.2) {
    if (pet.sleeping) return;
    pet.busy = true;
    pet.targetX = null;
    setAnim(name);
    setTimeout(() => {
      pet.busy = false;
      setAnim("idle");
      pet.stateTimer = rand(1.5, 3);
    }, dur * 1000);
  }

  /* ---------- 主循环 ---------- */
  let lastTs = performance.now();
  let zzzTimer = 0;
  function tick(ts) {
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;

    // 逐帧动画
    const a = ANIM[pet.anim];
    pet.frameTimer += dt;
    if (pet.frameTimer >= 1 / a.fps) {
      pet.frameTimer = 0;
      if (a.once) {
        if (pet.frame < a.frames - 1) pet.frame++;
      } else {
        pet.frame = (pet.frame + 1) % a.frames;
      }
    }

    // 睡觉时冒 Zzz
    if (pet.sleeping) {
      zzzTimer += dt;
      if (zzzTimer > 1.6) { zzzTimer = 0; spawnFx("fx-zzz", "💤"); }
    }

    // 移动
    if (!pet.sleeping && !pet.busy && pet.targetX != null) {
      const dir = Math.sign(pet.targetX - pet.x);
      setAnim(dir >= 0 ? "runR" : "runL");
      pet.x += dir * RUN_SPEED * dt;
      const { min, max } = bounds();
      pet.x = Math.max(min, Math.min(max, pet.x));
      if (Math.abs(pet.targetX - pet.x) < 4) {   // 到达目的地
        pet.targetX = null;
        setAnim("idle");
        pet.stateTimer = rand(1.5, 3.5);
      }
    } else if (!pet.sleeping && !pet.busy) {
      pet.stateTimer -= dt;
      if (pet.stateTimer <= 0) decide();
    }

    applyFrame();
    requestAnimationFrame(tick);
  }

  /* ---------- 数值 / UI ---------- */
  function level() { return 1 + Math.floor(Math.sqrt(save.affection / 8)); }
  function refreshUI() {
    $("pet-level").textContent = `Lv.${level()}`;
    const lvNext = 8 * Math.pow(level(), 2);
    $("affection-bar").style.width = `${Math.min(100, (save.affection / lvNext) * 100)}%`;
    $("affection-num").textContent = save.affection;
    $("hunger-bar").style.width = `${save.hunger}%`;
    $("hunger-num").textContent = save.hunger;
    const mood = pet.sleeping ? "😴 睡着了"
      : save.hunger < 25 ? "🥺 肚子饿了"
      : save.affection >= 80 ? "🥰 无比亲密"
      : save.affection >= 30 ? "😊 心情不错"
      : "🙂 慢慢熟悉中";
    $("pet-mood").textContent = mood;
  }
  function gainAffection(n) {
    save.affection += n;
    persist();
    refreshUI();
  }

  /* ---------- 睡觉 ---------- */
  function fallAsleep(sayLine = true) {
    if (pet.sleeping) return;
    pet.sleeping = true;
    pet.busy = false;
    pet.targetX = null;
    setAnim("sleep");
    if (sayLine) say(pick(LINES.sleepy));
    refreshUI();
  }
  function wakeUp() {
    if (!pet.sleeping) return;
    pet.sleeping = false;
    setAnim("idle");
    pet.stateTimer = rand(1, 2);
    say(pick(LINES.wake));
    refreshUI();
  }

  /* ---------- 交互 ---------- */
  // 点击草地：跑过去
  playground.addEventListener("click", (e) => {
    if (e.target === sprite || sprite.contains(e.target)) return;
    if (pet.sleeping) return;
    const rect = playground.getBoundingClientRect();
    const { min, max } = bounds();
    pet.targetX = Math.max(min, Math.min(max, e.clientX - rect.left - petW / 2));
    pet.busy = false;
    if (Math.random() < 0.4) say(pick(LINES.run), 1500);
  });

  // 点击小樱：撒娇 + 加亲密度
  sprite.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pet.sleeping) { wakeUp(); return; }
    hearts(3);
    gainAffection(1);
    say(pick(LINES.pat));
    emote(Math.random() < 0.5 ? "shy" : "joy");
  });

  // 按钮
  $("btn-pat").addEventListener("click", () => {
    if (pet.sleeping) { say("嘘——她睡着啦", 1600); return; }
    hearts(4);
    gainAffection(2);
    say(pick(LINES.pat));
    emote("shy");
  });
  $("btn-feed").addEventListener("click", () => {
    if (pet.sleeping) { say("嘘——她睡着啦", 1600); return; }
    if (save.hunger >= 100) { say(pick(LINES.full)); emote("shy", 1.6); return; }
    save.hunger = Math.min(100, save.hunger + 15);
    gainAffection(2);
    spawnFx("fx-heart", "🍡", 2);
    hearts(2);
    say(pick(LINES.feed));
    emote("joy");
  });
  $("btn-play").addEventListener("click", () => {
    if (pet.sleeping) { say("嘘——她睡着啦", 1600); return; }
    gainAffection(3);
    hearts(5);
    say(pick(LINES.play));
    emote("joy", 3);
  });
  $("btn-sleep").addEventListener("click", () => {
    pet.sleeping ? wakeUp() : fallAsleep();
  });

  // 饱食度随时间缓慢下降
  setInterval(() => {
    if (save.hunger > 0) {
      save.hunger = Math.max(0, save.hunger - 1);
      persist();
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
  pet.x = playground.clientWidth * 0.4;
  applyFrame();
  refreshUI();
  requestAnimationFrame(tick);

  // 欢迎词
  setTimeout(() => {
    say(pick(LINES.greet));
    emote("wave", 2.4);
  }, 600);
})();
