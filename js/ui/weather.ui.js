/* 🌤 天气 UI（多城市） — 自 app.js 拆分
 * 逻辑层：js/weather.js (window.Weather / WeatherUtils)
 * 由 app.js 通过 window.WeatherUIFactory(UIContext) 实例化。
 */
(function () {
  "use strict";

  window.WeatherUIFactory = function (ctx) {
    const { $, toast, escapeHtml, Store } = ctx;
  const UIWeather = (() => {
    const card = $("#weather-card");
    let inited = false;
    let viewingId = null;      // 当前点开显示详情的城市 id（不等于 activeId）

    function getViewingId() {
      const cities = WeatherUtils.listCities();
      if (!cities.length) return null;
      if (viewingId && cities.some((c) => c.id === viewingId)) return viewingId;
      const activeId = Weather.data.activeId || "auto";
      if (cities.some((c) => c.id === activeId)) return activeId;
      return cities[0].id;
    }

    function tabTempHtml(cityId) {
      const cache = Weather.data.caches[cityId];
      if (!cache || !cache.current) return "";
      const c = cache.current;
      const [em] = WeatherUtils.wmo(c.weather_code);
      return `<span class="t-emoji">${em}</span><span class="t-temp">${Math.round(c.temperature_2m)}°</span>`;
    }

    function renderTabs() {
      const cities = WeatherUtils.listCities();
      const vid = getViewingId();
      const activeId = Weather.data.activeId || "auto";
      const container = $("#weather-cities");
      if (!cities.length) {
        container.innerHTML = `<span class="hint" style="padding:6px 10px">未配置城市 · 在设置里添加</span>`;
        return;
      }
      container.innerHTML = cities.map((c) => {
        const star = c.id === activeId ? "★" : "";
        const hasCache = !!Weather.data.caches[c.id];
        const cls = "w-city-tab"
          + (c.id === vid ? " active" : "")
          + (hasCache ? "" : " loading");
        const name = c.id === "auto" ? (c.name || "自动定位") : c.name;
        return `<button class="${cls}" data-cid="${c.id}" title="点击查看 · 双击设为主城市">
          ${star ? `<span class="star">★</span>` : ""}
          <span class="t-name">${escapeHtml(name)}</span>
          ${tabTempHtml(c.id)}
        </button>`;
      }).join("");
    }

    function renderDetail() {
      const vid = getViewingId();
      if (!vid) {
        $("#w-icon").textContent = "🌡";
        $("#w-temp").textContent = "--";
        $("#w-desc").textContent = "请先在设置里添加城市";
        $("#w-city").textContent = "";
        $("#w-active-name").textContent = "--";
        $("#w-daily").innerHTML = "";
        return;
      }
      const city = WeatherUtils.getCityById(vid);
      const cache = Weather.data.caches[vid];
      const cityName = city?.name || (vid === "auto" ? "自动定位" : "--");
      $("#w-active-name").textContent = cityName + (vid === (Weather.data.activeId || "auto") ? " · 主城市" : "");
      if (!cache || !cache.current) {
        $("#w-icon").textContent = "🌡";
        $("#w-temp").textContent = "--";
        $("#w-desc").textContent = "加载中…";
        $("#w-city").textContent = cityName;
        $("#w-daily").innerHTML = "";
        return;
      }
      const c = cache.current;
      const [emoji, desc] = WeatherUtils.wmo(c.weather_code);
      $("#w-icon").textContent = emoji;
      $("#w-temp").textContent = Math.round(c.temperature_2m);
      $("#w-desc").textContent = `${desc} · 体感 ${Math.round(c.apparent_temperature)}° · 湿度 ${c.relative_humidity_2m}%`;
      $("#w-city").textContent = cityName;
      const daily = cache.daily;
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      let html = "";
      if (daily && daily.time) {
        for (let i = 0; i < daily.time.length; i++) {
          const d = new Date(daily.time[i]);
          const [em] = WeatherUtils.wmo(daily.weather_code[i]);
          const dname = i === 0 ? "今" : dayNames[d.getDay()];
          const rain = daily.precipitation_probability_max[i];
          html += `<div class="weather-day">
            <div class="wd-date">${dname}${rain != null ? ` <span style="opacity:.6">${rain}%</span>` : ""}</div>
            <div class="wd-emoji">${em}</div>
            <div class="wd-temp">${Math.round(daily.temperature_2m_max[i])}/${Math.round(daily.temperature_2m_min[i])}°</div>
          </div>`;
        }
      }
      $("#w-daily").innerHTML = html;
    }

    function render() {
      renderTabs();
      renderDetail();
      if (Store.settings.weatherOnCal && window.UICalRefresh) {
        try { UICalRefresh(); } catch (_) {}
      }
    }

    async function refresh(force = false) {
      if (!Store.settings.showWeather) { card.hidden = true; return; }
      const cities = WeatherUtils.listCities();
      if (cities.length === 0) { card.hidden = true; return; }
      card.hidden = false;
      // 先渲染 tabs（可能为空缓存）
      render();
      // 并行拉取所有城市
      try {
        await WeatherUtils.fetchAll(force);
      } catch (_) {}
      render();
    }

    function init() {
      if (inited) return;
      inited = true;
      $("#w-refresh").addEventListener("click", () => refresh(true).then(() => toast("已刷新")).catch(() => {}));
      // 点击 tab 切换查看；双击设为主城市
      $("#weather-cities").addEventListener("click", (e) => {
        const tab = e.target.closest(".w-city-tab");
        if (!tab) return;
        viewingId = tab.dataset.cid;
        render();
      });
      $("#weather-cities").addEventListener("dblclick", (e) => {
        const tab = e.target.closest(".w-city-tab");
        if (!tab) return;
        WeatherUtils.setActive(tab.dataset.cid);
        viewingId = tab.dataset.cid;
        render();
        toast("已设为主城市");
        if (window.UICalRefresh) try { UICalRefresh(); } catch (_) {}
      });
      refresh();
    }

    return { init, refresh, render, setViewing(id) { viewingId = id; render(); } };
  })();

    return UIWeather;
  };
})();
