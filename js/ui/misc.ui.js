/* 🎛 杂项 UI（语音输入 / 搜索联想 / 最近使用 / 星标置顶 / AI TTS） — 自 app.js 拆分
 * 由 app.js 通过 window.MiscUIFactory(UIContext) 实例化；
 * AITts 仍挂 window.AITts（AI 聊天气泡的朗读按钮依赖）。
 */
(function () {
  "use strict";

  window.MiscUIFactory = function (ctx) {
    const { $, $$, toast, escapeHtml, Store } = ctx;
  // ===================== 语音输入 UI =====================
  const UIVoice = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    function supported() { return !!SR; }

    function bind(btn, targetEl, { append = false } = {}) {
      if (!btn || !targetEl) return;
      if (!supported()) {
        btn.disabled = true;
        btn.title = "浏览器不支持 Web Speech API（请用 Chrome / Edge）";
        btn.style.opacity = "0.4";
        return;
      }
      let rec = null;
      btn.addEventListener("click", () => {
        if (rec) { rec.stop(); return; }
        rec = new SR();
        rec.lang = "zh-CN";
        rec.interimResults = true;
        rec.continuous = false;
        btn.classList.add("recording");
        let finalText = "";
        rec.onresult = (ev) => {
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interim += r[0].transcript;
          }
          const baseVal = (append && targetEl._baseVal != null) ? targetEl._baseVal : "";
          const v = (append ? baseVal + (baseVal && (finalText || interim) ? " " : "") : "") + finalText + interim;
          targetEl.value = v;
        };
        rec.onerror = () => { toast("语音识别错误"); };
        rec.onend = () => {
          btn.classList.remove("recording");
          rec = null;
          targetEl._baseVal = null;
        };
        if (append) targetEl._baseVal = targetEl.value;
        rec.start();
      });
    }

    function init() {
      bind($("#task-voice"), document.querySelector('#form-task [name="title"]'));
      bind($("#ai-voice"), $("#ai-input"), { append: true });
    }
    return { init, bind, supported };
  })();

  // ===================== 搜索联想 UI =====================
  const UISuggest = (() => {
    const input = $("#search-input");
    const box = $("#search-suggest");
    const form = $("#search-form");
    let items = [];
    let activeIdx = -1;
    let timer = null;
    let lastQ = "";

    function hide() { box.hidden = true; activeIdx = -1; }
    function show() { box.hidden = false; }

    function render() {
      if (!items.length) { hide(); return; }
      const local = items.filter((x) => x.type === "local");
      const remote = items.filter((x) => x.type === "remote");
      let html = "";
      if (local.length) {
        html += `<div class="sugg-group-title">本地书签</div>`;
        html += local.map((x, i) => `
          <div class="sugg-item" data-idx="${items.indexOf(x)}">
            <span class="sugg-icon">🔗</span>
            <span class="sugg-text">${escapeHtml(x.text)}</span>
            <span class="sugg-sub">${escapeHtml(x.sub || "")}</span>
          </div>`).join("");
      }
      if (remote.length) {
        html += `<div class="sugg-group-title">搜索建议</div>`;
        html += remote.map((x) => `
          <div class="sugg-item" data-idx="${items.indexOf(x)}">
            <span class="sugg-icon">🔎</span>
            <span class="sugg-text">${escapeHtml(x.text)}</span>
            <span class="sugg-sub">${escapeHtml(x.src || "")}</span>
          </div>`).join("");
      }
      box.innerHTML = html;
      show();
      $$(".sugg-item", box).forEach((el) => {
        el.addEventListener("mouseenter", () => {
          activeIdx = +el.dataset.idx;
          highlight();
        });
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(+el.dataset.idx);
        });
      });
      highlight();
    }

    function highlight() {
      $$(".sugg-item", box).forEach((el) => {
        el.classList.toggle("active", +el.dataset.idx === activeIdx);
      });
    }

    function pick(idx) {
      const it = items[idx];
      if (!it) return;
      if (it.type === "local" && it.url) {
        window.open(it.url, Store.settings.newTab ? "_blank" : "_self");
      } else {
        input.value = it.text;
        form.requestSubmit();
      }
      hide();
    }

    async function query(q) {
      if (!q.trim()) { items = []; hide(); return; }
      if (q === lastQ) return;
      lastQ = q;
      const eng = Store.settings.engine;
      try {
        const list = await Suggest.fetchAll(q, eng);
        if (q !== lastQ) return;
        items = list;
        render();
      } catch (_) {}
    }

    function init() {
      input.addEventListener("input", () => {
        const v = input.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => query(v), 180);
      });
      input.addEventListener("focus", () => {
        if (input.value.trim() && items.length) show();
      });
      document.addEventListener("click", (e) => {
        if (!form.contains(e.target)) hide();
      });
      input.addEventListener("keydown", (e) => {
        if (box.hidden) return;
        if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); highlight(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); highlight(); }
        else if (e.key === "Enter") {
          if (activeIdx >= 0) {
            e.preventDefault();
            pick(activeIdx);
          }
        } else if (e.key === "Escape") hide();
      });
    }

    return { init, hide };
  })();

  // ===================== 最近使用 UI =====================
  const UIRecent = (() => {
    const card = $("#recent-card");
    const grid = $("#recent-grid");
    let inited = false;

    function collect() {
      const all = [];
      (Store.state.groups || []).forEach((g) => {
        g.links.forEach((l) => {
          if (l.lastClickAt) all.push({ ...l, groupId: g.id, groupName: g.name });
        });
      });
      return all.sort((a, b) => b.lastClickAt - a.lastClickAt).slice(0, 10);
    }

    function refresh() {
      if (!Store.settings.showRecent) { card.hidden = true; return; }
      const list = collect();
      if (!list.length) { card.hidden = true; return; }
      card.hidden = false;
      grid.innerHTML = list.map((l) => {
        const letter = (l.name || l.url || "?").trim().charAt(0).toUpperCase();
        const icon = l.icon
          ? `<img src="${escapeHtml(l.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : `<span class="recent-fb">${escapeHtml(letter)}</span>`;
        return `<a class="recent-item" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" data-id="${l.id}" title="${escapeHtml(l.name)}">
          ${icon}
          <span class="recent-name">${escapeHtml(l.name || l.url)}</span>
        </a>`;
      }).join("");
      $$(".recent-item", grid).forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.dataset.id;
          const link = Store.state.groups.flatMap((g) => g.links).find((x) => x.id === id);
          if (link) {
            link.clickCount = (link.clickCount || 0) + 1;
            link.lastClickAt = Date.now();
            Store.save();
            setTimeout(refresh, 100);
          }
        });
      });
    }

    function init() {
      if (inited) return;
      inited = true;
      $("#recent-clear").addEventListener("click", () => {
        if (!confirm("清空所有最近使用记录？")) return;
        (Store.state.groups || []).forEach((g) => g.links.forEach((l) => {
          delete l.lastClickAt; delete l.clickCount;
        }));
        Store.save();
        refresh();
      });
      refresh();
    }

    return { init, refresh };
  })();

  // ===================== 星标置顶 UI =====================
  const UIStarred = (() => {
    const card = $("#starred-card");
    const grid = $("#starred-grid");

    function refresh() {
      if (!card || !grid) return;
      if (!Store.settings.showStarred) {
        card.hidden = true;
        return;
      }
      const list = Layout.collectStarredLinks(Store.state.groups, 20);
      if (!list.length) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      grid.innerHTML = list.map((l) => {
        const letter = (l.name || l.url || "?").trim().charAt(0).toUpperCase();
        const icon = l.icon
          ? `<img src="${escapeHtml(l.icon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : `<span class="recent-fb">${escapeHtml(letter)}</span>`;
        return `<a class="recent-item" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" data-id="${l.id}" title="${escapeHtml(l.name)} · ${escapeHtml(l.groupName || "")}">
          ${icon}
          <span class="recent-name">${escapeHtml(l.name || l.url)}</span>
        </a>`;
      }).join("");
    }

    function init() {
      refresh();
    }

    return { init, refresh };
  })();

  // ===================== AI TTS =====================
  window.AITts = (() => {
    let currentUtter = null;
    function getVoice(text) {
      const voices = speechSynthesis.getVoices();
      const hasZh = /[\u4e00-\u9fa5]/.test(text);
      if (hasZh) return voices.find((v) => /zh/i.test(v.lang)) || voices[0];
      return voices.find((v) => /en/i.test(v.lang)) || voices[0];
    }
    function stripMd(s) {
      return String(s || "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[#*_>~|\-]/g, "")
        .replace(/\s+/g, " ");
    }
    function stop() {
      try { speechSynthesis.cancel(); } catch (_) {}
      if (currentUtter?.__btn) currentUtter.__btn.classList.remove("playing");
      currentUtter = null;
    }
    function speak(text, btn) {
      if (!("speechSynthesis" in window)) { toast("浏览器不支持语音合成"); return; }
      if (currentUtter && currentUtter.__btn === btn) { stop(); return; }
      stop();
      const clean = stripMd(text);
      if (!clean.trim()) return;
      const u = new SpeechSynthesisUtterance(clean);
      const v = getVoice(clean);
      if (v) u.voice = v;
      u.rate = 1; u.pitch = 1;
      u.onend = () => { if (btn) btn.classList.remove("playing"); currentUtter = null; };
      u.onerror = u.onend;
      u.__btn = btn;
      if (btn) btn.classList.add("playing");
      currentUtter = u;
      speechSynthesis.speak(u);
    }
    // 预加载声音（Chrome 首次为空）
    if ("speechSynthesis" in window) {
      speechSynthesis.onvoiceschanged = () => { };
    }
    return { speak, stop };
  })();


    return { UIVoice, UISuggest, UIRecent, UIStarred };
  };
})();
