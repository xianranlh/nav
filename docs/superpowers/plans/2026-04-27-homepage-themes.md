# Sakura Nav 首页主题与排列优化 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Sakura Nav 首页落地"4 套可切换主题包 + 排列易操作 + 移动端响应式"，不重构 `app.js`。

**Architecture:** 复用现有 `VISUAL_THEMES` 注册表 + `data-visual-theme` 选择器 + `Sakura.particleMode` 三件套，做扩展而非重写。新增 1 个主题（Q 版二次元）、调整 1 个（暗夜极简，新增）、复用 2 个（樱粉=sakura、复古纸=sycamore 改文案）。同时为 `sakura.js` 增加 `candy-stars` 与 `none` 粒子模式，为首页加入紧凑 hero / 高频区 / 粘性分组 tab / 超紧凑卡片密度 / 移动端响应式。

**Tech Stack:** 原生 HTML / CSS / JS（项目无构建工具、无测试框架），冒烟脚本 `_smoke.ps1`，配合手测清单。

---

## Deviation from Spec

1. **不新建 `theme.js`**：探查后发现 `app.js` 已包含 `VISUAL_THEMES` 注册表、`applyVisualTheme()`、`syncSakuraParticles()`、`particleModeFromVisualTheme()`，CSS 已有 `html[data-visual-theme="..."]` 体系，`sakura.js` 已经支持模式切换。本计划改为在现有体系上扩展，避免无意义重构。`app.js` 净增 < 200 行，符合 spec §2 "改动限定"。新增 4 个 CSS 主题文件按 spec 要求保留（`themes/*.css` via `<link>`）。

2. **不实现 `ParticleEngine.register()` 显式 API**：现有 `Sakura.set({ particleMode })` 和内部 `makeParticle` 分发表已经是事实上的"插件机制"。新增模式 = 在分发表加一行 + 写一个粒子类，效果与显式注册 API 等价但代码更少。

3. **FPS 自动降级简化为"移动端粒子数 ÷ 2"**：spec §7 设想 `FPS<30 检测 → 减半 → 仍卡切 none`。考虑到 YAGNI（多数移动端只要数量减半就够），改为 Task 10 在加载时直接对 `(max-width: 768px)` 视口减半。FPS 探针逻辑暂不实现，未来若有用户反馈卡顿再加。

---

## File Structure

| 文件 | 改动 | 说明 |
|---|---|---|
| `themes/sakura.css` | 新建 | 樱粉主题专属规则（从 `styles.css` 挪过来一部分 OR 新增覆盖） |
| `themes/q-anime.css` | 新建 | Q 版二次元（柔和星空） |
| `themes/dark-minimal.css` | 新建 | 暗夜极简 |
| `themes/paper.css` | 新建 | 复古纸质（基于 sycamore 增强） |
| `index.html` | 修改 | `<link>` 4 个主题 CSS、hero 结构调整、加 starred shelf 容器、加分组 tab 容器、加 4th 卡片密度、加 hero 显示模式设置 |
| `styles.css` | 修改 | hero compact 布局、starred shelf、sticky group tabs、ultra-compact density、≤768px 媒体查询 |
| `sakura.js` | 修改 | 新增 `CandyStar` 类 + `candy-stars` 模式 + `none` 模式 + canvas 显隐控制 |
| `app.js` | 修改 | `VISUAL_THEMES` 加 `q-anime` / `dark-minimal` / `paper` 别名；`particleModeFromVisualTheme` 加映射；`bindSettings` 加新主题选项与 hero 显示模式；新增 starred shelf 渲染；新增 group tab 渲染；新增 `applyHeroMode()`；新增 `theme:changed` 事件派发 |
| `_smoke.ps1` | 修改 | 新增 4 个主题/2 个粒子模式 grep 检查 |
| `README.md` | 修改 | 主题章节更新为 4 套 |

---

## Slice A — Q 版二次元主题（柔和星空）

### Task 1：定义新主题元数据 + CSS 文件

**Files:**
- Modify: `app.js`（搜索 `VISUAL_THEMES = {`，在 `sycamore` 后追加项；搜索 `particleModeFromVisualTheme`，加映射）
- Create: `themes/q-anime.css`
- Modify: `index.html`（`<head>` 内 `styles.css` 之后追加 `<link>`）

- [ ] **Step 1: 在 app.js 的 `VISUAL_THEMES` 中追加 Q 版条目**

`VISUAL_THEMES` 当前内容：

```js
const VISUAL_THEMES = {
  sakura:    { id: "sakura",    label: "樱 · 樱花", accent: "#ff8fab", fab: "🌸", aiLogo: "🌸" },
  starlight: { id: "starlight", label: "星光",       accent: "#8b9fff", fab: "✨", aiLogo: "✨" },
  sycamore:  { id: "sycamore",  label: "梧桐叶",     accent: "#c4a06e", fab: "🍂", aiLogo: "🍂" },
};
```

修改为：

```js
const VISUAL_THEMES = {
  sakura:       { id: "sakura",       label: "樱 · 樱粉",       accent: "#ff8fab", fab: "🌸", aiLogo: "🌸" },
  "q-anime":    { id: "q-anime",      label: "✨ Q 版二次元",    accent: "#c4a8e8", fab: "✨", aiLogo: "✨" },
  "dark-minimal": { id: "dark-minimal", label: "🌙 暗夜极简",   accent: "#8da4c0", fab: "🌙", aiLogo: "🌙" },
  paper:        { id: "paper",        label: "📜 复古纸质",      accent: "#b07c4f", fab: "📜", aiLogo: "📜" },
  // 兼容旧值
  starlight:    { id: "starlight",    label: "星光（旧）",       accent: "#8b9fff", fab: "✨", aiLogo: "✨" },
  sycamore:     { id: "sycamore",     label: "梧桐叶（旧）",     accent: "#c4a06e", fab: "🍂", aiLogo: "🍂" },
};
```

- [ ] **Step 2: 在 app.js 的 `particleModeFromVisualTheme` 加映射**

当前实现：

```js
function particleModeFromVisualTheme(vid) {
  if (vid === "starlight") return "starlight";
  if (vid === "sycamore") return "sycamore";
  return "sakura";
}
```

替换为：

```js
function particleModeFromVisualTheme(vid) {
  if (vid === "q-anime") return "candy-stars";
  if (vid === "dark-minimal") return "none";
  if (vid === "paper") return "sycamore";       // 复用现有梧桐叶粒子作为纸屑/落叶
  if (vid === "starlight") return "starlight";  // 兼容
  if (vid === "sycamore") return "sycamore";    // 兼容
  return "sakura";
}
```

