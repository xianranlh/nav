/* 背景粒子：樱花 / 星光 / 梧桐叶 / 糖果星星 / 空模式
 * - Canvas，devicePixelRatio 自适应
 * - particleMode: sakura | starlight | sycamore | candy-stars | none
 */
(function () {
  const canvas = document.getElementById("sakura-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let width = 0, height = 0, dpr = 1;
  let particles = [];
  let running = true;
  let rafId = 0;
  let config = {
    count: 70,
    speed: 1.0,
    particleMode: "sakura",
    wind: 0.6,
    sizeMin: 8,
    sizeMax: 18,
  };

  function Petal(init) {
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
    const palette = [
      [255, 205, 219], [255, 182, 203], [255, 170, 200],
      [255, 225, 235], [250, 192, 220],
    ];
    const c = palette[Math.floor(Math.random() * palette.length)];
    this.color = c;
  };
  Petal.prototype.update = function (dt) {
    this.swing += this.swingSpeed;
    this.x += (this.vx + Math.sin(this.swing) * 0.6 + config.wind * 0.3) * config.speed * dt;
    this.y += this.vy * config.speed * dt;
    this.rot += this.vr * config.speed * dt;
    if (this.y > height + 20 || this.x < -40 || this.x > width + 40) this.reset(false);
  };
  Petal.prototype.draw = function (c2) {
    c2.save();
    c2.translate(this.x, this.y);
    c2.rotate(this.rot);
    c2.globalAlpha = this.opacity;
    const s = this.size;
    const grad = c2.createLinearGradient(-s, 0, s, 0);
    const [r, g, b] = this.color;
    grad.addColorStop(0, `rgba(${r},${g},${b},0.2)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(1, `rgba(255,255,255,0.4)`);
    c2.fillStyle = grad;
    c2.beginPath();
    c2.moveTo(0, -s * 0.9);
    c2.bezierCurveTo(s * 0.6, -s * 0.5, s * 0.6, s * 0.3, 0, s * 0.7);
    c2.bezierCurveTo(-s * 0.6, s * 0.3, -s * 0.6, -s * 0.5, 0, -s * 0.9);
    c2.closePath();
    c2.fill();
    c2.strokeStyle = `rgba(${r - 20},${g - 40},${b - 30},0.5)`;
    c2.lineWidth = 0.6;
    c2.beginPath();
    c2.moveTo(0, -s * 0.5);
    c2.lineTo(0, s * 0.5);
    c2.stroke();
    c2.restore();
  };

  function Star(init) {
    this.reset(init);
  }
  Star.prototype.reset = function (initial) {
    this.x = Math.random() * width;
    this.y = initial ? Math.random() * height : height + 20 + Math.random() * 80;
    this.size = 1.2 + Math.random() * 2.8;
    this.vy = -(0.15 + Math.random() * 0.35);
    this.vx = (-0.2 + Math.random() * 0.4);
    this.phase = Math.random() * Math.PI * 2;
    this.twinkle = 0.02 + Math.random() * 0.04;
    const palette = [
      [220, 235, 255], [200, 220, 255], [255, 255, 255],
      [180, 210, 255], [160, 195, 255],
    ];
    this.color = palette[Math.floor(Math.random() * palette.length)];
  };
  Star.prototype.update = function (dt, t) {
    this.phase += this.twinkle * config.speed * dt;
    this.x += this.vx * config.speed * dt;
    this.y += this.vy * config.speed * dt;
    this.opacity = 0.35 + Math.sin(t * 0.002 + this.phase) * 0.35;
    if (this.y < -30) this.reset(false);
    if (this.x < -20 || this.x > width + 20) this.x = (this.x + width + 40) % (width + 40) - 20;
  };
  Star.prototype.draw = function (c2) {
    c2.save();
    c2.translate(this.x, this.y);
    c2.globalAlpha = Math.max(0.15, Math.min(1, this.opacity));
    const [r, g, b] = this.color;
    const s = this.size;
    const g1 = c2.createRadialGradient(0, 0, 0, 0, 0, s * 2.5);
    g1.addColorStop(0, `rgba(255,255,255,0.95)`);
    g1.addColorStop(0.4, `rgba(${r},${g},${b},0.85)`);
    g1.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c2.fillStyle = g1;
    c2.beginPath();
    c2.arc(0, 0, s * 2.2, 0, Math.PI * 2);
    c2.fill();
    c2.strokeStyle = `rgba(255,255,255,0.5)`;
    c2.lineWidth = 0.3;
    c2.beginPath();
    c2.moveTo(-s * 3, 0);
    c2.lineTo(s * 3, 0);
    c2.moveTo(0, -s * 3);
    c2.lineTo(0, s * 3);
    c2.stroke();
    c2.restore();
  };

  function Leaf(init) {
    this.reset(init);
  }
  Leaf.prototype.reset = function (initial) {
    this.x = Math.random() * width;
    this.y = initial ? Math.random() * height : -30 - Math.random() * height * 0.25;
    this.size = config.sizeMin * 0.85 + Math.random() * (config.sizeMax * 0.9 - config.sizeMin * 0.85);
    this.vy = 0.5 + Math.random() * 1.1;
    this.vx = -0.35 + Math.random() * 0.7;
    this.rot = Math.random() * Math.PI * 2;
    this.vr = (-0.025 + Math.random() * 0.05);
    this.swing = Math.random() * Math.PI * 2;
    this.swingSpeed = 0.008 + Math.random() * 0.018;
    this.opacity = 0.55 + Math.random() * 0.4;
    const palette = [
      [180, 140, 70], [120, 95, 55], [85, 120, 65], [200, 165, 90],
      [95, 130, 75], [165, 130, 60],
    ];
    this.color = palette[Math.floor(Math.random() * palette.length)];
  };
  Leaf.prototype.update = function (dt) {
    this.swing += this.swingSpeed;
    this.x += (this.vx + Math.sin(this.swing) * 0.45 + config.wind * 0.25) * config.speed * dt;
    this.y += this.vy * config.speed * dt;
    this.rot += this.vr * config.speed * dt;
    if (this.y > height + 30 || this.x < -50 || this.x > width + 50) this.reset(false);
  };
  Leaf.prototype.draw = function (c2) {
    c2.save();
    c2.translate(this.x, this.y);
    c2.rotate(this.rot);
    c2.globalAlpha = this.opacity;
    const s = this.size;
    const [r, g, b] = this.color;
    const grad = c2.createLinearGradient(-s, -s, s, s);
    grad.addColorStop(0, `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 35)},${b},0.95)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(1, `rgba(${r - 20},${g - 15},${b - 10},0.75)`);
    c2.fillStyle = grad;
    c2.beginPath();
    c2.moveTo(0, -s);
    c2.bezierCurveTo(s * 0.55, -s * 0.35, s * 0.65, s * 0.25, 0, s * 0.95);
    c2.bezierCurveTo(-s * 0.55, s * 0.2, -s * 0.6, -s * 0.3, 0, -s);
    c2.closePath();
    c2.fill();
    c2.strokeStyle = `rgba(${r - 30},${g - 25},${b - 15},0.45)`;
    c2.lineWidth = 0.5;
    c2.beginPath();
    c2.moveTo(0, -s * 0.85);
    c2.quadraticCurveTo(0, 0, 0, s * 0.85);
    c2.stroke();
    c2.restore();
  };

  function CandyStar(init) {
    this.reset(init);
  }
  CandyStar.prototype.reset = function (initial) {
    this.x = Math.random() * width;
    this.y = initial ? Math.random() * height : -10 - Math.random() * height * 0.2;
    this.size = 1.6 + Math.random() * 2.4;
    this.vy = 0.25 + Math.random() * 0.35;
    this.vx = -0.1 + Math.random() * 0.2;
    this.phase = Math.random() * Math.PI * 2;
    this.twinkle = 0.015 + Math.random() * 0.025;
    const palette = [
      [196, 168, 232], [255, 196, 214], [168, 200, 255],
      [255, 244, 168], [255, 230, 245],
    ];
    this.color = palette[Math.floor(Math.random() * palette.length)];
  };
  CandyStar.prototype.update = function (dt, t) {
    this.phase += this.twinkle * config.speed * dt;
    this.x += this.vx * config.speed * dt;
    this.y += this.vy * config.speed * dt;
    this.opacity = 0.4 + Math.sin(t * 0.0015 + this.phase) * 0.35;
    if (this.y > height + 20) this.reset(false);
    if (this.x < -20 || this.x > width + 20) this.x = (this.x + width + 40) % (width + 40) - 20;
  };
  CandyStar.prototype.draw = function (c2) {
    c2.save();
    c2.translate(this.x, this.y);
    c2.globalAlpha = Math.max(0.15, Math.min(1, this.opacity));
    const [r, g, b] = this.color;
    const s = this.size;
    const grad = c2.createRadialGradient(0, 0, 0, 0, 0, s * 3);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.9)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c2.fillStyle = grad;
    c2.beginPath();
    c2.arc(0, 0, s * 2.4, 0, Math.PI * 2);
    c2.fill();
    c2.strokeStyle = "rgba(255,255,255,0.65)";
    c2.lineWidth = 0.5;
    c2.beginPath();
    c2.moveTo(-s * 3, 0);
    c2.lineTo(s * 3, 0);
    c2.moveTo(0, -s * 3);
    c2.lineTo(0, s * 3);
    c2.stroke();
    c2.restore();
  };

  function Meteor() {
    this.reset();
  }
  Meteor.prototype.reset = function () {
    this.x = width * (0.6 + Math.random() * 0.4);
    this.y = -20;
    this.vx = -(2.5 + Math.random() * 1.5);
    this.vy = 1.8 + Math.random() * 0.8;
    this.life = 1.0;
    this.dead = false;
  };
  Meteor.prototype.update = function (dt) {
    if (this.dead) return;
    this.x += this.vx * config.speed * dt;
    this.y += this.vy * config.speed * dt;
    this.life -= 0.005 * dt;
    if (this.life <= 0 || this.y > height + 80 || this.x < -80) this.dead = true;
  };
  Meteor.prototype.draw = function (c2) {
    if (this.dead) return;
    c2.save();
    c2.globalAlpha = Math.max(0, this.life);
    const grad = c2.createLinearGradient(this.x, this.y, this.x + this.vx * 12, this.y + this.vy * 12);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(1, "rgba(196,168,232,0)");
    c2.strokeStyle = grad;
    c2.lineWidth = 1.6;
    c2.beginPath();
    c2.moveTo(this.x, this.y);
    c2.lineTo(this.x + this.vx * 12, this.y + this.vy * 12);
    c2.stroke();
    c2.restore();
  };

  function Cloud(init) {
    this.reset(init);
  }
  Cloud.prototype.reset = function (initial) {
    this.x = initial ? Math.random() * width : -120;
    this.y = 40 + Math.random() * (height * 0.4);
    this.scale = 0.6 + Math.random() * 0.6;
    this.vx = 0.08 + Math.random() * 0.1;
    this.opacity = 0.18 + Math.random() * 0.14;
  };
  Cloud.prototype.update = function (dt) {
    this.x += this.vx * config.speed * dt;
    if (this.x > width + 140) this.reset(false);
  };
  Cloud.prototype.draw = function (c2) {
    c2.save();
    c2.translate(this.x, this.y);
    c2.globalAlpha = this.opacity;
    c2.fillStyle = "rgba(255,255,255,1)";
    const s = 30 * this.scale;
    c2.beginPath();
    c2.arc(0, 0, s, 0, Math.PI * 2);
    c2.arc(s * 0.9, -s * 0.2, s * 0.85, 0, Math.PI * 2);
    c2.arc(s * 1.7, 0, s * 0.7, 0, Math.PI * 2);
    c2.arc(s * 0.5, s * 0.4, s * 0.65, 0, Math.PI * 2);
    c2.fill();
    c2.restore();
  };

  function makeParticle(initial) {
    const m = config.particleMode;
    if (m === "starlight") return new Star(initial);
    if (m === "sycamore") return new Leaf(initial);
    if (m === "candy-stars") return new CandyStar(initial);
    return new Petal(initial);
  }

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

  function ensureParticles() {
    if (config.particleMode === "none") {
      particles.length = 0;
      if (canvas) canvas.style.display = "none";
      return;
    }
    if (canvas) canvas.style.display = "";
    while (particles.length < config.count) particles.push(makeParticle(true));
    if (particles.length > config.count) particles.length = config.count;
  }

  function rebuildParticles() {
    particles = [];
    meteors = [];
    clouds = [];
    ensureParticles();
  }

  let meteors = [];
  let clouds = [];
  let lastMeteorAt = 0;
  let last = performance.now();
  function loop(t) {
    if (!running) return;
    if (config.particleMode === "none") {
      rafId = requestAnimationFrame(loop);
      return;
    }
    const dt = Math.min((t - last) / 16.67, 3);
    last = t;
    ctx.clearRect(0, 0, width, height);
    const mode = config.particleMode;
    for (const p of particles) {
      if (mode === "starlight" || mode === "candy-stars") p.update(dt, t);
      else p.update(dt);
      p.draw(ctx);
    }
    if (mode === "candy-stars") {
      if (t - lastMeteorAt > 25000 + Math.random() * 15000) {
        meteors.push(new Meteor());
        lastMeteorAt = t;
      }
      for (const m of meteors) {
        m.update(dt);
        m.draw(ctx);
      }
      meteors = meteors.filter((m) => !m.dead);
      while (clouds.length < 2) clouds.push(new Cloud(true));
      for (const c of clouds) {
        c.update(dt);
        c.draw(ctx);
      }
    }
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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else start();
  });

  window.addEventListener("resize", () => { resize(); });

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  window.Sakura = {
    init(opts = {}) {
      Object.assign(config, opts);
      resize();
      particles = [];
      if (reduced && reduced.matches) return;
      rebuildParticles();
      start();
    },
    set(opts = {}) {
      const prevMode = config.particleMode;
      Object.assign(config, opts);
      if (opts.particleMode != null && opts.particleMode !== prevMode) rebuildParticles();
      else ensureParticles();
    },
    getConfig() { return { ...config }; },
    start,
    stop,
  };
})();
