/* 樱 · 待办事项 (v1.19.5)
 * 极简 todo list：勾选 / 拖拽排序 / 删除 / 编辑；
 * 可选"同步到日历"：勾选后写入 Cal.data.tasks 作为对应日期的一次性任务，
 * 反向只读（不会自动从日历回写到 todo，保持轻量）。
 *
 * 存储：localStorage key "sakura_nav_todos_v1"，结构 { items: [...] }
 *   item = { id, text, done, doneAt?, dueDate?, syncToCal, calTaskId?, color?, createdAt, order }
 */
(function () {
  "use strict";
  const KEY = "sakura_nav_todos_v1";

  const Todo = {
    data: { items: [] },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.items)) {
            this.data = parsed;
            return;
          }
        }
      } catch (_) {}
      this.data = { items: [] };
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (_) {}
    },

    add(text, opts = {}) {
      const id = "todo-" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
      const item = {
        id,
        text: String(text || "").trim() || "新待办",
        done: false,
        dueDate: opts.dueDate || "", // YYYY-MM-DD
        syncToCal: !!opts.syncToCal,
        color: opts.color || "#a6c6ff",
        createdAt: Date.now(),
        order: this.data.items.length,
      };
      this.data.items.push(item);
      if (item.syncToCal && item.dueDate) this._syncToCalendar(item);
      this.save();
      return item;
    },

    update(id, patch) {
      const it = this.data.items.find((x) => x.id === id);
      if (!it) return;
      const prevSync = it.syncToCal;
      const prevDate = it.dueDate;
      Object.assign(it, patch);
      // 联动维护
      const needCal = it.syncToCal && it.dueDate;
      if (needCal) {
        this._syncToCalendar(it);
      } else if (prevSync && it.calTaskId) {
        this._removeFromCalendar(it);
      }
      this.save();
    },

    toggleDone(id) {
      const it = this.data.items.find((x) => x.id === id);
      if (!it) return;
      it.done = !it.done;
      it.doneAt = it.done ? Date.now() : null;
      // 同步到日历的任务也勾上 done
      if (it.calTaskId && window.Cal && Cal.data?.tasks) {
        const t = Cal.data.tasks.find((tt) => tt.id === it.calTaskId);
        if (t) {
          t.done = it.done;
          try { Cal.save && Cal.save(); } catch (_) {}
        }
      }
      this.save();
    },

    remove(id) {
      const idx = this.data.items.findIndex((x) => x.id === id);
      if (idx < 0) return;
      const it = this.data.items[idx];
      if (it.calTaskId) this._removeFromCalendar(it);
      this.data.items.splice(idx, 1);
      this.save();
    },

    reorder(newIds) {
      const map = new Map(this.data.items.map((x) => [x.id, x]));
      const next = [];
      newIds.forEach((id, i) => { const it = map.get(id); if (it) { it.order = i; next.push(it); } });
      // 兜底没出现的 id
      for (const [, it] of map) if (!next.includes(it)) next.push(it);
      this.data.items = next;
      this.save();
    },

    /** 待办 → 日历：在 Cal.data.tasks 里 upsert 一条 */
    _syncToCalendar(item) {
      if (!window.Cal || !Cal.data) return;
      const ts = this._dueDateToTs(item.dueDate);
      if (!ts) return;
      Cal.data.tasks = Cal.data.tasks || [];
      let task = item.calTaskId ? Cal.data.tasks.find((t) => t.id === item.calTaskId) : null;
      if (!task) {
        task = {
          id: "task-from-todo-" + item.id,
          title: "📝 " + item.text,
          desc: "（来自待办事项）",
          startAt: ts,
          allDay: true,
          color: item.color || "#a6c6ff",
          repeat: { type: "none" },
          remindBefore: 0,
          done: !!item.done,
        };
        Cal.data.tasks.push(task);
        item.calTaskId = task.id;
      } else {
        task.title = "📝 " + item.text;
        task.startAt = ts;
        task.color = item.color || task.color;
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

    _dueDateToTs(ymd) {
      const m = (ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return 0;
      const d = new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0);
      return d.getTime();
    },

    /** 排序：未完成置顶，按 order 升序；已完成按完成时间倒序排底部 */
    sorted() {
      const open = this.data.items.filter((x) => !x.done).sort((a, b) => (a.order || 0) - (b.order || 0));
      const done = this.data.items.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      return [...open, ...done];
    },

    /** 简单统计：未完成数 */
    pendingCount() { return this.data.items.filter((x) => !x.done).length; },
  };

  window.Todo = Todo;
})();
