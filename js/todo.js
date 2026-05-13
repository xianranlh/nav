/* 樱 · 提醒事项（Mac Reminders 风格） v1.20.0
 * 双层数据模型：lists（用户列表 + 内置智能列表）+ items
 *
 *  lists: [{ id, name, emoji, color, builtin: false, order, hidden?: false }]
 *  items: [{
 *    id, listId, text, notes,
 *    done, doneAt,
 *    dueDate (YYYY-MM-DD), dueTime (HH:mm), remindAt (ms),
 *    priority (0|1|2|3 = 无|低|中|高),
 *    flagged, tags[], url,
 *    parentId, subOrder,
 *    order, syncToCal, calTaskId,
 *    createdAt, updatedAt
 *  }]
 *
 *  存储：localStorage key = "sakura_nav_todos_v2"（v1.19.5 的 v1 老数据自动迁移）
 *  对外：window.Todo
 */
(function () {
  "use strict";
  const KEY = "sakura_nav_todos_v2";
  const LEGACY_KEY = "sakura_nav_todos_v1";

  // 内置智能列表
  const SMART = {
    today:     { id: "smart-today",     emoji: "📅", name: "今天",     color: "#0a84ff" },
    scheduled: { id: "smart-scheduled", emoji: "📆", name: "计划",     color: "#ff453a" },
    all:       { id: "smart-all",       emoji: "📋", name: "全部",     color: "#8e8e93" },
    flagged:   { id: "smart-flagged",   emoji: "🚩", name: "已标记",   color: "#ff9f0a" },
    completed: { id: "smart-completed", emoji: "✅", name: "已完成",   color: "#30d158" },
  };

  function uid(prefix) {
    return (prefix || "id") + "-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function pad2(n) { return String(n).padStart(2, "0"); }

  const Todo = {
    data: {
      lists: [
        // 默认提供一个"提醒"列表
        { id: "list-default", name: "提醒事项", emoji: "🌸", color: "#ff6b8a", order: 0 },
      ],
      items: [],
      activeListId: "smart-today",
      activeFilter: "",
    },

    SMART,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.lists) && Array.isArray(parsed.items)) {
            this.data = Object.assign(this.data, parsed);
            this._normalize();
            return;
          }
        }
        // 老格式迁移：v1 只有 items 没有 lists
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (parsed && Array.isArray(parsed.items)) {
            this.data.items = parsed.items.map((it) => ({
              id: it.id || uid("todo"),
              listId: "list-default",
              text: it.text || "",
              notes: "",
              done: !!it.done,
              doneAt: it.doneAt || null,
              dueDate: it.dueDate || "",
              dueTime: "",
              remindAt: 0,
              priority: 0,
              flagged: false,
              tags: [],
              url: "",
              parentId: null,
              subOrder: 0,
              order: it.order || 0,
              syncToCal: !!it.syncToCal,
              calTaskId: it.calTaskId || null,
              createdAt: it.createdAt || Date.now(),
              updatedAt: Date.now(),
              color: it.color || "",
            }));
            this.save();
            return;
          }
        }
      } catch (_) {}
      this._normalize();
    },

    _normalize() {
      if (!Array.isArray(this.data.lists)) this.data.lists = [];
      if (!Array.isArray(this.data.items)) this.data.items = [];
      if (!this.data.lists.length) {
        this.data.lists.push({ id: "list-default", name: "提醒事项", emoji: "🌸", color: "#ff6b8a", order: 0 });
      }
      // 老 active 不存在了 fallback 到今天
      if (this.data.activeListId && !this._listExists(this.data.activeListId)) {
        this.data.activeListId = "smart-today";
      }
      // item 字段补齐
      for (const it of this.data.items) {
        if (typeof it.priority !== "number") it.priority = 0;
        if (typeof it.flagged !== "boolean") it.flagged = false;
        if (!Array.isArray(it.tags)) it.tags = [];
        if (!it.dueTime) it.dueTime = "";
        if (!it.notes) it.notes = "";
        if (!it.url) it.url = "";
        if (typeof it.parentId !== "string" && it.parentId !== null) it.parentId = null;
      }
    },

    _listExists(id) {
      return id.startsWith("smart-") || id.startsWith("tag:") || this.data.lists.some((l) => l.id === id);
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (_) {}
    },

    // -------- Lists --------
    addList({ name, emoji = "🗒", color = "#7c83fa" }) {
      const list = { id: uid("list"), name: String(name).trim() || "新列表", emoji, color, order: this.data.lists.length };
      this.data.lists.push(list);
      this.save();
      return list;
    },
    updateList(id, patch) {
      const l = this.data.lists.find((x) => x.id === id);
      if (!l) return;
      Object.assign(l, patch);
      this.save();
    },
    removeList(id) {
      const idx = this.data.lists.findIndex((x) => x.id === id);
      if (idx < 0) return;
      // 同时删掉这个 list 下的所有 item（包括日历副本）
      const remain = [];
      for (const it of this.data.items) {
        if (it.listId === id) { if (it.calTaskId) this._removeFromCalendar(it); }
        else remain.push(it);
      }
      this.data.items = remain;
      this.data.lists.splice(idx, 1);
      if (this.data.activeListId === id) this.data.activeListId = "smart-today";
      this.save();
    },

    // -------- Items --------
    addItem({ text, listId, dueDate = "", dueTime = "", priority = 0, syncToCal = false }) {
      const item = {
        id: uid("todo"),
        listId: listId || this._resolveAddListId(),
        text: String(text || "").trim() || "新提醒",
        notes: "",
        done: false,
        doneAt: null,
        dueDate, dueTime,
        remindAt: 0,
        priority,
        flagged: false,
        tags: [],
        url: "",
        parentId: null,
        subOrder: 0,
        order: this.data.items.length,
        syncToCal,
        calTaskId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.data.items.push(item);
      if (item.syncToCal && item.dueDate) this._syncToCalendar(item);
      this.save();
      return item;
    },

    /** 智能列表上 + 时不知道 listId，落到上一次访问的"真实"列表或第一个用户列表 */
    _resolveAddListId() {
      const a = this.data.activeListId || "";
      if (a && !a.startsWith("smart-")) return a;
      return this.data.lists[0]?.id || "list-default";
    },

    update(id, patch) {
      const it = this.data.items.find((x) => x.id === id);
      if (!it) return;
      const prevSync = it.syncToCal;
      Object.assign(it, patch, { updatedAt: Date.now() });
      const needCal = it.syncToCal && it.dueDate;
      if (needCal) this._syncToCalendar(it);
      else if (prevSync && it.calTaskId) this._removeFromCalendar(it);
      this.save();
    },

    toggleDone(id) {
      const it = this.data.items.find((x) => x.id === id);
      if (!it) return;
      it.done = !it.done;
      it.doneAt = it.done ? Date.now() : null;
      // 同步到日历的副本也勾上
      if (it.calTaskId && window.Cal && Cal.data?.tasks) {
        const t = Cal.data.tasks.find((tt) => tt.id === it.calTaskId);
        if (t) { t.done = it.done; try { Cal.save && Cal.save(); } catch (_) {} }
      }
      // 子任务：父项 done 时所有子任务也 done
      if (it.done) {
        for (const c of this.data.items.filter((x) => x.parentId === it.id)) {
          c.done = true; c.doneAt = Date.now();
          if (c.calTaskId && window.Cal && Cal.data?.tasks) {
            const t2 = Cal.data.tasks.find((tt) => tt.id === c.calTaskId);
            if (t2) { t2.done = true; }
          }
        }
        try { Cal.save && Cal.save(); } catch (_) {}
      }
      this.save();
    },

    toggleFlag(id) {
      const it = this.data.items.find((x) => x.id === id);
      if (!it) return;
      it.flagged = !it.flagged;
      it.updatedAt = Date.now();
      this.save();
    },

    remove(id) {
      // 同时删子任务
      const ids = [id, ...this.data.items.filter((x) => x.parentId === id).map((x) => x.id)];
      for (const xid of ids) {
        const it = this.data.items.find((x) => x.id === xid);
        if (it?.calTaskId) this._removeFromCalendar(it);
      }
      this.data.items = this.data.items.filter((x) => !ids.includes(x.id));
      this.save();
    },

    reorder(listId, newIds) {
      const inList = new Map(this.data.items.filter((x) => x.listId === listId).map((x) => [x.id, x]));
      newIds.forEach((id, i) => { const it = inList.get(id); if (it) it.order = i; });
      this.save();
    },

    /** 切换 active 列表 */
    setActiveList(id) {
      if (!this._listExists(id)) return;
      this.data.activeListId = id;
      this.save();
    },

    /** 当前 active 列表对应的过滤 + 排序后 items；只返回 parentId=null 的项，子任务由 UI 单独取 */
    activeItems() {
      const id = this.data.activeListId;
      const filter = (this.data.activeFilter || "").trim().toLowerCase();
      const matchSearch = (it) => !filter || (it.text + " " + it.notes).toLowerCase().includes(filter);
      let pool;
      if (id && id.startsWith("tag:")) {
        const t = id.slice(4);
        pool = this.data.items.filter((it) => !it.done && (it.tags || []).includes(t));
      } else if (id === "smart-today") {
        const today = todayStr();
        pool = this.data.items.filter((it) => !it.done && it.dueDate && it.dueDate <= today);
      } else if (id === "smart-scheduled") {
        pool = this.data.items.filter((it) => !it.done && it.dueDate);
      } else if (id === "smart-all") {
        pool = this.data.items.filter((it) => !it.done);
      } else if (id === "smart-flagged") {
        pool = this.data.items.filter((it) => !it.done && it.flagged);
      } else if (id === "smart-completed") {
        pool = this.data.items.filter((it) => it.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      } else {
        pool = this.data.items.filter((it) => it.listId === id);
      }
      pool = pool.filter((it) => !it.parentId && matchSearch(it));
      // 排序：未完成 → priority desc → due date asc → order asc；已完成放最后按完成时间倒序
      if (id === "smart-completed") return pool;
      return pool.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        const ad = a.dueDate || "9999-99-99";
        const bd = b.dueDate || "9999-99-99";
        if (ad !== bd) return ad < bd ? -1 : 1;
        return (a.order || 0) - (b.order || 0);
      });
    },

    childrenOf(parentId) {
      return this.data.items.filter((x) => x.parentId === parentId).sort((a, b) => (a.subOrder || 0) - (b.subOrder || 0));
    },

    /** 各个智能列表 / 用户列表的 count（未完成） */
    counts() {
      const today = todayStr();
      const items = this.data.items;
      const out = {
        "smart-today": items.filter((x) => !x.done && x.dueDate && x.dueDate <= today).length,
        "smart-scheduled": items.filter((x) => !x.done && x.dueDate).length,
        "smart-all": items.filter((x) => !x.done).length,
        "smart-flagged": items.filter((x) => !x.done && x.flagged).length,
        "smart-completed": items.filter((x) => x.done).length,
      };
      for (const l of this.data.lists) {
        out[l.id] = items.filter((x) => x.listId === l.id && !x.done).length;
      }
      return out;
    },

    // -------- 模板（v1.20.3） --------
    TEMPLATES: [
      { id: "shopping",  name: "购物清单", emoji: "🛒", color: "#ff9f0a", items: [
        "牛奶 / 酸奶", "鸡蛋 · 1 板", "全麦面包", "水果（苹果 / 香蕉）", "蔬菜（番茄 / 黄瓜）", "纸巾 / 抽纸",
      ]},
      { id: "week-plan", name: "本周计划", emoji: "📅", color: "#0a84ff", items: [
        { text: "周一 · 设定目标", priority: 2 },
        { text: "周三 · 中期复盘", priority: 1 },
        { text: "周五 · 总结一周",  priority: 2 },
        { text: "周末 · 放松 & 充电", priority: 0 },
      ]},
      { id: "travel-pack", name: "旅行打包", emoji: "🧳", color: "#bf5af2", items: [
        { text: "护照 / 身份证", priority: 3 },
        "充电器 + 转换头 + 充电宝",
        "换洗衣物（按天数 +1）",
        "洗漱用品 + 化妆品",
        "常用药品（感冒 / 肠胃 / 创可贴）",
        "旅行保险 + 行程单",
        "现金 + 银行卡",
        "雨伞 / 防晒霜",
      ]},
      { id: "fitness",   name: "健身周",   emoji: "🏃", color: "#30d158", items: [
        "周一 · 胸 + 三头", "周二 · 有氧 30 min", "周三 · 背 + 二头",
        "周四 · 腿", "周五 · 肩 + 核心", "周末 · 拉伸 & 恢复",
      ]},
      { id: "project",   name: "项目 Sprint", emoji: "💼", color: "#7c83fa", items: [
        { text: "需求评审", priority: 2 },
        { text: "技术方案",  priority: 2 },
        { text: "拆任务",    priority: 1 },
        "开发",
        "联调",
        "测试",
        { text: "上线", priority: 3 },
        "复盘",
      ]},
      { id: "reading",   name: "阅读清单", emoji: "📚", color: "#ff6b8a", items: [
        "本月想读的书：", "推荐文章 / 收藏夹",
      ]},
    ],

    /** 用模板创建一个列表 + 一堆 items；返回新建的 list */
    createFromTemplate(tplId) {
      const tpl = this.TEMPLATES.find((t) => t.id === tplId);
      if (!tpl) return null;
      const list = this.addList({ name: tpl.name, emoji: tpl.emoji, color: tpl.color });
      for (const raw of tpl.items) {
        const it = typeof raw === "string" ? { text: raw } : raw;
        this.addItem({
          listId: list.id,
          text: it.text,
          priority: it.priority || 0,
          dueDate: it.dueDate || "",
        });
      }
      this.setActiveList(list.id);
      return list;
    },

    /** 当前所有 tags 的计数（按 use count desc） */
    tagCounts() {
      const map = new Map();
      for (const it of this.data.items) {
        if (it.done) continue;
        for (const t of (it.tags || [])) {
          map.set(t, (map.get(t) || 0) + 1);
        }
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    },

    /** 列表完成进度 0-1（已完成 / 总数）。智能列表用 activeItems 计算前忽略此函数 */
    listProgress(listId) {
      const all = this.data.items.filter((x) => x.listId === listId);
      if (!all.length) return { done: 0, total: 0, pct: 0 };
      const done = all.filter((x) => x.done).length;
      return { done, total: all.length, pct: done / all.length };
    },

    /** 给已存在的列表批量加 items（AI 生成时用） */
    addManyItems(listId, items) {
      for (const raw of items || []) {
        const it = typeof raw === "string" ? { text: raw } : raw;
        if (!it.text) continue;
        this.addItem({
          listId,
          text: it.text,
          priority: it.priority || 0,
          dueDate: it.dueDate || "",
          syncToCal: !!it.syncToCal,
        });
      }
    },

    // -------- 与日历联动 --------
    _syncToCalendar(item) {
      if (!window.Cal || !Cal.data) return;
      const ts = this._dueToTs(item);
      if (!ts) return;
      Cal.data.tasks = Cal.data.tasks || [];
      let task = item.calTaskId ? Cal.data.tasks.find((t) => t.id === item.calTaskId) : null;
      if (!task) {
        task = {
          id: "task-from-todo-" + item.id,
          title: "📝 " + item.text,
          desc: (item.notes || "") + "\n（来自提醒事项）",
          startAt: ts,
          allDay: !item.dueTime,
          color: this._priorityColor(item) || "#a6c6ff",
          repeat: { type: "none" },
          remindBefore: 0,
          done: !!item.done,
        };
        Cal.data.tasks.push(task);
        item.calTaskId = task.id;
      } else {
        task.title = "📝 " + item.text;
        task.startAt = ts;
        task.allDay = !item.dueTime;
        task.color = this._priorityColor(item) || task.color;
        task.done = !!item.done;
      }
      try { Cal.save && Cal.save(); } catch (_) {}
    },

    _removeFromCalendar(item) {
      if (!window.Cal || !Cal.data?.tasks || !item.calTaskId) return;
      const i = Cal.data.tasks.findIndex((t) => t.id === item.calTaskId);
      if (i >= 0) Cal.data.tasks.splice(i, 1);
      delete item.calTaskId;
      try { Cal.save && Cal.save(); } catch (_) {}
    },

    _dueToTs(item) {
      if (!item.dueDate) return 0;
      const m = item.dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return 0;
      let h = 9, mi = 0;
      if (item.dueTime) {
        const t = item.dueTime.match(/^(\d{1,2}):(\d{2})$/);
        if (t) { h = +t[1]; mi = +t[2]; }
      }
      return new Date(+m[1], +m[2] - 1, +m[3], h, mi).getTime();
    },

    _priorityColor(item) {
      if (item.priority === 3) return "#ff453a";
      if (item.priority === 2) return "#ff9f0a";
      if (item.priority === 1) return "#0a84ff";
      // 没有优先级时用所属列表色
      const list = this.data.lists.find((l) => l.id === item.listId);
      return list?.color || "";
    },

    todayStr,
    pad2,
    uid,
  };

  window.Todo = Todo;
})();
