/* 樱 · 搜索下拉联想
 * 来源：
 *   1) 本地：当前导航 links 里按 name/url/desc 匹配
 *   2) 远端：DuckDuckGo AC API（原生支持 CORS）+ 百度 JSONP 备用
 *
 * 用法：
 *   Suggest.fetchAll(keyword) -> Promise<[{type:'local'|'remote', text, url?, sub?}]>
 */
(function () {
  "use strict";

  function localMatch(q) {
    const kw = q.trim().toLowerCase();
    if (!kw) return [];
    const groups = window.Store?.state?.groups || [];
    const out = [];
    for (const g of groups) {
      for (const l of g.links) {
        const hay = `${l.name || ""} ${l.url || ""} ${l.desc || ""}`.toLowerCase();
        if (hay.includes(kw)) {
          out.push({ type: "local", text: l.name, url: l.url, sub: g.name, icon: l.icon, id: l.id });
          if (out.length >= 6) return out;
        }
      }
    }
    return out;
  }

  async function ddg(q) {
    try {
      const r = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&kl=wt-wt`, { mode: "cors" });
      if (!r.ok) return [];
      const arr = await r.json();
      return arr.slice(0, 8).map((x) => ({ type: "remote", text: x.phrase, src: "DuckDuckGo" }));
    } catch (_) { return []; }
  }

  // 百度 JSONP：用 <script> 注入，回调到全局
  function baidu(q, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const cb = "__bdsug" + Math.random().toString(36).slice(2);
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        resolve([]);
      }, timeoutMs);
      window[cb] = function (res) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const list = (res && res.s) ? res.s : [];
        resolve(list.slice(0, 8).map((t) => ({ type: "remote", text: t, src: "百度" })));
        cleanup();
      };
      function cleanup() {
        try { delete window[cb]; } catch (_) { window[cb] = null; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      const s = document.createElement("script");
      s.src = `https://suggestion.baidu.com/su?wd=${encodeURIComponent(q)}&cb=${cb}`;
      s.onerror = () => { if (!done) { done = true; clearTimeout(timer); resolve([]); cleanup(); } };
      document.head.appendChild(s);
    });
  }

  async function remote(q, engine) {
    // 根据当前搜索引擎挑合适的远端
    if (engine === "baidu" || engine === "bing") {
      // bing 搜索但没 CORS，用 DuckDuckGo+百度结果合并
      const [b, d] = await Promise.all([baidu(q).catch(() => []), ddg(q).catch(() => [])]);
      return dedupe([...b, ...d]);
    }
    if (engine === "google" || engine === "duckduckgo" || engine === "zhihu" || engine === "github" || engine === "mdn") {
      const d = await ddg(q);
      return d;
    }
    return await ddg(q);
  }

  function dedupe(arr) {
    const seen = new Set();
    return arr.filter((x) => {
      const k = x.text.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  async function fetchAll(q, engine) {
    const l = localMatch(q);
    const r = await remote(q, engine).catch(() => []);
    return [...l, ...r.slice(0, 10 - l.length)];
  }

  window.Suggest = { fetchAll, localMatch };
})();
