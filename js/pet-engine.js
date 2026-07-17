/* ===============================
   pet-engine.js —— 宠物共享引擎
   被 pet.html（宠物乐园）与 index.html（首页漫游小宠物）共用
   两种渲染模式：
   · sheet  ：小樱官方精灵图（4x 高清帧，52×56 逻辑帧）
   · custom ：用户上传图片，程序化动画（跳跃/摇摆/翻转/躺倒）
   =============================== */
(() => {
  "use strict";

  const SAVE_KEY = "sakura-pet@1";
  const SHEET_URL = "assets/pet/xiaoying-sheet.png";
  const CELL_W = 52, CELL_H = 56, SHEET_W = 416, SHEET_H = 504;

  /* ---------- 动作表（sheet 模式） ---------- */
  const ANIM = {
    idle:  { row: 0, frames: 6, fps: 4 },
    runR:  { row: 1, frames: 8, fps: 10 },
    runL:  { row: 2, frames: 8, fps: 10 },
    walk:  { row: 3, frames: 4, fps: 5 },
    sit:   { row: 4, frames: 5, fps: 4 },
    sleep: { row: 5, frames: 8, fps: 2.2, once: true },
    joy:   { row: 6, frames: 6, fps: 7 },
    wave:  { row: 7, frames: 6, fps: 6 },
    shy:   { row: 8, frames: 6, fps: 6 },
  };

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

  /* ---------- 存档 ---------- */
  const Config = {
    defaults() {
      return { affection: 0, hunger: 60, last: 0, custom: null, homeWidget: true, name: "小樱" };
    },
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (!s) return this.defaults();
        return {
          affection: s.affection | 0,
          hunger: Math.min(100, s.hunger == null ? 60 : s.hunger | 0),
          last: s.last || 0,
          custom: s.custom && s.custom.img ? s.custom : null,
          homeWidget: s.homeWidget !== false,
          name: s.name || (s.custom && s.custom.img ? "我的宠物" : "小樱"),
        };
      } catch { return this.defaults(); }
    },
    save(cfg) {
      cfg.last = Date.now();
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(cfg)); } catch {}
    },
  };

  /* ---------- 组件样式（一次性注入，页面无需引入额外 css） ---------- */
  function ensureStyles() {
    if (document.getElementById("pet-engine-css")) return;
    const st = document.createElement("style");
    st.id = "pet-engine-css";
    st.textContent = `
.pe-sprite{position:absolute;background-repeat:no-repeat;cursor:pointer;pointer-events:auto;z-index:3;transform-origin:50% 88%;user-select:none;-webkit-user-select:none;}
.pe-shadow{position:absolute;left:50%;bottom:-8px;width:62%;height:12px;transform:translateX(-50%);background:radial-gradient(ellipse at center,rgba(0,0,0,.22),transparent 70%);border-radius:50%;pointer-events:none;}
.pe-bubble{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);max-width:230px;white-space:nowrap;background:rgba(255,255,255,.95);border:1px solid rgba(229,99,138,.35);border-radius:12px;padding:6px 12px;font-size:13px;color:#4a3b52;box-shadow:0 4px 12px rgba(229,99,138,.2);animation:pe-bubble-pop .25s ease;pointer-events:none;z-index:4;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;}
.pe-bubble::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:rgba(255,255,255,.95);}
@keyframes pe-bubble-pop{from{opacity:0;transform:translateX(-50%) scale(.7)}to{opacity:1;transform:translateX(-50%) scale(1)}}
.pe-heart{position:absolute;font-size:18px;animation:pe-heart-rise 1.2s ease-out forwards;pointer-events:none;z-index:5;}
@keyframes pe-heart-rise{0%{opacity:0;transform:translateY(0) scale(.6)}20%{opacity:1}100%{opacity:0;transform:translateY(-70px) scale(1.15)}}
.pe-zzz{position:absolute;font-size:15px;animation:pe-zzz-rise 2.4s ease-out forwards;pointer-events:none;z-index:5;}
@keyframes pe-zzz-rise{0%{opacity:0;transform:translate(0,0) scale(.7)}25%{opacity:.9}100%{opacity:0;transform:translate(18px,-46px) scale(1.2)}}
`;
    document.head.appendChild(st);
  }

  /* ===============================
     PetActor —— 一只会动的宠物
     =============================== */
  class PetActor {
    /**
     * @param {Object} opts
     *   container    宿主元素（须 position:relative/fixed）
     *   fxLayer      粒子层（缺省用 container）
     *   scale        显示倍率（1 = 52×56）
     *   speed        奔跑速度 px/s
     *   groundBottom 距容器底部 px
     *   autonomous   是否自主闲逛
     *   chatty       闲逛时是否自言自语
     *   custom       用户宠物图片 dataURL（null = 小樱）
     *   onPetClick   点击宠物回调 (actor) => {}
     */
    constructor(opts = {}) {
      this.container = opts.container;
      this.fxLayer = opts.fxLayer || opts.container;
      this.scale = opts.scale || 2;
      this.speed = opts.speed || 95;
      this.groundBottom = opts.groundBottom == null ? 34 : opts.groundBottom;
      this.autonomous = opts.autonomous !== false;
      this.chatty = opts.chatty !== false;
      this.custom = opts.custom || null;
      this.onPetClick = opts.onPetClick || null;
      this.destroyed = false;

      ensureStyles();

      // DOM
      const el = this.el = document.createElement("div");
      el.className = "pe-sprite";
      el.style.bottom = `${this.groundBottom}px`;
      const shadow = document.createElement("div");
      shadow.className = "pe-shadow";
      const bubble = this.bubbleEl = document.createElement("div");
      bubble.className = "pe-bubble";
      bubble.hidden = true;
      el.appendChild(bubble);
      el.appendChild(shadow);
      this.container.appendChild(el);

      // 状态
      this.s = {
        x: Math.max(8, this.container.clientWidth * 0.4),
        targetX: null, anim: "idle", frame: 0, frameTimer: 0,
        stateTimer: 1.5, sleeping: false, busy: false, t: 0,
        facing: 1, zzzTimer: 0,
      };
      this._bubbleTimer = 0;
      this._emoteTimer = 0;

      this.applyMode();

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.s.sleeping) { this.wakeUp(); return; }
        if (this.onPetClick) this.onPetClick(this);
      });

      this._last = performance.now();
      this._raf = requestAnimationFrame((ts) => this._tick(ts));
    }

    get w() { return CELL_W * this.scale; }
    get h() { return CELL_H * this.scale; }

    /* ---------- 模式 ---------- */
    applyMode() {
      const el = this.el;
      el.style.width = `${this.w}px`;
      el.style.height = `${this.h}px`;
      if (this.custom) {
        el.classList.add("pe-custom");
        el.style.backgroundImage = `url("${this.custom}")`;
        el.style.backgroundSize = "contain";
        el.style.backgroundPosition = "center bottom";
      } else {
        el.classList.remove("pe-custom");
        el.style.backgroundImage = `url("${SHEET_URL}")`;
        el.style.backgroundSize = `${SHEET_W * this.scale}px ${SHEET_H * this.scale}px`;
        el.style.transform = "";
      }
    }
    setCustom(dataUrl) {
      this.custom = dataUrl || null;
      this.applyMode();
      this.setAnim("idle", true);
    }

    /* ---------- 基础 ---------- */
    bounds() {
      const w = this.container.clientWidth;
      return { min: 8, max: Math.max(8, w - this.w - 8) };
    }
    setAnim(name, force) {
      if (!force && this.s.anim === name) return;
      this.s.anim = name;
      this.s.frame = 0;
      this.s.frameTimer = 0;
      this._render();
    }
    say(text, ms = 2600) {
      this.bubbleEl.textContent = text;
      this.bubbleEl.hidden = false;
      clearTimeout(this._bubbleTimer);
      this._bubbleTimer = setTimeout(() => { this.bubbleEl.hidden = true; }, ms);
    }
    spawnFx(cls, emoji, n = 1) {
      for (let i = 0; i < n; i++) {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = emoji;
        s.style.left = `${this.s.x + this.w / 2 + rand(-24, 24)}px`;
        s.style.bottom = `${this.groundBottom + this.h * 0.85 + rand(-8, 12)}px`;
        s.style.animationDelay = `${i * 0.12}s`;
        this.fxLayer.appendChild(s);
        setTimeout(() => s.remove(), 2800);
      }
    }
    hearts(n = 3) { this.spawnFx("pe-heart", pick(["💗", "💕", "🩷", "✨"]), n); }

    /* ---------- 行为 ---------- */
    emote(name, dur = 2.2) {
      if (this.s.sleeping) return;
      this.s.busy = true;
      this.s.targetX = null;
      this.setAnim(name, true);
      clearTimeout(this._emoteTimer);
      this._emoteTimer = setTimeout(() => {
        this.s.busy = false;
        this.setAnim("idle");
        this.s.stateTimer = rand(1.5, 3);
      }, dur * 1000);
    }
    runTo(x, sayIt = true) {
      if (this.s.sleeping) return;
      const { min, max } = this.bounds();
      this.s.targetX = Math.max(min, Math.min(max, x));
      this.s.busy = false;
      clearTimeout(this._emoteTimer);
      if (sayIt && Math.random() < 0.4) this.say(pick(LINES.run), 1500);
    }
    fallAsleep(sayLine = true) {
      if (this.s.sleeping) return;
      this.s.sleeping = true;
      this.s.busy = false;
      this.s.targetX = null;
      this.setAnim("sleep", true);
      if (sayLine) this.say(pick(LINES.sleepy));
      if (this.onStateChange) this.onStateChange();
    }
    wakeUp() {
      if (!this.s.sleeping) return;
      this.s.sleeping = false;
      this.setAnim("idle", true);
      this.s.stateTimer = rand(1, 2);
      this.say(pick(LINES.wake));
      if (this.onStateChange) this.onStateChange();
    }
    get sleeping() { return this.s.sleeping; }

    decide() {
      const roll = Math.random();
      const { min, max } = this.bounds();
      if (roll < 0.42) {
        this.s.targetX = rand(min, max);
        this.s.stateTimer = 99;
      } else if (roll < 0.58) {
        this.setAnim("sit");
        this.s.stateTimer = rand(3, 6);
      } else if (roll < 0.7) {
        this.setAnim("walk");
        this.s.stateTimer = rand(2, 4);
      } else if (roll < 0.78) {
        this.setAnim("wave");
        if (this.chatty) this.say(pick(LINES.bored));
        this.s.stateTimer = rand(2, 3.5);
      } else if (roll < 0.86) {
        this.setAnim("joy");
        this.s.stateTimer = rand(2, 3.5);
      } else {
        this.setAnim("idle");
        this.s.stateTimer = rand(2.5, 5);
      }
    }

    /* ---------- 主循环 ---------- */
    _tick(ts) {
      if (this.destroyed) return;
      const dt = Math.min(0.1, (ts - this._last) / 1000);
      this._last = ts;
      const s = this.s;
      s.t += dt;

      // sheet 帧推进
      const a = ANIM[s.anim];
      s.frameTimer += dt;
      if (s.frameTimer >= 1 / a.fps) {
        s.frameTimer = 0;
        if (a.once) { if (s.frame < a.frames - 1) s.frame++; }
        else s.frame = (s.frame + 1) % a.frames;
      }

      // 睡觉冒 Zzz
      if (s.sleeping) {
        s.zzzTimer += dt;
        if (s.zzzTimer > 1.6) { s.zzzTimer = 0; this.spawnFx("pe-zzz", "💤"); }
      }

      // 移动
      if (!s.sleeping && !s.busy && s.targetX != null) {
        const dir = Math.sign(s.targetX - s.x) || 1;
        s.facing = dir;
        this.setAnim(dir >= 0 ? "runR" : "runL");
        s.x += dir * this.speed * dt;
        const { min, max } = this.bounds();
        s.x = Math.max(min, Math.min(max, s.x));
        if (Math.abs(s.targetX - s.x) < 4) {
          s.targetX = null;
          this.setAnim("idle");
          s.stateTimer = rand(1.5, 3.5);
        }
      } else if (!s.sleeping && !s.busy && this.autonomous) {
        s.stateTimer -= dt;
        if (s.stateTimer <= 0) this.decide();
      }

      this._render();
      this._raf = requestAnimationFrame((t2) => this._tick(t2));
    }

    /* ---------- 渲染 ---------- */
    _render() {
      const s = this.s, el = this.el;
      el.style.left = `${s.x}px`;
      if (!this.custom) {
        const a = ANIM[s.anim];
        el.style.backgroundPosition =
          `${-s.frame * CELL_W * this.scale}px ${-a.row * CELL_H * this.scale}px`;
        return;
      }
      // custom 模式：程序化动画
      const t = s.t;
      let tf = "";
      switch (s.anim) {
        case "runR":
          tf = `translateY(${-Math.abs(Math.sin(t * 9)) * 10}px) rotate(${Math.sin(t * 9) * 4}deg)`;
          break;
        case "runL":
          tf = `translateY(${-Math.abs(Math.sin(t * 9)) * 10}px) rotate(${Math.sin(t * 9) * -4}deg) scaleX(-1)`;
          break;
        case "walk":
          tf = `translateY(${-Math.abs(Math.sin(t * 6)) * 6}px)`;
          break;
        case "sit":
          tf = `translateY(${this.h * 0.08}px) scale(1.05, ${0.86 + Math.sin(t * 2) * 0.015})`;
          break;
        case "sleep":
          tf = `translateY(${this.h * 0.16}px) rotate(-84deg) scale(${1 + Math.sin(t * 1.5) * 0.02})`;
          break;
        case "joy":
          tf = `translateY(${-Math.abs(Math.sin(t * 7)) * 16}px) rotate(${Math.sin(t * 7) * 8}deg)`;
          break;
        case "wave":
          tf = `rotate(${Math.sin(t * 8) * 7}deg)`;
          break;
        case "shy":
          tf = `translateX(${Math.sin(t * 10) * 2}px) rotate(${Math.sin(t * 5) * 3}deg) scale(.97)`;
          break;
        default: // idle
          tf = `translateY(${Math.sin(t * 2.2) * 3}px)`;
      }
      el.style.transform = tf;
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this._raf);
      clearTimeout(this._bubbleTimer);
      clearTimeout(this._emoteTimer);
      this.el.remove();
    }
  }

  window.SakuraPet = { Config, PetActor, ANIM, LINES, pick, rand, SHEET_URL, SAVE_KEY };
})();
