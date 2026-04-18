/* 樱 · 博客模块
 * 数据：localStorage["sakura_nav_blog_v1"]
 * 功能：帖子增删改查、Markdown、标签筛选、后台管理、草稿/发布、导入导出
 */
(function () {
  "use strict";
  const BLOG_KEY = "sakura_nav_blog_v1";

  const Blog = {
    data: {
      posts: [],              // [{ id, title, content, tags:[], cover, createdAt, updatedAt, published }]
      adminMode: false,
    },

    load() {
      try {
        const raw = localStorage.getItem(BLOG_KEY);
        if (raw) Object.assign(this.data, JSON.parse(raw));
      } catch (_) {}
      if (!Array.isArray(this.data.posts)) this.data.posts = [];
      if (!this.data.posts.length) this.seed();
    },

    save() { localStorage.setItem(BLOG_KEY, JSON.stringify(this.data)); },

    seed() {
      this.data.posts = [
        {
          id: uid(),
          title: "欢迎使用樱 · 博客",
          content:
            "# 欢迎 🌸\n\n这是内置的示例博客。你可以在 **后台管理** 里编辑、删除、或发布新文章。\n\n" +
            "## 功能\n\n- 完全本地存储，无需服务器\n- 支持 Markdown（标题、列表、代码、链接、图片）\n- 标签筛选、搜索、封面图\n- AI 可以帮你写草稿\n\n" +
            "## 小技巧\n\n1. 点击右下角 🤖 打开 AI，让它帮你写一篇文章，然后把内容粘贴进编辑器\n" +
            "2. 支持拖拽图片自动转 Markdown\n\n```js\nconsole.log('Hello from 樱');\n```",
          tags: ["公告", "欢迎"],
          cover: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          published: true,
        },
      ];
      this.save();
    },

    list({ tag, query, includeDraft } = {}) {
      let arr = this.data.posts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (!includeDraft) arr = arr.filter((p) => p.published);
      if (tag) arr = arr.filter((p) => (p.tags || []).includes(tag));
      if (query) {
        const q = query.toLowerCase();
        arr = arr.filter((p) =>
          (p.title || "").toLowerCase().includes(q) ||
          (p.content || "").toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      }
      return arr;
    },

    get(id) { return this.data.posts.find((p) => p.id === id); },

    create(partial) {
      const now = Date.now();
      const post = Object.assign({
        id: uid(),
        title: "无标题",
        content: "",
        tags: [],
        cover: "",
        createdAt: now,
        updatedAt: now,
        published: false,
      }, partial || {});
      this.data.posts.unshift(post);
      this.save();
      return post;
    },

    update(id, patch) {
      const p = this.get(id);
      if (!p) return null;
      Object.assign(p, patch, { updatedAt: Date.now() });
      this.save();
      return p;
    },

    remove(id) {
      this.data.posts = this.data.posts.filter((p) => p.id !== id);
      this.save();
    },

    allTags() {
      const s = new Set();
      for (const p of this.data.posts) (p.tags || []).forEach((t) => s.add(t));
      return [...s];
    },

    exportJson() {
      return JSON.stringify(this.data, null, 2);
    },

    importJson(text) {
      const d = JSON.parse(text);
      if (!Array.isArray(d.posts)) throw new Error("格式不正确");
      this.data = Object.assign({ posts: [], adminMode: false }, d);
      this.save();
    },
  };

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  window.Blog = Blog;
})();
