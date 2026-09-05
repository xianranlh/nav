/* 闲然导航 · 宠物显式事件总线
 * 业务模块派发 nav:* 事件；宠物只订阅状态，不观察 UI class。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.window === root) root.SakuraPetEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const PRIORITY = {
    idle: 0,
    done: 10,
    syncing: 20,
    waiting: 25,
    thinking: 30,
    working: 30,
    error: 40,
    offline: 50,
  };

  const EVENT_MAP = {
    "nav:ai:start": { source: "ai", status: "thinking", detail: "AI 回复中" },
    "nav:ai:done": { source: "ai", status: "done", detail: "AI 完成", ttl: 2600 },
    "nav:ai:error": { source: "ai", status: "error", detail: "AI 出错", ttl: 3200 },
    "nav:sync:start": { source: "sync", status: "syncing", detail: "同步数据" },
    "nav:sync:done": { source: "sync", status: "done", detail: "已同步", ttl: 1800 },
    "nav:sync:error": { source: "sync", status: "error", detail: "同步失败", ttl: 3000 },
    "nav:knowledge:index-start": { source: "knowledge", status: "syncing", detail: "正在整理知识" },
    "nav:knowledge:index-done": { source: "knowledge", status: "done", detail: "知识索引完成", ttl: 2200 },
    "nav:knowledge:search": { source: "knowledge", status: "working", detail: "正在检索知识", ttl: 3000 },
    "nav:knowledge:open": { source: "knowledge", status: "done", detail: "已打开笔记", ttl: 1600 },
    "nav:knowledge:capture": { source: "knowledge", status: "done", detail: "已放进 Inbox", ttl: 2200 },
    "nav:knowledge:error": { source: "knowledge", status: "error", detail: "知识服务异常", ttl: 3000 },
    "nav:network:offline": { source: "network", status: "offline", detail: "网络离线" },
    "nav:network:online": { source: "network", status: "done", detail: "已恢复联网", ttl: 2000, clear: true },
  };

  class PetStatusBus {
    constructor({
      target = null,
      now = () => Date.now(),
      setTimer = (fn, ms) => root.setTimeout(fn, ms),
      clearTimer = (id) => root.clearTimeout(id),
    } = {}) {
      this.target = target;
      this.now = now;
      this.setTimer = setTimer;
      this.clearTimer = clearTimer;
      this.entries = new Map();
      this.timers = new Map();
      this.subscribers = new Set();
      this.lastEvent = new Map();
      this.current = { status: "idle", detail: "" };
    }

    get() {
      return { ...this.current };
    }

    on(fn) {
      this.subscribers.add(fn);
      return () => this.subscribers.delete(fn);
    }

    set(status, detail = "", options = {}) {
      const normalized = Object.prototype.hasOwnProperty.call(PRIORITY, status) ? status : "idle";
      const source = String(options.source || "manual");
      this.clearTimer(this.timers.get(source));
      this.timers.delete(source);
      if (normalized === "idle") this.entries.delete(source);
      else this.entries.set(source, { status: normalized, detail: String(detail || ""), at: this.now() });
      if (Number(options.ttl) > 0) {
        this.timers.set(source, this.setTimer(() => {
          this.entries.delete(source);
          this.timers.delete(source);
          this._emit();
        }, Number(options.ttl)));
      }
      this._emit();
    }

    pulse(status, detail = "", ms = 2800) {
      this.set(status, detail, { source: "manual", ttl: ms });
    }

    clear(source) {
      const key = String(source || "manual");
      this.clearTimer(this.timers.get(key));
      this.timers.delete(key);
      this.entries.delete(key);
      this._emit();
    }

    handle(name, detail = {}) {
      const meta = EVENT_MAP[name];
      if (!meta) return false;
      const dedupeKey = `${name}\0${String(detail?.detail || "")}`;
      const last = this.lastEvent.get(dedupeKey) || 0;
      if (meta.ttl && last > 0 && this.now() - last < 3000) return false;
      this.lastEvent.set(dedupeKey, this.now());
      if (meta.clear) this.clear(meta.source);
      let status = meta.status;
      let text = String(detail?.detail || meta.detail || "");
      if (name === "nav:ai:start" && detail?.mode === "image") {
        status = "working";
        text = "生图中";
      }
      this.set(status, text, { source: meta.source, ttl: detail?.ttl || meta.ttl || 0 });
      return true;
    }

    _emit() {
      const active = [...this.entries.values()].sort((a, b) => {
        return (PRIORITY[b.status] || 0) - (PRIORITY[a.status] || 0) || b.at - a.at;
      })[0];
      const next = active ? { status: active.status, detail: active.detail } : { status: "idle", detail: "" };
      if (next.status === this.current.status && next.detail === this.current.detail) return;
      this.current = next;
      for (const fn of this.subscribers) {
        try { fn(this.get()); } catch (_) {}
      }
      if (this.target && typeof this.target.dispatchEvent === "function") {
        try { this.target.dispatchEvent(new root.CustomEvent("sakura-pet-status", { detail: this.get() })); } catch (_) {}
      }
    }
  }

  const bus = new PetStatusBus({ target: root && root.window === root ? root : null });
  if (root && root.window === root && typeof root.addEventListener === "function") {
    for (const name of Object.keys(EVENT_MAP)) {
      root.addEventListener(name, (event) => bus.handle(name, event.detail || {}));
    }
  }

  function emit(name, detail = {}) {
    if (root && root.window === root && typeof root.dispatchEvent === "function") {
      root.dispatchEvent(new root.CustomEvent(name, { detail }));
    } else {
      bus.handle(name, detail);
    }
  }

  return { PRIORITY, EVENT_MAP, PetStatusBus, bus, emit };
});
