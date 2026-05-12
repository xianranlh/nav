/* 樱 · 日历节日数据（v1.19.4）
 * 暴露 window.CalFestivals.getFestivalsForDate(Date) → [{ name, emoji, kind, priority }]
 *   kind: "cn-holiday"（中国法定节假日，红色高亮）
 *         "cn-traditional"（中国传统节日，粉色）
 *         "cn"（中国公历节日，蓝色）
 *         "west"（西方常见节日，紫色）
 *   priority: 同一天有多个节日时，数字大的优先显示
 *
 * 农历节日：用浏览器自带的 Intl + 中国农历 (zh-CN-u-ca-chinese) 转换；
 *   不支持的浏览器回落到硬编码 2026-2030 的公历日期表。
 * 法定节假日：硬编码 2026 年国务院公告日期（含调休主日，不含补班）。
 */
(function () {
  "use strict";

  // ===== 公历固定节日 =====
  const FIXED = {
    // mm-dd: [name, emoji, kind, priority]
    "01-01": ["元旦", "🎊", "cn-holiday", 10],
    "02-14": ["情人节", "💝", "west", 5],
    "03-08": ["妇女节", "🌸", "cn", 5],
    "03-12": ["植树节", "🌳", "cn", 4],
    "04-01": ["愚人节", "🤡", "west", 4],
    "05-01": ["劳动节", "💼", "cn-holiday", 9],
    "05-04": ["青年节", "🎓", "cn", 4],
    "06-01": ["儿童节", "🎈", "cn", 5],
    "07-01": ["建党节", "🚩", "cn", 4],
    "08-01": ["建军节", "⚔️", "cn", 4],
    "09-10": ["教师节", "📚", "cn", 5],
    "10-01": ["国庆节", "🇨🇳", "cn-holiday", 10],
    "10-31": ["万圣节", "🎃", "west", 5],
    "11-11": ["双十一", "🛒", "cn", 3],
    "12-24": ["平安夜", "🎄", "west", 5],
    "12-25": ["圣诞节", "🎅", "west", 8],
  };

  // ===== 农历节日（兜底硬编码：2026-2030 的公历日期）=====
  // 当浏览器不支持 Intl 农历，或 Intl 输出格式不一致时使用这张表
  const LUNAR_FALLBACK = {
    2026: { "02-17": "春节", "03-03": "元宵节", "06-19": "端午节", "08-19": "七夕节", "09-25": "中秋节", "10-18": "重阳节" },
    2027: { "02-06": "春节", "02-20": "元宵节", "06-09": "端午节", "08-08": "七夕节", "09-15": "中秋节", "10-08": "重阳节" },
    2028: { "01-26": "春节", "02-09": "元宵节", "05-28": "端午节", "07-28": "七夕节", "09-03": "中秋节", "09-27": "重阳节" },
    2029: { "02-13": "春节", "02-27": "元宵节", "06-16": "端午节", "08-15": "七夕节", "09-22": "中秋节", "10-16": "重阳节" },
    2030: { "02-03": "春节", "02-17": "元宵节", "06-05": "端午节", "08-05": "七夕节", "09-12": "中秋节", "10-05": "重阳节" },
  };

  // ===== 清明节（节气，每年公历 4 月 4 或 5 日）=====
  const QINGMING = {
    2026: "04-05", 2027: "04-05", 2028: "04-04", 2029: "04-04", 2030: "04-04",
  };

  // ===== 中国法定节假日（硬编码兜底，2026 年；其它年份从 API 拉取后写入这里）=====
  // 数据源：国务院办公厅《关于 2026 年部分节假日安排的通知》
  const CN_HOLIDAYS = {
    2026: {
      "01-01": "元旦", "01-02": "元旦", "01-03": "元旦",
      "02-15": "春节", "02-16": "春节", "02-17": "春节", "02-18": "春节",
      "02-19": "春节", "02-20": "春节", "02-21": "春节",
      "04-04": "清明", "04-05": "清明", "04-06": "清明",
      "05-01": "劳动节", "05-02": "劳动节", "05-03": "劳动节", "05-04": "劳动节", "05-05": "劳动节",
      "06-19": "端午", "06-20": "端午", "06-21": "端午",
      "09-24": "中秋", "09-25": "中秋", "09-26": "中秋", "09-27": "中秋",
      "10-01": "国庆", "10-02": "国庆", "10-03": "国庆", "10-04": "国庆",
      "10-05": "国庆", "10-06": "国庆", "10-07": "国庆", "10-08": "国庆",
    },
  };

  // ===== 节假日 API 拉取（timor.tech 公开节假日服务）=====
  // 每年 12 月国务院发完次年公告后，timor 通常 24h 内同步更新
  // 接口形如：https://timor.tech/api/holiday/year/2027 →
  //   { code: 0, holiday: { "2027-01-01": { holiday: true, name: "元旦", wage: 3, date: "2027-01-01" }, ... } }
  // 我们只关心 holiday=true 的天（不关心补班的 wage=2 那些）
  const API_BASE = "https://timor.tech/api/holiday/year/";
  const CACHE_KEY_PREFIX = "sakura_nav_holidays_";
  const CACHE_TTL = 90 * 24 * 60 * 60 * 1000; // 90 天本地缓存（中国年度节假日基本不会改）
  const fetchedYears = new Set();

  /** 把 timor 响应里的 map { "2027-01-01": {name:"元旦"} } 映射成 { "01-01": "元旦", ... } */
  function timorToYearTable(api) {
    const out = {};
    if (!api || !api.holiday) return out;
    for (const [ymd, info] of Object.entries(api.holiday)) {
      if (!info || info.holiday !== true) continue; // 跳过补班
      const m = ymd.match(/^\d{4}-(\d{2})-(\d{2})$/);
      if (!m) continue;
      out[`${m[1]}-${m[2]}`] = info.name || "假期";
    }
    return out;
  }

  async function fetchYearFromApi(year) {
    const ck = CACHE_KEY_PREFIX + year;
    // 1) 优先读 localStorage 缓存
    try {
      const cached = localStorage.getItem(ck);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.ts && Date.now() - parsed.ts < CACHE_TTL && parsed.table) {
          return parsed.table;
        }
      }
    } catch (_) {}
    // 2) 拉 API
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(API_BASE + year, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const j = await r.json();
      if (j.code !== 0) return null;
      const table = timorToYearTable(j);
      try { localStorage.setItem(ck, JSON.stringify({ ts: Date.now(), table })); } catch (_) {}
      return table;
    } catch (_) {
      return null;
    }
  }

  /** 异步预拉某一年的节假日数据：拉到后 merge 进 CN_HOLIDAYS，next renderMonth 会自动用上 */
  async function ensureYear(year) {
    if (CN_HOLIDAYS[year] && Object.keys(CN_HOLIDAYS[year]).length >= 10) return; // 已有完整数据
    if (fetchedYears.has(year)) return;
    fetchedYears.add(year);
    const table = await fetchYearFromApi(year);
    if (table && Object.keys(table).length) {
      CN_HOLIDAYS[year] = table;
      // 通知 UI 重新渲染（如果暴露了 hook）
      try { window.dispatchEvent(new CustomEvent("cal-holidays-updated", { detail: { year } })); } catch (_) {}
    }
  }

  // ===== 浮动节日：依靠 weekday-in-month 计算 =====
  function nthWeekdayOfMonth(year, monthZero, weekday, n) {
    const first = new Date(year, monthZero, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return day;
  }

  // ===== 主接口 =====
  function getFestivalsForDate(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const md = pad2(m) + "-" + pad2(d);
    const items = [];

    // 1) 公历固定节日
    if (FIXED[md]) {
      const [name, emoji, kind, priority] = FIXED[md];
      items.push({ name, emoji, kind, priority });
    }

    // 2) 清明节
    if (QINGMING[y] === md) {
      items.push({ name: "清明节", emoji: "🌿", kind: "cn-traditional", priority: 8 });
    }

    // 3) 农历节日（先用 Intl，失败用硬编码）
    const lunar = lookupLunar(date);
    if (lunar) {
      items.push({ name: lunar, emoji: lunarEmoji(lunar), kind: "cn-traditional", priority: 9 });
    }

    // 4) 浮动节日（母亲节 / 父亲节 / 感恩节）
    if (m === 5 && date.getDay() === 0 && Math.ceil(d / 7) === 2) {
      items.push({ name: "母亲节", emoji: "🌷", kind: "west", priority: 6 });
    }
    if (m === 6 && date.getDay() === 0 && Math.ceil(d / 7) === 3) {
      items.push({ name: "父亲节", emoji: "🎩", kind: "west", priority: 6 });
    }
    if (m === 11 && date.getDay() === 4 && Math.ceil(d / 7) === 4) {
      items.push({ name: "感恩节", emoji: "🦃", kind: "west", priority: 5 });
    }

    // 5) 中国法定节假日（标 holiday）
    if (CN_HOLIDAYS[y] && CN_HOLIDAYS[y][md]) {
      items.push({
        name: CN_HOLIDAYS[y][md] + " · 放假",
        emoji: "🏖",
        kind: "cn-holiday",
        priority: 11,
        isLegalHoliday: true,
      });
    }

    // 去重：同名节日只保留一个（按 priority 高的）
    // 兼容"国庆/国庆节/国庆 · 放假"等变体，归一化为 baseName
    function baseName(name) {
      return name
        .replace(" · 放假", "")
        .replace(/节$/, "")
        .trim();
    }
    const seen = new Map();
    for (const it of items) {
      const key = baseName(it.name);
      const exist = seen.get(key);
      if (!exist || it.priority > exist.priority) {
        seen.set(key, it);
      }
    }
    return [...seen.values()].sort((a, b) => b.priority - a.priority);
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function lookupLunar(date) {
    const y = date.getFullYear();
    const md = pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
    // 优先硬编码表（更稳）
    if (LUNAR_FALLBACK[y] && LUNAR_FALLBACK[y][md]) return LUNAR_FALLBACK[y][md];
    // Intl 兜底：尝试从 zh-CN-u-ca-chinese 拿农历
    try {
      const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
        month: "numeric", day: "numeric",
      }).formatToParts(date);
      const mm = parts.find((p) => p.type === "month")?.value || "";
      const dd = parts.find((p) => p.type === "day")?.value || "";
      // 不同浏览器输出格式不同：标准输出形如 "正月" "初一"，但 numeric 也可能输出 "1" "1"
      const key = mm + "·" + dd;
      // 已知映射
      const INTL_MAP = {
        "正月·初一": "春节", "正月·1": "春节", "1·初一": "春节", "1·1": "春节",
        "正月·十五": "元宵节", "1·15": "元宵节",
        "五月·初五": "端午节", "5·初五": "端午节", "5·5": "端午节",
        "七月·初七": "七夕节", "7·初七": "七夕节", "7·7": "七夕节",
        "八月·十五": "中秋节", "8·十五": "中秋节", "8·15": "中秋节",
        "九月·初九": "重阳节", "9·初九": "重阳节", "9·9": "重阳节",
      };
      return INTL_MAP[key] || null;
    } catch (_) {
      return null;
    }
  }

  function lunarEmoji(name) {
    return name === "春节" ? "🧧"
      : name === "元宵节" ? "🏮"
      : name === "端午节" ? "🐉"
      : name === "七夕节" ? "💞"
      : name === "中秋节" ? "🌕"
      : name === "重阳节" ? "🌼"
      : "🏮";
  }

  window.CalFestivals = {
    getFestivalsForDate,
    todayFestivals: () => getFestivalsForDate(new Date()),
    ensureYear,
    /** 强制刷新缓存：删除 localStorage 该年的缓存，重新拉 */
    refreshYear(year) {
      try { localStorage.removeItem(CACHE_KEY_PREFIX + year); } catch (_) {}
      fetchedYears.delete(year);
      return ensureYear(year);
    },
    /** 已缓存的年份 */
    cachedYears() {
      const ys = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(CACHE_KEY_PREFIX)) ys.push(+k.slice(CACHE_KEY_PREFIX.length));
        }
      } catch (_) {}
      return ys.sort();
    },
  };
})();