- [ ] **Step 3: 创建 themes/q-anime.css**

```css
/* Q 版二次元 · 柔和星空版
 * 用户要求：更萌 / 主题色柔和（如星空）/ 温和
 * 三色低饱和：雾紫 + 樱乳粉 + 月光蓝
 */
html[data-visual-theme="q-anime"] {
  --accent: #c4a8e8;
  --accent-2: #ffc4d6;
  --accent-soft: #efe4f8;
  --accent-rgb: 196, 168, 232;

  --text: #4a3a5e;
  --text-soft: #7a6a8e;
  --text-faint: #a394b8;

  --glass-shadow: 0 6px 22px rgba(196, 168, 232, 0.18);
  --card-bg: rgba(255, 250, 253, 0.7);
  --card-hover: rgba(255, 250, 253, 0.9);
  --card-border: rgba(196, 168, 232, 0.35);

  --radius-lg: 28px;
  --radius-md: 22px;
  --radius-sm: 14px;

  --bg-gradient:
    radial-gradient(1100px 680px at 18% 12%, #efe4f8 0%, transparent 58%),
    radial-gradient(900px 620px at 86% 84%, #d8e6ff 0%, transparent 55%),
    linear-gradient(160deg, #fdf8ff 0%, #f6efff 45%, #eef4ff 100%);
}

html[data-visual-theme="q-anime"][data-theme="dark"] {
  --text: #ece4f5;
  --text-soft: #c8b8d8;
  --text-faint: #9888a8;
  --card-bg: rgba(48, 40, 64, 0.55);
  --card-hover: rgba(60, 52, 80, 0.78);
  --card-border: rgba(196, 168, 232, 0.25);
  --bg-gradient:
    radial-gradient(1100px 680px at 18% 12%, #2c1f44 0%, transparent 58%),
    radial-gradient(900px 620px at 86% 84%, #1a2440 0%, transparent 55%),
    linear-gradient(160deg, #14102a 0%, #1f1735 50%, #0f1428 100%);
}

/* Q 版独有：圆润字 + 字间距 + 卡片柔阴影 */
html[data-visual-theme="q-anime"] {
  font-family: "M PLUS Rounded 1c", "PingFang SC", system-ui, sans-serif;
  letter-spacing: 0.015em;
}
html[data-visual-theme="q-anime"] .card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--card-border);
  box-shadow: 0 4px 16px rgba(196, 168, 232, 0.12);
  transition: transform .25s ease, box-shadow .25s ease;
}
html[data-visual-theme="q-anime"] .card:hover {
  transform: translateY(-4px) scale(1.015);
  box-shadow: 0 10px 28px rgba(196, 168, 232, 0.28);
}
html[data-visual-theme="q-anime"] .chip,
html[data-visual-theme="q-anime"] .btn-primary,
html[data-visual-theme="q-anime"] .btn-secondary {
  border-radius: 999px;
}
```

- [ ] **Step 4: 在 index.html 的 `<head>` 内 `styles.css` 之后追加主题 link**

搜索 `<link rel="stylesheet" href="styles.css"`，在它**之后**追加：

```html
<link rel="stylesheet" href="themes/sakura.css" />
<link rel="stylesheet" href="themes/q-anime.css" />
<link rel="stylesheet" href="themes/dark-minimal.css" />
<link rel="stylesheet" href="themes/paper.css" />
```

`themes/sakura.css` 文件后续 Task 4 会创建（先占位空文件）：

```bash
touch themes/sakura.css themes/dark-minimal.css themes/paper.css
```

（`themes/q-anime.css` 已在 Step 3 创建）

- [ ] **Step 5: 提交**

```bash
git add app.js themes/q-anime.css themes/sakura.css themes/dark-minimal.css themes/paper.css index.html
git commit -m "feat(theme): add q-anime visual theme (gentle starry palette)"
```

- [ ] **Step 6: 手动验证（浏览器）**

打开 `index.html` → 设置 → 视觉风格 → 选 `✨ Q 版二次元` → 期望：背景渐变变为雾紫/淡粉/淡蓝；卡片更圆；强调色切到雾紫。粒子还是樱花（candy-stars 还没实现，下一 task 处理）。

---

### Task 2：实现 candy-stars 粒子模式

**Files:**
- Modify: `sakura.js`（在文件末尾 `window.Sakura` 之前新增 `CandyStar` 类、`Meteor` 类、`Cloud` 类，并在 `makeParticle` 内分发）

- [ ] **Step 1: 在 sakura.js 的 `Leaf` 类之后、`function makeParticle` 之前新增三个类**

```js
  // —— Q 版二次元：缓慢飘落的小星星 + 偶发流星 + 极少量小云朵 ——
  function CandyStar(init) { this.reset(init); }
  CandyStar.prototype.reset = function (initial) {
    this.x = Math.random() * width;
    this.y = initial ? Math.random() * height : -10 - Math.random() * height * 0.2;
    this.size = 1.6 + Math.random() * 2.4;
    this.vy = 0.25 + Math.random() * 0.35;          // 缓慢
    this.vx = (-0.1 + Math.random() * 0.2);
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
    const grd = c2.createRadialGradient(0, 0, 0, 0, 0, s * 3);
    grd.addColorStop(0, `rgba(255,255,255,0.95)`);
    grd.addColorStop(0.4, `rgba(${r},${g},${b},0.9)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c2.fillStyle = grd;
    c2.beginPath();
    c2.arc(0, 0, s * 2.4, 0, Math.PI * 2);
    c2.fill();
    // 四角光芒
    c2.strokeStyle = `rgba(255,255,255,0.65)`;
    c2.lineWidth = 0.5;
    c2.beginPath();
    c2.moveTo(-s * 3, 0); c2.lineTo(s * 3, 0);
    c2.moveTo(0, -s * 3); c2.lineTo(0, s * 3);
    c2.stroke();
    c2.restore();
  };

  // 偶发流星：从右上向左下划过
  function Meteor(init) { this.reset(init); }
  Meteor.prototype.reset = function () {
    this.x = width * (0.6 + Math.random() * 0.4);
    this.y = -20;
    this.len = 60 + Math.random() * 60;
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
    const grd = c2.createLinearGradient(this.x, this.y, this.x + this.vx * 12, this.y + this.vy * 12);
    grd.addColorStop(0, "rgba(255,255,255,0.95)");
    grd.addColorStop(1, "rgba(196,168,232,0)");
    c2.strokeStyle = grd;
    c2.lineWidth = 1.6;
    c2.beginPath();
    c2.moveTo(this.x, this.y);
    c2.lineTo(this.x + this.vx * 12, this.y + this.vy * 12);
    c2.stroke();
    c2.restore();
  };

  // 极少量小云朵（半透明）
  function Cloud(init) { this.reset(init); }
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
```

- [ ] **Step 2: 修改 `makeParticle` 与 `loop` 以支持 candy-stars 模式**

当前 `makeParticle`：

```js
function makeParticle(initial) {
  const m = config.particleMode;
  if (m === "starlight") return new Star(initial);
  if (m === "sycamore") return new Leaf(initial);
  return new Petal(initial);
}
```

替换为：

```js
function makeParticle(initial) {
  const m = config.particleMode;
  if (m === "starlight") return new Star(initial);
  if (m === "sycamore") return new Leaf(initial);
  if (m === "candy-stars") return new CandyStar(initial);
  return new Petal(initial);
}
```

`candy-stars` 模式额外维护 2 个独立列表（流星 + 云朵），不进 `particles` 数组。在 `let last = performance.now();` 上方新增：

```js
  let meteors = [];
  let clouds = [];
  let lastMeteorAt = 0;
