/* ===============================
   pet-widget.js —— 导航首页漫游小宠物
   依赖 pet-engine.js（SakuraPet）
   · 在页面底部自由活动（不遮挡点击，仅宠物本体可交互）
   · 单击：摸摸 + 加亲密度；双击：进入宠物乐园
   · 开关在 宠物乐园 → “在导航首页显示宠物”
   =============================== */
(() => {
  "use strict";
  if (!window.SakuraPet) return;
  const { Config, PetActor, LINES, pick } = window.SakuraPet;

  const cfg = Config.load();
  if (!cfg.homeWidget) return;

  function boot() {
    // 漫游层：铺满底部，pointer-events:none —— 只有宠物本体接受点击
    const layer = document.createElement("div");
    layer.id = "home-pet-layer";
    layer.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;height:150px;pointer-events:none;z-index:950;overflow:visible;";
    document.body.appendChild(layer);

    const actor = new PetActor({
      container: layer,
      fxLayer: layer,
      scale: 1.5,
      speed: 70,
      groundBottom: 4,
      chatty: false,          // 首页安静些，气泡只在互动时出现
      custom: cfg.custom ? cfg.custom.img : null,
      onPetClick(a) {
        a.hearts(3);
        a.say(pick(LINES.pat), 2200);
        a.emote(Math.random() < 0.5 ? "shy" : "joy", 1.8);
        // 亲密度 +1（与宠物乐园共享存档）
        const c = Config.load();
        c.affection += 1;
        Config.save(c);
      },
    });
    actor.el.title = `${cfg.name}：点我互动，双击去宠物乐园`;
    actor.el.addEventListener("dblclick", () => { location.href = "pet.html"; });

    // 偶尔悄悄说一句（低频，不打扰）
    setInterval(() => {
      if (!actor.sleeping && Math.random() < 0.25) actor.say(pick(LINES.bored), 2400);
    }, 45000);

    // 深夜自动睡着（23:00 - 6:00 且闲置时）
    setInterval(() => {
      const hr = new Date().getHours();
      if ((hr >= 23 || hr < 6) && !actor.sleeping && Math.random() < 0.5) actor.fallAsleep(false);
    }, 60000);

    // 跨页签同步：宠物乐园里换了形象/关了开关，首页即时生效
    addEventListener("storage", (e) => {
      if (e.key !== window.SakuraPet.SAVE_KEY) return;
      const c = Config.load();
      if (!c.homeWidget) { actor.destroy(); layer.remove(); return; }
      const img = c.custom ? c.custom.img : null;
      if (img !== actor.custom) actor.setCustom(img);
      actor.el.title = `${c.name}：点我互动，双击去宠物乐园`;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
