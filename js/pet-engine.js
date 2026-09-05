/* ===============================
   pet-engine.js —— 宠物共享引擎
   定位对齐 Codex Pet 折中方案：
   · 首页：状态桌宠（idle / thinking / working / done / error / offline / syncing）
   · 乐园页：轻互动 + 改名/换装，不做养成数值游戏
   =============================== */
(() => {
  "use strict";

  if (!window.SakuraPetConfig || !window.SakuraPetEvents) {
    console.error("[pet] pet-config.js 与 pet-events.js 必须先于 pet-engine.js 加载");
    return;
  }
  const { Config, SAVE_KEY, LEGACY_KEY: LEGACY_SAVE_KEY, V2_KEY } = window.SakuraPetConfig;
  const Status = window.SakuraPetEvents.bus;
  const SHEET_URL = "assets/pet/xiaoying-sheet.png";
  const CELL_W = 52, CELL_H = 56, SHEET_W = 416, SHEET_H = 504;

  /* ---------- 动作表（sheet） ---------- */
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

  /** 状态 → 默认动作 / 角标文案 */
  const STATUS_META = {
    idle:     { anim: "idle",  label: "待命",   emoji: "💤" },
    thinking: { anim: "walk",  label: "思考中", emoji: "💭" },
    working:  { anim: "runR",  label: "工作中", emoji: "⚡" },
    waiting:  { anim: "sit",   label: "等待你", emoji: "👀" },
    done:     { anim: "joy",   label: "完成",   emoji: "✅" },
    error:    { anim: "shy",   label: "出错了", emoji: "⚠️" },
    offline:  { anim: "sleep", label: "离线",   emoji: "📡" },
    syncing:  { anim: "wave",  label: "同步中", emoji: "🔄" },
  };

  const LINES = {
    greet:   ["在呢～", "有什么要忙的吗？", "随时待命！", "嘿，我在这儿"],
    pat:     ["嘿嘿～", "♪", "点到我啦", "继续加油哦"],
    thinking:["我在想…", "处理中…", "稍等一下～"],
    working: ["跑起来～", "马上好", "专心干活中"],
    done:    ["搞定！", "完成啦✨", "可以看结果了"],
    error:   ["哎呀…", "好像出了点问题", "要不要重试？"],
    offline: ["网络断开了…", "离线中", "连上再说"],
    syncing: ["同步数据…", "存一下～"],
    idle:    ["发呆中…", "等你指令", "哼哼哼～"],
    guard:   ["站岗中！", "这里交给我～", "一动不动盯梢中"],
    patrol:  ["去巡逻啦～", "这边看看…那边看看…", "来回溜达中"],
  };

  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const rand = (min, max) => min + Math.random() * (max - min);

  Status.meta = (status) => STATUS_META[status] || STATUS_META.idle;

  function ensureStyles() {
    if (document.getElementById("pet-engine-css")) return;
    const st = document.createElement("style");
    st.id = "pet-engine-css";
    st.textContent = `
.pe-sprite{position:absolute;background-repeat:no-repeat;cursor:pointer;pointer-events:auto;z-index:3;transform-origin:50% 88%;user-select:none;-webkit-user-select:none;touch-action:manipulation;}
.pe-shadow{position:absolute;left:50%;bottom:-8px;width:62%;height:12px;transform:translateX(-50%);background:radial-gradient(ellipse at center,rgba(0,0,0,.22),transparent 70%);border-radius:50%;pointer-events:none;}
.pe-bubble{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);max-width:min(240px,70vw);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,.95);border:1px solid rgba(229,99,138,.35);border-radius:12px;padding:6px 12px;font-size:13px;color:#4a3b52;box-shadow:0 4px 12px rgba(229,99,138,.2);animation:pe-bubble-pop .25s ease;pointer-events:none;z-index:4;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;}
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
     PetActor
     =============================== */
  class PetActor {
    /**
     * opts: container, fxLayer, scale, speed, groundBottom,
     *       autonomous, chatty, custom, onPetClick, statusDriven,
     *       activityMode (guard 站岗 | patrol 巡逻)
     * statusDriven=true 时动作跟随 Status；巡逻模式下空闲时可走动
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
      this.statusDriven = !!opts.statusDriven;
      this.activityMode = opts.activityMode === "patrol" ? "patrol" : "guard";
      this.destroyed = false;
      this._statusUnsub = null;

      ensureStyles();

      const el = (this.el = document.createElement("div"));
      el.className = "pe-sprite";
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "宠物");
      el.tabIndex = 0;
      el.style.bottom = `${this.groundBottom}px`;
      const shadow = document.createElement("div");
      shadow.className = "pe-shadow";
      const bubble = (this.bubbleEl = document.createElement("div"));
      bubble.className = "pe-bubble";
      bubble.hidden = true;
      el.appendChild(bubble);
      el.appendChild(shadow);
      this.container.appendChild(el);

      this.s = {
        x: Math.max(8, (this.container.clientWidth || 200) * 0.4),
        targetX: null,
        anim: "idle",
        frame: 0,
        frameTimer: 0,
        stateTimer: 1.5,
        sleeping: false,
        busy: false,
        t: 0,
        facing: 1,
        zzzTimer: 0,
      };
      this._bubbleTimer = 0;
      this._emoteTimer = 0;

      this.applyMode();

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.s.sleeping && !this.statusDriven) {
          this.wakeUp();
          return;
        }
        if (this.onPetClick) this.onPetClick(this);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        el.click();
      });

      if (this.statusDriven) {
        this._statusUnsub = Status.on((p) => this.applyStatus(p.status, p.detail));
        this.applyStatus(Status.get().status, Status.get().detail);
      } else {
        this._syncActivityAutonomy();
      }

      this._last = performance.now();
      this._raf = 0;
      this._onVisibility = () => {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
        if (!document.hidden && !this.destroyed) {
          this._last = performance.now();
          this._raf = requestAnimationFrame((ts) => this._tick(ts));
        }
      };
      document.addEventListener("visibilitychange", this._onVisibility);
      if (!document.hidden) this._raf = requestAnimationFrame((ts) => this._tick(ts));
    }

    /** 切换站岗 / 巡逻 */
    setActivityMode(mode) {
      this.activityMode = mode === "patrol" ? "patrol" : "guard";
      if (this.statusDriven) {
        this.applyStatus(Status.get().status, Status.get().detail);
      } else {
        this._syncActivityAutonomy();
        if (this.activityMode === "guard") {
          this.s.targetX = null;
          this.setAnim("idle", true);
        } else {
          this.s.stateTimer = 0.3;
        }
      }
    }

    _syncActivityAutonomy() {
      if (this.activityMode === "patrol") {
        this.autonomous = true;
      } else {
        this.autonomous = false;
        this.s.targetX = null;
      }
    }

    /** 是否允许自主走动（巡逻 + 空闲） */
    _canPatrolWalk() {
      if (this.activityMode !== "patrol") return false;
      if (this.s.sleeping || this.s.busy) return false;
      if (!this.statusDriven) return true;
      const st = Status.get().status;
      return st === "idle" || st === "waiting";
    }

    get w() { return CELL_W * this.scale; }
    get h() { return CELL_H * this.scale; }

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
    setScale(scale) {
      const next = Number(scale);
      if (!Number.isFinite(next) || next <= 0) return;
      this.scale = next;
      this.applyMode();
      const bounds = this.bounds();
      this.s.x = Math.max(bounds.min, Math.min(bounds.max, this.s.x));
      this._render();
    }

    /** 跟随全局状态切换动作 */
    applyStatus(status, detail) {
      if (this.destroyed) return;
      const meta = STATUS_META[status] || STATUS_META.idle;
      this.s.sleeping = status === "offline";
      const hardBusy =
        status === "thinking" ||
        status === "working" ||
        status === "syncing" ||
        status === "done" ||
        status === "error" ||
        status === "offline";

      if (this.activityMode === "patrol" && (status === "idle" || status === "waiting")) {
        // 巡逻 + 空闲：放开走动，不锁死动画
        this.s.busy = false;
        this.s.sleeping = false;
        this.autonomous = true;
        if (!this.s.targetX) {
          // 若当前不是移动类动画，给一点时间后 decide
          const moving = this.s.anim === "runR" || this.s.anim === "runL" || this.s.anim === "walk";
          if (!moving) {
            this.setAnim("idle", false);
            this.s.stateTimer = Math.min(this.s.stateTimer || 1, 1.2);
          }
        }
        return;
      }

      // 站岗，或巡逻但忙碌：停住并播状态动作
      this.autonomous = false;
      this.s.busy = hardBusy || this.activityMode === "guard";
      this.s.targetX = null;
      this.setAnim(meta.anim, true);
      // 站岗空闲时 busy=false，允许原地 idle 呼吸
      if (this.activityMode === "guard" && (status === "idle" || status === "waiting")) {
        this.s.busy = false;
      }
    }

    bounds() {
      const w = this.container.clientWidth || 200;
      return { min: 8, max: Math.max(8, w - this.w - 8) };
    }
    setAnim(name, force) {
      if (!force && this.s.anim === name) return;
      if (!ANIM[name]) name = "idle";
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
    hearts(n = 3) { this.spawnFx("pe-heart", pick(["💗", "💕", "✨"]), n); }

    emote(name, dur = 2.2) {
      if (this.statusDriven) {
        // 状态驱动模式下短 emote 后回到当前状态动作
        this.setAnim(name, true);
        clearTimeout(this._emoteTimer);
        this._emoteTimer = setTimeout(() => {
          this.applyStatus(Status.get().status, Status.get().detail);
        }, dur * 1000);
        return;
      }
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
      // 站岗（状态驱动）不响应跑动；巡逻或非状态驱动可以
      if (this.statusDriven && this.activityMode !== "patrol") return;
      if (this.statusDriven && !this._canPatrolWalk()) return;
      const { min, max } = this.bounds();
      this.s.targetX = Math.max(min, Math.min(max, x));
      this.s.busy = false;
      clearTimeout(this._emoteTimer);
      if (sayIt && Math.random() < 0.35) this.say(pick(["马上到！", "来啦～"]), 1400);
    }
    fallAsleep(sayLine = true) {
      if (this.s.sleeping) return;
      this.s.sleeping = true;
      this.s.busy = false;
      this.s.targetX = null;
      this.setAnim("sleep", true);
      if (sayLine) this.say(pick(["有点困了…", "zzZ…"]));
      if (this.onStateChange) this.onStateChange();
    }
    wakeUp() {
      if (!this.s.sleeping) return;
      this.s.sleeping = false;
      this.setAnim("idle", true);
      this.s.stateTimer = rand(1, 2);
      this.say(pick(["醒来啦！", "唔…好了"]));
      if (this.onStateChange) this.onStateChange();
    }
    get sleeping() { return this.s.sleeping; }

    decide() {
      const roll = Math.random();
      const { min, max } = this.bounds();
      // 巡逻模式更爱走动
      const walkBias = this.activityMode === "patrol" ? 0.62 : 0.4;
      if (roll < walkBias) {
        this.s.targetX = rand(min, max);
        this.s.stateTimer = 99;
      } else if (roll < walkBias + 0.12) {
        this.setAnim("sit");
        this.s.stateTimer = rand(2, 4);
      } else if (roll < walkBias + 0.22) {
        this.setAnim("walk");
        this.s.stateTimer = rand(2, 4);
      } else if (roll < walkBias + 0.3) {
        this.setAnim("wave");
        if (this.chatty) this.say(pick(LINES.idle));
        this.s.stateTimer = rand(2, 3.5);
      } else {
        this.setAnim("idle");
        this.s.stateTimer = rand(1.8, 3.5);
      }
    }

    _tick(ts) {
      if (this.destroyed) return;
      const dt = Math.min(0.1, (ts - this._last) / 1000);
      this._last = ts;
      const s = this.s;
      s.t += dt;

      const a = ANIM[s.anim] || ANIM.idle;
      s.frameTimer += dt;
      if (s.frameTimer >= 1 / a.fps) {
        s.frameTimer = 0;
        if (a.once) {
          if (s.frame < a.frames - 1) s.frame++;
        } else s.frame = (s.frame + 1) % a.frames;
      }

      if (s.sleeping) {
        s.zzzTimer += dt;
        if (s.zzzTimer > 1.6) {
          s.zzzTimer = 0;
          this.spawnFx("pe-zzz", "💤");
        }
      }

      const canWalk = this._canPatrolWalk() || (!this.statusDriven && !s.sleeping && !s.busy);
      if (canWalk && s.targetX != null) {
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
      } else if (canWalk && this.autonomous) {
        s.stateTimer -= dt;
        if (s.stateTimer <= 0) this.decide();
      }

      // 站岗 + 忙碌：原地轻微踱步（巡逻忙碌时也小幅，但保持当前位置）
      if (
        this.statusDriven &&
        this.activityMode === "guard" &&
        (Status.get().status === "working" || Status.get().status === "thinking")
      ) {
        s.x = (this.container.clientWidth || 120) / 2 - this.w / 2 + Math.sin(s.t * 2.2) * 10;
      }

      this._render();
      if (!document.hidden) this._raf = requestAnimationFrame((t2) => this._tick(t2));
    }

    _render() {
      const s = this.s, el = this.el;
      el.style.left = `${s.x}px`;
      if (!this.custom) {
        const a = ANIM[s.anim] || ANIM.idle;
        el.style.backgroundPosition =
          `${-s.frame * CELL_W * this.scale}px ${-a.row * CELL_H * this.scale}px`;
        return;
      }
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
        default:
          tf = `translateY(${Math.sin(t * 2.2) * 3}px)`;
      }
      el.style.transform = tf;
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this._raf);
      document.removeEventListener("visibilitychange", this._onVisibility);
      clearTimeout(this._bubbleTimer);
      clearTimeout(this._emoteTimer);
      if (this._statusUnsub) this._statusUnsub();
      this.el.remove();
    }
  }

  window.SakuraPet = {
    Config,
    PetActor,
    Status,
    ANIM,
    LINES,
    STATUS_META,
    pick,
    rand,
    SHEET_URL,
    SAVE_KEY,
    V2_KEY,
    LEGACY_SAVE_KEY,
  };
})();