```

替换 `function loop(t)` 当前实现：

```js
function loop(t) {
  if (!running) return;
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
    // 流星：每 30 秒左右一颗
    if (t - lastMeteorAt > 25000 + Math.random() * 15000) {
      meteors.push(new Meteor());
      lastMeteorAt = t;
    }
    for (const m of meteors) { m.update(dt); m.draw(ctx); }
    meteors = meteors.filter(m => !m.dead);
    // 云朵：保持 2 个
    while (clouds.length < 2) clouds.push(new Cloud(true));
    for (const c of clouds) { c.update(dt); c.draw(ctx); }
  }
  rafId = requestAnimationFrame(loop);
}
```

`rebuildParticles` 也要清空 meteors/clouds：

```js
function rebuildParticles() {
  particles = [];
  meteors = [];
  clouds = [];
  ensureParticles();
}
```

- [ ] **Step 3: 浏览器手测**

刷新页面 → 设置 → 视觉风格选 `Q 版二次元` → 期望：粒子从樱花切换为缓慢飘落的小星星，约半分钟出现一次流星。

- [ ] **Step 4: 提交**

```bash
git add sakura.js
git commit -m "feat(particles): add candy-stars mode (slow stars + meteors + clouds)"
```

---

## Slice B — 暗夜极简（none 模式）+ 复古纸质（复用 sycamore）

### Task 3：none 粒子模式 + 暗夜极简 CSS

**Files:**
- Modify: `sakura.js`（在 `makeParticle` 加 `none` 分支 + 引擎层加 canvas 显隐）
- Create: `themes/dark-minimal.css`

- [ ] **Step 1: sakura.js 内引擎层支持 none 模式**

修改 `function ensureParticles`：

```js
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
```

修改 `loop` 函数顶部，在 `if (!running) return;` 之后加：

```js
  if (config.particleMode === "none") { rafId = requestAnimationFrame(loop); return; }
```

- [ ] **Step 2: 创建 themes/dark-minimal.css**

写入：

```css
/* 暗夜极简 · 静默无装饰 · 高对比 */
html[data-visual-theme="dark-minimal"] {
  --accent: #8da4c0;
  --accent-2: #b8c8dc;
  --accent-soft: rgba(141, 164, 192, 0.16);
  --accent-rgb: 141, 164, 192;

  --text: #f0f3f8;
  --text-soft: #b8c0cc;
  --text-faint: #7a8290;

  --glass-alpha: 0.18;
  --glass-bg: rgba(20, 22, 28, 0.72);
  --glass-border: rgba(255, 255, 255, 0.07);
  --glass-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  --blur: 6px;

  --card-bg: rgba(28, 30, 36, 0.6);
  --card-hover: rgba(38, 40, 48, 0.78);

  --radius-lg: 8px;
  --radius-md: 8px;
  --radius-sm: 6px;

  --bg-gradient:
    radial-gradient(1200px 700px at 50% 0%, #1a1d24 0%, transparent 60%),
    linear-gradient(180deg, #0e1014 0%, #0a0c10 100%);
}

/* 暗夜本身就是暗色基调，亮色模式下也保持暗（用户主动选择就是要暗） */
html[data-visual-theme="dark-minimal"][data-theme="light"] {
  /* 留空：与默认相同 */
}

/* 极简卡片：方角描边，无阴影，悬停亮起 */
html[data-visual-theme="dark-minimal"] .card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  box-shadow: none;
  transition: border-color .2s, background .2s;
}
html[data-visual-theme="dark-minimal"] .card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}

