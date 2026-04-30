/* 樱 · 日历与任务模块
 * 功能：
 *  - 单次 / 每天 / 每周（指定星期）/ 每月（按日期）/ 每年（按月日） 重复
 *  - 间隔步长（例：每 2 周）、结束日期、最大次数
 *  - 例外跳过（某一次占用取消）
 *  - 完成记录（单次 → done；重复 → doneDates）
 *  - 下一次发生时间、指定范围内所有发生时间
 *  - 提醒（提前 N 分钟，浏览器 Notification）
 *  - 格式化倒计时
 * 数据：经 sakura-remote 写入服务端 SQLite
 */
(function () {
  "use strict";

  const KEY = "sakura_nav_calendar_v1";
  const DAY = 86400 * 1000;

  const Cal = {
    data: {
      tasks: [],
      settings: { firstDayOfWeek: 1, notify: false }, // 0=周日, 1=周一
    },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) Object.assign(this.data, JSON.parse(raw));
      } catch (_) {}
      if (!Array.isArray(this.data.tasks)) this.data.tasks = [];
      if (!this.data.settings) this.data.settings = { firstDayOfWeek: 1, notify: false };
      this.seedIfEmpty();
    },

    save() { localStorage.setItem(KEY, JSON.stringify(this.data)); },

    seedIfEmpty() {
      if (this.data.tasks.length) return;
      const now = Date.now();
      const soon = new Date(); soon.setHours(soon.getHours() + 2, 0, 0, 0);
      this.data.tasks = [
        {
          id: uid(),
          title: "✨ 欢迎使用樱日历",
          desc: "编辑本任务或新建任意重复任务，试试底部 + 按钮。",
          startAt: soon.getTime(),
          allDay: false,
          color: "#ff8fab",
          repeat: { type: "none", interval: 1 },
          exceptions: [],
          doneDates: [],
          done: false,
          remindBefore: 0,
          tags: ["示例"],
          createdAt: now,
        },
      ];
      this.save();
    },

    create(partial) {
      const t = Object.assign({
        id: uid(),
        title: "新任务",
        desc: "",
        startAt: Date.now(),
        allDay: false,
        color: "#ff8fab",
        repeat: { type: "none", interval: 1 },
        exceptions: [],
        doneDates: [],
        done: false,
        remindBefore: 0,
        tags: [],
        createdAt: Date.now(),
      }, partial || {});
      this.data.tasks.push(t);
      this.save();
      return t;
    },

    update(id, patch) {
      const t = this.get(id);
      if (!t) return null;
      Object.assign(t, patch);
      this.save();
      return t;
    },

    remove(id) {
      this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
      this.save();
    },

    get(id) { return this.data.tasks.find((t) => t.id === id); },
  };

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  // ===================== 重复规则计算 =====================
  /** 把时间戳向前推进到下一次发生（不做例外/完成判断） */
  function step(ts, repeat) {
    if (!repeat || repeat.type === "none") return null;
    const interval = Math.max(1, repeat.interval || 1);
    const d = new Date(ts);
    switch (repeat.type) {
      case "daily":
        d.setDate(d.getDate() + interval);
        return d.getTime();
      case "weekly": {
        const wd = (repeat.weekDays && repeat.weekDays.length) ? [...repeat.weekDays].sort() : null;
        if (!wd) { d.setDate(d.getDate() + 7 * interval); return d.getTime(); }
        // 在 interval 周内寻找下一个匹配星期几
        for (let i = 1; i <= 7 * interval + 7; i++) {
          const nx = new Date(d);
          nx.setDate(d.getDate() + i);
          if (wd.includes(nx.getDay())) return nx.getTime();
        }
        return null;
      }
      case "monthly":
        d.setMonth(d.getMonth() + interval);
        return d.getTime();
      case "yearly":
        d.setFullYear(d.getFullYear() + interval);
        return d.getTime();
    }
    return null;
  }

  function isExcepted(task, ts) {
    const ex = task.exceptions || [];
    return ex.includes(ts) || ex.some((e) => Math.abs(e - ts) < 60000);
  }
  function isDoneOccurrence(task, ts) {
    if (!task.repeat || task.repeat.type === "none") return !!task.done;
    const d = task.doneDates || [];
    return d.includes(ts) || d.some((e) => Math.abs(e - ts) < 60000);
  }

  /** 生成从 fromTs 起，范围内的所有发生时间（含例外过滤） */
  function* occurrences(task, fromTs = Date.now(), toTs = fromTs + 365 * DAY, opts = {}) {
    const r = task.repeat || { type: "none" };
    let t = task.startAt;
    let count = 0;
    const maxCount = r.count || Infinity;
    const until = r.until || Infinity;
    const hardLimit = 5000; // 防死循环

    // 如果 startAt 还没到 fromTs 就一直推进
    while (t < fromTs && count < hardLimit) {
      if (r.type === "none") {
        // 单次任务，且 t < fromTs → 只有当 opts.includePast 才给
        if (opts.includePast && !isExcepted(task, t) && (!opts.skipDone || !isDoneOccurrence(task, t))) yield t;
        return;
      }
      const nxt = step(t, r);
      if (!nxt) return;
      t = nxt;
      count++;
      if (count >= maxCount || t > until) return;
    }

    while (t <= toTs && count < hardLimit) {
      if (t > until) return;
      const excluded = isExcepted(task, t);
      const doneHere = isDoneOccurrence(task, t);
      if (!excluded && (!opts.skipDone || !doneHere)) yield t;
      if (r.type === "none") return;
      const nxt = step(t, r);
      if (!nxt) return;
      t = nxt;
      count++;
      if (count >= maxCount) return;
    }
  }

  /** 下一次发生（>= now，未完成、未跳过） */
  function nextOccurrence(task, fromTs = Date.now()) {
    for (const ts of occurrences(task, fromTs, fromTs + 5 * 365 * DAY, { skipDone: true })) {
      return ts;
    }
    return null;
  }

  /** 收集一个时间范围内的所有任务发生（含任务引用） */
  function listInRange(from, to, tasks = Cal.data.tasks, opts = {}) {
    const out = [];
    for (const t of tasks) {
      for (const ts of occurrences(t, from, to, opts)) {
        out.push({ task: t, ts });
      }
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  /** 即将到来（从现在起 N 个任务） */
  function upcoming(n = 5, fromTs = Date.now()) {
    const items = [];
    for (const t of Cal.data.tasks) {
      const next = nextOccurrence(t, fromTs);
      if (next != null) items.push({ task: t, ts: next });
    }
    items.sort((a, b) => a.ts - b.ts);
    return items.slice(0, n);
  }

  /** 今天的任务 */
  function today(date = new Date()) {
    const from = new Date(date); from.setHours(0, 0, 0, 0);
    const to = new Date(date); to.setHours(23, 59, 59, 999);
    return listInRange(from.getTime(), to.getTime());
  }

  // ===================== 完成 / 跳过 =====================
  function markDone(task, ts) {
    if (!task.repeat || task.repeat.type === "none") {
      task.done = true;
    } else {
      task.doneDates = task.doneDates || [];
      if (!task.doneDates.includes(ts)) task.doneDates.push(ts);
    }
    Cal.save();
  }
  function undoDone(task, ts) {
    if (!task.repeat || task.repeat.type === "none") task.done = false;
    else task.doneDates = (task.doneDates || []).filter((x) => x !== ts);
    Cal.save();
  }
  function skipOnce(task, ts) {
    task.exceptions = task.exceptions || [];
    if (!task.exceptions.includes(ts)) task.exceptions.push(ts);
    Cal.save();
  }

  // ===================== 倒计时格式化 =====================
  function fmtCountdown(ms) {
    const neg = ms < 0;
    ms = Math.abs(ms);
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    let str;
    if (d >= 1) str = `${d} 天 ${h} 小时`;
    else if (h >= 1) str = `${h} 小时 ${m} 分`;
    else if (m >= 1) str = `${m} 分 ${sec} 秒`;
    else str = `${sec} 秒`;
    return neg ? `已过期 ${str}` : `还有 ${str}`;
  }

  function fmtDateTime(ts, allDay) {
    const d = new Date(ts);
    const dateStr = d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
    if (allDay) return dateStr + " 全天";
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${dateStr} ${h}:${m}`;
  }

  // ===================== 重复规则摘要 =====================
  const WEEK_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
  function repeatLabel(r) {
    if (!r || r.type === "none") return "单次";
    const n = r.interval || 1;
    switch (r.type) {
      case "daily": return n === 1 ? "每天" : `每 ${n} 天`;
      case "weekly":
        if (r.weekDays?.length) {
          const days = [...r.weekDays].sort().map((d) => WEEK_NAMES[d]).join(" ");
          return (n === 1 ? "每周" : `每 ${n} 周`) + "（" + days + "）";
        }
        return n === 1 ? "每周" : `每 ${n} 周`;
      case "monthly": return n === 1 ? "每月" : `每 ${n} 个月`;
      case "yearly": return n === 1 ? "每年" : `每 ${n} 年`;
    }
    return "未知";
  }

  // ===================== 通知 =====================
  const notifyState = { timers: new Map(), permission: "default" };

  async function requestNotifyPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      notifyState.permission = Notification.permission;
      return Notification.permission;
    }
    const r = await Notification.requestPermission();
    notifyState.permission = r;
    return r;
  }

  /** 扫描未来 24h 内需要提醒的发生，安排 setTimeout */
  function scheduleReminders() {
    // 清理旧定时器
    for (const t of notifyState.timers.values()) clearTimeout(t);
    notifyState.timers.clear();
    if (!Cal.data.settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();
    const horizon = now + 24 * 3600 * 1000;
    for (const task of Cal.data.tasks) {
      const lead = (task.remindBefore || 0) * 60 * 1000; // minutes → ms
      for (const ts of occurrences(task, now - lead, horizon, { skipDone: true })) {
        const fireAt = ts - lead;
        const delay = fireAt - now;
        if (delay < 0 || delay > 24 * 3600 * 1000) continue;
        const key = task.id + "_" + ts;
        if (notifyState.timers.has(key)) continue;
        const timer = setTimeout(() => {
          try {
            // 天气提示注入
            let wBody = "";
            if (window.WeatherUtils) {
              const d = new Date(ts);
              const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const f = window.WeatherUtils.forecastForDate(ds);
              if (f) {
                const [emoji, desc] = window.WeatherUtils.wmo(f.code);
                const rain = (f.code >= 50 && f.code <= 99) || f.rainProb >= 60;
                const hot = f.max >= 32;
                const cold = f.min <= 0;
                wBody = `\n${emoji} ${desc} ${Math.round(f.min)}~${Math.round(f.max)}°`;
                if (rain) wBody += "，记得带伞 ☂";
                else if (hot) wBody += "，注意防晒 🕶";
                else if (cold) wBody += "，注意保暖 🧣";
              }
            }
            new Notification(`🌸 ${task.title}`, {
              body: (task.desc ? task.desc + "\n" : "") + "📅 " + fmtDateTime(ts, task.allDay) + wBody,
              tag: key,
              icon: "/icon.png",
            });
          } catch (_) {}
          notifyState.timers.delete(key);
        }, delay);
        notifyState.timers.set(key, timer);
      }
    }
  }

  // ===================== iCal (.ics) 导入 / 导出 =====================
  function icsEscape(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }
  function icsUnescape(s) {
    return String(s || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }
  function pad(n, w = 2) { return String(n).padStart(w, "0"); }
  function fmtIcsDate(ts, allDay) {
    const d = new Date(ts);
    if (allDay) return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    // 转为 UTC
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }
  function parseIcsDate(s, allDay) {
    // 20260420T140000Z or 20260420T140000 or 20260420
    if (!s) return NaN;
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
    if (!m) return NaN;
    const [, y, mo, d, h = 0, mi = 0, se = 0, z] = m;
    const Y = +y, M = +mo - 1, D = +d, H = +h, Mi = +mi, S = +se;
    if (allDay || (!h && !mi && !se && !z)) return new Date(Y, M, D).getTime();
    if (z) return Date.UTC(Y, M, D, H, Mi, S);
    return new Date(Y, M, D, H, Mi, S).getTime();
  }
  const BYDAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const DAY_TO_BY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  function rruleFromRepeat(r, startAt, allDay) {
    if (!r || r.type === "none") return null;
    const parts = ["FREQ=" + r.type.toUpperCase()];
    if (r.interval && r.interval > 1) parts.push("INTERVAL=" + r.interval);
    if (r.type === "weekly" && r.weekDays?.length) {
      parts.push("BYDAY=" + [...r.weekDays].sort().map((d) => DAY_TO_BY[d]).join(","));
    }
    if (r.until) parts.push("UNTIL=" + fmtIcsDate(r.until, allDay));
    if (r.count) parts.push("COUNT=" + r.count);
    return parts.join(";");
  }
  function rruleToRepeat(rrule) {
    if (!rrule) return { type: "none", interval: 1 };
    const kv = {};
    rrule.split(";").forEach((p) => { const [k, v] = p.split("="); kv[k.toUpperCase()] = v; });
    const freq = (kv.FREQ || "").toUpperCase();
    const typeMap = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };
    const r = { type: typeMap[freq] || "none", interval: +kv.INTERVAL || 1 };
    if (kv.BYDAY) r.weekDays = kv.BYDAY.split(",").map((x) => BYDAY_MAP[x.trim().slice(-2)]).filter((x) => x != null);
    if (kv.UNTIL) r.until = parseIcsDate(kv.UNTIL);
    if (kv.COUNT) r.count = +kv.COUNT;
    return r;
  }

  function exportIcs(tasks = Cal.data.tasks) {
    const now = fmtIcsDate(Date.now(), false);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Sakura Nav//Calendar//ZH",
      "CALSCALE:GREGORIAN",
    ];
    for (const t of tasks) {
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + t.id + "@sakura-nav");
      lines.push("DTSTAMP:" + now);
      if (t.allDay) {
        lines.push("DTSTART;VALUE=DATE:" + fmtIcsDate(t.startAt, true));
        const endDate = new Date(t.startAt); endDate.setDate(endDate.getDate() + 1);
        lines.push("DTEND;VALUE=DATE:" + fmtIcsDate(endDate.getTime(), true));
      } else {
        lines.push("DTSTART:" + fmtIcsDate(t.startAt, false));
        lines.push("DTEND:" + fmtIcsDate(t.startAt + 3600 * 1000, false));
      }
      lines.push("SUMMARY:" + icsEscape(t.title));
      if (t.desc) lines.push("DESCRIPTION:" + icsEscape(t.desc));
      const rr = rruleFromRepeat(t.repeat, t.startAt, t.allDay);
      if (rr) lines.push("RRULE:" + rr);
      if (t.remindBefore) {
        lines.push("BEGIN:VALARM");
        lines.push("TRIGGER:-PT" + t.remindBefore + "M");
        lines.push("ACTION:DISPLAY");
        lines.push("DESCRIPTION:" + icsEscape(t.title));
        lines.push("END:VALARM");
      }
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function importIcs(text) {
    // 处理折行 (RFC 5545)
    const raw = text.replace(/\r?\n[ \t]/g, "");
    const lines = raw.split(/\r?\n/);
    const events = [];
    let cur = null;
    let inAlarm = false;
    let alarmTrigger = null;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") { cur = {}; }
      else if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
      else if (line === "BEGIN:VALARM") { inAlarm = true; alarmTrigger = null; }
      else if (line === "END:VALARM") {
        inAlarm = false;
        if (cur && alarmTrigger) cur._alarm = alarmTrigger;
      }
      else if (cur) {
        const m = line.match(/^([A-Z0-9-]+)(;[^:]*)?:(.*)$/);
        if (!m) continue;
        const [, key, params = "", val] = m;
        if (inAlarm) {
          if (key === "TRIGGER") {
            const mt = val.match(/-?PT?(\d+)M/i) || val.match(/-P(\d+)D/i);
            if (mt) alarmTrigger = +mt[1] * (val.includes("D") ? 1440 : 1);
          }
          continue;
        }
        if (key === "SUMMARY") cur.title = icsUnescape(val);
        else if (key === "DESCRIPTION") cur.desc = icsUnescape(val);
        else if (key === "UID") cur.uid = val;
        else if (key === "DTSTART") {
          cur.allDay = /VALUE=DATE(?!-TIME)/i.test(params);
          cur.startAt = parseIcsDate(val, cur.allDay);
        } else if (key === "RRULE") cur.rrule = val;
      }
    }
    const out = [];
    for (const ev of events) {
      if (!ev.title || !ev.startAt) continue;
      out.push({
        id: uid(),
        title: ev.title,
        desc: ev.desc || "",
        startAt: ev.startAt,
        allDay: !!ev.allDay,
        color: "#ff8fab",
        repeat: rruleToRepeat(ev.rrule),
        exceptions: [],
        doneDates: [],
        done: false,
        remindBefore: ev._alarm || 0,
        tags: ["iCal"],
        createdAt: Date.now(),
      });
    }
    return out;
  }

  // ===================== 统计 =====================
  function stats() {
    const now = Date.now();
    const DAY_MS = 86400000;
    // 本周范围（周一起）
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    const wd = (today.getDay() + 6) % 7; // 周一 = 0
    weekStart.setDate(today.getDate() - wd);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    function ratioInRange(from, to) {
      let total = 0, done = 0;
      for (const t of Cal.data.tasks) {
        for (const ts of occurrences(t, from, to - 1, {})) {
          if (ts > now) continue; // 只算已过发生
          total++;
          if (isDoneOccurrence(t, ts)) done++;
        }
      }
      return { total, done, ratio: total ? done / total : 0 };
    }
    const week = ratioInRange(weekStart.getTime(), weekEnd.getTime());
    const month = ratioInRange(monthStart.getTime(), monthEnd.getTime());

    // 本月每天完成数（30 天趋势）
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const from = d.getTime();
      const to = from + DAY_MS;
      let total = 0, done = 0;
      for (const t of Cal.data.tasks) {
        for (const ts of occurrences(t, from, to - 1, {})) {
          if (ts > now) continue;
          total++;
          if (isDoneOccurrence(t, ts)) done++;
        }
      }
      days.push({ date: d, total, done });
    }

    // 连续打卡：今天或昨天开始，向前数 "有任务且全部完成" 的连续天数
    let streak = 0;
    let cursor = new Date(today);
    if (days[days.length - 1].total === 0) cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      const from = cursor.getTime();
      const to = from + DAY_MS;
      let t = 0, d = 0;
      for (const tk of Cal.data.tasks) {
        for (const ts of occurrences(tk, from, to - 1, {})) {
          if (ts > now) continue;
          t++;
          if (isDoneOccurrence(tk, ts)) d++;
        }
      }
      if (t === 0) { cursor.setDate(cursor.getDate() - 1); continue; }
      if (d === t) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else break;
    }

    // 总计
    const totalTasks = Cal.data.tasks.length;
    const totalCompleted = Cal.data.tasks.reduce((a, t) => a + ((t.doneDates || []).length + (t.done ? 1 : 0)), 0);

    return { week, month, days, streak, totalTasks, totalCompleted };
  }

  // ===================== 月历网格 =====================
  function monthGrid(year, month, firstDayOfWeek = 1) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() - firstDayOfWeek + 7) % 7;
    const start = new Date(year, month, 1 - offset);
    start.setHours(0, 0, 0, 0);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      cells.push({ date: d, inMonth: d.getMonth() === month });
    }
    return cells;
  }

  // ===================== 对外 =====================
  window.Cal = Cal;
  window.CalUtils = {
    step,
    occurrences,
    nextOccurrence,
    listInRange,
    upcoming,
    today,
    isExcepted,
    isDoneOccurrence,
    markDone,
    undoDone,
    skipOnce,
    fmtCountdown,
    fmtDateTime,
    repeatLabel,
    requestNotifyPermission,
    scheduleReminders,
    monthGrid,
    exportIcs,
    importIcs,
    stats,
    WEEK_NAMES,
    uid,
  };
})();
