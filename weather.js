/* 樱 · 天气模块（多城市版）
 * 数据源：Open-Meteo（forecast + geocoding，均免费、无 KEY）
 *   https://open-meteo.com/
 *   https://geocoding-api.open-meteo.com/
 * 定位备用：ipapi.co
 *
 * 数据结构：
 *   Weather.data = {
 *     auto: true,                     // 是否启用"自动定位"卡
 *     autoCity: { lat, lon, name },   // 自动定位得到的城市
 *     cities: [                       // 用户手动添加的城市
 *       { id, name, adm1, adm2, lat, lon, country }
 *     ],
 *     activeId: "auto"|string,        // 当前主城市（月历/通知使用）
 *     caches: {                       // {id -> {current, daily, updatedAt}}
 *       auto: {...}, [id]: {...}
 *     },
 *     unit: "celsius",
 *   }
 *
 * 向后兼容：老数据若含 lat/lon/city 而无 cities，自动迁移到 autoCity。
 */
(function () {
  "use strict";

  const KEY = "sakura_nav_weather_v1";

  const Weather = {
    data: {
      auto: true,
      autoCity: null,
      cities: [],
      activeId: "auto",
      caches: {},
      unit: "celsius",
    },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        // 兼容旧版 { auto, lat, lon, city, cache, lastFetch }
        if (parsed && parsed.cities === undefined && (parsed.lat != null || parsed.city)) {
          const migrated = {
            auto: parsed.auto !== false,
            autoCity: (parsed.lat != null && parsed.lon != null)
              ? { lat: parsed.lat, lon: parsed.lon, name: parsed.city || "" }
              : null,
            cities: [],
            activeId: "auto",
            caches: {},
            unit: parsed.unit || "celsius",
          };
          if (parsed.cache) {
            migrated.caches.auto = {
              current: parsed.cache.current,
              daily: parsed.cache.daily,
              updatedAt: parsed.lastFetch || Date.now(),
            };
          }
          this.data = Object.assign(this.data, migrated);
          this.save();
          return;
        }
        Object.assign(this.data, parsed);
        if (!this.data.caches) this.data.caches = {};
        if (!Array.isArray(this.data.cities)) this.data.cities = [];
        if (!this.data.activeId) this.data.activeId = "auto";
      } catch (_) {}
    },
    save() { localStorage.setItem(KEY, JSON.stringify(this.data)); },
  };

  // WMO weather codes → emoji + 中文
  const WMO = {
    0: ["☀️", "晴"], 1: ["🌤", "多云"], 2: ["⛅️", "多云"], 3: ["☁️", "阴"],
    45: ["🌫", "有雾"], 48: ["🌫", "雾凇"],
    51: ["🌦", "小毛毛雨"], 53: ["🌦", "毛毛雨"], 55: ["🌧", "大毛毛雨"],
    56: ["🌧", "冻毛毛雨"], 57: ["🌧", "强冻毛毛雨"],
    61: ["🌦", "小雨"], 63: ["🌧", "中雨"], 65: ["🌧", "大雨"],
    66: ["🌧", "冻雨"], 67: ["🌧", "强冻雨"],
    71: ["🌨", "小雪"], 73: ["🌨", "中雪"], 75: ["❄️", "大雪"], 77: ["❄️", "雪粒"],
    80: ["🌦", "阵雨"], 81: ["🌧", "中阵雨"], 82: ["⛈", "强阵雨"],
    85: ["🌨", "阵雪"], 86: ["❄️", "强阵雪"],
    95: ["⛈", "雷雨"], 96: ["⛈", "雷雨带冰雹"], 99: ["⛈", "强雷雨冰雹"],
  };
  function wmo(code) { return WMO[code] || ["🌡", "未知"]; }

  async function locateByIp() {
    try {
      const r = await fetch("https://ipapi.co/json/");
      if (!r.ok) throw 0;
      const j = await r.json();
      return { lat: j.latitude, lon: j.longitude, name: j.city + (j.region ? "・" + j.region : "") };
    } catch (_) {
      const r = await fetch("http://ip-api.com/json/?lang=zh-CN");
      const j = await r.json();
      return { lat: j.lat, lon: j.lon, name: j.city };
    }
  }

  async function locateByGeolocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("浏览器不支持地理定位"));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "" }),
        (err) => reject(err),
        { timeout: 8000, maximumAge: 3600_000 }
      );
    });
  }

  async function ensureAutoLocation(force = false) {
    if (!Weather.data.auto) return;
    if (!force && Weather.data.autoCity && Weather.data.autoCity.lat != null) return;
    try {
      const loc = await locateByIp();
      if (loc.lat && loc.lon) {
        Weather.data.autoCity = { lat: loc.lat, lon: loc.lon, name: loc.name || "" };
        Weather.save();
      }
    } catch (_) {}
  }

  /** 城市搜索（默认优先中国） */
  async function searchCity(query, { countryCode = "CN", count = 10, lang = "zh" } = {}) {
    const q = (query || "").trim();
    if (!q) return [];
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", q);
    url.searchParams.set("count", String(count));
    url.searchParams.set("language", lang);
    if (countryCode) url.searchParams.set("countryCode", countryCode);
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error("城市搜索失败");
    const j = await r.json();
    return (j.results || []).map((it) => ({
      id: "c_" + it.id,
      name: it.name,
      adm1: it.admin1 || "",
      adm2: it.admin2 || "",
      country: it.country_code || it.country || "",
      lat: it.latitude,
      lon: it.longitude,
    }));
  }

  /** 查出当前有效的城市列表（用于渲染） */
  function listCities() {
    const out = [];
    if (Weather.data.auto) {
      const a = Weather.data.autoCity || {};
      out.push({
        id: "auto",
        kind: "auto",
        name: a.name || "自动定位",
        adm1: "",
        lat: a.lat, lon: a.lon,
      });
    }
    for (const c of Weather.data.cities || []) {
      out.push({ ...c, kind: "manual" });
    }
    return out;
  }

  function getCityById(id) {
    if (id === "auto") {
      const a = Weather.data.autoCity;
      return a ? { id: "auto", kind: "auto", name: a.name || "自动定位", lat: a.lat, lon: a.lon } : null;
    }
    const c = (Weather.data.cities || []).find((x) => x.id === id);
    return c ? { ...c, kind: "manual" } : null;
  }

  /** 指定城市拉天气（必要时走缓存） */
  async function fetchForecastFor(cityId, force = false) {
    if (cityId === "auto") await ensureAutoLocation();
    const city = getCityById(cityId);
    if (!city || city.lat == null || city.lon == null) throw new Error("城市未设置");

    const now = Date.now();
    const cache = Weather.data.caches[cityId];
    if (!force && cache && cache.current && now - (cache.updatedAt || 0) < 3600 * 1000) return cache;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=7`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("天气 API 出错：HTTP " + r.status);
    const j = await r.json();
    Weather.data.caches[cityId] = {
      current: j.current,
      daily: j.daily,
      updatedAt: now,
    };
    Weather.save();
    return Weather.data.caches[cityId];
  }

  /** 刷新所有已配置的城市（并行，失败逐个 swallow） */
  async function fetchAll(force = false) {
    const cities = listCities();
    if (!cities.length) return [];
    const settled = await Promise.allSettled(
      cities.map((c) => fetchForecastFor(c.id, force).then((data) => ({ id: c.id, data })))
    );
    return settled.map((s, i) => s.status === "fulfilled"
      ? { id: cities[i].id, ok: true, data: s.value.data }
      : { id: cities[i].id, ok: false, error: s.reason });
  }

  /** 向后兼容：拉"主城市"的天气（用于日历/通知） */
  async function fetchForecast(force = false) {
    const activeId = Weather.data.activeId || "auto";
    try {
      const data = await fetchForecastFor(activeId, force);
      // 旧代码通过 Weather.data.cache 来访问
      Weather.data.cache = { current: data.current, daily: data.daily };
      return Weather.data.cache;
    } catch (e) {
      // 主城市失败时尝试其他城市（只为了兼容日历天气图标）
      for (const c of listCities()) {
        if (c.id === activeId) continue;
        try {
          const data = await fetchForecastFor(c.id, false);
          Weather.data.cache = { current: data.current, daily: data.daily };
          return Weather.data.cache;
        } catch (_) {}
      }
      throw e;
    }
  }

  function forecastForDate(dateStr, cityId = null) {
    const id = cityId || Weather.data.activeId || "auto";
    const cache = Weather.data.caches[id];
    if (!cache || !cache.daily) return null;
    const idx = cache.daily.time.findIndex((t) => t === dateStr);
    if (idx < 0) return null;
    return {
      code: cache.daily.weather_code[idx],
      max: cache.daily.temperature_2m_max[idx],
      min: cache.daily.temperature_2m_min[idx],
      rainProb: cache.daily.precipitation_probability_max[idx],
    };
  }

  function current(cityId = null) {
    const id = cityId || Weather.data.activeId || "auto";
    return Weather.data.caches[id]?.current || null;
  }

  function addCity(city) {
    if (!city || city.lat == null || city.lon == null) return null;
    const id = city.id || "c_" + Date.now().toString(36);
    const item = {
      id,
      name: city.name,
      adm1: city.adm1 || "",
      adm2: city.adm2 || "",
      country: city.country || "",
      lat: city.lat,
      lon: city.lon,
    };
    if ((Weather.data.cities || []).some((c) => c.id === id)) return item; // 已存在
    Weather.data.cities = [...(Weather.data.cities || []), item];
    Weather.save();
    return item;
  }

  function removeCity(id) {
    if (id === "auto") { Weather.data.auto = false; Weather.save(); return; }
    Weather.data.cities = (Weather.data.cities || []).filter((c) => c.id !== id);
    if (Weather.data.caches[id]) delete Weather.data.caches[id];
    if (Weather.data.activeId === id) Weather.data.activeId = "auto";
    Weather.save();
  }

  function setActive(id) {
    if (id !== "auto" && !(Weather.data.cities || []).some((c) => c.id === id)) return;
    Weather.data.activeId = id;
    Weather.save();
  }

  function setAuto(enabled) {
    Weather.data.auto = !!enabled;
    if (!enabled && Weather.data.activeId === "auto") {
      // 自动定位关掉了，activeId 退回第一个手动城市
      const first = (Weather.data.cities || [])[0];
      Weather.data.activeId = first ? first.id : "auto";
    }
    Weather.save();
  }

  window.Weather = Weather;
  window.WeatherUtils = {
    wmo,
    fetchForecast, fetchForecastFor, fetchAll,
    forecastForDate, current,
    ensureLocation: ensureAutoLocation, locateByGeolocation, locateByIp,
    searchCity,
    listCities, getCityById,
    addCity, removeCity, setActive, setAuto,
  };
})();
