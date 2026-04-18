/* 碎樱花飘舞背景
 * - Canvas 粒子系统，性能友好 (devicePixelRatio 自适应)
 * - 支持暂停、动态调整数量和速度
 * - 可根据 body.data-theme 自动调整配色
 */
(function () {
  const canvas = document.getElementById("sakura-canvas");
  const ctx = canvas.getContext("2d");

  let width = 0, height = 0, dpr = 1;
  let petals = [];
  let running = true;
  let rafId = 0;
  let config = {
    count: 70,        // 樱花数量
    speed: 1.0,       // 全局速度倍率
    wind: 0.6,        // 风力
    sizeMin: 8,
    sizeMax: 18,
  };

  // 一片花瓣的数据
  function Petal(init = true) {
    this.reset(init);
  }
  Petal.prototype.reset = function (initial) {
    this.x = Math.random() * width;
    this.y = initial ? Math.random() * height : -20 - Math.random() * height * 0.3;
    this.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
    this.vy = 0.6 + Math.random() * 1.2;
    this.vx = -0.3 + Math.random() * 0.6;
    this.rot = Math.random() * Math.PI * 2;
    this.vr = (-0.02 + Math.random() * 0.04);
    this.swing = Math.random() * Math.PI * 2;
    this.swingSpeed = 0.01 + Math.random() * 0.02;
    this.opacity = 0.6 + Math.random() * 0.4;
    // 颜色（粉色系随机）
    const palette = [
      [255, 205, 219],
      [255, 182, 203],
      [255, 170, 200],
      [255, 225, 235],
      [250, 192, 220],
    ];
    const c = palette[Math.floor(Math.random() * palette.length)];
    this.color = c;
  };
  Petal.prototype.update = function (dt) {
    this.swing += this.swingSpeed;
    this.x += (this.vx + Math.sin(this.swing) * 0.6 + config.wind * 0.3) * config.speed * dt;
    this.y += this.vy * config.speed * dt;
    this.rot += this.vr * config.speed * dt;
    if (this.y > height + 20 || this.x < -40 || this.x > width + 40) {
      this.reset(false);
    }
  };
  Petal.prototype.draw = function (ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = this.opacity;

    // 绘制花瓣形状：两个贝塞尔曲线构造椭圆带尖的瓣
    const s = this.size;
    const grad = ctx.createLinearGradient(-s, 0, s, 0);
    const [r, g, b] = this.color;
    grad.addColorStop(0, `rgba(${r},${g},${b},0.2)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(1, `rgba(255,255,255,0.4)`);
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, -s * 0.9);
    ctx.bezierCurveTo(s * 0.6, -s * 0.5, s * 0.6, s * 0.3, 0, s * 0.7);
    ctx.bezierCurveTo(-s * 0.6, s * 0.3, -s * 0.6, -s * 0.5, 0, -s * 0.9);
    ctx.closePath();
    ctx.fill();

    // 中心纹理
    ctx.strokeStyle = `rgba(${r - 20},${g - 40},${b - 30},0.5)`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(0, s * 0.5);
    ctx.stroke();

    ctx.restore();
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ensureCount() {
    while (petals.length < config.count) petals.push(new Petal(true));
    if (petals.length > config.count) petals.length = config.count;
  }

  let last = performance.now();
  function loop(t) {
    if (!running) return;
    const dt = Math.min((t - last) / 16.67, 3);
    last = t;
    ctx.clearRect(0, 0, width, height);
    for (const p of petals) { p.update(dt); p.draw(ctx); }
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId) return;
    running = true;
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // 页面隐藏时暂停，节约电量
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else start();
  });

  window.addEventListener("resize", () => { resize(); });

  // 用户启用"减少动画"时直接关掉粒子，节省电量
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  // 对外 API
  window.Sakura = {
    init(opts = {}) {
      Object.assign(config, opts);
      resize();
      petals = [];
      if (reduced && reduced.matches) return; // 尊重系统设置
      ensureCount();
      start();
    },
    set(opts = {}) {
      Object.assign(config, opts);
      ensureCount();
    },
    getConfig() { return { ...config }; },
    start, stop,
  };
})();