html[data-visual-theme="dark-minimal"] {
  font-family: "Inter", "PingFang SC", system-ui, sans-serif;
  letter-spacing: 0.005em;
}
```

- [ ] **Step 3: 浏览器手测**

切到 `🌙 暗夜极简` → 期望：背景变深黑、所有粒子消失、卡片变方且无阴影、悬停时蓝色描边亮起。

- [ ] **Step 4: 提交**

```bash
git add sakura.js themes/dark-minimal.css
git commit -m "feat(theme): add dark-minimal theme + 'none' particle mode"
```

---

### Task 4：复古纸质 CSS

**Files:**
- Create: `themes/paper.css`
- Modify: `themes/sakura.css`（顺手把 sakura 主题的微调放进去，避免 q-anime 的字体污染默认）

- [ ] **Step 1: 创建 themes/paper.css**

```css
/* 复古纸质 · 米黄底 + 衬线字 + 纸感阴影 */
html[data-visual-theme="paper"] {
  --accent: #b07c4f;
  --accent-2: #d6b88f;
  --accent-soft: #f3e6d2;
  --accent-rgb: 176, 124, 79;

  --text: #3a2e22;
  --text-soft: #6a5a44;
  --text-faint: #a08e74;

  --glass-bg: rgba(252, 244, 226, 0.78);
  --glass-border: rgba(176, 124, 79, 0.22);
  --glass-shadow: 0 4px 14px rgba(80, 50, 20, 0.12);

  --card-bg: rgba(252, 244, 226, 0.86);
  --card-hover: rgba(252, 244, 226, 1);
  --card-border: rgba(176, 124, 79, 0.28);

  --radius-lg: 6px;
  --radius-md: 6px;
  --radius-sm: 4px;

  --bg-gradient:
    radial-gradient(1100px 680px at 18% 12%, #f5e8c7 0%, transparent 60%),
    radial-gradient(900px 620px at 86% 84%, #ead7b3 0%, transparent 55%),
    linear-gradient(160deg, #faf2dc 0%, #f0e2c0 50%, #e8d3a8 100%);
}

html[data-visual-theme="paper"][data-theme="dark"] {
  --text: #f0e8d4;
  --text-soft: #c8b89a;
  --text-faint: #98886a;
  --glass-bg: rgba(40, 32, 22, 0.78);
  --glass-border: rgba(176, 124, 79, 0.32);
  --card-bg: rgba(40, 32, 22, 0.85);
  --card-hover: rgba(50, 40, 28, 0.95);
  --bg-gradient:
    radial-gradient(1100px 680px at 18% 12%, #2c241a 0%, transparent 60%),
    linear-gradient(160deg, #1c1610 0%, #2a2218 100%);
}

html[data-visual-theme="paper"] {
  font-family: "Source Han Serif", "Georgia", "PingFang SC", serif;
  letter-spacing: 0.01em;
}

html[data-visual-theme="paper"] .card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--card-border);
  box-shadow: 1px 1px 0 rgba(176, 124, 79, 0.15), 0 4px 12px rgba(80, 50, 20, 0.1);
  transition: transform .2s, box-shadow .2s;
}
html[data-visual-theme="paper"] .card:hover {
  transform: translateY(-2px);
  box-shadow: 2px 2px 0 rgba(176, 124, 79, 0.2), 0 8px 18px rgba(80, 50, 20, 0.15);
}
```

- [ ] **Step 2: 创建 themes/sakura.css（保持默认樱粉行为不变）**

```css
/* 樱粉 · 默认主题（沿用 styles.css :root 的值，不重复定义；
 * 仅在此处提供 sakura 专属的卡片悬停微调，方便后续与其它主题对齐） */
html[data-visual-theme="sakura"] .card,
html:not([data-visual-theme]) .card {
  transition: transform .2s, box-shadow .2s;
}
html[data-visual-theme="sakura"] .card:hover,
html:not([data-visual-theme]) .card:hover {
  transform: translateY(-2px);
}
```

（保持默认主题视觉不变，只是把"悬停轻浮"明确写出来，便于和其他主题对照。）

- [ ] **Step 3: 浏览器手测**

切到 `📜 复古纸质` → 期望：米黄底色 + 墨绿/赭石强调色 + 衬线字 + 飘落叶（已用 sycamore 模式）。

- [ ] **Step 4: 提交**

```bash
git add themes/paper.css themes/sakura.css
git commit -m "feat(theme): add paper theme; pin sakura defaults via theme file"
```

---

## Slice C — 设置面板：主题选择器升级

### Task 5：把视觉风格下拉换成 4 张预览卡

**Files:**
- Modify: `index.html`（搜索 `<select id="set-visual-theme">`，整个 `<label class="row">视觉风格 ...</label>` 块替换）
- Modify: `app.js`（搜索 `setV("#set-visual-theme"`，找到对应 bindSettings 段；搜索 `$("#set-visual-theme").addEventListener` 找到对应 listener；改成新的 DOM 结构事件代理）
- Modify: `styles.css`（在文件末尾追加预览卡样式）

- [ ] **Step 1: 替换 index.html 视觉风格段落**

搜索：

```html
<label class="row">视觉风格
  <select id="set-visual-theme">
    <option value="sakura">樱 · 樱花</option>
    <option value="starlight">星光</option>
    <option value="sycamore">梧桐叶</option>
  </select>
</label>
```

替换为：

```html
<div class="row row-stack">
  <span class="row-label">视觉风格</span>
  <div class="theme-picker" id="theme-picker">
    <button type="button" class="theme-card" data-theme-id="sakura">
      <div class="theme-thumb theme-thumb--sakura"></div>
      <div class="theme-name">🌸 樱粉</div>
    </button>
    <button type="button" class="theme-card" data-theme-id="q-anime">
      <div class="theme-thumb theme-thumb--q-anime"></div>
      <div class="theme-name">✨ Q 版二次元</div>
    </button>
    <button type="button" class="theme-card" data-theme-id="dark-minimal">
      <div class="theme-thumb theme-thumb--dark-minimal"></div>
      <div class="theme-name">🌙 暗夜极简</div>
    </button>
    <button type="button" class="theme-card" data-theme-id="paper">
      <div class="theme-thumb theme-thumb--paper"></div>
      <div class="theme-name">📜 复古纸质</div>
    </button>
  </div>
  <input type="hidden" id="set-visual-theme" />
</div>
```

（保留隐藏 input 让现有 `bindSettings` 的 `setV("#set-visual-theme", ...)` 仍工作）

- [ ] **Step 2: 在 styles.css 末尾追加预览卡样式**

```css
/* ===================== 主题预览卡 ===================== */
.row-stack { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.row-label { font-size: .9em; color: var(--text-soft); }

.theme-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.theme-card {
  border: 2px solid transparent;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 8px;
  cursor: pointer;
  transition: border-color .2s, transform .2s;
  font-family: inherit;
  color: inherit;
}
.theme-card:hover { transform: translateY(-2px); }
.theme-card.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.theme-thumb {
  width: 100%;
  height: 70px;
  border-radius: calc(var(--radius-md) - 4px);
  margin-bottom: 6px;
  position: relative;
  overflow: hidden;
}
.theme-thumb--sakura {
  background: linear-gradient(135deg, #ffd6e6 0%, #ffe1ee 50%, #c9e4ff 100%);
}
.theme-thumb--sakura::after {
  content: "🌸"; position: absolute; right: 6px; top: 4px; font-size: 16px;
}
.theme-thumb--q-anime {
  background: linear-gradient(135deg, #efe4f8 0%, #ffe7f0 50%, #d8e6ff 100%);
}
.theme-thumb--q-anime::after {
  content: "✨"; position: absolute; right: 6px; top: 4px; font-size: 16px;
}
.theme-thumb--dark-minimal {
  background: linear-gradient(180deg, #1a1d24 0%, #0a0c10 100%);
  border: 1px solid #8da4c0;
}
.theme-thumb--dark-minimal::after {
  content: "🌙"; position: absolute; right: 6px; top: 4px; font-size: 16px; filter: grayscale(0.4);
}
.theme-thumb--paper {
  background: linear-gradient(135deg, #faf2dc 0%, #f0e2c0 50%, #e8d3a8 100%);
}
.theme-thumb--paper::after {
  content: "📜"; position: absolute; right: 6px; top: 4px; font-size: 16px;
}
.theme-name {
  font-size: .85em;
  color: var(--text-soft);
  text-align: center;
}
```

- [ ] **Step 3: 在 app.js 的 `bindSettings()` 里替换视觉风格 listener**

搜索 `$("#set-visual-theme").addEventListener("change"`，找到现有 listener。

将其整体块（从那一行到对应 `});` 闭合）替换为：

```js
    // 主题预览卡（替代下拉）
    const picker = $("#theme-picker");
    if (picker) {
      const refreshActive = () => {
        $$(".theme-card", picker).forEach((card) => {
          card.classList.toggle("is-active", card.dataset.themeId === Store.settings.visualTheme);
        });
      };
      refreshActive();
      picker.addEventListener("click", (e) => {
        const card = e.target.closest(".theme-card");
        if (!card) return;
        const id = card.dataset.themeId;
        if (!id || id === Store.settings.visualTheme) return;
        // 切换主题：更新设置，刷新强调色（如未自定义），重新应用
        const meta = VISUAL_THEMES[id];
        if (!meta) return;
        const prevAccent = VISUAL_THEMES[Store.settings.visualTheme]?.accent;
        Store.settings.visualTheme = id;
        // 仅在用户没有手动改过 accent（即 accent === 旧主题默认）时才跟随主题切色
        if (Store.settings.accent === prevAccent) {
          Store.settings.accent = meta.accent;
          const accentInput = $("#set-accent");
          if (accentInput) accentInput.value = meta.accent;
        }
        Store.saveSettings();
        applyVisualTheme();
        applyStyle();
        syncSakuraParticles();
        refreshActive();
        // 派发事件供其他子系统监听（暂未使用，预留）
        document.dispatchEvent(new CustomEvent("theme:changed", { detail: { id } }));
      });
    }
```

并删掉原 `$("#set-visual-theme").addEventListener("change", ...)` 整段。

- [ ] **Step 4: 浏览器手测**

打开设置 → 看到 4 张主题预览卡，当前选中那张有边框高亮 → 点其他卡片立即切换主题、关闭设置仍生效、刷新仍生效。

- [ ] **Step 5: 提交**

```bash
git add index.html app.js styles.css
git commit -m "feat(theme): replace visual-theme dropdown with 4 preview cards"
```

---

## Slice D — 紧凑 hero（合并问候 + 时钟 + 一言）

### Task 6：hero 紧凑布局 + 显示模式设置

**Files:**
- Modify: `index.html`（搜索 `<header class="glass header-bar">` 修改结构、设置面板加显示模式选项）
- Modify: `app.js`（新增 `applyHeroMode()`、setting key、bind 事件）
- Modify: `styles.css`（新增 hero 紧凑/隐藏样式）

- [ ] **Step 1: 在 app.js 的 `Store.settings` 默认值里加 `heroMode`**

搜索 `showHitokoto: false,`，在它**附近**（与其他 UI 开关同区域，比如 `showRecent: true,` 之后）追加一行：

```js
      heroMode: "compact",  // expanded | compact | hidden
```

- [ ] **Step 2: 在 styles.css 末尾追加 hero 模式样式**

```css
/* ===================== Hero 紧凑模式 ===================== */
html[data-hero-mode="compact"] .header-bar .greet {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
html[data-hero-mode="compact"] .header-bar .greet h1 {
  display: inline;
  font-size: 1.2em;
  margin: 0;
}
html[data-hero-mode="compact"] .header-bar .greet #sub-greet {
  display: none;
}
html[data-hero-mode="compact"] .header-bar .greet #hitokoto {
  font-size: .9em;
  color: var(--text-soft);
  margin: 0;
}
html[data-hero-mode="compact"] .header-bar .clock {
  text-align: right;
}
html[data-hero-mode="compact"] .header-bar .clock #clock-date {
  display: none;
}

html[data-hero-mode="hidden"] .header-bar .greet,
html[data-hero-mode="hidden"] .header-bar .clock {
  display: none;
}
```

- [ ] **Step 3: 在 app.js 新增 `applyHeroMode()`，并在 `applyVisualTheme()` 之后调用**

搜索 `function applyVisualTheme()`，在它**下方**新增：

```js
  function applyHeroMode() {
    const mode = Store.settings.heroMode || "compact";
    document.documentElement.dataset.heroMode = mode;
  }
```

搜索 `applyVisualTheme();` 全部出现处（应该有 3 处：line 1433, 2470, 4465），**在每个 `applyVisualTheme();` 之后**追加：

```js
    applyHeroMode();
```

（注意不要破坏缩进。）

- [ ] **Step 4: 在 index.html 设置面板加 hero 模式选项**

搜索 `<label class="row"><input type="checkbox" id="set-show-clock"`（line 463 附近），在 `set-show-clock` 这一 row **之前**插入：

```html
<label class="row">Hero 区显示
  <select id="set-hero-mode">
    <option value="expanded">展开</option>
    <option value="compact">紧凑</option>
    <option value="hidden">隐藏</option>
  </select>
</label>
```

- [ ] **Step 5: 在 app.js 的 `bindSettings()` 里绑定 `set-hero-mode`**

搜索 `setV("#set-density", s.density);`（在 1345 附近），**在它附近**（与其他 setV 同区域）追加：

```js
    setV("#set-hero-mode", s.heroMode || "compact");
```

搜索 `$("#set-density").addEventListener` 行（1447 附近），**在它附近**追加：

```js
    $("#set-hero-mode").addEventListener("change", (e) => {
      s.heroMode = e.target.value;
      Store.saveSettings();
      applyHeroMode();
    });
```

- [ ] **Step 6: 浏览器手测**

刷新页面，默认应是紧凑（heroMode 默认值已设）。打开设置 → Hero 区显示 → 切换"展开/紧凑/隐藏"，立刻生效。期望：紧凑时一行问候+时钟、一言在第二行；隐藏时整 hero 区消失。

- [ ] **Step 7: 提交**

```bash
git add app.js index.html styles.css
git commit -m "feat(layout): hero compact mode (combine greeting/clock/hitokoto)"
```

---

## Slice E — 高频区（星标置顶 shelf）

### Task 7：星标置顶横向 shelf

> 「最近使用」shelf 已存在（`#recent-card`，由 `set-show-recent` 控制）。本任务新增「⭐ 星标」shelf，位置在 `recent-card` 之前。

**Files:**
- Modify: `index.html`（在 `<section class="top-row" id="top-row">` 内的 `<section id="recent-card"` 之**前**新增星标 shelf 容器）
- Modify: `app.js`（新增 `renderStarredShelf()` + 在卡片渲染、星标变化时调用；新增 `showStarred` 设置）
- Modify: `styles.css`（追加样式）

- [ ] **Step 1: 在 app.js 的 `Store.settings` 默认值里追加**

```js
      showStarred: true,
```

- [ ] **Step 2: 在 index.html 的 `<section class="top-row" id="top-row">` 内、`<section id="recent-card"` **之前**追加**

```html
<section id="starred-card" class="recent-card glass" hidden>
  <header class="recent-head">
    <span class="recent-title">⭐ 星标置顶</span>
  </header>
  <div class="recent-grid" id="starred-grid"></div>
</section>
```

- [ ] **Step 3: 在 app.js 找到现有 `function renderRecent` 或类似（`grep -n "function renderRecent\|function updateRecent" app.js`），在它附近新增 `renderStarredShelf`**

```js
  function renderStarredShelf() {
    const card = $("#starred-card");
    const grid = $("#starred-grid");
    if (!card || !grid) return;
    if (!Store.settings.showStarred) { card.hidden = true; return; }
    const links = [];
    for (const g of (Store.state.groups || [])) {
      for (const lk of (g.links || [])) {
        if (lk.starred) links.push({ ...lk, _groupName: g.name });
      }
    }
    if (!links.length) { card.hidden = true; return; }
    card.hidden = false;
    grid.innerHTML = "";
    for (const lk of links.slice(0, 20)) {
      const a = document.createElement("a");
      a.className = "recent-item";
      a.href = lk.url;
      a.target = Store.settings.newTab ? "_blank" : "_self";
      a.rel = "noopener";
      a.title = `${lk.name} · ${lk._groupName}`;
      const ico = document.createElement("img");
      ico.className = "recent-icon";
      ico.alt = "";
      ico.src = lk.icon || faviconFromUrl(lk.url);
      ico.onerror = () => { ico.replaceWith(document.createTextNode(initialOf(lk.name))); };
      const nm = document.createElement("span");
      nm.className = "recent-name";
      nm.textContent = lk.name;
      a.appendChild(ico);
      a.appendChild(nm);
      grid.appendChild(a);
    }
  }
```

注：如果 `faviconFromUrl` / `initialOf` 函数名与项目实际不一致，使用 `grep -n "function faviconFromUrl\|favicon\b" app.js` 找正确名字并替换。

- [ ] **Step 4: 在 app.js 找到 `function renderAll` 或主渲染函数（`grep -n "function renderAll\|renderGroups()\|renderRecent()" app.js`），在调用 `renderRecent()` 之前/之后追加调用 `renderStarredShelf();`**

具体行需根据 grep 结果定。如果有多处，选择"渲染卡片完成后"那处。

- [ ] **Step 5: 在 index.html 设置面板新增开关**

搜索 `set-show-recent` 那一行（约 483），**在它后面**追加：

```html
<label class="row"><input type="checkbox" id="set-show-starred" /> 首页显示"星标置顶"卡</label>
```

- [ ] **Step 6: 在 app.js 的 `bindSettings()` 里绑定**

```js
    setC("#set-show-starred", s.showStarred);
```

并在 listener 区追加：

```js
    $("#set-show-starred").addEventListener("change", (e) => {
      s.showStarred = e.target.checked;
      Store.saveSettings();
      renderStarredShelf();
    });
```

- [ ] **Step 7: 浏览器手测**

把任意一个卡片右键设为星标 → 顶部出现 `⭐ 星标置顶` shelf。设置里关闭 → shelf 消失。

- [ ] **Step 8: 提交**

```bash
git add app.js index.html
git commit -m "feat(layout): starred shelf above recent on homepage"
```

---

## Slice F — 粘性分组 tab（≥4 组时显示）

### Task 8：分组 tab 条

**Files:**
- Modify: `index.html`（在 `<section id="groups-container">` 之**前**新增 tab 容器）
- Modify: `app.js`（新增 `renderGroupTabs()` + 在分组渲染后调用）
- Modify: `styles.css`（追加样式）

- [ ] **Step 1: 在 index.html 的 `<section id="groups-container"` **之前**追加**

```html
<nav id="group-tabs" class="group-tabs glass" hidden role="tablist"></nav>
```

- [ ] **Step 2: 在 app.js 找到 `function renderGroups` 或主分组渲染函数（`grep -n "function renderGroups\|renderGroups\b" app.js`），在它**末尾**调用前新增**

```js
  function renderGroupTabs() {
    const tabs = $("#group-tabs");
    if (!tabs) return;
    const groups = Store.state.groups || [];
    if (groups.length < 4) { tabs.hidden = true; tabs.innerHTML = ""; return; }
    tabs.hidden = false;
    tabs.innerHTML = "";
    for (const g of groups) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "group-tab";
      b.dataset.groupId = g.id;
      b.textContent = g.name;
      b.addEventListener("click", () => {
        const target = document.querySelector(`[data-group-id="${g.id}"].group-block, [data-group-id="${g.id}"].group, #group-${g.id}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        $$(".group-tab", tabs).forEach((t) => t.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      tabs.appendChild(b);
    }
  }
```

注：上面的查询里包含 3 种 selector，因为我没有逐行确认 group block 的实际类名。执行时 `grep -n "group-block\|class=\"group\"\|id=\"group-" app.js | head` 确认现有 DOM 是哪种，并删掉不匹配的两个。

- [ ] **Step 3: 在 `renderGroups`（或主渲染函数）末尾调用 `renderGroupTabs();`**

- [ ] **Step 4: 在 styles.css 末尾追加**

```css
/* ===================== 分组 tab 条 ===================== */
.group-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  margin: 8px 0 12px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  position: sticky;
  top: 8px;
  z-index: 50;
  scrollbar-width: none;
}
.group-tabs::-webkit-scrollbar { display: none; }
.group-tab {
  flex: 0 0 auto;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
  font-size: .9em;
  font-family: inherit;
  transition: all .15s;
}
.group-tab:hover { color: var(--text); border-color: var(--accent); }
.group-tab.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 5: 浏览器手测**

新建 4 个分组 → tab 条出现并粘性置顶 → 点 tab 平滑滚动到对应分组 → 删一个分组到 3 个 → tab 条隐藏。

- [ ] **Step 6: 提交**

```bash
git add app.js index.html styles.css
git commit -m "feat(layout): sticky group tabs (visible when ≥4 groups)"
```

---

## Slice G — 超紧凑卡片密度（图标墙）

### Task 9：第 4 档密度

**Files:**
- Modify: `index.html`（搜索 `<select id="set-density">` 加第 4 个 option）
- Modify: `styles.css`（加 `[data-density="tight"]` 规则）

- [ ] **Step 1: 在 index.html 的 `<select id="set-density">` 选项末尾追加**

```html
<option value="tight">超紧凑（图标墙）</option>
```

- [ ] **Step 2: 在 styles.css 行 84 附近追加**

```css
[data-density="tight"]   { --card-size: 64px; --gap: 8px; }
[data-density="tight"] .card .desc { display: none; }
[data-density="tight"] .card .name {
  font-size: .72em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-density="tight"] .card .icon-wrap {
  width: 36px;
  height: 36px;
}
```

注：如果 `.card .desc` / `.card .name` / `.card .icon-wrap` 类名与项目实际不一致，先 `grep -n 'class="card\|class="link-card' app.js index.html | head`，并替换为正确的子元素类名。

- [ ] **Step 3: 浏览器手测**

设置 → 卡片密度 → 选"超紧凑（图标墙）" → 卡片缩到一行 6-8 个、只剩图标 + 小字名。

- [ ] **Step 4: 提交**

```bash
git add index.html styles.css
git commit -m "feat(layout): add tight card density (icon wall)"
```

---

## Slice H — 移动端响应式（≤768px）

### Task 10：移动端布局

**Files:**
- Modify: `styles.css`（在文件末尾追加 `@media (max-width: 768px)` 块）
- Modify: `app.js`（在 `syncSakuraParticles` 里加移动端粒子数减半）

- [ ] **Step 1: 在 styles.css 末尾追加**

```css
/* ===================== 移动端 ≤768px ===================== */
@media (max-width: 768px) {
  /* hero 单行 */
  .header-bar { padding: 10px 12px; gap: 6px; }
  .header-bar .greet h1 { font-size: 1em; }

  /* 分组 tab 吸顶 */
  .group-tabs { top: 4px; padding: 6px 8px; }

  /* 卡片两列 / tight 三列 */
  .group-block .links,
  .group .links,
  #groups-container .links {
    grid-template-columns: repeat(2, 1fr);
  }
  [data-density="tight"] .group-block .links,
  [data-density="tight"] .group .links,
  [data-density="tight"] #groups-container .links {
    grid-template-columns: repeat(3, 1fr);
  }

  /* 设置面板：滑出抽屉式（如果项目用 <dialog>，改成 sheet 风格） */
  dialog.glass-dialog.settings-dialog {
    margin: 0;
    width: 100vw;
    max-width: 100vw;
    height: 86vh;
    max-height: 86vh;
    bottom: 0;
    top: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  /* 玻璃模糊降一档 */
  :root { --blur: 10px; }

  /* 高频区横向滚动更紧凑 */
  .recent-grid { gap: 6px; }
}
```

注：上面的 `.group-block .links` / `.group .links` / `#groups-container .links` 三选一需确认项目实际类名，删掉不匹配的两个。

- [ ] **Step 2: 在 app.js 的 `syncSakuraParticles` 里加移动端减半**

当前实现：

```js
function syncSakuraParticles() {
  if (!window.Sakura) return;
  const s = Store.settings;
  Sakura.set({
    particleMode: particleModeFromVisualTheme(s.visualTheme),
    count: s.sakuraCount,
    speed: s.sakuraSpeed,
  });
}
```

替换为：

```js
function syncSakuraParticles() {
  if (!window.Sakura) return;
  const s = Store.settings;
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  Sakura.set({
    particleMode: particleModeFromVisualTheme(s.visualTheme),
    count: isMobile ? Math.round((s.sakuraCount || 70) / 2) : (s.sakuraCount || 70),
    speed: s.sakuraSpeed,
  });
}
```

并在文件末尾增加（如果还没有）：

```js
window.addEventListener("resize", () => {
  // 跨 768px 阈值时重新同步粒子数
  syncSakuraParticles();
});
```

注：搜索 `window.addEventListener("resize"` 看现有 listener，如果已存在，把 `syncSakuraParticles()` 调用并入即可。

- [ ] **Step 3: 浏览器手测（DevTools 切手机视图）**

在 Chrome DevTools 切到 iPhone 12 → 期望：hero 一行、卡片 2 列、tight 模式 3 列、设置抽屉从底部滑出、粒子数明显变少。

- [ ] **Step 4: 提交**

```bash
git add styles.css app.js
git commit -m "feat(responsive): mobile ≤768px layout (2-col grid, sheet settings, half particles)"
```

---

## Slice I — 验收 + 文档

### Task 11：冒烟脚本扩展

**Files:**
- Modify: `_smoke.ps1`

- [ ] **Step 1: Read 现有 _smoke.ps1 看其格式**

```bash
cat _smoke.ps1
```

- [ ] **Step 2: 在末尾追加（保持原有缩进/风格）**

```powershell
# === Theme & layout smoke checks ===
$themeFiles = @('themes/sakura.css','themes/q-anime.css','themes/dark-minimal.css','themes/paper.css')
foreach ($f in $themeFiles) {
  if (-not (Test-Path $f)) { Write-Error "missing $f"; exit 1 }
}
if (-not (Select-String -Path 'sakura.js' -Pattern 'candy-stars' -Quiet)) {
  Write-Error "candy-stars mode not found in sakura.js"; exit 1
}
if (-not (Select-String -Path 'sakura.js' -Pattern '"none"' -Quiet)) {
  Write-Error "none mode not found in sakura.js"; exit 1
}
if (-not (Select-String -Path 'app.js' -Pattern 'q-anime' -Quiet)) {
  Write-Error "q-anime not registered in VISUAL_THEMES"; exit 1
}
if (-not (Select-String -Path 'app.js' -Pattern 'applyHeroMode' -Quiet)) {
  Write-Error "applyHeroMode missing"; exit 1
}
if (-not (Select-String -Path 'app.js' -Pattern 'renderStarredShelf' -Quiet)) {
  Write-Error "renderStarredShelf missing"; exit 1
}
if (-not (Select-String -Path 'app.js' -Pattern 'renderGroupTabs' -Quiet)) {
  Write-Error "renderGroupTabs missing"; exit 1
}
if (-not (Select-String -Path 'styles.css' -Pattern '\[data-density="tight"\]' -Quiet)) {
  Write-Error "tight density rule missing"; exit 1
}
if (-not (Select-String -Path 'styles.css' -Pattern 'max-width: 768px' -Quiet)) {
  Write-Error "mobile media query missing"; exit 1
}
Write-Host "theme & layout smoke OK"
```

- [ ] **Step 3: 在 macOS / Linux 用 sh 替代检查（项目用户环境）**

如果用户环境是 bash/zsh（mac 是），新建 `_smoke.sh` 镜像版本（只在 ps1 不可用时跑）：

```bash
#!/usr/bin/env bash
set -e
for f in themes/sakura.css themes/q-anime.css themes/dark-minimal.css themes/paper.css; do
  [ -f "$f" ] || { echo "missing $f"; exit 1; }
done
grep -q 'candy-stars' sakura.js || { echo 'candy-stars missing'; exit 1; }
grep -q '"none"' sakura.js || { echo 'none mode missing'; exit 1; }
grep -q 'q-anime' app.js || { echo 'q-anime missing'; exit 1; }
grep -q 'applyHeroMode' app.js || { echo 'applyHeroMode missing'; exit 1; }
grep -q 'renderStarredShelf' app.js || { echo 'renderStarredShelf missing'; exit 1; }
grep -q 'renderGroupTabs' app.js || { echo 'renderGroupTabs missing'; exit 1; }
grep -qE '\[data-density="tight"\]' styles.css || { echo 'tight density missing'; exit 1; }
grep -q 'max-width: 768px' styles.css || { echo 'mobile mq missing'; exit 1; }
echo 'theme & layout smoke OK'
```

```bash
chmod +x _smoke.sh
```

- [ ] **Step 4: 跑一次冒烟**

```bash
./_smoke.sh
```

期望输出：`theme & layout smoke OK`

- [ ] **Step 5: 提交**

```bash
git add _smoke.ps1 _smoke.sh
git commit -m "test: smoke checks for theme & layout changes"
```

---

### Task 12：手测清单 + README 更新

**Files:**
- Modify: `README.md`（更新主题章节）
- Create: `docs/superpowers/specs/2026-04-27-homepage-themes-test-checklist.md`（手测清单归档）

- [ ] **Step 1: 在 README.md 中找到"完全自定义外观"或"视觉 & 氛围"小节，更新主题描述**

搜索 README.md 中的 `亮色 / 暗色 / 跟随系统`，**在它**之前**追加：

```markdown
- 🎭 **四套预设主题包**（一键切换，热生效不刷页）：
  - 🌸 **樱粉**（默认）—— 玻璃 + 樱花飘落
  - ✨ **Q 版二次元**（柔和星空版）—— 雾紫/樱乳粉/月光蓝三色低饱和、缓慢飘落小星 + 偶发流星
  - 🌙 **暗夜极简** —— 高对比静默无装饰
  - 📜 **复古纸质** —— 米黄底 + 衬线字 + 飘落叶
- 🎨 **当前主题之上的微调**：主色调（沿用调色板）、字号、圆角、卡片密度（含新增"超紧凑图标墙"档）
```

- [ ] **Step 2: 创建手测清单**

写入 `docs/superpowers/specs/2026-04-27-homepage-themes-test-checklist.md`：

```markdown
# A 阶段验收手测清单

执行人：______ · 日期：______

## 主题切换（4 主题 × 桌面/移动 × 亮/暗 = 16 组）

每组检查：背景渐变 / 卡片样式 / 强调色 / 粒子是否符合主题 / 切换无刷页 / 设置面板字色对比 / AI 面板字色对比 / 日历面板字色对比

| # | 主题 | 视口 | 模式 | 通过？ |
|---|---|---|---|---|
| 1 | 樱粉 | 桌面 | 亮 | □ |
| 2 | 樱粉 | 桌面 | 暗 | □ |
| 3 | 樱粉 | 移动 | 亮 | □ |
| 4 | 樱粉 | 移动 | 暗 | □ |
| 5 | Q 版二次元 | 桌面 | 亮 | □ |
| 6 | Q 版二次元 | 桌面 | 暗 | □ |
| 7 | Q 版二次元 | 移动 | 亮 | □ |
| 8 | Q 版二次元 | 移动 | 暗 | □ |
| 9 | 暗夜极简 | 桌面 | 亮 | □ |
| 10 | 暗夜极简 | 桌面 | 暗 | □ |
| 11 | 暗夜极简 | 移动 | 亮 | □ |
| 12 | 暗夜极简 | 移动 | 暗 | □ |
| 13 | 复古纸质 | 桌面 | 亮 | □ |
| 14 | 复古纸质 | 桌面 | 暗 | □ |
| 15 | 复古纸质 | 移动 | 亮 | □ |
| 16 | 复古纸质 | 移动 | 暗 | □ |

## 布局功能

- [ ] hero 紧凑模式（默认）：一行问候 + 时钟 + 第二行一言
- [ ] hero 展开模式：原状
- [ ] hero 隐藏模式：整 hero 区消失
- [ ] 星标置顶 shelf：把任意卡片设星标后顶部出现
- [ ] 星标关闭：设置里关掉，shelf 消失
- [ ] 分组 tab 条：仅当 ≥ 4 组时显示
- [ ] 分组 tab 点击：平滑滚动到对应分组
- [ ] 分组 tab 高亮：当前点的 tab 有 active 边框
- [ ] 超紧凑密度：卡片缩为图标 + 小字
- [ ] 移动端 ≤768px：卡片 2 列、tight 3 列、设置底部抽屉、粒子数减半

## 回归（现有功能不破）

- [ ] 添加链接（粘贴 URL 自动弹窗）
- [ ] 编辑链接（双击 + 右键菜单）
- [ ] 跨组拖拽
- [ ] 整组拖拽重排
- [ ] 分组折叠 ▾
- [ ] 搜索引擎切换
- [ ] 搜索联想下拉
- [ ] AI 助手唤起（Alt+A）
- [ ] AI 流式输出
- [ ] 日历月视图打开
- [ ] 日历任务倒计时刷新
- [ ] 音乐播放器（Alt+M）
- [ ] 多端同步（如已配置）

## prefers-reduced-motion

- [ ] 系统开启"减少动画" → 所有主题粒子数 = 0

## 修改主题后强调色行为

- [ ] 主色调未自定义时切主题：accent 自动跟随新主题
- [ ] 主色调已自定义时切主题：accent 保留用户选择
```

- [ ] **Step 3: 提交**

```bash
git add README.md docs/superpowers/specs/2026-04-27-homepage-themes-test-checklist.md
git commit -m "docs: update README themes section + add manual test checklist"
```

---

## 完成标志

全部 Task 1-12 完成 + 手测清单全部勾选 + 冒烟脚本通过。

完成后，按用户优先级 ACEBFGD 进入下一阶段：**C（日历 / 任务）**。在新对话或新 brainstorm 循环中开始。
