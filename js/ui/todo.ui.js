/* ✅ 提醒事项 UI (Mac Reminders 风格) — 自 app.js 拆分
 * 逻辑层：js/todo.js (window.Todo)
 * 由 app.js 通过 window.TodoUIFactory(UIContext) 实例化，实例化顺序与拆分前一致。
 */
(function () {
  "use strict";

  window.TodoUIFactory = function (ctx) {
    const { $, escapeHtml, toast } = ctx;
    const dlg = $("#dialog-todo");
    const dlgEditList = $("#dialog-rem-list");
    const smartGrid = $("#rem-smart-grid");
    const listNav = $("#rem-list-nav");
    const itemsEl = $("#rem-items");
    const emptyEl = $("#rem-empty");
    const mainEmoji = dlg.querySelector(".rem-main-emoji");
    const mainName = dlg.querySelector(".rem-main-name");
    const editListBtn = $("#rem-edit-list");
    const addInput = $("#rem-add-input");
    const searchInput = $("#rem-search");
    const badgeEl = $("#todo-badge");
    const detailDlg = $("#dialog-rem-detail");
    const detailBody = $("#rem-detail-body");

    const LIST_COLORS = ["#ff6b8a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#7c83fa", "#bf5af2", "#8e8e93"];
    let editingListId = null; // 当前编辑列表的 id（null = 新建）
    let openDetailId = null;

    function open() {
      if (!window.Todo) return;
      if (!Todo.__loaded) { Todo.load(); Todo.__loaded = true; }
      render();
      if (!dlg.open && typeof dlg.showModal === "function") dlg.showModal();
      setTimeout(() => addInput?.focus(), 80);
    }

    function syncBadge() {
      if (!window.Todo || !badgeEl) return;
      const n = Todo.counts()["smart-today"] || 0;
      if (n > 0) { badgeEl.hidden = false; badgeEl.textContent = n > 99 ? "99+" : String(n); }
      else { badgeEl.hidden = true; }
    }

    function activeList() {
      const id = Todo.data.activeListId;
      if (id?.startsWith("smart-")) return Todo.SMART[id.slice(6)];
      if (id?.startsWith("tag:")) {
        const t = id.slice(4);
        return { name: "#" + t.replace(/^#/, ""), emoji: "🏷", color: "#7c83fa" };
      }
      return Todo.data.lists.find((l) => l.id === id) || Todo.SMART.today;
    }

    function render() {
      renderSidebar();
      renderMain();
      syncBadge();
    }

    function renderSidebar() {
      const cs = Todo.counts();
      const aid = Todo.data.activeListId;
      smartGrid.innerHTML = Object.entries(Todo.SMART).map(([key, s]) => {
        const id = `smart-${key}`;
        const active = aid === id;
        return `<button type="button" class="rem-smart-tile ${active ? "is-active" : ""}" data-list-id="${id}" style="--tile-color:${s.color}">
          <span class="rem-smart-icon">${s.emoji}</span>
          <span class="rem-smart-count">${cs[id] || 0}</span>
          <span class="rem-smart-name">${escapeHtml(s.name)}</span>
        </button>`;
      }).join("");

      listNav.innerHTML = Todo.data.lists.map((l) => {
        const active = aid === l.id;
        const n = cs[l.id] || 0;
        const prog = Todo.listProgress(l.id);
        // 进度环：14×14 SVG，描边 2px，stroke-dasharray 控制完成弧
        const C = 2 * Math.PI * 5; // 半径 5
        const dash = `${(prog.pct * C).toFixed(1)} ${C}`;
        const ring = prog.total > 0 ? `<svg class="rem-list-ring" width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="2"></circle>
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-dasharray="${dash}" transform="rotate(-90 7 7)"></circle>
        </svg>` : "";
        return `<li>
          <button type="button" class="rem-list-row ${active ? "is-active" : ""}" data-list-id="${l.id}" style="--row-color:${l.color}" title="${prog.total > 0 ? `已完成 ${prog.done}/${prog.total}（${Math.round(prog.pct * 100)}%）` : "暂无内容"}">
            <span class="rem-list-dot"></span>
            <span class="rem-list-emoji">${escapeHtml(l.emoji || "🗒")}</span>
            <span class="rem-list-name">${escapeHtml(l.name)}</span>
            ${ring}
            ${n > 0 ? `<span class="rem-list-count">${n}</span>` : ""}
          </button>
        </li>`;
      }).join("");

      // 标签区
      const tagSec = $("#rem-tag-section");
      const tagNav = $("#rem-tag-nav");
      const tags = Todo.tagCounts();
      if (tags.length) {
        tagSec.hidden = false;
        tagNav.innerHTML = tags.map(([t, n]) => {
          const tagId = "tag:" + t;
          const active = aid === tagId;
          return `<li>
            <button type="button" class="rem-tag-row ${active ? "is-active" : ""}" data-list-id="${escapeAttr(tagId)}">
              <span class="rem-tag-hash">#</span>
              <span class="rem-tag-name">${escapeHtml(t.replace(/^#/, ""))}</span>
              <span class="rem-list-count">${n}</span>
            </button>
          </li>`;
        }).join("");
      } else {
        tagSec.hidden = true;
        tagNav.innerHTML = "";
      }
    }

    function renderMain() {
      const a = activeList();
      mainEmoji.textContent = a.emoji || "🗒";
      mainEmoji.style.color = a.color || "";
      mainName.textContent = a.name;
      // 智能列表 / 标签视图不显示编辑列表按钮；添加输入框对"已完成"也禁用
      const aid = String(Todo.data.activeListId);
      const isSmart = aid.startsWith("smart-");
      const isTag = aid.startsWith("tag:");
      editListBtn.hidden = isSmart || isTag;
      addInput.disabled = (aid === "smart-completed");
      addInput.placeholder = addInput.disabled
        ? "已完成列表不能直接添加"
        : (isTag ? `添加到 ${activeList().name}（带 ${aid.slice(4)} 标签）...` : "添加提醒事项...");

      const items = Todo.activeItems();
      emptyEl.hidden = items.length > 0;
      itemsEl.innerHTML = items.map((it) => renderItem(it)).join("");
    }

    function renderItem(it) {
      const overdue = !it.done && it.dueDate && it.dueDate < Todo.todayStr();
      const due = it.dueDate ? formatDue(it) : "";
      const subs = Todo.childrenOf(it.id);
      const subHtml = subs.length ? `<ul class="rem-sub">${subs.map((s) =>
        `<li class="rem-sub-item ${s.done ? "is-done" : ""}" data-id="${s.id}">
          <button type="button" class="rem-radio" data-act="toggle" data-priority="${s.priority || 0}"></button>
          <span class="rem-sub-text">${escapeHtml(s.text)}</span>
          <button type="button" class="rem-x" data-act="del">×</button>
        </li>`
      ).join("")}</ul>` : "";
      const tags = it.tags?.length ? `<span class="rem-tags">${it.tags.map((t) => `<span class="rem-tag">${escapeHtml(t)}</span>`).join("")}</span>` : "";
      const list = Todo.data.lists.find((l) => l.id === it.listId);
      const isSmart = String(Todo.data.activeListId).startsWith("smart-");
      const listLabel = isSmart && list ? `<span class="rem-from-list" style="color:${list.color}">${escapeHtml(list.emoji || "🗒")} ${escapeHtml(list.name)}</span>` : "";
      return `<div class="rem-item ${it.done ? "is-done" : ""} ${it.flagged ? "is-flagged" : ""} ${overdue ? "is-overdue" : ""}" data-id="${it.id}">
        <button type="button" class="rem-radio" data-act="toggle" data-priority="${it.priority || 0}" title="点击完成"></button>
        <div class="rem-item-main">
          <div class="rem-item-row1">
            <span class="rem-item-text" data-act="edit" contenteditable="false" spellcheck="false">${escapeHtml(it.text)}</span>
            ${it.flagged ? '<span class="rem-flag" title="已标记">🚩</span>' : ""}
            ${listLabel}
          </div>
          ${it.notes ? `<div class="rem-item-notes">${escapeHtml(it.notes)}</div>` : ""}
          <div class="rem-item-meta">
            ${due ? `<span class="rem-due ${overdue ? "is-overdue" : ""}">📅 ${due}</span>` : ""}
            ${it.url ? `<a class="rem-url" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">🔗 链接</a>` : ""}
            ${it.syncToCal ? `<span class="rem-cal-tag" title="已同步到日历">📅 同步</span>` : ""}
            ${tags}
          </div>
          ${subHtml}
        </div>
        <button type="button" class="rem-info" data-act="detail" title="详情">ⓘ</button>
      </div>`;
    }

    function formatDue(it) {
      const d = it.dueDate;
      if (!d) return "";
      const today = Todo.todayStr();
      let label = d;
      if (d === today) label = "今天";
      else {
        const dd = new Date(d + "T00:00:00");
        const todayDate = new Date(today + "T00:00:00");
        const diff = Math.round((dd - todayDate) / 86400000);
        if (diff === 1) label = "明天";
        else if (diff === -1) label = "昨天";
        else if (diff > 1 && diff <= 6) label = `${diff} 天后`;
        else if (diff < -1 && diff >= -6) label = `${-diff} 天前`;
      }
      return it.dueTime ? `${label} ${it.dueTime}` : label;
    }

    function openDetail(id) {
      const it = Todo.data.items.find((x) => x.id === id);
      if (!it) return;
      openDetailId = id;
      detailBody.innerHTML = `
        <section class="rem-d-card">
          <label class="rem-d-field">
            <span>标题</span>
            <input type="text" id="rem-d-text" value="${escapeAttr(it.text)}" maxlength="200" placeholder="提醒标题..." />
          </label>
          <label class="rem-d-field">
            <span>备注</span>
            <textarea id="rem-d-notes" rows="3" placeholder="备注 / 位置 / 想法...">${escapeHtml(it.notes || "")}</textarea>
          </label>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">⏰ 时间</h4>
          <div class="rem-d-row">
            <label class="rem-d-field">
              <span>截止日期</span>
              <input type="date" id="rem-d-date" value="${escapeAttr(it.dueDate || "")}" />
            </label>
            <label class="rem-d-field">
              <span>具体时间</span>
              <input type="time" id="rem-d-time" value="${escapeAttr(it.dueTime || "")}" />
            </label>
          </div>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">⚡ 优先级</h4>
          <div class="rem-d-priority">
            ${[0, 1, 2, 3].map((p) => `<button type="button" class="rem-p p-${p} ${p === (it.priority || 0) ? "is-on" : ""}" data-p="${p}">${["无", "低", "中", "高"][p]}</button>`).join("")}
          </div>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">🚩 标记 · 📅 同步</h4>
          <div class="rem-d-toggles">
            <label class="rem-d-toggle">
              <input type="checkbox" id="rem-d-flag" ${it.flagged ? "checked" : ""} />
              <span>🚩 标记为重要</span>
            </label>
            <label class="rem-d-toggle">
              <input type="checkbox" id="rem-d-sync" ${it.syncToCal ? "checked" : ""} />
              <span>📅 同步到日历</span>
            </label>
          </div>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">🔗 链接与标签</h4>
          <label class="rem-d-field">
            <span>URL</span>
            <input type="url" id="rem-d-url" value="${escapeAttr(it.url || "")}" placeholder="https://..." />
          </label>
          <label class="rem-d-field">
            <span>标签（空格分隔）</span>
            <input type="text" id="rem-d-tags" value="${escapeAttr((it.tags || []).join(" "))}" placeholder="#购物 #紧急" />
          </label>
        </section>

        <section class="rem-d-card">
          <h4 class="rem-d-card-title">📂 所属列表</h4>
          <label class="rem-d-field">
            <select id="rem-d-listid">
              ${Todo.data.lists.map((l) => `<option value="${l.id}" ${l.id === it.listId ? "selected" : ""}>${escapeHtml(l.emoji || "🗒")}  ${escapeHtml(l.name)}</option>`).join("")}
            </select>
          </label>
        </section>
      `;
      // priority button click（事件委托）
      detailBody.querySelectorAll(".rem-p").forEach((b) => b.addEventListener("click", () => {
        const p = +b.dataset.p;
        detailBody.querySelectorAll(".rem-p").forEach((x) => x.classList.toggle("is-on", +x.dataset.p === p));
        Todo.update(openDetailId, { priority: p });
        renderMain();
        renderSidebar();
      }));
      if (typeof detailDlg.showModal === "function" && !detailDlg.open) detailDlg.showModal();
    }
    // detailBody 上的 change/input：一次性绑定（事件委托），openDetailId 守门
    detailBody.addEventListener("change", () => { if (openDetailId) saveDetailFromDOM(); });
    detailBody.addEventListener("input", () => { if (openDetailId) saveDetailFromDOM(); });

    function closeDetail() {
      if (detailDlg.open) detailDlg.close();
      openDetailId = null;
    }
    // 关闭时清理状态
    detailDlg.addEventListener("close", () => { openDetailId = null; });

    function saveDetailFromDOM() {
      if (!openDetailId) return;
      const patch = {
        text: $("#rem-d-text")?.value.trim() || "新提醒",
        notes: $("#rem-d-notes")?.value || "",
        dueDate: $("#rem-d-date")?.value || "",
        dueTime: $("#rem-d-time")?.value || "",
        flagged: $("#rem-d-flag")?.checked || false,
        syncToCal: $("#rem-d-sync")?.checked || false,
        url: $("#rem-d-url")?.value.trim() || "",
        listId: $("#rem-d-listid")?.value || undefined,
        tags: ($("#rem-d-tags")?.value || "").split(/\s+/).map((t) => t.trim()).filter(Boolean),
      };
      Todo.update(openDetailId, patch);
      // text + due 等会影响列表渲染，render 一下；但不要 re-render detail body（会重置光标）
      renderMain();
      renderSidebar();
    }

    function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;").replace(/&/g, "&amp;"); }

    // -------- 列表编辑弹窗 --------
    function openListEditor(listId) {
      editingListId = listId || null;
      const form = $("#form-rem-list");
      const target = listId ? Todo.data.lists.find((l) => l.id === listId) : null;
      $("#rem-list-edit-title").innerHTML = listId ? "✎ 编辑列表" : "🗒 新建列表";
      form.name.value = target?.name || "";
      form.emoji.value = target?.emoji || "🗒";
      form.color.value = target?.color || LIST_COLORS[0];
      $("#rem-list-delete").hidden = !listId;
      // 颜色 swatch
      const colorBox = $("#rem-list-colors");
      colorBox.innerHTML = LIST_COLORS.map((c) =>
        `<button type="button" class="rem-color-swatch ${c === form.color.value ? "is-on" : ""}" data-c="${c}" style="background:${c}"></button>`
      ).join("");
      colorBox.querySelectorAll(".rem-color-swatch").forEach((b) => b.addEventListener("click", () => {
        form.color.value = b.dataset.c;
        colorBox.querySelectorAll(".rem-color-swatch").forEach((x) => x.classList.toggle("is-on", x.dataset.c === b.dataset.c));
      }));
      if (typeof dlgEditList.showModal === "function" && !dlgEditList.open) dlgEditList.showModal();
    }

    $("#form-rem-list").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.name.value.trim();
      const emoji = form.emoji.value.trim() || "🗒";
      const color = form.color.value || LIST_COLORS[0];
      if (!name) { toast("请填列表名"); return; }
      if (editingListId) {
        Todo.updateList(editingListId, { name, emoji, color });
      } else {
        const l = Todo.addList({ name, emoji, color });
        Todo.setActiveList(l.id);
      }
      dlgEditList.close();
      render();
    });

    $("#rem-list-delete").addEventListener("click", () => {
      if (!editingListId) return;
      const l = Todo.data.lists.find((x) => x.id === editingListId);
      const n = Todo.data.items.filter((x) => x.listId === editingListId).length;
      const msg = n > 0 ? `删除「${l?.name}」会同时删除其中 ${n} 项提醒，确定？` : `删除列表「${l?.name}」？`;
      if (!confirm(msg)) return;
      Todo.removeList(editingListId);
      dlgEditList.close();
      render();
    });

    // -------- 事件绑定 --------
    $("#btn-todo").addEventListener("click", open);

    // 侧边栏点击：切列表
    dlg.addEventListener("click", (e) => {
      const tile = e.target.closest("[data-list-id]");
      if (tile) {
        Todo.setActiveList(tile.dataset.listId);
        Todo.data.activeFilter = ""; // 切列表时清搜索
        searchInput.value = "";
        closeDetail();
        render();
      }
    });

    // 新建列表
    $("#rem-add-list").addEventListener("click", () => openListEditor(null));

    // 📋 从模板创建列表
    const dlgTpl = $("#dialog-rem-tpl");
    $("#rem-tpl").addEventListener("click", () => {
      const grid = $("#rem-tpl-grid");
      grid.innerHTML = Todo.TEMPLATES.map((t) => `
        <button type="button" class="rem-tpl-card" data-tpl="${escapeAttr(t.id)}" style="--tpl-color:${t.color}">
          <span class="rem-tpl-emoji">${escapeHtml(t.emoji)}</span>
          <span class="rem-tpl-name">${escapeHtml(t.name)}</span>
          <span class="rem-tpl-cnt">${t.items.length} 条预设</span>
        </button>
      `).join("");
      grid.querySelectorAll(".rem-tpl-card").forEach((b) => b.addEventListener("click", () => {
        const list = Todo.createFromTemplate(b.dataset.tpl);
        dlgTpl.close();
        render();
        if (list) toast(`已从模板创建「${list.name}」`);
      }));
      if (typeof dlgTpl.showModal === "function" && !dlgTpl.open) dlgTpl.showModal();
    });

    // ✨ AI 一句话生成列表
    const dlgAiGen = $("#dialog-rem-ai");
    const aiPrompt = $("#rem-ai-prompt");
    const aiStatus = $("#rem-ai-status");
    $("#rem-ai-gen").addEventListener("click", () => {
      if (!window.AI || !AI.AIStore?.currentProvider?.()) {
        toast("请先到 AI 设置里配好供应商再用 ✨ AI 生成");
        return;
      }
      aiPrompt.value = "";
      aiStatus.hidden = true;
      if (typeof dlgAiGen.showModal === "function" && !dlgAiGen.open) dlgAiGen.showModal();
      setTimeout(() => aiPrompt.focus(), 50);
    });
    // 示例 chip 点击填入 prompt
    dlgAiGen.addEventListener("click", (e) => {
      const chip = e.target.closest(".rem-ai-chip");
      if (chip) aiPrompt.value = chip.dataset.prompt;
    });
    $("#form-rem-ai").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = aiPrompt.value.trim();
      if (!text) { toast("先描述一下要做什么"); return; }
      const provider = AI.AIStore.currentProvider();
      const model = AI.AIStore.data.currentModel || provider.defaultModel;
      if (!model) { toast("当前供应商没有选模型"); return; }
      const goBtn = $("#rem-ai-go");
      goBtn.disabled = true;
      aiStatus.hidden = false;
      aiStatus.textContent = "AI 思考中…";

      const sys = `你是任务规划助手。根据用户描述输出一个 JSON 对象，结构严格如下：
{
  "name": "列表名（5-10 字）",
  "emoji": "1 个 emoji 表示主题",
  "color": "颜色十六进制，从 [#ff6b8a, #ff9f0a, #ffd60a, #30d158, #0a84ff, #7c83fa, #bf5af2] 选一个",
  "items": [{"text": "条目内容（10-30 字）", "priority": 0|1|2|3}]
}
priority: 0=无 1=低 2=中 3=高。items 6-12 条。只输出 JSON 对象本身，不要 markdown 围栏，不要前后任何说明文字。`;

      try {
        let full = "";
        await AI.chat({
          provider, model,
          messages: [
            { role: "system", content: sys },
            { role: "user",   content: text },
          ],
          retry: { maxAttempts: 2, delayMs: 1200 },
          onDelta: (_d, f) => { full = f; aiStatus.textContent = "AI 生成中… " + Math.min(full.length, 800) + " 字"; },
        });
        // 容错：抠出 { ... } 部分
        const m = full.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("AI 返回不是 JSON 格式");
        const parsed = JSON.parse(m[0]);
        if (!parsed.name || !Array.isArray(parsed.items)) throw new Error("解析 JSON 失败");
        const list = Todo.addList({
          name: parsed.name,
          emoji: parsed.emoji || "✨",
          color: parsed.color || "#7c83fa",
        });
        Todo.addManyItems(list.id, parsed.items);
        Todo.setActiveList(list.id);
        dlgAiGen.close();
        render();
        toast(`✨ AI 已生成「${list.name}」· ${parsed.items.length} 条`);
      } catch (err) {
        aiStatus.textContent = "❌ " + (err.message || "生成失败");
      } finally {
        goBtn.disabled = false;
      }
    });
    // 编辑当前列表
    editListBtn.addEventListener("click", () => {
      if (!String(Todo.data.activeListId).startsWith("smart-")) openListEditor(Todo.data.activeListId);
    });

    // 搜索
    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        Todo.data.activeFilter = searchInput.value;
        renderMain();
      }, 120);
    });

    // 新建提醒：Enter 提交
    addInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const text = addInput.value.trim();
      if (!text) return;
      const aid = Todo.data.activeListId;
      let initial = {};
      if (aid === "smart-today") initial.dueDate = Todo.todayStr();
      else if (aid === "smart-flagged") initial.flagged = true;
      else if (aid && !aid.startsWith("smart-")) initial.listId = aid;
      Todo.addItem(Object.assign({ text }, initial));
      // smart-flagged 添加的提醒会带 flagged，但不在 today 列表里出现
      addInput.value = "";
      render();
    });

    // 项目区：勾选 / 详情 / 编辑文本
    itemsEl.addEventListener("click", (e) => {
      const root = e.target.closest(".rem-item, .rem-sub-item");
      if (!root) return;
      const id = root.dataset.id;
      const act = e.target.dataset.act || e.target.closest("[data-act]")?.dataset.act;
      if (act === "toggle") {
        Todo.toggleDone(id);
        render();
        if (openDetailId === id) {
          // detail 中的可见状态也要同步
        }
      } else if (act === "del") {
        Todo.remove(id);
        if (openDetailId === id) closeDetail();
        render();
      } else if (act === "detail") {
        if (openDetailId === id) closeDetail();
        else openDetail(id);
      } else if (act === "edit") {
        const span = e.target.closest(".rem-item-text");
        if (!span) return;
        span.contentEditable = "true";
        span.focus();
        document.getSelection()?.selectAllChildren(span);
        span.addEventListener("blur", () => {
          span.contentEditable = "false";
          Todo.update(id, { text: span.textContent.trim() || "新提醒" });
          render();
        }, { once: true });
        span.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); span.blur(); }
          if (ev.key === "Escape") { ev.preventDefault(); span.textContent = Todo.data.items.find((x) => x.id === id)?.text || ""; span.blur(); }
        });
      }
    });

    // 详情：删除按钮（在 dialog footer 里）
    $("#rem-d-del").addEventListener("click", () => {
      if (!openDetailId) return;
      if (!confirm("删除这条提醒？")) return;
      Todo.remove(openDetailId);
      closeDetail();
      render();
    });

    // 清除已完成
    $("#rem-clear-done").addEventListener("click", () => {
      const doneIds = Todo.data.items.filter((x) => x.done).map((x) => x.id);
      if (!doneIds.length) { toast("没有已完成的提醒"); return; }
      if (!confirm(`清除 ${doneIds.length} 条已完成的提醒？`)) return;
      doneIds.forEach((id) => Todo.remove(id));
      render();
    });

    // 启动时刷新 badge（即使 dialog 没打开）
    if (window.Todo) { Todo.load(); Todo.__loaded = true; syncBadge(); }

    return { open, syncBadge, render };
  };
})();
