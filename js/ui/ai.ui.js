/* 🤖 AI 模块 UI — 自 app.js 拆分（聊天面板 / 🍵茶话会 / 历史归档+图库 / AI 设置）
 * 逻辑层：js/ai.js (window.AI) / js/archive.js (window.Archive) / js/image-editor.js
 * 由 app.js 通过 window.AIUIFactory(UIContext) 实例化，实例化顺序与拆分前一致。
 * 内含：UIAI（聊天+茶话会）、UIArchive（多会话+图库+生图）、AI 设置弹窗（供应商/人设）。
 */
(function () {
  "use strict";

  window.AIUIFactory = function (ctx) {
    const { $, $$, toast, uid, escapeHtml, Store, render, Bg } = ctx;
  const UIAI = (() => {
    const panel = $("#ai-panel");
    const fab = $("#ai-fab");
    const messagesEl = $("#ai-messages");
    const input = $("#ai-input");
    const sendBtn = $("#ai-send");
    const stopBtn = $("#ai-stop");
    const tipEl = $("#ai-tip");
    const attachInput = $("#ai-attach-input");
    const attachPreview = $("#ai-attach-preview");
    const modelSel = $("#ai-model-select");
    const personaSel = $("#ai-persona-select");
    // 🎨 生图已迁移到「图库 → 生图」标签页（见图库弹窗 + UIArchive 生图逻辑）。
    // 聊天面板恒为纯对话；清掉历史残留 imageMode 的兜底已下沉到 AIStore.load()
    // （必须在服务端 hydrate 之后清，否则会被老存档复活）。
    if (input) input.placeholder = "输入消息...";

    let attachments = [];
    let abortCtrl = null;

    // ===== AI 面板可拖动 + 可调大小 + 几何持久化 =====
    const PANEL_GEOM_KEY = "sakura_nav_ai_panel_geom_v1";
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    function loadPanelGeometry() {
      // 移动端用 CSS @media 接管布局（占满屏幕），不读保存的桌面端几何，避免错位
      if (window.matchMedia("(max-width: 480px)").matches) return;
      try {
        const raw = localStorage.getItem(PANEL_GEOM_KEY);
        if (!raw) return;
        const g = JSON.parse(raw);
        if (!g || typeof g !== "object") return;
        // 兜底：极端值不应用，避免存了一份"窗口外"的位置导致面板看不见
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = clamp(+g.width  || 420, 320, vw);
        const h = clamp(+g.height || vh - 32, 360, vh);
        const top  = clamp(+g.top  || 16, 0, vh - 80);
        const left = clamp(+g.left || (vw - w - 16), -w + 100, vw - 100);
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.top = top + "px";
        panel.style.left = left + "px";
        panel.style.width = w + "px";
        panel.style.height = h + "px";
      } catch (_) {}
    }

    function savePanelGeometry() {
      if (window.matchMedia("(max-width: 480px)").matches) return; // 移动端不存
      const r = panel.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) return; // 防止 hidden 状态污染
      try {
        localStorage.setItem(PANEL_GEOM_KEY, JSON.stringify({
          top: Math.round(r.top), left: Math.round(r.left),
          width: Math.round(r.width), height: Math.round(r.height),
        }));
      } catch (_) {}
    }

    function resetPanelGeometry() {
      try { localStorage.removeItem(PANEL_GEOM_KEY); } catch (_) {}
      // 还原 CSS 默认（top/right + width/height）
      panel.style.top = "";
      panel.style.left = "";
      panel.style.right = "";
      panel.style.bottom = "";
      panel.style.width = "";
      panel.style.height = "";
    }

    // 1) 标题栏拖动 → 改 top/left
    {
      const head = panel.querySelector(".ai-head");
      let dragging = false;
      let startMouseX = 0, startMouseY = 0;
      let startTop = 0, startLeft = 0;

      head.addEventListener("mousedown", (e) => {
        // 点在按钮 / select / input / label 等交互元素上时不触发拖动
        if (e.target.closest("button, select, input, textarea, label, .ai-tool-btn, .ai-model-status")) return;
        if (e.button !== 0) return;
        dragging = true;
        const r = panel.getBoundingClientRect();
        startTop = r.top;
        startLeft = r.left;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        // 切到 top/left 定位（如果之前是 right/bottom）
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.top = startTop + "px";
        panel.style.left = startLeft + "px";
        panel.style.width = r.width + "px";
        panel.style.height = r.height + "px";
        panel.classList.add("ai-dragging");
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = panel.offsetWidth;
        const newTop = clamp(startTop + dy, 0, vh - 60);
        const newLeft = clamp(startLeft + dx, -w + 120, vw - 120); // 至少留 120px 在屏幕里以便拖回
        panel.style.top = newTop + "px";
        panel.style.left = newLeft + "px";
      });

      document.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove("ai-dragging");
        savePanelGeometry();
      });
    }

    // 2) 监听 resize:both 触发的尺寸变化，自动持久化
    {
      let saveTimer = null;
      const ro = new ResizeObserver(() => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          // 只在面板可见时保存，避免 hidden 状态下的尺寸（0×0）覆盖正常值
          if (!panel.hidden) savePanelGeometry();
        }, 250);
      });
      ro.observe(panel);
    }

    // 3) 标题栏右键菜单：复位
    panel.querySelector(".ai-head").addEventListener("contextmenu", (e) => {
      // 在按钮等元素上不拦截
      if (e.target.closest("button, select, input, textarea, .ai-tool-btn, .ai-model-status")) return;
      e.preventDefault();
      if (confirm("把 AI 面板复位到默认位置和大小？")) {
        resetPanelGeometry();
        toast?.("AI 面板已复位");
      }
    });

    function open() {
      // 打开前先把保存的几何应用上（之所以在 open 而不是 init 时做，是因为 hidden 状态下 ResizeObserver 拿到的尺寸是 0）
      loadPanelGeometry();
      panel.hidden = false;
      fab.classList.remove("has-new");
      autoResize();
      setTimeout(() => input.focus(), 100);
      refreshPersonaOptions();
      refreshModelOptions();
      renderMessages();
    }
    function close() { panel.hidden = true; }

    function refreshPersonaOptions() {
      personaSel.innerHTML = AI.AIStore.data.personas.map((p) =>
        `<option value="${p.id}" ${p.id === AI.AIStore.data.currentPersonaId ? "selected" : ""}>${escapeHtml(p.name)}</option>`
      ).join("");
    }

    /** 把 AI.getModelStatus 的结果渲染成下拉前缀文本（select 不能塞 HTML，只能用 unicode 符号）。 */
    function modelOptionPrefix(p, m) {
      const st = AI.getModelStatus(p, m);
      if (st.kind === "cold")    return "❄ ";
      if (st.kind === "error")   return "⚠ ";
      if (st.kind === "ok")      return "✓ ";
      return "· ";
    }

    function refreshModelOptions() {
      const p = AI.AIStore.currentProvider();
      if (!p) { modelSel.innerHTML = `<option value="">请先添加供应商</option>`; refreshModelStatus(); return; }
      const models = (p.models && p.models.length ? p.models : [p.defaultModel || "default"]).filter(Boolean);
      modelSel.innerHTML = models.map((m) =>
        `<option value="${escapeHtml(m)}" ${m === AI.AIStore.data.currentModel ? "selected" : ""}>${escapeHtml(modelOptionPrefix(p, m) + m)}</option>`
      ).join("");
      if (!AI.AIStore.data.currentModel) AI.AIStore.data.currentModel = models[0];
      refreshModelStatus();
    }

    /** 用户已经反馈 "模型可用性应该出现在下拉里"，因此头部的状态徽章已删。
     *  refreshModelStatus 现在改成"重画下拉前缀 + 把当前模型的状态写到 select 的 title 提示里"。
     *  其它代码原来调用 refreshModelStatus()，全部继续可用。 */
    function refreshModelStatus() {
      const sel = modelSel;
      if (!sel) return;
      const p = AI.AIStore.currentProvider();
      const cur = AI.AIStore.data.currentModel;
      // 1) 重画每个 option 的前缀（基于最新台账）
      Array.from(sel.options).forEach((opt) => {
        const m = opt.value;
        if (!m) return;
        opt.textContent = (p ? modelOptionPrefix(p, m) : "· ") + m;
      });
      // 2) 给整个 select 一个 tooltip：当前模型最近状态
      if (!p || !cur) {
        sel.title = "选择模型（每条选项前的 ✓/❄/⚠/· 表示最近一次状态）";
        return;
      }
      const st = AI.getModelStatus(p, cur);
      const head = "选择模型 — 当前 " + cur + "：";
      let detail = "未测：尚未对该模型发起过请求";
      if (st.kind === "ok") {
        const mins = Math.max(1, Math.round(st.ageMs / 60000));
        detail = `✓ 可用（最近一次成功约 ${mins} 分钟前）`;
      } else if (st.kind === "cold") {
        const remainMin = Math.ceil(st.remainingMs / 60000);
        detail = `❄ 冷却中（约 ${remainMin} 分钟后恢复）`;
      } else if (st.kind === "error") {
        detail = `⚠ 出错：${(st.msg || "").slice(0, 120)}`;
      } else {
        detail = "· 未测";
      }
      sel.title = head + "\n" + detail + "\n\n下拉里每条选项前的 ✓/❄/⚠/· 表示该模型最近一次状态";
    }

    personaSel.addEventListener("change", () => {
      AI.AIStore.data.currentPersonaId = personaSel.value;
      AI.AIStore.save();
    });
    modelSel.addEventListener("change", () => {
      AI.AIStore.data.currentModel = modelSel.value;
      AI.AIStore.save();
      refreshModelStatus();
    });
    // 每 30 秒刷一下下拉前缀，让冷却剩余分钟自然衰减
    setInterval(refreshModelStatus, 30 * 1000);

    $("#ai-refresh-models").addEventListener("click", async () => {
      const p = AI.AIStore.currentProvider();
      if (!p) { toast("请先在 AI 设置中添加供应商"); return; }
      tipEl.textContent = "正在拉取模型列表…";
      try {
        const ms = await AI.fetchModels(p);
        p.models = ms;
        AI.AIStore.save();
        refreshModelOptions();
        tipEl.textContent = `已加载 ${ms.length} 个模型`;
        setTimeout(() => tipEl.textContent = "", 2500);
      } catch (e) {
        tipEl.classList.add("err");
        tipEl.textContent = "拉取失败：" + e.message.slice(0, 120);
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 4000);
      }
    });

    // 🔍 主动探测：逐个发 1-token 请求，挑第一个能通的模型
    $("#ai-find-model").addEventListener("click", async () => {
      const p = AI.AIStore.currentProvider();
      if (!p) { toast("请先在 AI 设置中添加供应商"); return; }
      const list = (p.models || []).filter(Boolean);
      if (!list.length) { toast("先点 ↻ 拉取模型列表"); return; }
      const findBtn = $("#ai-find-model");
      findBtn.disabled = true;
      findBtn.classList.add("spinning");
      const findCtrl = new AbortController();
      const stopOnEsc = (e) => { if (e.key === "Escape") findCtrl.abort(); };
      document.addEventListener("keydown", stopOnEsc);
      try {
        const live = await AI.findAvailableModel({
          provider: p,
          signal: findCtrl.signal,
          prefer: AI.AIStore.data.currentModel,
          onProgress: ({ index, total, model: m, status }) => {
            tipEl.classList.remove("err");
            if (status === "probing") tipEl.textContent = `🔍 探测 ${index}/${total}：${m}`;
            else if (status === "cooldown") tipEl.textContent = `❄️ ${m} 冷却中，跳过…`;
            else if (status === "ok") tipEl.textContent = `✅ 已选用 ${m}`;
            else if (status === "error") tipEl.textContent = `⚠️ ${m} 不可用，继续…`;
          },
        });
        if (live) {
          AI.AIStore.data.currentModel = live;
          AI.AIStore.save();
          refreshModelOptions();
          tipEl.textContent = `✅ 已切到可用模型：${live}`;
          setTimeout(() => tipEl.textContent = "", 4000);
        } else {
          tipEl.classList.add("err");
          tipEl.textContent = "所有模型都不可用，建议换一家供应商或稍后再试";
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
        }
      } catch (e) {
        tipEl.classList.add("err");
        tipEl.textContent = e.name === "AbortError" ? "已取消探测" : ("探测失败：" + (e.message || "").slice(0, 120));
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 4000);
      } finally {
        findBtn.disabled = false;
        findBtn.classList.remove("spinning");
        document.removeEventListener("keydown", stopOnEsc);
        // 探测把整个模型列表都跑了一遍，台账更新很多，整个下拉的前缀都要重画
        try { refreshModelOptions(); } catch (_) {}
      }
    });

    $("#ai-clear").addEventListener("click", () => {
      if (!confirm("清空当前会话？对话历史不可恢复。")) return;
      AI.AIStore.messages = [];
      AI.AIStore.saveMessages();
      renderMessages();
    });

    // 导出当前对话为 Markdown
    $("#ai-export")?.addEventListener("click", () => {
      const msgs = (AI.AIStore && Array.isArray(AI.AIStore.messages)) ? AI.AIStore.messages : [];
      if (!msgs.length) { toast("当前对话为空，无可导出"); return; }
      try {
        const md = aiMessagesToMarkdown(msgs);
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const fname = `ai-chat-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.md`;
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast("已导出 " + fname);
      } catch (e) {
        console.error("[ai-export]", e);
        toast("导出失败：" + (e?.message || e));
      }
    });

    function aiMessagesToMarkdown(messages) {
      const lines = [];
      const title = (window.Store?.data?.siteTitle || document.title || "AI 对话");
      lines.push(`# ${title} · AI 对话记录`);
      lines.push("");
      lines.push(`> 导出时间：${new Date().toLocaleString()}`);
      const cur = AI.AIStore?.data;
      if (cur?.currentProviderId) {
        const p = (cur.providers || []).find((x) => x.id === cur.currentProviderId);
        if (p) lines.push(`> 当前供应商：${p.name || p.id} · 模型：${cur.currentModel || p.defaultModel || "—"}`);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
      for (const m of messages) {
        const roleLabel = m.role === "user" ? "🧑 用户" : (m.role === "assistant" ? "🤖 助手" : (m.role === "system" ? "⚙ 系统" : m.role));
        lines.push(`## ${roleLabel}`);
        lines.push("");
        // 生图卡片（结构化数据）
        if (Array.isArray(m.imageResults) && m.imageResults.length) {
          const meta = m.imageMeta || {};
          if (meta.prompt) {
            lines.push(`**提示词：** ${meta.prompt}`);
          }
          const pills = [];
          if (meta.model) pills.push(`模型 \`${meta.model}\``);
          if (meta.size) pills.push(`尺寸 ${meta.size}`);
          if (meta.quality) pills.push(`质量 ${meta.quality}`);
          if (meta.count) pills.push(`数量 ${meta.count}`);
          if (pills.length) lines.push(`*${pills.join(" · ")}*`);
          lines.push("");
          m.imageResults.forEach((r, i) => {
            if (r.status === "done" && r.url) {
              lines.push(`![image-${i+1}](${r.url})`);
            } else if (r.status === "error") {
              lines.push(`> ❌ 第 ${i+1} 张生成失败：${r.error || "未知错误"}`);
            } else {
              lines.push(`> ⏳ 第 ${i+1} 张生成中…`);
            }
          });
          lines.push("");
          continue;
        }
        // 普通消息：content 可能是字符串或 {text, images}
        let text = "";
        if (typeof m.content === "string") text = m.content;
        else if (m.content && typeof m.content === "object") text = m.content.text || "";
        text = text || "";
        if (text) {
          lines.push(text);
        } else {
          lines.push("*(无内容)*");
        }
        // 用户附件图片
        if (m.content && Array.isArray(m.content.images) && m.content.images.length) {
          lines.push("");
          for (const img of m.content.images) {
            if (typeof img === "string") lines.push(`![attachment](${img})`);
          }
        }
        lines.push("");
      }
      return lines.join("\n");
    }
    $("#ai-close").addEventListener("click", close);
    // Esc 关闭面板；若当前有 <dialog open>（含 AI 设置）则交给弹窗，不抢 Esc
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || panel.hidden) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      close();
    });
    $("#ai-open-settings").addEventListener("click", () => {
      const wasOpen = !panel.hidden;
      close();
      openAISettings();
      dlgAI.addEventListener("close", function reopen() {
        dlgAI.removeEventListener("close", reopen);
        if (wasOpen) open();
      });
    });
    fab.addEventListener("click", open);

    // ============= 🍵 茶话会模式：按钮 + 配置弹窗 =============
    const councilBtn = $("#ai-council");
    const dlgCouncil = $("#dialog-council");

    function syncCouncilBtnState() {
      const cfg = AI.AIStore.data.council || {};
      const on = !!cfg.enabled && (cfg.members || []).length > 0;
      councilBtn?.setAttribute("aria-pressed", on ? "true" : "false");
      councilBtn?.classList.toggle("is-active", on);
      if (on) {
        const modeText = cfg.mode === "broadcast" ? "广播" : cfg.mode === "debate" ? "辩论" : "圆桌";
        councilBtn.title = `茶话会已开启 · ${modeText} · ${cfg.members.length} 位成员（点击重新配置）`;
      } else {
        councilBtn.title = "茶话会模式：多代理并行/辩论/圆桌对话";
      }
      // 茶话会启用时，单代理的"模型"和"角色"下拉变得无意义（每个成员有自己的）；
      // 设为 disabled + 加 council-overridden 类，配合 CSS 显示一个简短提示
      const modelSelect = $("#ai-model-select");
      const personaSelect = $("#ai-persona-select");
      if (modelSelect) {
        modelSelect.disabled = on;
        modelSelect.classList.toggle("council-overridden", on);
        modelSelect.title = on
          ? `茶话会模式 · ${cfg.members.length} 位成员各自的模型生效（在 🍵 弹窗里改）`
          : "模型（每条选项前的 ✓/❄/⚠/· 表示最近一次状态）";
      }
      if (personaSelect) {
        personaSelect.disabled = on;
        personaSelect.classList.toggle("council-overridden", on);
        personaSelect.title = on
          ? `茶话会模式 · 每位成员有各自的角色（在 🍵 弹窗里改）`
          : "角色";
      }
    }

    function renderCouncilMembers() {
      const list = $("#council-members-list");
      const empty = $("#council-members-empty");
      const cfg = AI.AIStore.data.council;
      list.innerHTML = "";
      if (!cfg.members.length) {
        empty.hidden = false;
        renderCouncilModerator();
        return;
      }
      empty.hidden = true;
      cfg.members.forEach((m, idx) => {
        const provider = AI.AIStore.data.providers.find((p) => p.id === m.providerId);
        const personaList = AI.AIStore.data.personas;
        const providerList = AI.AIStore.data.providers;
        const modelList = provider?.models || [];

        const row = document.createElement("div");
        row.className = "council-member-row";
        row.style.setProperty("--member-color", m.color || "#ff6b8a");
        row.dataset.id = m.id;
        row.innerHTML = `
          <button type="button" class="council-member-color" data-act="color" title="点击换颜色">${escapeHtml(m.emoji || "🌸")}</button>
          <div class="council-member-fields">
            <input class="council-member-label" data-act="label" value="${escapeHtml(m.label || "")}" placeholder="代理名（如 严肃顾问 / 吐槽役）" />
            <div class="council-member-row2">
              <label class="council-mini-field">
                <span>角色</span>
                <select data-act="persona">
                  <option value="">（不指定，用对话默认 prompt）</option>
                  ${personaList.map((p) => `<option value="${p.id}" ${p.id === m.personaId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                </select>
              </label>
              <label class="council-mini-field">
                <span>供应商</span>
                <select data-act="provider">
                  ${providerList.map((p) => `<option value="${p.id}" ${p.id === m.providerId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
                </select>
              </label>
              <label class="council-mini-field">
                <span>模型</span>
                <select data-act="model">
                  ${modelList.length === 0 ? `<option value="">（先到 AI 设置里拉取这个供应商的模型列表）</option>` : ""}
                  ${modelList.map((m2) => `<option value="${m2}" ${m2 === m.model ? "selected" : ""}>${escapeHtml(m2)}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
          <button type="button" class="council-member-del" data-act="del" title="移除">✕</button>
        `;
        list.appendChild(row);
      });
      renderCouncilModerator();
    }

    function renderCouncilModerator() {
      const sel = $("#council-moderator");
      if (!sel) return;
      const cfg = AI.AIStore.data.council;
      sel.innerHTML = `<option value="">并行综合（每个代理各自综合一次）</option>` +
        cfg.members.map((m) => `<option value="${m.id}" ${m.id === cfg.moderatorMemberId ? "selected" : ""}>${escapeHtml(m.emoji || "🌸")} ${escapeHtml(m.label)}</option>`).join("");
    }

    function applyCouncilModeUI() {
      const mode = AI.AIStore.data.council.mode;
      dlgCouncil.querySelectorAll(".council-tab").forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      dlgCouncil.querySelectorAll("[data-mode-only]").forEach((el) => {
        el.hidden = el.dataset.modeOnly !== mode;
      });
    }

    let councilSnapshot = null;
    function openCouncilDialog() {
      const cfg = AI.AIStore.data.council;
      // 深拷贝快照，取消时回滚
      councilSnapshot = JSON.parse(JSON.stringify(cfg));
      $("#council-enabled").checked = !!cfg.enabled;
      $("#council-rounds").value = cfg.rounds || 1;
      $("#council-order").value = cfg.speakerOrder || "configured";
      const concEl = $("#council-concurrency");
      if (concEl) concEl.value = Math.max(1, Math.min(16, +cfg.concurrency || 4));
      applyCouncilModeUI();
      renderCouncilMembers();
      Dlg.open(dlgCouncil);
    }
    // 弹窗关闭时若没走 submit（用户点了取消 / X / Esc），把 in-memory state 回滚
    dlgCouncil.addEventListener("close", () => {
      if (councilSnapshot && dlgCouncil.returnValue !== "saved") {
        AI.AIStore.data.council = councilSnapshot;
        // 不需要 save() —— in-memory 已经回滚到与 localStorage 一致
      }
      councilSnapshot = null;
    });

    councilBtn?.addEventListener("click", openCouncilDialog);

    // 模式切换
    dlgCouncil.addEventListener("click", (e) => {
      const tab = e.target.closest(".council-tab");
      if (tab) {
        AI.AIStore.data.council.mode = tab.dataset.mode;
        applyCouncilModeUI();
        return;
      }
      const memberBtn = e.target.closest(".council-member-row [data-act]");
      if (memberBtn) {
        const id = memberBtn.closest(".council-member-row").dataset.id;
        const cfg = AI.AIStore.data.council;
        const m = cfg.members.find((x) => x.id === id);
        if (!m) return;
        if (memberBtn.dataset.act === "del") {
          cfg.members = cfg.members.filter((x) => x.id !== id);
          renderCouncilMembers();
        } else if (memberBtn.dataset.act === "color") {
          // 循环换 emoji + 颜色
          const palette = [
            { emoji: "🌸", color: "#ff6b8a" },
            { emoji: "🌊", color: "#0ea5e9" },
            { emoji: "🌿", color: "#3aa66e" },
            { emoji: "🔥", color: "#ff9d4a" },
            { emoji: "💜", color: "#ad6dff" },
            { emoji: "⭐", color: "#f59e0b" },
            { emoji: "🌙", color: "#7c83fa" },
            { emoji: "🍒", color: "#ec4899" },
          ];
          const cur = palette.findIndex((x) => x.emoji === m.emoji);
          const nx = palette[(cur + 1) % palette.length];
          m.emoji = nx.emoji;
          m.color = nx.color;
          renderCouncilMembers();
        }
      }
    });

    // input/change 写回
    dlgCouncil.addEventListener("input", (e) => {
      const row = e.target.closest(".council-member-row");
      if (!row) return;
      const m = AI.AIStore.data.council.members.find((x) => x.id === row.dataset.id);
      if (!m) return;
      const act = e.target.dataset.act;
      if (act === "label") m.label = e.target.value;
    });
    dlgCouncil.addEventListener("change", (e) => {
      const row = e.target.closest(".council-member-row");
      if (row) {
        const m = AI.AIStore.data.council.members.find((x) => x.id === row.dataset.id);
        if (!m) return;
        const act = e.target.dataset.act;
        if (act === "persona") m.personaId = e.target.value;
        else if (act === "provider") {
          m.providerId = e.target.value;
          // 切供应商时把 model 重置成新供应商的 default
          const p = AI.AIStore.data.providers.find((x) => x.id === m.providerId);
          m.model = p?.defaultModel || (p?.models || [])[0] || "";
          renderCouncilMembers();
        } else if (act === "model") m.model = e.target.value;
        return;
      }
      // 模式选项
      if (e.target.id === "council-rounds") AI.AIStore.data.council.rounds = Math.max(1, Math.min(3, +e.target.value || 1));
      else if (e.target.id === "council-order") AI.AIStore.data.council.speakerOrder = e.target.value;
      else if (e.target.id === "council-moderator") AI.AIStore.data.council.moderatorMemberId = e.target.value;
      else if (e.target.id === "council-enabled") AI.AIStore.data.council.enabled = e.target.checked;
    });

    // + 添加成员
    $("#council-add-member")?.addEventListener("click", () => {
      const cfg = AI.AIStore.data.council;
      if (!AI.AIStore.data.providers.length) { toast("请先到 AI 设置里添加供应商"); return; }
      cfg.members.push(AI.makeCouncilMember());
      renderCouncilMembers();
    });

    // ⚡ 深度研究：借鉴 grok-4.20-multi-agent-xhigh，一键建 16 个差异化角色成员
    $("#council-deep-research")?.addEventListener("click", () => {
      const cfg = AI.AIStore.data.council;
      const providers = AI.AIStore.data.providers || [];
      if (!providers.length) { toast("请先到 AI 设置里添加供应商"); return; }

      // 16 个差异化角色（emoji + label + 系统提示偏置），覆盖常见思维角度
      const ROLES = [
        { emoji: "🔬", label: "实证派",   bias: "你只看数据、引用与可验证事实，不接受空泛论断。" },
        { emoji: "🎯", label: "聚焦者",   bias: "你只回答用户真正问的那一点，拒绝展开离题内容。" },
        { emoji: "🛡️", label: "怀疑者",   bias: "你逐条挑战默认假设，追问\"为什么不会反过来\"。" },
        { emoji: "🚀", label: "乐观派",   bias: "你优先发掘机会和上行空间，但不忽略关键风险。" },
        { emoji: "⚠️", label: "风险官",   bias: "你列出所有可能失败的方式，按严重度排序。" },
        { emoji: "🧮", label: "量化师",   bias: "尽可能给出数字、比例、量级，避免\"一些/很多\"。" },
        { emoji: "🌍", label: "宏观视角", bias: "你从趋势、行业、长周期角度看问题，不陷入细节。" },
        { emoji: "🔍", label: "细节控",   bias: "你专门挑别人会忽略的边角和实现细节。" },
        { emoji: "🧑‍🎨", label: "创意者",  bias: "你给出 3 个非常规、跳出框架的方案。" },
        { emoji: "⚖️", label: "权衡师",   bias: "你列出每个方案的取舍 (trade-off) 矩阵。" },
        { emoji: "📚", label: "历史学者", bias: "你引用类似的历史先例或行业案例支撑判断。" },
        { emoji: "🛠️", label: "实施派",   bias: "你只关心\"明天就能开始执行\"的具体步骤。" },
        { emoji: "💰", label: "成本控",   bias: "你估算金钱 / 时间 / 注意力成本，优先低成本方案。" },
        { emoji: "🧭", label: "战略官",   bias: "你从长期目标反推当前应该做的事。" },
        { emoji: "🤝", label: "利益相关", bias: "你列出每一方的诉求与潜在冲突。" },
        { emoji: "🪞", label: "反思者",   bias: "你复盘别人答案的盲点，给出更平衡的最终结论。" },
      ];

      // 配色：跟原 makeCouncilMember 一致的调色板，循环使用
      const PALETTE = ["#ff6b8a", "#7c83fa", "#3aa66e", "#ff9d4a", "#ad6dff", "#ec4899", "#0ea5e9", "#f59e0b"];

      // 模型选取：每个 provider 用 rankModels 取最优；多 provider 时轮询
      const providerPicks = providers.map((p) => {
        const all = (p.models || []).filter(Boolean);
        const ranked = all.length ? AI.rankModels(p, all).ordered : [];
        return {
          provider: p,
          // 给每个 provider 最多准备 4 个候选模型，循环用
          models: ranked.slice(0, 4).length ? ranked.slice(0, 4) : [p.defaultModel].filter(Boolean),
        };
      }).filter((x) => x.models.length);

      if (!providerPicks.length) {
        toast("没有可用模型，请先到 AI 设置里加载模型列表");
        return;
      }

      // 建 16 个成员
      cfg.members = [];
      for (let i = 0; i < ROLES.length; i++) {
        const role = ROLES[i];
        const pick = providerPicks[i % providerPicks.length];
        const model = pick.models[Math.floor(i / providerPicks.length) % pick.models.length];
        cfg.members.push({
          id: "deep-" + i + "-" + Math.random().toString(36).slice(2, 6),
          label: role.label,
          emoji: role.emoji,
          color: PALETTE[i % PALETTE.length],
          personaId: "",      // 用空 persona，下面 systemPromptOverride 接管
          providerId: pick.provider.id,
          model,
          systemPromptOverride: `你扮演"${role.label}"角色。${role.bias}\n回答控制在 200 字以内，紧扣用户原始问题，不重复别人会说的部分。`,
        });
      }

      // 自动开启 + 广播模式 + 并发 4
      cfg.enabled  = true;
      cfg.mode     = "broadcast";
      cfg.concurrency = Math.min(4, ROLES.length);

      // 同步 UI 状态
      $("#council-enabled") && ($("#council-enabled").checked = true);
      $("#council-concurrency") && ($("#council-concurrency").value = cfg.concurrency);
      $$(".council-tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.mode === "broadcast" ? "true" : "false"));
      $$(".council-mode-row").forEach((r) => {
        const only = r.dataset.modeOnly;
        r.hidden = only && only !== "broadcast";
      });
      renderCouncilMembers();
      toast(`已生成 16 个差异化角色成员（并发 ${cfg.concurrency}）`);
    });

    // 并发上限输入
    $("#council-concurrency")?.addEventListener("change", (e) => {
      const v = Math.max(1, Math.min(16, +e.target.value || 4));
      AI.AIStore.data.council.concurrency = v;
      e.target.value = v;
    });

    // 保存（form submit）
    $("#form-council").addEventListener("submit", (e) => {
      e.preventDefault();
      const cfg = AI.AIStore.data.council;
      if (cfg.enabled && !cfg.members.length) {
        toast("茶话会模式至少需要一位成员");
        return;
      }
      // 校验每位成员有 provider + model
      for (const m of cfg.members) {
        if (!m.providerId || !m.model) {
          toast(`成员"${m.label || "未命名"}"还没选供应商或模型`);
          return;
        }
      }
      AI.AIStore.save();
      syncCouncilBtnState();
      // 标记 returnValue=saved，让 close 监听器知道这次是保存而不是取消，不要回滚
      dlgCouncil.close("saved");
      toast(cfg.enabled ? `已开启茶话会 · ${cfg.members.length} 位成员` : "已保存（未启用）");
    });

    // 启动时初始化按钮状态；同时暴露给外部，让 bootApp 在 load() 完成后能再 sync 一次
    syncCouncilBtnState();
    window.__syncCouncilBtnState = syncCouncilBtnState;

    // 建议按钮
    messagesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ai-suggest]");
      if (b) { input.value = b.dataset.aiSuggest; input.focus(); autoResize(); }
    });

    // 附件
    attachInput.addEventListener("change", async () => {
      for (const f of attachInput.files) {
        try {
          const att = await AI.fileToAttachment(f);
          attachments.push(att);
          // 图片附件自动入图库
          if (att?.type === "image" && att.dataUrl && window.Archive?.Gallery) {
            window.Archive.Gallery.add({
              source: "uploaded",
              dataUrl: att.dataUrl,
              name: att.name || "",
              mime: f.type || "image/png",
              bytes: f.size || 0,
            }).catch(() => {});
          }
        }
        catch (err) { toast("读取失败：" + err.message); }
      }
      attachInput.value = "";
      renderAttachments();
    });

    function renderAttachments() {
      attachPreview.innerHTML = "";
      attachments.forEach((a, i) => {
        const el = document.createElement("span");
        el.className = "ai-attach-item";
        el.innerHTML = a.type === "image"
          ? `<img src="${a.dataUrl}"><span class="name">${escapeHtml(a.name)}</span><button class="x" data-i="${i}" type="button">×</button>`
          : `📄<span class="name">${escapeHtml(a.name)}</span><button class="x" data-i="${i}" type="button">×</button>`;
        attachPreview.appendChild(el);
      });
    }
    attachPreview.addEventListener("click", (e) => {
      const b = e.target.closest(".x");
      if (!b) return;
      attachments.splice(+b.dataset.i, 1);
      renderAttachments();
    });

    // 发送
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener("input", autoResize);
    function autoResize() {
      input.style.height = "auto";
      const nextHeight = Math.min(input.scrollHeight, 140);
      input.style.height = nextHeight + "px";
      input.style.overflowY = input.scrollHeight > 140 ? "auto" : "hidden";
    }

    sendBtn.addEventListener("click", send);
    stopBtn.addEventListener("click", () => { abortCtrl?.abort(); });

    /** 茶话会模式总入口：根据 cfg.mode 分发到 broadcast / debate / roundtable。
     *  调用前 userMsg 已经入栈。返回后所有成员的 assistant 消息都已经写好。 */
    async function sendCouncil(userText, currentAttachments, cfg) {
      const members = (cfg.members || []).slice();
      if (!members.length) throw new Error("茶话会没有配置任何成员");

      // 在每个 send 开头先写一条"轮次分隔"消息，让历史记录里看得出这是同一次提问
      const startMarker = {
        role: "system",
        councilDivider: true,
        content: cfg.mode === "broadcast" ? "🍵 广播" : cfg.mode === "debate" ? "🍵 辩论 · 第 1 轮" : "🍵 圆桌",
        ts: Date.now(),
        councilHidden: true, // 不送给模型
      };
      AI.AIStore.messages.push(startMarker);
      renderMessages();

      if (cfg.mode === "broadcast") {
        await runCouncilBroadcast(members, userText, currentAttachments);
        return;
      }
      if (cfg.mode === "debate") {
        await runCouncilDebate(members, userText, currentAttachments, cfg);
        return;
      }
      if (cfg.mode === "roundtable") {
        await runCouncilRoundtable(members, userText, currentAttachments, cfg);
        return;
      }
    }

    /** 广播：所有成员并行发请求，每个有自己的 streaming bubble，互不见对方。
     *  借鉴 grok2api 多 agent 协同的三个思路：
     *  - 并发上限信号量（默认 4，可通过 council.concurrency 调）：避免 16 成员同时炸
     *  - 进度卡片：顶部 N/T 完成 · X 失败 · 平均耗时
     *  - 单成员失败自动用 rankModels 选下一个备选模型重试一次（429/5xx 触发） */
    async function runCouncilBroadcast(members, userText, currentAttachments) {
      const cfg = AI.AIStore.data.council || {};
      const concurrency = Math.max(1, Math.min(16, +cfg.concurrency || 4));

      // 进度卡片（一条独立的 system 消息，类型 councilProgress）
      const progress = {
        role: "system",
        councilProgress: true,
        total: members.length,
        done: 0,
        failed: 0,
        retried: 0,
        startTs: Date.now(),
        latencies: [],
        ts: Date.now(),
        councilHidden: true, // 不送给模型
      };
      AI.AIStore.messages.push(progress);

      // 占位 assistant 消息（保持 UI 顺序稳定）
      const slots = members.map((m) => {
        const msg = {
          role: "assistant",
          content: "",
          ts: Date.now(),
          streaming: true,
          councilMember: { id: m.id, label: m.label, color: m.color, emoji: m.emoji },
          councilTurn: { mode: "broadcast", round: 1 },
        };
        AI.AIStore.messages.push(msg);
        return { member: m, msg };
      });
      AI.AIStore.saveMessages();
      renderMessages();

      const sem = AI.semaphore(concurrency);

      // 失败是否可自动重试：429/5xx/Network 类（避开 401/403 等鉴权失败 + 用户取消）
      const isRetriable = (err) => {
        if (!err || err.name === "AbortError") return false;
        const code = err.status || err.code || 0;
        if (code === 429) return true;
        if (code >= 500 && code < 600) return true;
        // 没有 status 字段的网络层错误也认为可重试
        if (!code && /(network|timeout|fetch|ECONN|ENOTFOUND)/i.test(err.message || "")) return true;
        return false;
      };

      await Promise.all(slots.map(({ member, msg }) => sem.run(async () => {
        if (abortCtrl?.signal.aborted) {
          msg.streaming = false;
          msg.content = "_[已取消]_";
          updateCouncilBubble(msg);
          progress.failed++;
          updateCouncilProgressBubble(progress);
          return;
        }

        const provider = AI.AIStore.data.providers.find((p) => p.id === member.providerId);
        if (!provider) {
          msg.streaming = false;
          msg.content = `_供应商 ${member.providerId} 已不存在_`;
          msg.error = true;
          updateCouncilBubble(msg);
          progress.failed++;
          updateCouncilProgressBubble(progress);
          return;
        }

        const t0 = Date.now();
        const tried = new Set();
        let currentModel = member.model;
        let lastErr = null;

        // 最多 2 轮：原模型 + 一次自动备选
        for (let attempt = 0; attempt < 2; attempt++) {
          tried.add(currentModel);
          // 重试时给气泡挂一个 "↻ 换模型重试" 元数据，方便 UI 标记
          if (attempt > 0) {
            msg.routedFrom = member.model;
            msg.routedTo = currentModel;
            progress.retried++;
            updateCouncilProgressBubble(progress);
          }
          try {
            const msgs = await AI.buildMessagesForMember(member, userText, currentAttachments);
            await AI.chat({
              provider, model: currentModel, messages: msgs,
              signal: abortCtrl.signal,
              retry: { maxAttempts: 2, delayMs: 1200 },
              onDelta: (_d, full) => {
                msg.content = full;
                updateCouncilBubble(msg);
                scrollToBottom();
              },
            });
            lastErr = null;
            break; // 成功，退出 attempt 循环
          } catch (err) {
            lastErr = err;
            // 用户主动取消：直接退出
            if (err?.name === "AbortError") break;
            // 不可重试 / 已经是第二次尝试：直接失败
            if (attempt === 1 || !isRetriable(err)) break;
            // 选下一个备选模型
            const next = AI.pickNextModelFor(provider, currentModel, tried);
            if (!next) break;
            currentModel = next;
            msg.content = ""; // 清掉前一次的半成品内容，重新流
          }
        }

        // 收尾：更新气泡 + 进度
        if (lastErr) {
          if (lastErr.name === "AbortError") {
            msg.content += "\n\n_[已取消]_";
          } else {
            msg.content = formatAIError(lastErr);
            msg.error = true;
          }
          progress.failed++;
        } else {
          progress.done++;
          progress.latencies.push(Date.now() - t0);
        }
        msg.streaming = false;
        AI.AIStore.saveMessages();
        updateCouncilBubble(msg);
        updateCouncilProgressBubble(progress);
      })));

      // 全部结束：标记进度卡完成
      progress.finishedTs = Date.now();
      AI.AIStore.saveMessages();
      updateCouncilProgressBubble(progress);
    }

    /** 把进度卡渲染成一行紧凑的横向胶囊。 */
    function renderCouncilProgress(p) {
      const pct = p.total ? Math.round((p.done + p.failed) / p.total * 100) : 0;
      const avgMs = p.latencies && p.latencies.length
        ? Math.round(p.latencies.reduce((a, b) => a + b, 0) / p.latencies.length)
        : 0;
      const elapsed = Math.round(((p.finishedTs || Date.now()) - p.startTs) / 1000);
      const running = !p.finishedTs;
      return `<div class="ai-council-progress ${running ? "running" : "done"}">
        <span class="acp-ico">${running ? "🍵" : (p.failed ? "⚠️" : "✅")}</span>
        <div class="acp-bar"><div class="acp-bar-fill" style="width:${pct}%"></div></div>
        <span class="acp-stat"><b>${p.done}</b>/${p.total}</span>
        ${p.failed ? `<span class="acp-stat err">${p.failed} 失败</span>` : ""}
        ${p.retried ? `<span class="acp-stat warn">${p.retried} 换模型</span>` : ""}
        ${avgMs ? `<span class="acp-stat">平均 ${(avgMs / 1000).toFixed(1)}s</span>` : ""}
        <span class="acp-stat muted">总 ${elapsed}s</span>
      </div>`;
    }

    function updateCouncilProgressBubble(progress) {
      const idx = AI.AIStore.messages.indexOf(progress);
      if (idx < 0) return;
      const wrap = messagesEl.querySelectorAll(".ai-msg")[idx];
      if (!wrap) return;
      wrap.innerHTML = renderCouncilProgress(progress);
    }

    /** 辩论：第 1 轮广播 → 第 2 轮把所有 R1 答案喂给主持人/全体 综合反驳。 */
    async function runCouncilDebate(members, userText, currentAttachments, cfg) {
      // R1
      await runCouncilBroadcast(members, userText, currentAttachments);
      if (abortCtrl?.signal.aborted) return;

      // 综合摘要：把 R1 的所有 bubble 内容拼成"各代理初步回答"块
      const r1Summary = members.map((m) => {
        const msg = [...AI.AIStore.messages].reverse().find((x) => x.councilMember?.id === m.id && x.councilTurn?.round === 1);
        const txt = (msg?.content || "_(无回答)_").slice(0, 1200);
        return `### ${m.emoji || ""} ${m.label}\n${txt}`;
      }).join("\n\n");

      const debatePrompt =
        "【辩论第 2 轮 · 综合反驳】以下是这一轮所有代理的第一轮初步回答。\n" +
        "请你阅读后给出综合判断：\n" +
        "1) 找出共识；\n" +
        "2) 指出彼此分歧 / 错误 / 遗漏；\n" +
        "3) 给出你最终的判断，必要时直接反驳前面某位代理的具体观点。\n" +
        "答案要紧扣用户原始问题。\n\n" +
        "原始问题：\n" + userText + "\n\n" +
        "其他代理的初步回答：\n" + r1Summary;

      // 决定 R2 的"综合者"：moderatorMemberId 指定一个，否则全员各自综合一次
      const moderators = cfg.moderatorMemberId
        ? members.filter((m) => m.id === cfg.moderatorMemberId)
        : members;
      if (!moderators.length) return;

      // R2 分隔
      AI.AIStore.messages.push({ role: "system", councilDivider: true, content: "🍵 辩论 · 第 2 轮（综合反驳）", ts: Date.now(), councilHidden: true });
      renderMessages();

      const r2Slots = moderators.map((m) => {
        const msg = {
          role: "assistant", content: "", ts: Date.now(), streaming: true,
          councilMember: { id: m.id, label: m.label, color: m.color, emoji: m.emoji },
          councilTurn: { mode: "debate", round: 2 },
        };
        AI.AIStore.messages.push(msg);
        return { member: m, msg };
      });
      AI.AIStore.saveMessages();
      renderMessages();

      await Promise.all(r2Slots.map(async ({ member, msg }) => {
        const provider = AI.AIStore.data.providers.find((p) => p.id === member.providerId);
        try {
          const msgs = await AI.buildMessagesForMember(member, userText, currentAttachments, { extraSystem: debatePrompt });
          await AI.chat({
            provider, model: member.model, messages: msgs,
            signal: abortCtrl.signal,
            retry: { maxAttempts: 2, delayMs: 1200 },
            onDelta: (_d, full) => { msg.content = full; updateCouncilBubble(msg); scrollToBottom(); },
          });
        } catch (err) {
          if (err?.name === "AbortError") msg.content += "\n\n_[已取消]_";
          else { msg.content = formatAIError(err); msg.error = true; }
        } finally {
          msg.streaming = false;
          AI.AIStore.saveMessages();
          updateCouncilBubble(msg);
        }
      }));
    }

    /** 圆桌：每个成员轮流发言，能看见前面所有人的发言（同一轮 + 上一轮）。
     *  通过把 history 里的 [代理名]: 内容 当作 assistant 历史送回。 */
    async function runCouncilRoundtable(members, userText, currentAttachments, cfg) {
      const rounds = Math.max(1, Math.min(3, cfg.rounds || 1));
      let order = members.slice();
      for (let r = 1; r <= rounds; r++) {
        if (cfg.speakerOrder === "random") {
          // 简易 Fisher-Yates
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
          }
        }
        if (r > 1) {
          AI.AIStore.messages.push({ role: "system", councilDivider: true, content: `🍵 圆桌 · 第 ${r} 轮`, ts: Date.now(), councilHidden: true });
          renderMessages();
        }
        for (const member of order) {
          if (abortCtrl?.signal.aborted) return;
          const provider = AI.AIStore.data.providers.find((p) => p.id === member.providerId);
          const msg = {
            role: "assistant", content: "", ts: Date.now(), streaming: true,
            councilMember: { id: member.id, label: member.label, color: member.color, emoji: member.emoji },
            councilTurn: { mode: "roundtable", round: r },
          };
          AI.AIStore.messages.push(msg);
          AI.AIStore.saveMessages();
          renderMessages();

          try {
            // buildMessagesForMember 已经把历史中的茶话会消息扁平化成 [代理名]: 内容 → 当前成员能看到前面的发言
            const extraUser = r === 1 && order[0]?.id === member.id ? "" : "请你简洁地回应（或反驳 / 补充）前面已经发言的代理；如果是第一个发言就直接给观点。";
            const msgs = await AI.buildMessagesForMember(member, userText, currentAttachments, { extraUser });
            await AI.chat({
              provider, model: member.model, messages: msgs,
              signal: abortCtrl.signal,
              retry: { maxAttempts: 2, delayMs: 1200 },
              onDelta: (_d, full) => { msg.content = full; updateCouncilBubble(msg); scrollToBottom(); },
            });
          } catch (err) {
            if (err?.name === "AbortError") { msg.content += "\n\n_[已取消]_"; msg.streaming = false; AI.AIStore.saveMessages(); updateCouncilBubble(msg); return; }
            else { msg.content = formatAIError(err); msg.error = true; }
          } finally {
            msg.streaming = false;
            AI.AIStore.saveMessages();
            updateCouncilBubble(msg);
          }
        }
      }
    }

    /** 局部更新某条茶话会 bubble 的 DOM，避免整列表 rerender 抢焦点。
     *  rAF 节流：多路并行流式时每帧每条至多渲一次 markdown。 */
    const _councilRaf = new Map(); // idx -> rafId
    function updateCouncilBubble(msg) {
      const idx = AI.AIStore.messages.indexOf(msg);
      if (idx < 0 || _councilRaf.has(idx)) return;
      _councilRaf.set(idx, requestAnimationFrame(() => {
        _councilRaf.delete(idx);
        const el = messagesEl.querySelector('.ai-msg[data-idx="' + idx + '"]');
        const bubble = el && el.querySelector(".ai-bubble");
        if (bubble) bubble.innerHTML = renderCouncilBubble(msg);
      }));
    }

    function renderCouncilBubble(msg) {
      const m = msg.councilMember || {};
      const turn = msg.councilTurn || {};
      const meta = turn.mode === "debate" && turn.round === 2 ? "综合 · 第 2 轮"
        : turn.mode === "roundtable" ? `圆桌 · 第 ${turn.round} 轮`
        : "";
      const tag = `<div class="ai-council-tag" style="--member-color:${m.color || "#ff6b8a"}">
        <span>${escapeHtml(m.emoji || "🌸")}</span>
        <span>${escapeHtml(m.label || "代理")}</span>
        ${meta ? `<span class="acl-meta">· ${meta}</span>` : ""}
      </div>`;
      return tag + renderAssistantContent(msg.content || "", msg);
    }

    async function send() {
      const text = input.value.trim();
      if (!text && !attachments.length) return;
      scrollToBottom(true); // 用户主动发送：强制回到底部并恢复跟随
      const councilCfg = AI.AIStore.data.council;
      const councilOn = !!councilCfg?.enabled && (councilCfg.members || []).length > 0;
      // 茶话会模式不需要 currentProvider/currentModel；每个成员有自己的
      let provider = null;
      let model = "";
      if (!councilOn) {
        provider = AI.AIStore.currentProvider();
        if (!provider) {
          tipEl.classList.add("err");
          tipEl.textContent = "请先在 AI 设置中添加供应商";
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 3500);
          return;
        }
        model = AI.AIStore.data.currentModel || provider.defaultModel;
        if (!model) { toast("请先选择模型"); return; }
      } else {
        // 茶话会模式预校验：每个成员都得有 provider+model，且 provider 还存在
        const stale = (councilCfg.members || []).filter((m) => {
          const p = AI.AIStore.data.providers.find((pp) => pp.id === m.providerId);
          return !p || !m.model;
        });
        if (stale.length) {
          tipEl.classList.add("err");
          tipEl.textContent = `茶话会有 ${stale.length} 位成员的供应商或模型已失效，请在配置里重新选`;
          setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 4500);
          return;
        }
      }

      const userMsg = {
        role: "user",
        content: text,
        ts: Date.now(),
        attachments: attachments.map((a) => a.type === "image"
          ? { type: "image", name: a.name, dataUrl: a.dataUrl }
          : { type: "text", name: a.name, text: (a.text || "").slice(0, 500) + (a.text?.length > 500 ? "…" : "") }),
      };
      AI.AIStore.messages.push(userMsg);
      AI.AIStore.saveMessages();

      const currentAttachments = attachments.slice();
      input.value = "";
      attachments = [];
      renderAttachments();
      autoResize();
      stopBtn.hidden = false;
      sendBtn.hidden = true;
      panel.classList.add("is-sending");
      abortCtrl = new AbortController();

      // ========== 🍵 茶话会分支 ==========
      if (councilOn) {
        try {
          await sendCouncil(text, currentAttachments, councilCfg);
        } catch (err) {
          if (err?.name !== "AbortError") {
            tipEl.classList.add("err");
            tipEl.textContent = (err.message || "茶话会出错").replace(/\s+/g, " ").slice(0, 160);
            setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
          }
        } finally {
          abortCtrl = null;
          stopBtn.hidden = true;
          sendBtn.hidden = false;
          panel.classList.remove("is-sending");
          try { refreshModelStatus(); } catch (_) {}
          try { syncCouncilBtnState(); } catch (_) {}
        }
        return;
      }

      const asstMsg = { role: "assistant", content: "", ts: Date.now(), streaming: true };
      AI.AIStore.messages.push(asstMsg);
      renderMessages();

      // 思考状态已经移到气泡里的动画指示器；tipEl 仅在出错时给文字
      tipEl.textContent = "";

      // 构建候选模型链：用户选的优先，剩下按 provider.models 顺序补齐；
      // 本地台账里仍在冷却中的模型先排到末尾（保留作为兜底）；同时考虑 upstream 维度的冷却。
      const allModels = (provider.models || []).filter(Boolean);
      const dedupe = new Set();
      const orderedAll = [model, ...allModels].filter((m) => {
        if (!m || dedupe.has(m)) return false;
        dedupe.add(m); return true;
      });
      const ranked = AI.rankModels(provider, orderedAll);
      let chain = ranked.fresh.length ? [...ranked.fresh, ...ranked.cold] : ranked.ordered;

      // 智能模式：当前选的模型已经在台账里冷却 → 发送前先用 1-token 探针找一个真正活的
      if (AI.AIStore.data.smartMode && ranked.cold.includes(model)) {
        try {
          tipEl.textContent = "智能模式：探测可用模型…";
          const live = await AI.findAvailableModel({
            provider,
            signal: abortCtrl.signal,
            prefer: model,
            onProgress: ({ index, total, model: m, status }) => {
              tipEl.textContent =
                status === "probing" ? `智能模式：探测 ${index}/${total} «${m}»…` :
                status === "cooldown" ? `«${m}» 冷却中，跳过…` :
                status === "ok" ? `已选用 «${m}»` :
                tipEl.textContent;
            },
          });
          if (live) chain = [live, ...chain.filter((m) => m !== live)];
        } catch (_) { /* 探测失败也走原 chain */ }
      }

      let usedModel = chain[0];
      let succeeded = false;
      let lastErr = null;
      let attemptIdx = 0;

      try {
        const msgs = await AI.buildMessages(text, currentAttachments);
        let prevModel = null;
        const visited = new Set();
        while (chain.length) {
          const tryModel = chain.shift();
          if (!tryModel || visited.has(tryModel)) continue;
          visited.add(tryModel);
          // 已知该 UI 模型映射到的 upstream 仍在冷却 → 直接跳过，避免做无意义的尝试
          const myUp = AI.upstreamMap[provider.id + "::" + tryModel];
          if (myUp && (AI.cooldownLedger[myUp] || 0) > Date.now()) continue;
          attemptIdx++;
          if (attemptIdx > 1) {
            tipEl.textContent = `「${prevModel}」冷却中，正在切到「${tryModel}」重试…`;
            asstMsg.content = ""; // 抹掉上次失败时填的错误正文
            renderMessages();
          }
          try {
            await AI.chat({
              provider, model: tryModel, messages: msgs, signal: abortCtrl.signal,
              retry: {
                maxAttempts: 2,
                delayMs: 1200,
                onRetry: (n, total) => {
                  tipEl.textContent = `「${tryModel}」凭据冷却，重试 ${n}/${total - 1}…`;
                },
              },
              onDelta: (_d, full) => {
                asstMsg.content = full;
                scheduleLastBubbleRender(asstMsg);
              },
            });
            usedModel = tryModel;
            succeeded = true;
            break;
          } catch (err) {
            lastErr = err;
            prevModel = tryModel;
            if (err.name === "AbortError") break;
            const cool = AI.isCooldownError(err);
            const gw = AI.isGatewayError(err);
            if (!cool && !gw) break; // 既不是冷却也不是网关错误 → 真错，立刻报
            if (cool) {
              // UI 模型 + upstream 都登记到台账；下一轮 while 自动会跳过同一 upstream 的别名
              AI.recordCooldown(provider, tryModel, err);
            }
            // 网关错误（504/502 等）不写台账，因为它跟凭据无关；切下一个模型再试
          }
        }

        if (succeeded) {
          asstMsg.streaming = false;
          if (usedModel !== model) {
            asstMsg.routedFrom = model;
            asstMsg.routedTo = usedModel;
          }
          // 解析指令块，生成操作卡
          const actions = AI.parseActions(asstMsg.content);
          if (actions.length) asstMsg.actions = actions;
          if (actions.length && AI.AIStore.data.autoApply) {
            const r = AI.applyActions(actions);
            asstMsg.applied = true;
            asstMsg.appliedResult = r;
            toast(`已自动执行 ${r.ok} 项指令`);
          }
          AI.AIStore.saveMessages();
          renderMessages();
          tipEl.textContent = "";
        } else {
          throw lastErr || new Error("未知错误");
        }
      } catch (err) {
        asstMsg.streaming = false;
        if (err.name === "AbortError") asstMsg.content += "\n\n_[已取消]_";
        else { asstMsg.content = formatAIError(err); asstMsg.error = true; }
        AI.AIStore.saveMessages();
        renderMessages();
        tipEl.classList.add("err");
        tipEl.textContent = (err.message || "网络错误").replace(/\s+/g, " ").slice(0, 160);
        setTimeout(() => { tipEl.classList.remove("err"); tipEl.textContent = ""; }, 6000);
      } finally {
        abortCtrl = null;
        stopBtn.hidden = true;
        sendBtn.hidden = false;
        panel.classList.remove("is-sending");
        // 一次 send 完成（成功 / 失败 / 取消都算），刷一下模型状态徽章 — chat()/generateImage() 内部已经记好台账了
        try { refreshModelStatus(); } catch (_) {}
      }
    }

    function renderMessages() {
      const ms = AI.AIStore.messages;
      if (!ms.length) {
        messagesEl.innerHTML = messagesEl.querySelector(".ai-empty") ? messagesEl.innerHTML :
          `<div class="ai-empty">
            <div class="ai-empty-logo">🌸</div>
            <p>让 AI 帮你整理导航页。</p>
          </div>`;
        return;
      }
      messagesEl.innerHTML = "";
      ms.forEach((m, idx) => {
        // 茶话会轮次分隔线（system + councilDivider）
        if (m.councilDivider) {
          const div = document.createElement("div");
          div.className = "ai-council-round-divider";
          div.innerHTML = `<span>${escapeHtml(m.content || "")}</span>`;
          // 用空 div 占位以保持 idx 与 messages 对齐（updateCouncilBubble 用 querySelectorAll(.ai-msg)[idx] 查不能错位）
          const wrap = document.createElement("div");
          wrap.className = "ai-msg ai-msg-divider";
          wrap.dataset.idx = idx;
          wrap.appendChild(div);
          messagesEl.appendChild(wrap);
          return;
        }
        // 茶话会进度卡（system + councilProgress）
        if (m.councilProgress) {
          const wrap = document.createElement("div");
          wrap.className = "ai-msg ai-msg-progress";
          wrap.dataset.idx = idx;
          wrap.innerHTML = renderCouncilProgress(m);
          messagesEl.appendChild(wrap);
          return;
        }
        const isCouncil = !!m.councilMember;
        const el = document.createElement("div");
        el.className = "ai-msg " + m.role + (isCouncil ? " is-council" : "");
        el.dataset.idx = idx;
        if (isCouncil) el.style.setProperty("--member-color", m.councilMember.color || "#ff6b8a");
        el.innerHTML = `
          <div class="ai-avatar">${m.role === "user" ? "我" : (isCouncil ? escapeHtml(m.councilMember.emoji || "🌸") : "🌸")}</div>
          <div class="ai-bubble"></div>
        `;
        const bubble = el.querySelector(".ai-bubble");
        if (m.role === "user") {
          bubble.innerHTML = renderUserContent(m);
        } else if (isCouncil) {
          bubble.innerHTML = renderCouncilBubble(m);
          if (m.content && !m.streaming) bubble.insertAdjacentHTML("beforeend", msgActionsHtml());
        } else {
          bubble.innerHTML = renderAssistantContent(m.content, m);
          if (m.content && !m.streaming) bubble.insertAdjacentHTML("beforeend", msgActionsHtml());
        }
        messagesEl.appendChild(el);
      });
      scrollToBottom();
    }

    function renderUserContent(m) {
      let html = escapeHtml(m.content || "").replace(/\n/g, "<br>");
      if (m.attachments?.length) {
        html += `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">` +
          m.attachments.map((a) => a.type === "image"
            ? `<figure class="ai-img-figure" style="margin:0">
                 <img class="ai-inline-img" src="${a.dataUrl}" alt="${escapeHtml(a.name||"")}" style="max-height:140px" />
                 <div class="ai-img-tools">
                   <button type="button" class="ai-img-btn" data-img-act="open" title="新窗口打开">↗</button>
                   <button type="button" class="ai-img-btn" data-img-act="download" title="下载">⬇</button>
                 </div>
               </figure>`
            : `<span class="ai-attach-item">📄${escapeHtml(a.name)}</span>`
          ).join("") + `</div>`;
      }
      return html;
    }

    /** 借鉴 ChatGpt-Image-Studio web/src/app/image/components/conversation-turns.tsx 的卡片设计：
     *  顶部一排胶囊（model/size/quality/张数/已用时间）；中间图片网格（1 列单图、2 列多图）；
     *  每张图下面一排圆形按钮（下载 / 复制提示词 / 重生）；
     *  loading 状态显示带 spinner 的占位框 + "已等待 XXs"；error 状态用玫瑰色块 + 重试按钮。 */
    function renderImageGenCard(msg) {
      const meta = msg.imageMeta || {};
      const results = msg.imageResults || [];
      const status = msg.imageGenStatus || {};
      const isRunning = !!msg.streaming;
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.filter((r) => r.status === "error").length;
      const cancelledCount = results.filter((r) => r.status === "cancelled").length;
      const elapsed = status.elapsedSec || 0;

      // 胶囊行
      const pills = [];
      if (meta.model)   pills.push(`<span class="ai-img-pill">${escapeHtml(meta.model)}</span>`);
      if (meta.size)    pills.push(`<span class="ai-img-pill">${escapeHtml(meta.size.toUpperCase())}</span>`);
      if (meta.quality && meta.quality !== "auto") pills.push(`<span class="ai-img-pill">Quality ${escapeHtml(meta.quality)}</span>`);
      if (results.length > 1) pills.push(`<span class="ai-img-pill">${results.length} 张</span>`);
      if (isRunning) {
        pills.push(`<span class="ai-img-pill running">⏱ 已等待 ${elapsed}s</span>`);
      } else if (elapsed > 0) {
        pills.push(`<span class="ai-img-pill">耗时 ${elapsed}s</span>`);
      }
      if (errorCount && !isRunning) pills.push(`<span class="ai-img-pill err">${errorCount} 张失败</span>`);
      if (cancelledCount) pills.push(`<span class="ai-img-pill muted">${cancelledCount} 张取消</span>`);

      // 图片网格
      const gridCls = results.length === 1 ? "ai-img-grid one" : "ai-img-grid many";
      const cards = results.map((r, i) => {
        const safeIdx = String(i + 1).padStart(2, "0");
        const dlName = `sakura-image-${Date.now()}-${safeIdx}.png`;
        if (r.status === "success") {
          const u = r.dataUrl || r.url;
          // 改写提示词改为可折叠 details，默认收起，节省纵向空间
          const cap = r.revisedPrompt
            ? `<details class="ai-img-revised"><summary>模型理解的提示词</summary><div class="ai-img-revised-body">${escapeHtml(r.revisedPrompt)}</div></details>`
            : "";
          // 操作改为图标按钮 + 悬浮 tooltip，横向收紧
          return `<figure class="ai-img-card success">
              <img class="ai-img-thumb" src="${u}" alt="生图结果 #${i + 1}" title="点击查看大图" />
              ${cap}
              <div class="ai-img-actions">
                <a class="ai-img-act" href="${u}" download="${dlName}" title="下载到本地" aria-label="下载">⬇</a>
                <button type="button" class="ai-img-act" data-img-act="seed-prompt" title="把这条提示词复制回输入框" aria-label="复制提示词">✎</button>
                <button type="button" class="ai-img-act" data-img-act="retry-image" title="用同样的提示词再生成一次" aria-label="再生成">↻</button>
              </div>
            </figure>`;
        }
        if (r.status === "error") {
          return `<figure class="ai-img-card error">
              <div class="ai-img-err-text">${escapeHtml(r.error || "处理失败")}</div>
              <div class="ai-img-actions">
                <button type="button" class="ai-img-act" data-img-act="retry-image" title="重新发送同样的请求" aria-label="重新生成">↻ 重试</button>
              </div>
            </figure>`;
        }
        if (r.status === "cancelled") {
          return `<figure class="ai-img-card cancelled"><div class="ai-img-cancel-text">已取消</div></figure>`;
        }
        // partial：Responses 模式收到 partial_image 时的中间状态，或最终降级用 partial 兜底
        if (r.status === "partial") {
          const u = r.dataUrl || r.url;
          const cap = r.revisedPrompt
            ? `<details class="ai-img-revised"><summary>模型理解的提示词（草稿）</summary><div class="ai-img-revised-body">${escapeHtml(r.revisedPrompt)}</div></details>`
            : "";
          const label = r.degraded
            ? `<span class="ai-img-partial-tag" title="多次重试后仍未拿到 final，用最后一次 partial_image 兜底">⚠ 半成品兜底</span>`
            : `<span class="ai-img-partial-tag" title="还在生成，这是 partial_image 预览">⏳ 生成中…</span>`;
          return `<figure class="ai-img-card partial">
              <img class="ai-img-thumb" src="${u}" alt="生图中间预览 #${i + 1}" />
              ${label}
              ${cap}
              <div class="ai-img-actions">
                <a class="ai-img-act" href="${u}" download="${dlName}" title="保存这张半成品" aria-label="下载">⬇</a>
                <button type="button" class="ai-img-act" data-img-act="retry-image" title="用同样的提示词再生成一次" aria-label="再生成">↻</button>
              </div>
            </figure>`;
        }
        // loading 占位
        return `<figure class="ai-img-card loading">
            <div class="ai-img-spinner-wrap">
              <div class="ai-img-spinner" aria-hidden="true"></div>
              <p class="ai-img-spinner-title">正在生成图片…</p>
              <p class="ai-img-spinner-sub">已等待 ${elapsed}s · 图片处理通常需要十几秒到几分钟</p>
            </div>
          </figure>`;
      }).join("");

      // 顶部 prompt 摘要：跟下面每张图的错误信息可能完全一样，所以全失败时不重复显示同一句错误，
      // 只给一句简短状态，详细错误已经在每张图的卡片里。
      let summary = "";
      if (isRunning) {
        summary = `<div class="ai-img-summary running">🎨 正在生成 ${results.length} 张图片…</div>`;
      } else if (errorCount === results.length && results.length > 0) {
        summary = `<div class="ai-img-summary err">❌ 生成失败 · 详情见下方</div>`;
      } else if (errorCount > 0 && successCount > 0) {
        summary = `<div class="ai-img-summary partial">⚠️ ${successCount} 张成功 / ${errorCount} 张失败</div>`;
      } else if (successCount > 0) {
        summary = `<div class="ai-img-summary ok">✅ 生成完成 · ${successCount} 张</div>`;
      } else if (cancelledCount === results.length) {
        summary = `<div class="ai-img-summary muted">已取消</div>`;
      }

      return `<div class="ai-img-card-wrap">
        <div class="ai-img-pills">${pills.join("")}</div>
        ${summary}
        <div class="${gridCls}">${cards}</div>
      </div>`;
    }

    function renderAssistantContent(text, msg) {
      // 生图卡片优先：如果消息带 imageResults 字段（不论成功/失败/加载中），用结构化卡片渲染
      if (msg?.imageResults && msg.imageResults.length) {
        return renderImageGenCard(msg);
      }
      // 流式中且尚无任何文本内容时，在气泡里显示动画"思考中"指示器
      const thinking = !!msg?.streaming && !String(text || "").trim();
      let html = thinking
        ? `<div class="ai-thinking" aria-label="正在思考"><span></span><span></span><span></span></div>`
        : AI.renderMarkdown(text || "");
      if (msg?.streaming && !thinking) html += '<span class="ai-stream-cursor" aria-hidden="true"></span>';
      // fallback 命中时在最前面挂一条提示
      if (msg?.routedTo && msg.routedFrom && msg.routedTo !== msg.routedFrom) {
        html = `<div class="ai-route-note">🔁 <code>${escapeHtml(msg.routedFrom)}</code> 当前不可用，已自动切到 <b>${escapeHtml(msg.routedTo)}</b> 完成回答</div>` + html;
      }
      // 替换指令块占位符
      html = html.replace(/<div class="ai-action-placeholder" data-code="([^"]*)"><\/div>/g, (_, code) => {
        try {
          const raw = code.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
          const arr = JSON.parse(raw);
          if (!Array.isArray(arr)) return "";
          return renderActionCard(arr, msg);
        } catch (_) { return ""; }
      });
      // 如果消息已 applied
      if (msg?.applied && msg.appliedResult) {
        html += `<div class="ai-action-card applied"><h5>✓ 已执行（${msg.appliedResult.ok} 成功 / ${msg.appliedResult.fail} 失败）</h5><ol>${msg.appliedResult.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ol></div>`;
      }
      // 错误消息：附加“立即重试 / 清除冷却台账”按钮
      if (msg?.error) {
        html += `<div class="ai-error-actions">
          <button type="button" class="btn-retry-ai" data-retry-send="1">🔁 立即重试</button>
          <button type="button" class="btn-clear-cooldown" data-clear-cooldown="1" title="清空本地记录的冷却中模型">🧹 清空冷却记录</button>
        </div>`;
      }
      return html;
    }

    function renderActionCard(arr, msg) {
      const items = arr.map((a) => {
        const cls = a.op.startsWith("add") ? "op-add" : a.op.startsWith("delete") ? "op-delete" : "op-rename";
        return `<li><span class="badge ${cls}">${a.op}</span>${escapeHtml(JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='op'))))}</li>`;
      }).join("");
      const id = "act-" + Math.random().toString(36).slice(2, 8);
      return `<div class="ai-action-card" data-actid="${id}"><h5>🛠 AI 请求执行以下操作</h5><ol>${items}</ol>
        <div class="ai-action-apply">
          <button class="btn-apply" data-apply="${id}">✅ 应用</button>
          <button class="btn-ignore" data-apply="${id}" data-ignore="1">忽略</button>
        </div></div>`;
    }

    // 指令卡应用/忽略
    messagesEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-apply]");
      if (!btn) return;
      const id = btn.dataset.apply;
      const card = messagesEl.querySelector(`.ai-action-card[data-actid="${id}"]`);
      if (!card) return;
      // 找对应消息
      const msgEl = btn.closest(".ai-msg");
      const idx = [...messagesEl.children].indexOf(msgEl);
      const msg = AI.AIStore.messages[idx];
      if (!msg || !msg.actions) return;
      if (btn.dataset.ignore) {
        card.classList.add("applied");
        card.querySelector("h5").textContent = "✕ 已忽略";
        msg.applied = true;
        msg.appliedResult = { ok: 0, fail: 0, notes: ["用户忽略"] };
      } else {
        const r = AI.applyActions(msg.actions);
        msg.applied = true;
        msg.appliedResult = r;
        card.classList.add("applied");
        toast(`已应用 ${r.ok} 项指令`);
      }
      AI.AIStore.saveMessages();
      renderMessages();
    });

    /** 智能滚动：仅当用户位于底部附近（80px 内）才跟随；force 用于发送等主动场景 */
    let _stickBottom = true;
    function scrollToBottom(force) {
      if (force) _stickBottom = true;
      if (!_stickBottom) return;
      requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    }
    const jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "ai-jump-bottom";
    jumpBtn.title = "回到底部";
    jumpBtn.textContent = "↓";
    jumpBtn.hidden = true;
    panel.appendChild(jumpBtn);
    jumpBtn.addEventListener("click", () => { scrollToBottom(true); jumpBtn.hidden = true; });
    messagesEl.addEventListener("scroll", () => {
      _stickBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
      jumpBtn.hidden = _stickBottom;
    }, { passive: true });

    /** 流式中的最后一条 assistant 气泡：rAF 节流渲染（每帧至多解析一次 markdown） */
    let _lastBubbleRaf = 0;
    function scheduleLastBubbleRender(msg) {
      if (_lastBubbleRaf) return;
      _lastBubbleRaf = requestAnimationFrame(() => {
        _lastBubbleRaf = 0;
        const bubble = messagesEl.querySelector(".ai-msg:last-child .ai-bubble");
        if (bubble) bubble.innerHTML = renderAssistantContent(msg.content, msg);
        scrollToBottom();
      });
    }

    /** 消息 hover 操作条（复制 / 朗读），点击由 messagesEl 统一委托处理 */
    function msgActionsHtml() {
      return '<span class="ai-msg-actions">' +
        '<button type="button" class="tts-btn" data-act="copy-msg" title="复制这条回复的原文"><span class="ai-tool-ico">📋</span><span class="ai-tool-txt">复制</span></button>' +
        '<button type="button" class="tts-btn" data-act="tts-msg" title="朗读 / 停止朗读这条回复"><span class="ai-tool-ico">🔊</span><span class="ai-tool-txt">朗读</span></button>' +
        '</span>';
    }

    /** 从最后一条 user 消息重新发送：抹掉 user 之后的所有助手消息，
     *  把内容/附件回填到输入框，再走一次 send()。 */
    function retryFromLastError() {
      const ms = AI.AIStore.messages;
      let i = ms.length - 1;
      while (i >= 0 && ms[i].role !== "user") i--;
      if (i < 0) { toast?.("没有可重试的消息"); return; }
      const u = ms[i];
      ms.length = i; // 删除 user + 之后所有
      AI.AIStore.saveMessages();
      input.value = u.content || "";
      attachments = (u.attachments || []).map((a) => a.type === "image"
        ? { type: "image", name: a.name, dataUrl: a.dataUrl }
        : { type: "text", name: a.name, text: a.text || "" });
      renderAttachments();
      autoResize();
      renderMessages();
      send();
    }

    /** 把上游错误（含 429 限额 / 模型冷却 JSON / 5xx 网关 HTML）渲染成友好 Markdown。 */
    function formatAIError(err) {
      const msg = err.message || "网络错误";
      const upstream = err.upstream || tryParseEmbeddedJson(msg);
      const e = upstream?.error || upstream || {};
      const lower = (e.message || "").toLowerCase();
      const isCooldown = e.code === "model_cooldown" || /cool(ing)?[ _-]?down/.test(lower);
      const isLimit = err.status === 429 || e.type === "usage_limit_reached" || /usage[_ ]?limit|rate[_ ]?limit/.test(lower);
      const isGateway = AI.isGatewayError(err);

      // 估算剩余秒数（兼容 resets_in_seconds / reset_seconds / resets_at / reset_time）
      let secs = +e.resets_in_seconds || +e.reset_seconds || 0;
      if (!secs && e.resets_at) secs = Math.max(0, +e.resets_at - Math.floor(Date.now()/1000));
      if (!secs && typeof e.reset_time === "string") {
        const h = +(e.reset_time.match(/(\d+)\s*h/i)?.[1] || 0);
        const m = +(e.reset_time.match(/(\d+)\s*m(?!s)/i)?.[1] || 0);
        const s = +(e.reset_time.match(/(\d+)\s*s/i)?.[1] || 0);
        secs = h * 3600 + m * 60 + s;
      }
      const when = secs ? humanDur(secs) : "稍后";
      const resetAt = e.resets_at ? new Date(+e.resets_at * 1000).toLocaleString("zh-CN")
                     : (secs ? new Date(Date.now() + secs * 1000).toLocaleString("zh-CN") : "");

      const requested = AI.AIStore.data.currentModel || "(未知)";

      if (isCooldown) {
        const realModel = e.model ? `\`${e.model}\`` : "未知";
        const realProv = e.provider ? `\`${e.provider}\`` : "未知";
        const provider = AI.AIStore.currentProvider();
        const ledger = AI.cooldownLedger || {};
        const allTried = (provider?.models || []).filter((m) => ledger[provider.id + "::" + m]).map((m) => `\`${m}\``);
        const triedLine = allTried.length
          ? `- 本会话已尝试并标记冷却的模型：${allTried.join("、")}`
          : "";
        return [
          `**⚠️ 上游中转所有可用凭据都在冷却**`,
          ``,
          `- 你选择的模型：\`${requested}\``,
          `- 中转实际路由到：${realModel}（provider：${realProv}）`,
          `- 该后端的所有凭据正在冷却，约 **${when}** 后恢复${resetAt ? `（${resetAt}）` : ""}`,
          triedLine,
          ``,
          `客户端已经做了：① 同模型 1~2 次快速重试；② 沿下拉里的其它模型自动 fallback。下面这种情况都没成功，说明 CPAMC 这个号池整体确实在冷却。可以：`,
          `  1. 点 "立即重试" — 等几秒再试，刚释放的 Key 经常能命中；`,
          `  2. 在 "AI 设置" 加一个备用供应商，发不出去时一键切换；`,
          `  3. 联系 CPAMC 站长检查号池/限流配置；`,
          `  4. 等冷却结束自动恢复。`,
        ].filter(Boolean).join("\n");
      }
      if (isLimit) {
        const plan = e.plan_type ? `（${e.plan_type} 套餐）` : "";
        return [
          `**⚠️ 上游 AI 配额已用完${plan}**`,
          ``,
          `- 重置倒计时：约 **${when}**${resetAt ? `（${resetAt}）` : ""}`,
          `- 你可以：`,
          `  1. 等待自动恢复；`,
          `  2. 在 "AI 设置" 中切换到其它 **供应商 / 模型** 继续对话；`,
          `  3. 如果用的是图片生成模型，可以临时换一个不计入这个套餐的服务。`,
        ].join("\n");
      }
      if (isGateway) {
        const isTimeout = err.status === 504;
        const head = isTimeout
          ? `**⏱️ 上游网关超时（HTTP 504）**`
          : `**🚧 上游网关暂时不可达（HTTP ${err.status}）**`;
        return [
          head,
          ``,
          `- 你选择的模型：\`${requested}\``,
          `- 客户端已经做了：① 同模型 1~2 次重试；② 沿下拉里其它模型 fallback。还是失败说明中转/上游确实抽风。`,
          ``,
          isTimeout
            ? `**为什么常发生在画图请求**：图片生成动辄 30~60 秒，超过中转网关（Cloudflare/Nginx 默认 30~60s）的等待上限就会被强制 504 切断 —— 这跟模型有没有产出无关。`
            : `这通常是中转把流量打到的某台后端节点临时挂了或在重启。`,
          ``,
          `建议：`,
          `  1. 直接点 "🔁 立即重试"；`,
          `  2. 把提示词缩短一些（图片生成请求越短越不容易超时）；`,
          `  3. 在头部 🔍 主动找一个非画图、能正常出文字的模型；`,
          `  4. 在 "AI 设置" 中加一个直连图片生成 API 的供应商（避开中转）。`,
        ].join("\n");
      }
      return `**出错了：** ${msg}`;
    }
    function tryParseEmbeddedJson(text) {
      const i = String(text || "").indexOf("{");
      if (i < 0) return null;
      try { return JSON.parse(text.slice(i)); } catch (_) { return null; }
    }
    function humanDur(secs) {
      secs = Math.max(0, Math.floor(secs));
      if (secs < 60) return secs + " 秒";
      const m = Math.floor(secs / 60);
      if (m < 60) return m + " 分钟";
      const h = Math.floor(m / 60), rm = m % 60;
      if (h < 24) return rm ? `${h} 小时 ${rm} 分钟` : `${h} 小时`;
      const d = Math.floor(h / 24), rh = h % 24;
      return rh ? `${d} 天 ${rh} 小时` : `${d} 天`;
    }

    // 灯箱预览 / 图片悬浮按钮（下载、新窗口） / 错误气泡按钮 / 消息操作条
    messagesEl.addEventListener("click", (e) => {
      // 0) 消息操作条：复制 / 朗读（事件委托，替代逐条挂 listener）
      const actBtn = e.target.closest('[data-act="copy-msg"], [data-act="tts-msg"]');
      if (actBtn) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(actBtn.closest(".ai-msg")?.dataset.idx ?? -1);
        const m = idx >= 0 ? AI.AIStore.messages[idx] : null;
        if (!m) return;
        if (actBtn.dataset.act === "copy-msg") {
          navigator.clipboard?.writeText(m.content || "").then(
            () => toast("已复制原文"),
            () => toast("复制失败")
          );
        } else {
          window.AITts.speak(m.content, actBtn);
        }
        return;
      }
      // 0a) 错误气泡：立即重试
      if (e.target.closest("[data-retry-send]")) {
        e.preventDefault();
        e.stopPropagation();
        retryFromLastError();
        return;
      }
      // 0b) 错误气泡：清空本地冷却台账
      if (e.target.closest("[data-clear-cooldown]")) {
        e.preventDefault();
        e.stopPropagation();
        const k = AI.cooldownLedger || {};
        for (const key of Object.keys(k)) delete k[key];
        toast?.("已清空本地冷却记录，下次发送将重新尝试所有模型");
        return;
      }
      // 1) 图片悬浮按钮：下载 / 新窗口 / 复制提示词回填 / 重新生成
      const btn = e.target.closest("[data-img-act]");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const act = btn.dataset.imgAct;
        // 找所属消息：根据 DOM 顺序定位 messages 索引
        const msgEl = btn.closest(".ai-msg");
        const idx = msgEl ? Number(msgEl.dataset.idx ?? -1) : -1;
        const msg = idx >= 0 ? AI.AIStore.messages[idx] : null;

        if (act === "seed-prompt") {
          // 把这条 assistant 消息对应的 user prompt 回填到输入框
          const promptText = msg?.imageMeta?.prompt
            || (idx > 0 ? AI.AIStore.messages[idx - 1]?.content : "")
            || "";
          input.value = promptText;
          autoResize();
          input.focus();
          toast?.("已复制提示词到输入框");
          return;
        }
        if (act === "retry-image") {
          // 直接重发：把对应 user 消息的 prompt 当作新一轮提交
          retryFromLastError();
          return;
        }
        // 新卡片：open 用 data-url；老结构：从 .ai-img-figure 的 img 取 src
        let imgSrc = btn.dataset.url;
        let imgAlt = "";
        if (!imgSrc) {
          const fig = btn.closest(".ai-img-figure, .ai-img-card");
          const img = fig?.querySelector("img");
          if (img) { imgSrc = img.src; imgAlt = img.alt; }
        }
        if (!imgSrc) return;
        if (act === "open") {
          window.open(imgSrc, "_blank", "noopener");
        } else if (act === "download") {
          downloadImage(imgSrc, imgAlt);
        }
        return;
      }
      // 1.5) 卡片图片本身 → 灯箱（点 .ai-img-thumb）
      const thumb = e.target.closest(".ai-img-thumb");
      if (thumb) {
        // 借用现有 .ai-inline-img 的灯箱逻辑：先把 src 转给灯箱代码处理
        // 简单做法：当成 ai-inline-img 同等对待，下面的灯箱逻辑会接住
      }
      // 2) 点击图片 → 灯箱（兼容老 .ai-inline-img 和新 .ai-img-thumb）
      const img = e.target.closest(".ai-inline-img, .ai-img-thumb");
      if (!img) return;
      // 老结构里 <a class="ai-media-link"> 包着 <img>，避免新标签页打断预览
      const wrap = e.target.closest(".ai-media-link");
      if (wrap) e.preventDefault();
      openLightbox(img.src, img.alt);
    });

    let _lbBox = null;
    function openLightbox(src, alt) {
      if (!_lbBox) {
        _lbBox = document.createElement("div");
        _lbBox.className = "ai-lightbox";
        _lbBox.innerHTML = `
          <div class="ai-lightbox-toolbar">
            <button class="ai-lb-btn" data-lb-act="open" type="button" title="新窗口打开">↗</button>
            <button class="ai-lb-btn" data-lb-act="download" type="button" title="下载">⬇</button>
            <button class="ai-lb-btn" data-lb-act="close" type="button" title="关闭 (Esc)">✕</button>
          </div>
          <img alt="">`;
        _lbBox.addEventListener("click", (e) => {
          const b = e.target.closest("[data-lb-act]");
          const img = _lbBox.querySelector("img");
          if (!b) {
            // 点击空白区域关闭，但点击图片本身不关闭
            if (e.target.tagName !== "IMG") _lbBox.hidden = true;
            return;
          }
          e.stopPropagation();
          if (b.dataset.lbAct === "close") _lbBox.hidden = true;
          else if (b.dataset.lbAct === "open") window.open(img.src, "_blank", "noopener");
          else if (b.dataset.lbAct === "download") downloadImage(img.src, img.alt);
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && _lbBox && !_lbBox.hidden) _lbBox.hidden = true;
        });
        document.body.appendChild(_lbBox);
      }
      const img = _lbBox.querySelector("img");
      img.src = src;
      img.alt = alt || "";
      _lbBox.hidden = false;
    }

    /** 把任意图片（http(s) / data: / blob:）保存到本地。
     *  优先用 fetch + Blob，失败就退化到 <a download> + 新窗口提示。 */
    async function downloadImage(src, hint) {
      if (!src) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const baseName = (hint || "sakura-ai-image").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "image";
      // data: 直接转 Blob
      if (src.startsWith("data:")) {
        try {
          const m = /^data:([^;,]+)(?:;base64)?,/i.exec(src) || [];
          const mime = m[1] || "image/png";
          const ext = (mime.split("/")[1] || "png").split("+")[0];
          const blob = await (await fetch(src)).blob();
          triggerSave(blob, `${baseName}-${stamp}.${ext}`);
          return;
        } catch (_) { /* 失败则继续走通用路径 */ }
      }
      try {
        const res = await fetch(src, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || guessExt(src)).split(";")[0] || "png";
        triggerSave(blob, `${baseName}-${stamp}.${ext}`);
        toast?.("已开始下载");
      } catch (_) {
        // CORS 失败：退化为新窗口（用户右键另存为）
        const a = document.createElement("a");
        a.href = src;
        a.target = "_blank";
        a.rel = "noopener";
        a.download = `${baseName}-${stamp}.${guessExt(src)}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast?.("当前图片不支持直接下载，已新窗口打开，请右键另存为");
      }
    }
    function guessExt(url) {
      const m = /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i.exec(url || "");
      return m ? m[1].toLowerCase() : "png";
    }
    function triggerSave(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }

    // 拖拽文件到输入框
    panel.addEventListener("dragover", (e) => { e.preventDefault(); });
    panel.addEventListener("drop", async (e) => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) {
        try {
          const att = await AI.fileToAttachment(f);
          attachments.push(att);
          if (att?.type === "image" && att.dataUrl && window.Archive?.Gallery) {
            window.Archive.Gallery.add({
              source: "uploaded",
              dataUrl: att.dataUrl,
              name: att.name || "",
              mime: f.type || "image/png",
              bytes: f.size || 0,
            }).catch(() => {});
          }
        }
        catch (_) {}
      }
      renderAttachments();
    });

    return { open, close, refreshPersonaOptions, refreshModelOptions, refreshModelStatus, renderMessages };
  })();

  // ===================== 历史归档 UI（多会话 + 图库）=====================
  const UIArchive = (() => {
    const dlgSessions = $("#dialog-sessions");
    const dlgGallery  = $("#dialog-gallery");
    let _saveTimer = null;

    // Archive 缺失（IDB 不可用 / archive.js 加载失败）时给个温和的兜底：
    // 按钮仍可点，但 toast 提示原因，便于用户排查；不再 return null 让按钮变哑巴。
    if (!window.Archive) {
      console.warn("[UIArchive] window.Archive 未就绪，可能 archive.js 没加载或 IndexedDB 不可用");
      const warn = () => toast("图库 / 会话功能未启用：浏览器禁用了 IndexedDB 或脚本加载失败", 4000);
      $("#ai-sessions")?.addEventListener("click", warn);
      $("#ai-gallery") ?.addEventListener("click", warn);
      return null;
    }
    const { Gallery, Sessions } = window.Archive;

    // 给 currentId/AIStore.messages 关联：saveMessages 之后异步把当前会话写入 DB
    function patchSaveMessages() {
      const origin = AI.AIStore.saveMessages.bind(AI.AIStore);
      AI.AIStore.saveMessages = function () {
        origin();
        scheduleSessionFlush();
      };
    }
    function scheduleSessionFlush() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(flushCurrentSession, 350);
    }
    async function flushCurrentSession() {
      try {
        await Archive.ready;
        let id = Sessions.currentId();
        if (!id) {
          // 还没绑定当前会话：建一个
          const rec = await Sessions.create({
            title: Sessions.autoTitle(AI.AIStore.messages) || "新会话",
            messages: AI.AIStore.messages,
            model: AI.AIStore.data.currentModel || "",
            persona: (AI.AIStore.currentPersona && AI.AIStore.currentPersona()?.id) || "",
          });
          Sessions.setCurrentId(rec.id);
          return;
        }
        // 已有当前会话：找标题（首次有用户消息后自动改名）
        const cur = await Sessions.load(id);
        const metaPatch = {
          model: AI.AIStore.data.currentModel || cur?.model || "",
          persona: (AI.AIStore.currentPersona && AI.AIStore.currentPersona()?.id) || cur?.persona || "",
        };
        if (cur && (!cur.title || /^新会话/.test(cur.title))) {
          const auto = Sessions.autoTitle(AI.AIStore.messages);
          if (auto) metaPatch.title = auto;
        }
        await Sessions.save(id, AI.AIStore.messages, metaPatch);
      } catch (e) {
        // 静默：localStorage 仍然是兜底
        console.debug("[Archive] flush session:", e);
      }
    }

    // 启动：等 archive bootstrap 完，从当前会话拉消息
    async function init() {
      try {
        await Archive.ready;
        patchSaveMessages();
        const id = Sessions.currentId();
        if (id) {
          const rec = await Sessions.load(id);
          if (rec && Array.isArray(rec.messages) && rec.messages.length) {
            // 仅当 IDB 里有更多消息时才覆盖（避免反向回放）
            const lsCount = (AI.AIStore.messages || []).length;
            if (rec.messages.length >= lsCount) {
              AI.AIStore.messages = rec.messages;
              UIAI.renderMessages();
            }
          }
        }
      } catch (e) {
        console.warn("[UIArchive.init]", e);
      }
    }
    init();

    // ---------- 会话弹窗 ----------
    function openSessions() {
      if (!dlgSessions) {
        console.warn("[UIArchive] #dialog-sessions 不存在 — 检查 index.html 是否包含会话弹窗元素");
        toast("会话弹窗模板缺失，请刷新页面或重新部署");
        return;
      }
      try {
        renderSessionsList();
        Dlg.open(dlgSessions);
      } catch (e) {
        console.error("[UIArchive.openSessions]", e);
        toast("打开会话弹窗出错：" + (e?.message || e), 4000);
      }
    }
    async function renderSessionsList(filterText = "") {
      const list = $("#sessions-list");
      const empty = $("#sessions-empty");
      const all = await Sessions.list();
      const q = filterText.trim().toLowerCase();
      const filtered = q
        ? all.filter((s) => (s.title || "").toLowerCase().includes(q))
        : all;
      const curId = Sessions.currentId();
      if (!filtered.length) {
        list.innerHTML = "";
        empty.hidden = false;
        empty.textContent = q ? `没有匹配 "${filterText}" 的会话` : "还没有历史会话。点 + 新建一个开始。";
        return;
      }
      empty.hidden = true;
      list.innerHTML = filtered.map((s) => {
        const isCur = s.id === curId;
        const date = new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleString();
        return `<div class="session-row ${isCur ? "is-current" : ""}" data-id="${s.id}">
          <button type="button" class="session-pin" data-act="pin" title="${s.pinned ? "取消置顶" : "置顶"}">${s.pinned ? "📌" : "📍"}</button>
          <div class="session-info">
            <div class="session-title">${escapeHtml(s.title || "新会话")}</div>
            <div class="session-meta">${s.messageCount || 0} 条 · ${escapeHtml(date)}${s.model ? " · " + escapeHtml(s.model) : ""}</div>
          </div>
          <div class="session-acts">
            ${isCur ? `<span class="session-cur-badge">当前</span>` : `<button type="button" class="mini-btn" data-act="switch">切换</button>`}
            <button type="button" class="mini-btn" data-act="rename" title="重命名">✎</button>
            <button type="button" class="mini-btn danger" data-act="remove" title="删除">🗑</button>
          </div>
        </div>`;
      }).join("");
    }

    $("#ai-sessions")?.addEventListener("click", openSessions);
    $("#sessions-search")?.addEventListener("input", (e) => renderSessionsList(e.target.value));
    $("#sessions-new")?.addEventListener("click", async () => {
      // 新建：把当前消息保留为旧会话快照，开一个空会话
      await flushCurrentSession();
      const rec = await Sessions.create({ title: "新会话", messages: [] });
      Sessions.setCurrentId(rec.id);
      AI.AIStore.messages = [];
      AI.AIStore.saveMessages();
      UIAI.renderMessages();
      toast("已开启新会话");
      renderSessionsList($("#sessions-search").value || "");
    });
    dlgSessions?.addEventListener("click", async (e) => {
      const row = e.target.closest(".session-row");
      const btn = e.target.closest("[data-act]");
      if (!row || !btn) return;
      const id = row.dataset.id;
      const act = btn.dataset.act;
      if (act === "switch") {
        await flushCurrentSession();
        const rec = await Sessions.load(id);
        if (!rec) return;
        Sessions.setCurrentId(id);
        AI.AIStore.messages = Array.isArray(rec.messages) ? rec.messages : [];
        // 直接重写 localStorage，避免下一次 saveMessages 把旧的写回
        try { localStorage.setItem("sakura_nav_chat_v1", JSON.stringify(AI.AIStore.messages.slice(-200))); } catch (_) {}
        UIAI.renderMessages();
        Dlg.close(dlgSessions);
        toast(`已切到「${rec.title || "会话"}」`);
      }
      if (act === "rename") {
        const cur = await Sessions.load(id);
        const name = prompt("会话标题：", cur?.title || "");
        if (name !== null) {
          await Sessions.rename(id, name);
          renderSessionsList($("#sessions-search").value || "");
        }
      }
      if (act === "remove") {
        const cur = await Sessions.load(id);
        if (!confirm(`删除会话「${cur?.title || "未命名"}」？此操作不可撤销。`)) return;
        await Sessions.remove(id);
        if (Sessions.currentId() === id) {
          Sessions.setCurrentId("");
          AI.AIStore.messages = [];
          try { localStorage.removeItem("sakura_nav_chat_v1"); } catch (_) {}
          UIAI.renderMessages();
        }
        renderSessionsList($("#sessions-search").value || "");
      }
      if (act === "pin") {
        await Sessions.togglePinned(id);
        renderSessionsList($("#sessions-search").value || "");
      }
    });

    // ---------- 图库弹窗 ----------
    let galleryFilter = "all";
    let gallerySelectMode = false;          // 选择模式开关
    /** 选中的图片 id —— 有序数组（决定背景轮播的播放顺序）。
     *  之前是 Set，为了支持拖拽改顺序改成 Array，对外行为保持"集合"语义。 */
    const gallerySelected = [];
    const galSel = {
      has(id) { return gallerySelected.includes(id); },
      add(id) { if (!this.has(id)) gallerySelected.push(id); },
      delete(id) {
        const i = gallerySelected.indexOf(id);
        if (i >= 0) gallerySelected.splice(i, 1);
      },
      toggle(id) { this.has(id) ? this.delete(id) : this.add(id); },
      clear() { gallerySelected.length = 0; },
      get size() { return gallerySelected.length; },
      values() { return gallerySelected.slice(); },
      move(fromIdx, toIdx) {
        if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0
            || fromIdx >= gallerySelected.length || toIdx >= gallerySelected.length) return;
        const [it] = gallerySelected.splice(fromIdx, 1);
        gallerySelected.splice(toIdx, 0, it);
      },
    };
    let galleryCurrentItems = [];           // 当前视图渲染出的 items（供"全选当前视图"用）

    function openGallery() {
      if (!dlgGallery) {
        console.warn("[UIArchive] #dialog-gallery 不存在 — 检查 index.html 是否包含图库弹窗元素");
        toast("图库弹窗模板缺失，请刷新页面或重新部署");
        return;
      }
      try {
        const intEl = $("#gallery-bg-interval");
        if (intEl) intEl.value = Math.max(5, Math.min(3600, +Store.settings.bgInterval || 60));
        const shEl  = $("#gallery-bg-shuffle");
        if (shEl) shEl.checked = !!Store.settings.bgShuffle;
        initGalleryGen();
        refreshGenProviders();
        showGalleryTab("library");
        refreshPresetSelect();
        renderGallery();
        renderSelThumbStrip();
        Dlg.open(dlgGallery);
      } catch (e) {
        console.error("[UIArchive.openGallery]", e);
        toast("打开图库出错：" + (e?.message || e), 4000);
      }
    }

    function setGallerySelectMode(on) {
      gallerySelectMode = !!on;
      const selbar = $("#gallery-selbar");
      const toggleBtn = $("#gallery-select-toggle");
      if (selbar) selbar.hidden = !gallerySelectMode;
      if (toggleBtn) {
        toggleBtn.textContent = gallerySelectMode ? "✕ 退出选择" : "☑ 选择";
        toggleBtn.classList.toggle("primary", gallerySelectMode);
      }
      if (!gallerySelectMode) galSel.clear();
      updateGallerySelCount();
      renderGallery();
    }

    function updateGallerySelCount() {
      const el = $("#gallery-sel-count");
      if (el) el.textContent = galSel.size;
      const useBtn = $("#gallery-use-bg");
      if (useBtn) useBtn.disabled = galSel.size === 0;
      // 顺序条同步刷新
      renderSelThumbStrip();
    }

    async function renderGallery() {
      const grid = $("#gallery-grid");
      const empty = $("#gallery-empty");
      const stat  = $("#gallery-stat");
      const q     = $("#gallery-search")?.value || "";
      const opts  = { query: q };
      if (galleryFilter === "generated") opts.source = "generated";
      if (galleryFilter === "uploaded")  opts.source = "uploaded";
      if (galleryFilter === "favorite")  opts.favoriteOnly = true;
      const items = await Gallery.list(opts);
      galleryCurrentItems = items;
      // 进入选择模式时给整个 grid 加一个 class，CSS 接管显示 checkbox
      grid?.classList.toggle("is-selecting", gallerySelectMode);

      // 顶部统计
      try {
        const total = await Gallery.count();
        const bytes = await Gallery.totalBytes();
        const mb = (bytes / 1024 / 1024).toFixed(1);
        stat.textContent = `共 ${total} 张 · 约 ${mb} MB`;
      } catch (_) {}

      if (!items.length) {
        grid.innerHTML = "";
        empty.hidden = false;
        empty.textContent = q
          ? `没有匹配 "${q}" 的图`
          : "这里还没有图。生图或上传图片附件后会自动入库。";
        return;
      }
      empty.hidden = true;
      grid.innerHTML = items.map((it) => {
        const cap = (it.prompt || it.name || it.revisedPrompt || "").trim();
        const tip = cap || (it.source === "uploaded" ? "上传图片" : "生成图片");
        const dateStr = new Date(it.ts || Date.now()).toLocaleString();
        const tag = it.source === "uploaded" ? "上传" : "生图";
        const hasUrl = !!it.serverUrl;
        const urlBadge = hasUrl
          ? `<span class="gallery-url-badge" title="已同步到服务端 · 点 🔗 复制公开 URL">🔗 URL</span>`
          : `<span class="gallery-url-badge pending" title="正在同步到服务端…">⤴ 同步中</span>`;
        const isSel = galSel.has(it.id);
        const selOverlay = gallerySelectMode
          ? `<span class="gallery-check ${isSel ? "on" : ""}" data-act="sel" aria-label="选择">${isSel ? "✓" : ""}</span>`
          : "";
        return `<figure class="gallery-card ${it.favorite ? "is-fav" : ""} ${isSel ? "is-selected" : ""}" data-id="${it.id}">
          ${selOverlay}
          <img src="${it.dataUrl}" alt="${escapeAttr(tip)}" loading="lazy" />
          <figcaption class="gallery-cap">
            <span class="gallery-tag ${it.source}">${tag}</span>
            <span class="gallery-cap-text" title="${escapeAttr(tip)}">${escapeHtml(cap.slice(0, 32) || dateStr)}</span>
            ${urlBadge}
          </figcaption>
          <div class="gallery-acts">
            <button type="button" class="mini-btn" data-act="edit" title="打开图像编辑器（裁剪/旋转/翻转/画笔）">✏️</button>
            <button type="button" class="mini-btn" data-act="set-bg" title="设为当前背景（单张）">📌</button>
            ${hasUrl ? `<button type="button" class="mini-btn" data-act="copy-url" title="复制公开 URL">🔗</button>` : ""}
            <button type="button" class="mini-btn" data-act="fav" title="${it.favorite ? "取消收藏" : "收藏"}">${it.favorite ? "★" : "☆"}</button>
            <a class="mini-btn" href="${it.dataUrl}" download="${it.name || ("sakura-image-" + (it.id || "")) + ".png"}" title="下载">⬇</a>
            <button type="button" class="mini-btn" data-act="copy" title="复制 prompt">✎</button>
            <button type="button" class="mini-btn danger" data-act="remove" title="删除">🗑</button>
          </div>
        </figure>`;
      }).join("");
    }

    /** 把选中的图片应用为背景轮播：serverUrl 优先（小且 CDN 友好），dataUrl 兜底。 */
    async function applySelectedAsBackground() {
      if (!galSel.size) { toast("先勾选至少一张图"); return; }
      const intervalEl = $("#gallery-bg-interval");
      const intervalSec = Math.max(5, Math.min(3600, parseInt(intervalEl?.value, 10) || 60));
      const shuffle = !!$("#gallery-bg-shuffle")?.checked;

      // 按 selected 顺序解析 URL（拖拽过的顺序）；优先 serverUrl
      const ids = galSel.values();
      const urls = [];
      let dataUrlCount = 0;
      for (const id of ids) {
        const rec = await Gallery.get(id);
        if (!rec) continue;
        if (rec.serverUrl) urls.push(rec.serverUrl);
        else if (rec.dataUrl) { urls.push(rec.dataUrl); dataUrlCount++; }
      }
      if (!urls.length) { toast("选中的图都没有可用 URL"); return; }

      if (dataUrlCount >= 3) {
        const ok = confirm(
          `其中有 ${dataUrlCount} 张还未同步到服务端，将以 base64 形式存进设置里。\n` +
          `这可能让 nav 的设置体积膨胀几 MB。\n\n` +
          `继续？（建议等所有图都显示 🔗 URL 后再做）`
        );
        if (!ok) return;
      }

      Store.settings.bgShuffle = shuffle;
      Store.settings.bgMode = "rotate";
      Store.settings.bgList = urls;
      Store.settings.bgInterval = intervalSec;
      try { Store.save(); } catch (_) {}
      Bg.apply();

      // 同步设置面板里的 bgMode UI（如果当前打开）
      try {
        const radio = document.querySelector('input[name="bg-mode"][value="rotate"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
      } catch (_) {}

      toast(`✨ 已应用 ${urls.length} 张为背景轮播 · 每 ${intervalSec}s 一张 ${shuffle ? "(随机)" : ""}`);
      Dlg.close(dlgGallery);
      setGallerySelectMode(false);
    }

    // ---------- 拖拽排序：缩略图条 ----------
    /** 渲染顶部缩略图条；按 galSel 当前顺序展示，可拖动改顺序 */
    async function renderSelThumbStrip() {
      const wrap = $("#gallery-sel-thumbs");
      const strip = $("#gallery-sel-thumb-strip");
      if (!wrap || !strip) return;
      if (!galSel.size) {
        wrap.hidden = true;
        strip.innerHTML = "";
        return;
      }
      wrap.hidden = false;
      const ids = galSel.values();
      const records = [];
      for (const id of ids) {
        const rec = await Gallery.get(id);
        if (rec) records.push(rec);
      }
      strip.innerHTML = records.map((r, i) => `
        <div class="gallery-sel-thumb" draggable="true" data-id="${r.id}" data-idx="${i}" title="拖拽以改顺序">
          <span class="gallery-sel-thumb-idx">${i + 1}</span>
          <img src="${r.dataUrl}" alt="" />
          <button type="button" class="gallery-sel-thumb-x" data-act="thumb-remove" title="从选中里移除">×</button>
        </div>
      `).join("");
    }

    // 拖拽事件 —— 用纯 HTML5 drag API，dragover 期间标记 placeholder 位置
    let _dragFromIdx = -1;
    $("#gallery-sel-thumb-strip")?.addEventListener("dragstart", (e) => {
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (!thumb) return;
      _dragFromIdx = +thumb.dataset.idx;
      thumb.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", thumb.dataset.id); } catch (_) {}
    });
    $("#gallery-sel-thumb-strip")?.addEventListener("dragend", (e) => {
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (thumb) thumb.classList.remove("dragging");
      $$(".gallery-sel-thumb", $("#gallery-sel-thumb-strip")).forEach((t) => t.classList.remove("drop-before", "drop-after"));
      _dragFromIdx = -1;
    });
    $("#gallery-sel-thumb-strip")?.addEventListener("dragover", (e) => {
      e.preventDefault();
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (!thumb || _dragFromIdx < 0) return;
      $$(".gallery-sel-thumb", $("#gallery-sel-thumb-strip")).forEach((t) => t.classList.remove("drop-before", "drop-after"));
      const r = thumb.getBoundingClientRect();
      const before = (e.clientX - r.left) < (r.width / 2);
      thumb.classList.add(before ? "drop-before" : "drop-after");
    });
    $("#gallery-sel-thumb-strip")?.addEventListener("drop", (e) => {
      e.preventDefault();
      const thumb = e.target.closest(".gallery-sel-thumb");
      if (!thumb || _dragFromIdx < 0) return;
      const toIdx0 = +thumb.dataset.idx;
      const r = thumb.getBoundingClientRect();
      const before = (e.clientX - r.left) < (r.width / 2);
      // 计算最终插入位置；删掉源后插入目标位置
      let toIdx = before ? toIdx0 : toIdx0 + 1;
      if (toIdx > _dragFromIdx) toIdx--; // 删源后原右侧索引整体左移 1
      galSel.move(_dragFromIdx, toIdx);
      _dragFromIdx = -1;
      renderSelThumbStrip();
      renderGallery(); // 让 grid 卡片角标也更新（虽然 grid 不显示顺序，但更稳）
    });

    // 缩略图上的 × 按钮：单张移除
    $("#gallery-sel-thumb-strip")?.addEventListener("click", (e) => {
      const x = e.target.closest("[data-act='thumb-remove']");
      if (!x) return;
      const id = x.closest(".gallery-sel-thumb")?.dataset.id;
      if (!id) return;
      galSel.delete(id);
      updateGallerySelCount();
      renderGallery();
    });

    // 上传完成事件：图库面板若已打开就重渲染（让"同步中"变成"🔗 URL"）
    window.addEventListener("sakura:gallery-uploaded", () => {
      if (dlgGallery && dlgGallery.open) renderGallery();
    });
    function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;"); }

    // ---------- 图集预设：增删改查 + 下拉同步 ----------
    function refreshPresetSelect() {
      const sel = $("#gallery-preset-select");
      if (!sel) return;
      const list = Store.settings.bgPresets || [];
      const cur = sel.value;
      sel.innerHTML = `<option value="">— 选择预设 —</option>` +
        list.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)} (${(p.urls || []).length})</option>`).join("");
      if (cur && list.find((p) => p.id === cur)) sel.value = cur;
    }

    async function loadPreset(id) {
      const list = Store.settings.bgPresets || [];
      const p = list.find((x) => x.id === id);
      if (!p) { toast("预设不存在"); return; }
      // 直接应用为当前背景，并把 urls 反向写回 selected（按 URL 反查 IDB 不可行 —— 用一个临时方案：清空 selected，但 urls 直接生效）
      Store.settings.bgMode = "rotate";
      Store.settings.bgList = (p.urls || []).slice();
      Store.settings.bgInterval = Math.max(5, Math.min(3600, +p.interval || 60));
      Store.settings.bgShuffle = !!p.shuffle;
      try { Store.save(); } catch (_) {}
      Bg.apply();
      // UI 同步
      try {
        const radio = document.querySelector('input[name="bg-mode"][value="rotate"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
      } catch (_) {}
      const intEl = $("#gallery-bg-interval"); if (intEl) intEl.value = Store.settings.bgInterval;
      const shEl  = $("#gallery-bg-shuffle"); if (shEl) shEl.checked = Store.settings.bgShuffle;
      toast(`✨ 已加载预设「${p.name}」· ${(p.urls || []).length} 张 · 每 ${Store.settings.bgInterval}s${Store.settings.bgShuffle ? " · 随机" : ""}`);
      Dlg.close(dlgGallery);
      setGallerySelectMode(false);
    }

    async function savePresetFromSelection() {
      if (!galSel.size) { toast("先勾选至少一张图"); return; }
      const name = prompt("给这个预设起个名字：", `图集 ${(Store.settings.bgPresets || []).length + 1}`);
      if (!name) return;
      // 解析 urls（同 applySelectedAsBackground 的逻辑，但不真的应用）
      const ids = galSel.values();
      const urls = [];
      for (const id of ids) {
        const rec = await Gallery.get(id);
        if (!rec) continue;
        urls.push(rec.serverUrl || rec.dataUrl);
      }
      const filtered = urls.filter(Boolean);
      if (!filtered.length) { toast("选中的图都没有可用 URL"); return; }
      const shuffle = !!$("#gallery-bg-shuffle")?.checked;
      const interval = Math.max(5, Math.min(3600, parseInt($("#gallery-bg-interval")?.value, 10) || 60));
      const preset = {
        id: "bgp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        name: String(name).slice(0, 40),
        urls: filtered,
        shuffle,
        interval,
        createdAt: Date.now(),
      };
      Store.settings.bgPresets = [...(Store.settings.bgPresets || []), preset];
      try { Store.save(); } catch (_) {}
      refreshPresetSelect();
      // 选中刚保存的
      const sel = $("#gallery-preset-select");
      if (sel) sel.value = preset.id;
      toast(`✨ 已保存预设「${preset.name}」`);
    }

    function deleteSelectedPreset() {
      const sel = $("#gallery-preset-select");
      const id = sel?.value;
      if (!id) { toast("先在下拉里选一个预设"); return; }
      const list = Store.settings.bgPresets || [];
      const p = list.find((x) => x.id === id);
      if (!p) return;
      if (!confirm(`删除预设「${p.name}」？此操作不可撤销。`)) return;
      Store.settings.bgPresets = list.filter((x) => x.id !== id);
      try { Store.save(); } catch (_) {}
      refreshPresetSelect();
      toast("预设已删除");
    }

    $("#ai-gallery")?.addEventListener("click", openGallery);
    $("#gallery-search")?.addEventListener("input", () => renderGallery());

    // 选择模式相关 ----------
    $("#gallery-select-toggle")?.addEventListener("click", () => {
      setGallerySelectMode(!gallerySelectMode);
    });
    $("#gallery-sel-all")?.addEventListener("click", () => {
      galleryCurrentItems.forEach((it) => galSel.add(it.id));
      updateGallerySelCount();
      renderGallery();
    });
    $("#gallery-sel-none")?.addEventListener("click", () => {
      galSel.clear();
      updateGallerySelCount();
      renderGallery();
    });
    $("#gallery-use-bg")?.addEventListener("click", applySelectedAsBackground);

    // 预设相关 ----------
    $("#gallery-preset-save")?.addEventListener("click", savePresetFromSelection);
    $("#gallery-preset-load")?.addEventListener("click", () => {
      const id = $("#gallery-preset-select")?.value;
      if (!id) { toast("先在下拉里选一个预设"); return; }
      loadPreset(id);
    });
    $("#gallery-preset-delete")?.addEventListener("click", deleteSelectedPreset);
    // 直接 change 下拉也算"加载"：双击体验更好但保留 [加载] 按钮兜底
    $("#gallery-preset-select")?.addEventListener("dblclick", () => {
      const id = $("#gallery-preset-select")?.value;
      if (id) loadPreset(id);
    });
    $$(".gallery-filter").forEach((b) => {
      b.addEventListener("click", () => {
        $$(".gallery-filter").forEach((x) => {
          x.classList.toggle("is-active", x === b);
          x.setAttribute("aria-selected", x === b ? "true" : "false");
        });
        galleryFilter = b.dataset.filter;
        renderGallery();
      });
    });
    $("#gallery-clear")?.addEventListener("click", async () => {
      const c = await Gallery.count();
      if (!c) { toast("图库已经是空的"); return; }
      if (!confirm(`确定清空整个图库（${c} 张）？此操作不可撤销。`)) return;
      await Gallery.clear();
      renderGallery();
      toast("图库已清空");
    });
    $("#gallery-grid")?.addEventListener("click", async (e) => {
      const card = e.target.closest(".gallery-card");
      if (!card) return;
      const id = card.dataset.id;
      const act = e.target.closest("[data-act]")?.dataset.act;

      // 选择模式：点 checkbox 或图片本体都切换选中态；点 .gallery-acts 里的按钮还是正常走
      if (gallerySelectMode && (act === "sel" || (!act && !e.target.closest(".gallery-acts")))) {
        galSel.toggle(id);
        updateGallerySelCount();
        const isSel = galSel.has(id);
        card.classList.toggle("is-selected", isSel);
        const chk = card.querySelector(".gallery-check");
        if (chk) { chk.classList.toggle("on", isSel); chk.textContent = isSel ? "✓" : ""; }
        return;
      }

      if (!act) {
        // 点击图片本体 → 灯箱（用现有 lightbox 机制）
        const rec = await Gallery.get(id);
        if (rec?.dataUrl) {
          window.open(rec.dataUrl, "_blank", "noopener");
        }
        return;
      }
      if (act === "fav") {
        await Gallery.toggleFavorite(id);
        renderGallery();
      }
      if (act === "copy") {
        const rec = await Gallery.get(id);
        const txt = rec?.prompt || rec?.revisedPrompt || "";
        if (!txt) { toast("这张图没有可复制的 prompt"); return; }
        try { await navigator.clipboard.writeText(txt); toast("已复制 prompt"); }
        catch (_) { toast("复制失败"); }
      }
      if (act === "copy-url") {
        const rec = await Gallery.get(id);
        if (!rec?.serverUrl) { toast("还没同步到服务端"); return; }
        // serverUrl 是 /api/gallery/image/xxx.png，拼成完整 URL
        const absUrl = new URL(rec.serverUrl, location.origin).href;
        try { await navigator.clipboard.writeText(absUrl); toast("已复制公开 URL"); }
        catch (_) { toast("复制失败"); }
      }
      if (act === "set-bg") {
        // 单张设为背景：优先 serverUrl（小），否则 dataUrl
        const rec = await Gallery.get(id);
        if (!rec) return;
        const url = rec.serverUrl || rec.dataUrl;
        if (!url) { toast("这张图没有可用 URL"); return; }
        Store.settings.bgMode = "single";
        Store.settings.bgSingle = url;
        try { Store.save(); } catch (_) {}
        Bg.apply();
        try {
          const radio = document.querySelector('input[name="bg-mode"][value="single"]');
          if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
        } catch (_) {}
        toast("✨ 已设为当前背景");
      }
      if (act === "edit") {
        const rec = await Gallery.get(id);
        if (!rec) return;
        if (!window.ImageEditor) { toast("图像编辑器模块未加载"); return; }
        try {
          await window.ImageEditor.open(rec, async ({ dataUrl, prompt, model }) => {
            // 编辑结果作为新条目入图库（不覆盖原图）
            const newId = await Gallery.add({
              source: "uploaded",
              dataUrl,
              prompt: (prompt || rec.prompt || "") + " (edited)",
              name: (rec.name || "image") + "-edited.png",
              mime: "image/png",
              model: model || rec.model || "",
            });
            renderGallery();
            toast(newId ? "✏️ 编辑结果已存为图库新条目" : "保存失败");
          });
        } catch (e) {
          toast("打开编辑器失败：" + (e?.message || e), 4000);
        }
      }
      if (act === "remove") {
        if (!confirm("删除这张图？(本地 + 服务端都会删)")) return;
        const rec = await Gallery.get(id);
        await Gallery.remove(id);
        // 后台异步删服务端文件
        if (rec?.serverId) {
          const ext = (rec.mime || "image/png").split("/")[1] || "png";
          fetch(`/api/gallery/image/${rec.serverId}.${ext}`, {
            method: "DELETE",
            credentials: "same-origin",
          }).catch(() => {});
        }
        renderGallery();
      }
    });

    // ===================== 图库 · 生图标签页（文生图 / 图生图） =====================
    // 复用 AI.generateImage（/v1/images/generations）与 AI.generateImageEdit（/v1/images/edits）。
    // 生图参数复用 AIStore.data.imageOpts（与原聊天生图共用持久化），并新增 genMode / genProviderId / genModel。
    const genState = { mode: "t2i", refs: [], abort: null, inited: false, results: [] };

    function genEl(id) { return document.getElementById(id); }
    function persistGenOpt(key, val) {
      AI.AIStore.data.imageOpts = { ...(AI.AIStore.data.imageOpts || {}), [key]: val };
      try { AI.AIStore.save(); } catch (_) {}
    }
    function readFileAsDataURL(f) {
      return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    }

    function showGalleryTab(name) {
      $$(".gallery-tab").forEach((t) => {
        const on = t.dataset.gtab === name;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      $$(".gallery-tabpanel").forEach((p) => { p.hidden = p.dataset.gpanel !== name; });
      if (name === "library") renderGallery();
    }

    function refreshGenProviders() {
      const provSel = genEl("gen-provider");
      if (!provSel) return;
      const providers = AI.AIStore.data.providers || [];
      const opts = AI.AIStore.data.imageOpts || {};
      const curProv = AI.AIStore.currentProvider && AI.AIStore.currentProvider();
      const savedId = opts.genProviderId || curProv?.id || providers[0]?.id || "";
      provSel.innerHTML = providers.length
        ? providers.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("")
        : `<option value="">（请先在 AI 设置里添加供应商）</option>`;
      if (providers.some((p) => p.id === savedId)) provSel.value = savedId;
      refreshGenModelList(false);
    }

    function refreshGenModelList(forceDefault) {
      const provSel = genEl("gen-provider");
      const modelInput = genEl("gen-model");
      const list = genEl("gen-model-list");
      if (!provSel || !modelInput) return;
      const providers = AI.AIStore.data.providers || [];
      const prov = providers.find((p) => p.id === provSel.value);
      const models = (prov?.models || []).slice();
      if (prov?.defaultModel && !models.includes(prov.defaultModel)) models.unshift(prov.defaultModel);
      // 百炼（DashScope）供应商：补充常用文生图模型建议，方便从下拉里直接选用
      if (/dashscope|aliyuncs\.com/i.test(prov?.baseUrl || "")) {
        ["wan2.5-t2i-preview", "wanx2.1-t2i-turbo", "wanx2.1-t2i-plus", "wanx2.0-t2i-turbo", "qwen-image", "flux-schnell", "flux-dev"]
          .forEach((m) => { if (!models.includes(m)) models.push(m); });
      }
      if (list) list.innerHTML = models.map((m) => `<option value="${escapeAttr(m)}"></option>`).join("");
      if (forceDefault || !modelInput.value) {
        const saved = AI.AIStore.data.imageOpts?.genModel || "";
        const curProv = AI.AIStore.currentProvider && AI.AIStore.currentProvider();
        let pick = "";
        if (!forceDefault && saved) pick = saved;
        if (!pick && prov && curProv && prov.id === curProv.id && AI.AIStore.data.currentModel) pick = AI.AIStore.data.currentModel;
        if (!pick) pick = prov?.defaultModel || models[0] || "";
        modelInput.value = pick;
      }
    }

    function syncGenMode() {
      const mode = genState.mode || "t2i";
      $$(".gen-mode-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.mode === mode));
      const refs = genEl("gen-refs");
      if (refs) refs.hidden = mode !== "i2i";
      const apiField = dlgGallery?.querySelector(".gen-field-api");
      if (apiField) apiField.hidden = mode === "i2i";
      const prompt = genEl("gen-prompt");
      if (prompt) prompt.placeholder = mode === "i2i"
        ? "描述如何编辑参考图（留空＝按模型默认重绘）…（Ctrl/⌘ + Enter 生成）"
        : "描述要生成的图片…（Ctrl/⌘ + Enter 生成）";
      syncGenDriver();
    }
    function syncGenDriver() {
      const apiSel = genEl("gen-api-mode");
      const driverField = genEl("gen-driver-field");
      const isResp = (genState.mode !== "i2i") && apiSel && apiSel.value === "responses";
      if (driverField) driverField.hidden = !isResp;
    }
    function syncGenCustom() {
      const sizeSel = genEl("gen-size");
      const customField = genEl("gen-custom-field");
      if (customField) customField.hidden = !(sizeSel && sizeSel.value === "custom");
    }

    function renderGenRefs() {
      const wrap = genEl("gen-ref-thumbs");
      const empty = genEl("gen-ref-empty");
      if (!wrap) return;
      wrap.innerHTML = genState.refs.map((r, i) =>
        `<div class="gen-ref-thumb"><img src="${r.dataUrl}" alt="参考图${i + 1}" /><button type="button" data-ref-rm="${i}" title="移除">×</button></div>`
      ).join("");
      if (empty) empty.hidden = genState.refs.length > 0;
    }
    async function addGenRefFiles(files) {
      for (const f of Array.from(files || [])) {
        if (!f || !(f.type || "").startsWith("image/")) continue;
        try { genState.refs.push({ dataUrl: await readFileAsDataURL(f), name: f.name }); } catch (_) {}
      }
      renderGenRefs();
    }

    function renderGenResults() {
      const el = genEl("gen-results");
      if (!el) return;
      el.innerHTML = genState.results.map((r) => {
        if (r.status === "loading") {
          return `<figure class="gen-card is-loading"><div class="gen-card-msg"><span class="gen-spin"></span>生成中…</div></figure>`;
        }
        if (r.status === "error") {
          return `<figure class="gen-card is-error" data-id="${r.id}"><div class="gen-card-msg">⚠ ${escapeHtml((r.error || "失败").slice(0, 90))}<button type="button" class="gen-card-retry" data-gen-act="retry">重试</button></div></figure>`;
        }
        const dl = r.dataUrl || "";
        return `<figure class="gen-card ${r.status === "partial" ? "is-partial" : ""}" data-id="${r.id}">
          <img src="${dl}" alt="生成结果" loading="lazy" />
          <div class="gen-card-acts">
            <a class="mini-btn" href="${dl}" download="sakura-gen-${r.id}.png" title="下载">⬇</a>
            <button type="button" class="mini-btn" data-gen-act="edit" title="在图像编辑器中打开">✏️</button>
            <button type="button" class="mini-btn" data-gen-act="tolib" title="去图库查看（已自动入库）">🖼</button>
          </div>
        </figure>`;
      }).join("");
    }

    async function runGalleryGen() {
      if (genState.abort) return;
      const statusEl = genEl("gen-status");
      const runBtn = genEl("gen-run");
      const cancelBtn = genEl("gen-cancel");
      const resultsEl = genEl("gen-results");
      const setErr = (msg) => { if (statusEl) { statusEl.classList.add("err"); statusEl.textContent = msg; } };
      if (statusEl) statusEl.classList.remove("err");

      const providers = AI.AIStore.data.providers || [];
      const provider = providers.find((p) => p.id === genEl("gen-provider")?.value);
      const model = (genEl("gen-model")?.value || "").trim();
      const prompt = (genEl("gen-prompt")?.value || "").trim();
      const mode = genState.mode || "t2i";

      if (!provider) { setErr("请先在 AI 设置里添加供应商，并在此选择"); return; }
      if (!model) { setErr("请填写或选择一个图像模型"); return; }
      if (mode === "i2i" && !genState.refs.length) { setErr("图生图需要至少上传 1 张参考图"); return; }
      if (mode === "t2i" && !prompt) { setErr("请输入提示词"); return; }

      let size = genEl("gen-size")?.value || "1024x1024";
      if (size === "custom") {
        const w = Math.max(64, +genEl("gen-custom-w")?.value || 1024);
        const h = Math.max(64, +genEl("gen-custom-h")?.value || 1024);
        size = `${w}x${h}`;
      }
      const quality = genEl("gen-quality")?.value || "auto";
      const count = Math.max(1, Math.min(8, +genEl("gen-count")?.value || 1));
      const apiMode = mode === "i2i" ? "images" : (genEl("gen-api-mode")?.value || "images");
      const textModel = (genEl("gen-driver")?.value || "").trim();

      const longSide = (() => { const m = /^(\d+)x(\d+)$/.exec(size); return m ? Math.max(+m[1], +m[2]) : 0; })();
      if (longSide >= 2048 && /^(gpt-image-|dall.?e[-\d])/i.test(model)) {
        if (confirm(`你选的尺寸 ${size} 对 ${model} 这类 OpenAI 系图模型大概率会失败（一般只支持 1024 系列）。\n\n确定 = 自动改用 1024×1024 继续；取消 = 保留 ${size} 强行尝试`)) {
          size = "1024x1024";
        }
      }

      genState.results = Array.from({ length: count }, (_, i) => ({ id: "g-" + Date.now() + "-" + i, status: "loading" }));
      renderGenResults();
      try { resultsEl?.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}

      genState.abort = new AbortController();
      if (runBtn) runBtn.hidden = true;
      if (cancelBtn) cancelBtn.hidden = false;
      const startedAt = Date.now();
      if (statusEl) statusEl.textContent = mode === "i2i" ? "正在图生图…" : "正在生成…";
      const tick = setInterval(() => {
        if (!genState.abort || !statusEl) return;
        statusEl.textContent = `${mode === "i2i" ? "图生图" : "生成"}中… 已等待 ${Math.floor((Date.now() - startedAt) / 1000)}s`;
      }, 1000);

      const retry = {
        maxAttempts: apiMode === "responses" ? 3 : 2,
        delayMs: apiMode === "responses" ? 15000 : 1500,
        onRetry: (n, total, err, stage) => {
          if (!statusEl) return;
          if (stage === "fallback-images") { statusEl.textContent = "⤵ Responses 模式失败，自动改用 Images 模式…"; return; }
          statusEl.textContent = `重试 ${n}/${total - 1}${err?.status ? " (HTTP " + err.status + ")" : ""}…`;
        },
      };

      try {
        let arr;
        if (mode === "i2i") {
          arr = await AI.generateImageEdit({
            provider, model, prompt: prompt || "编辑这张图片", images: genState.refs.map((r) => r.dataUrl),
            size, quality, n: count, signal: genState.abort.signal, retry,
          });
        } else {
          arr = await AI.generateImage({
            provider, model, prompt: prompt || "请生成一张创意图片", size, quality, n: count, apiMode, textModel,
            signal: genState.abort.signal, retry,
            onPartial: ({ b64, revisedPrompt }) => {
              if (!b64 || !genState.results.length) return;
              const slot = genState.results[0];
              slot.status = "partial";
              slot.dataUrl = "data:image/png;base64," + b64;
              slot.revisedPrompt = revisedPrompt || slot.revisedPrompt || "";
              renderGenResults();
            },
          });
        }
        const merged = (arr || []).map((it, i) => ({
          id: genState.results[i]?.id || "g-" + Date.now() + "-" + i,
          status: (it.degraded || it.sourceEvent === "partial") ? "partial" : "success",
          dataUrl: it.dataUrl || it.url || "",
          revisedPrompt: it.revisedPrompt || "",
        }));
        while (merged.length < count) merged.push({ id: "g-err-" + merged.length, status: "error", error: "接口返回的图片数量不足" });
        genState.results = merged;
        renderGenResults();
        const okCount = merged.filter((m) => m.dataUrl).length;
        if (statusEl) statusEl.textContent = `✅ 完成 · ${okCount}/${count} 张 · ${size} · ${quality}`;

        const toSave = merged
          .filter((r) => (r.status === "success" || r.status === "partial") && r.dataUrl)
          .map((r) => ({ source: "generated", dataUrl: r.dataUrl, prompt: prompt || "", revisedPrompt: r.revisedPrompt || "", model, size, quality }));
        if (toSave.length && window.Archive?.Gallery) {
          await window.Archive.Gallery.addBatch(toSave).catch(() => {});
        }
      } catch (err) {
        if (err?.name === "AbortError") {
          genState.results = genState.results.map((r) => r.status === "loading" ? { ...r, status: "error", error: "已取消" } : r);
          if (statusEl) statusEl.textContent = "已取消";
        } else {
          const friendly = (AI.formatImageErrorMessage ? AI.formatImageErrorMessage(err.message || "生图失败") : (err.message || "生图失败"));
          genState.results = genState.results.map((r) => r.status === "loading" ? { ...r, status: "error", error: friendly } : r);
          setErr(String(friendly).replace(/\s+/g, " ").slice(0, 220));
        }
        renderGenResults();
      } finally {
        clearInterval(tick);
        genState.abort = null;
        if (runBtn) runBtn.hidden = false;
        if (cancelBtn) cancelBtn.hidden = true;
      }
    }

    function initGalleryGen() {
      if (genState.inited) return;
      if (!dlgGallery) return;
      const sizeSel = genEl("gen-size");
      const qualSel = genEl("gen-quality");
      if (sizeSel && AI.IMAGE_SIZES) sizeSel.innerHTML = AI.IMAGE_SIZES.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
      if (qualSel && AI.IMAGE_QUALITIES) qualSel.innerHTML = AI.IMAGE_QUALITIES.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");

      const opts = AI.AIStore.data.imageOpts || {};
      genState.mode = opts.genMode === "i2i" ? "i2i" : "t2i";
      if (sizeSel) sizeSel.value = opts.size || "1024x1024";
      if (qualSel) qualSel.value = opts.quality || "auto";
      if (genEl("gen-count")) genEl("gen-count").value = String(opts.n || 1);
      if (genEl("gen-api-mode")) genEl("gen-api-mode").value = opts.apiMode || "images";
      if (genEl("gen-driver")) genEl("gen-driver").value = opts.textModel || "";
      if (genEl("gen-custom-w")) genEl("gen-custom-w").value = opts.customW || 1024;
      if (genEl("gen-custom-h")) genEl("gen-custom-h").value = opts.customH || 1024;

      refreshGenProviders();
      syncGenMode();
      syncGenCustom();
      renderGenRefs();

      $$(".gallery-tab").forEach((t) => t.addEventListener("click", () => showGalleryTab(t.dataset.gtab)));
      $$(".gen-mode-btn").forEach((b) => b.addEventListener("click", () => {
        genState.mode = b.dataset.mode === "i2i" ? "i2i" : "t2i";
        persistGenOpt("genMode", genState.mode);
        syncGenMode();
      }));

      genEl("gen-provider")?.addEventListener("change", () => {
        persistGenOpt("genProviderId", genEl("gen-provider").value);
        refreshGenModelList(true);
        persistGenOpt("genModel", genEl("gen-model").value);
      });
      genEl("gen-model")?.addEventListener("change", () => persistGenOpt("genModel", genEl("gen-model").value.trim()));
      sizeSel?.addEventListener("change", () => { persistGenOpt("size", sizeSel.value); syncGenCustom(); });
      qualSel?.addEventListener("change", () => persistGenOpt("quality", qualSel.value));
      genEl("gen-count")?.addEventListener("change", () => persistGenOpt("n", +genEl("gen-count").value || 1));
      genEl("gen-api-mode")?.addEventListener("change", () => { persistGenOpt("apiMode", genEl("gen-api-mode").value); syncGenDriver(); });
      genEl("gen-driver")?.addEventListener("change", () => persistGenOpt("textModel", genEl("gen-driver").value.trim()));
      genEl("gen-custom-w")?.addEventListener("change", () => persistGenOpt("customW", +genEl("gen-custom-w").value || 1024));
      genEl("gen-custom-h")?.addEventListener("change", () => persistGenOpt("customH", +genEl("gen-custom-h").value || 1024));

      genEl("gen-ref-input")?.addEventListener("change", (e) => { addGenRefFiles(e.target.files); e.target.value = ""; });
      const refsBox = genEl("gen-refs");
      if (refsBox) {
        refsBox.addEventListener("dragover", (e) => { e.preventDefault(); refsBox.classList.add("dragover"); });
        refsBox.addEventListener("dragleave", () => refsBox.classList.remove("dragover"));
        refsBox.addEventListener("drop", (e) => {
          e.preventDefault(); refsBox.classList.remove("dragover");
          if (e.dataTransfer?.files?.length) addGenRefFiles(e.dataTransfer.files);
        });
      }
      genEl("gen-ref-thumbs")?.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-ref-rm]");
        if (rm) { genState.refs.splice(+rm.dataset.refRm, 1); renderGenRefs(); }
      });

      genEl("gen-run")?.addEventListener("click", runGalleryGen);
      genEl("gen-cancel")?.addEventListener("click", () => { try { genState.abort?.abort(); } catch (_) {} });
      genEl("gen-prompt")?.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runGalleryGen(); }
      });

      genEl("gen-results")?.addEventListener("click", async (e) => {
        const act = e.target.closest("[data-gen-act]")?.dataset.genAct;
        if (!act) return;
        if (act === "retry") { runGalleryGen(); return; }
        if (act === "tolib") { showGalleryTab("library"); return; }
        if (act === "edit") {
          const id = e.target.closest(".gen-card")?.dataset.id;
          const r = genState.results.find((x) => x.id === id);
          if (!r?.dataUrl) return;
          if (!window.ImageEditor) { toast("图像编辑器模块未加载"); return; }
          try {
            await window.ImageEditor.open(
              { dataUrl: r.dataUrl, prompt: genEl("gen-prompt")?.value || "", model: genEl("gen-model")?.value || "" },
              async ({ dataUrl, prompt, model }) => {
                const newId = await Gallery.add({ source: "uploaded", dataUrl, prompt: (prompt || "") + " (edited)", name: "gen-edited.png", mime: "image/png", model: model || "" });
                toast(newId ? "✏️ 编辑结果已存为图库新条目" : "保存失败");
              }
            );
          } catch (err) { toast("打开编辑器失败：" + (err?.message || err), 4000); }
        }
      });

      genState.inited = true;
    }

    // 模块加载即尝试初始化（弹窗 DOM 已在页面里，隐藏状态也能绑定事件）
    try { initGalleryGen(); } catch (e) { console.warn("[GalleryGen.init]", e); }

    return { openSessions, openGallery, flushCurrentSession };
  })();

  // ===================== AI 设置 UI =====================
  const dlgAI = $("#dialog-ai");
  const dlgProvider = $("#dialog-provider");
  const dlgPersona = $("#dialog-persona");

  function openAISettings() {
    renderAIProviders();
    renderAIPersonas();
    $("#ai-signature").value = AI.AIStore.data.customSignature || "";
    $("#ai-auto-apply").checked = !!AI.AIStore.data.autoApply;
    const sm = $("#ai-smart-mode"); if (sm) sm.checked = !!AI.AIStore.data.smartMode;
    Dlg.open(dlgAI);
  }

  $("#ai-signature").addEventListener("change", (e) => {
    AI.AIStore.data.customSignature = e.target.value;
    AI.AIStore.save();
  });
  $("#ai-auto-apply").addEventListener("change", (e) => {
    AI.AIStore.data.autoApply = e.target.checked;
    AI.AIStore.save();
  });
  $("#ai-smart-mode")?.addEventListener("change", (e) => {
    AI.AIStore.data.smartMode = e.target.checked;
    AI.AIStore.save();
    toast(e.target.checked
      ? "已开启智能模式：发送前会自动绕开冷却模型"
      : "已关闭智能模式");
  });

  function renderAIProviders() {
    const list = $("#ai-providers-list");
    const curId = AI.AIStore.data.currentProviderId;
    list.innerHTML = AI.AIStore.data.providers.map((p) => `
      <div class="ai-provider-item ${p.id === curId ? "active" : ""}" data-id="${p.id}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml(p.baseUrl)}${p.models?.length ? ` · ${p.models.length} 模型` : ""}</span>
        <div class="actions">
          <button data-act="use">${p.id === curId ? "当前" : "选用"}</button>
          <button data-act="fetch">刷新模型</button>
          <button data-act="edit">编辑</button>
          <button data-act="del">删除</button>
        </div>
      </div>
    `).join("") || `<div class="hint">暂无供应商，点击下方"添加"。</div>`;
  }

  $("#ai-providers-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const item = btn.closest(".ai-provider-item");
    const id = item?.dataset.id;
    const p = AI.AIStore.data.providers.find((x) => x.id === id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === "use") {
      AI.AIStore.data.currentProviderId = id;
      AI.AIStore.data.currentModel = p.defaultModel || (p.models || [])[0] || "";
      AI.AIStore.save();
      renderAIProviders();
      UIAI.refreshModelOptions();
    } else if (act === "fetch") {
      btn.textContent = "…";
      try {
        const ms = await AI.fetchModels(p);
        p.models = ms;
        AI.AIStore.save();
        toast(`已加载 ${ms.length} 个模型`);
        renderAIProviders();
        UIAI.refreshModelOptions();
      } catch (err) {
        toast("拉取失败：" + err.message.slice(0, 80), 3500);
      }
      btn.textContent = "刷新模型";
    } else if (act === "edit") {
      openProviderDialog(p);
    } else if (act === "del") {
      if (!confirm(`删除供应商 "${p.name}"？`)) return;
      AI.AIStore.data.providers = AI.AIStore.data.providers.filter((x) => x.id !== id);
      if (AI.AIStore.data.currentProviderId === id) AI.AIStore.data.currentProviderId = (AI.AIStore.data.providers[0] || {}).id || "";
      AI.AIStore.save();
      renderAIProviders();
      UIAI.refreshModelOptions();
    }
  });

  $("#ai-add-provider").addEventListener("click", () => openProviderDialog(null));
  const presets = {
    openai:   { name: "OpenAI",   baseUrl: "https://api.openai.com/v1",           defaultModel: "gpt-4o-mini" },
    deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",         defaultModel: "deepseek-chat" },
    kimi:     { name: "Kimi",     baseUrl: "https://api.moonshot.cn/v1",          defaultModel: "moonshot-v1-8k" },
    ollama:   { name: "Ollama 本地", baseUrl: "http://localhost:11434/v1",         defaultModel: "llama3" },
  };
  Object.keys(presets).forEach((k) => {
    $("#ai-add-preset-" + k).addEventListener("click", () => openProviderDialog(null, presets[k]));
  });

  function populateProviderModelsDatalist(models) {
    const dl = $("#provider-models-dl");
    if (!dl) return;
    dl.innerHTML = (models || []).map((m) => `<option value="${escapeHtml(m)}"></option>`).join("");
  }

  function openProviderDialog(existing, preset) {
    const f = $("#form-provider");
    $("#provider-title").textContent = existing ? "🔌 编辑 AI 供应商" : "🔌 添加 AI 供应商";
    f.reset();
    const msg = $("#provider-fetch-msg");
    if (msg) { msg.textContent = ""; msg.classList.remove("err", "ok"); }
    if (existing) {
      f.name.value = existing.name;
      f.baseUrl.value = existing.baseUrl;
      f.apiKey.value = existing.apiKey || "";
      // 反代默认开启；只在 useProxy === false（用户显式禁用）时勾选"禁用本机反代"复选框
      if (f.disableProxy) f.disableProxy.checked = existing.useProxy === false;
      f.defaultModel.value = existing.defaultModel || "";
      populateProviderModelsDatalist(existing.models || []);
      f.dataset.fetchedModels = JSON.stringify(existing.models || []);
    } else if (preset) {
      f.name.value = preset.name;
      f.baseUrl.value = preset.baseUrl;
      f.defaultModel.value = preset.defaultModel;
      populateProviderModelsDatalist([]);
      f.dataset.fetchedModels = "[]";
    } else {
      populateProviderModelsDatalist([]);
      f.dataset.fetchedModels = "[]";
    }
    f.dataset.editId = existing ? existing.id : "";
    Dlg.open(dlgProvider);
  }

  $("#provider-fetch-models")?.addEventListener("click", async () => {
    const f = $("#form-provider");
    const btn = $("#provider-fetch-models");
    const msg = $("#provider-fetch-msg");
    const baseUrl = (f.baseUrl.value || "").trim();
    const apiKey = (f.apiKey.value || "").trim();
    // disableProxy 勾选 → useProxy=false 强制直连；否则 undefined 走自动判定
    const disableProxy = !!(f.disableProxy && f.disableProxy.checked);
    const useProxy = disableProxy ? false : undefined;
    if (!baseUrl) {
      if (msg) { msg.textContent = "请先填写 Base URL"; msg.classList.add("err"); }
      return;
    }
    if (msg) { msg.textContent = "正在拉取模型列表…"; msg.classList.remove("err", "ok"); }
    btn.disabled = true;
    try {
      const models = await AI.fetchModels({ baseUrl, apiKey, useProxy });
      populateProviderModelsDatalist(models);
      f.dataset.fetchedModels = JSON.stringify(models);
      if (!f.defaultModel.value && models[0]) f.defaultModel.value = models[0];
      if (msg) { msg.textContent = `已加载 ${models.length} 个模型，点击输入框可下拉选择`; msg.classList.remove("err"); msg.classList.add("ok"); }
    } catch (e) {
      if (msg) { msg.textContent = "拉取失败：" + String(e.message || e).slice(0, 200); msg.classList.add("err"); }
    } finally {
      btn.disabled = false;
    }
  });

  $("#form-provider").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    delete data.disableProxy; // 这是 UI 字段，不直接落库
    // 反代决策：勾上"禁用本机反代"= useProxy=false；不勾就把字段干掉走自动判定（buildFetchTarget 会按 proxyAvailable 决定）
    if (f.disableProxy && f.disableProxy.checked) {
      data.useProxy = false;
    } else {
      delete data.useProxy;
    }
    let fetched = [];
    try { fetched = JSON.parse(f.dataset.fetchedModels || "[]"); } catch (_) {}
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.providers.find((x) => x.id === editId);
      if (p) {
        const oldDefault = p.defaultModel;
        Object.assign(p, data);
        // Object.assign 不删字段：useProxy 不在 data 里时也要把旧的 false 清掉，让自动判定接管
        if (!("useProxy" in data)) delete p.useProxy;
        if (fetched.length) p.models = fetched;
        // 如果改的是当前正在用的供应商，且默认模型变了，把对话页正在用的当前模型也跟过去；
        // 否则用户在设置里改完默认模型后，对话页头部仍显示旧模型，迷惑性极强。
        if (p.id === AI.AIStore.data.currentProviderId
            && p.defaultModel
            && p.defaultModel !== oldDefault) {
          AI.AIStore.data.currentModel = p.defaultModel;
        }
        // 进一步兜底：当前模型不在新模型列表里就强制切到默认模型（或第一个）
        const models = p.models || [];
        if (p.id === AI.AIStore.data.currentProviderId
            && AI.AIStore.data.currentModel
            && models.length
            && !models.includes(AI.AIStore.data.currentModel)) {
          AI.AIStore.data.currentModel = p.defaultModel || models[0];
        }
      }
    } else {
      const newP = Object.assign({ id: AI.uid(), models: fetched }, data);
      AI.AIStore.data.providers.push(newP);
      if (!AI.AIStore.data.currentProviderId) {
        AI.AIStore.data.currentProviderId = newP.id;
        AI.AIStore.data.currentModel = newP.defaultModel || (newP.models || [])[0] || "";
      }
    }
    AI.AIStore.save();
    Dlg.close(dlgProvider);
    renderAIProviders();
    UIAI.refreshModelOptions();
  });

  // ---- Personas ----
  function renderAIPersonas() {
    const list = $("#ai-personas-list");
    const curId = AI.AIStore.data.currentPersonaId;
    list.innerHTML = AI.AIStore.data.personas.map((p) => `
      <div class="ai-persona-item ${p.id === curId ? "active" : ""}" data-id="${p.id}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml((p.prompt || "").slice(0, 60))}${p.prompt?.length > 60 ? "..." : ""}</span>
        <div class="actions">
          <button data-act="use">${p.id === curId ? "当前" : "选用"}</button>
          <button data-act="edit">编辑</button>
          <button data-act="del">删除</button>
        </div>
      </div>
    `).join("");
  }

  $("#ai-personas-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.closest(".ai-persona-item").dataset.id;
    const p = AI.AIStore.data.personas.find((x) => x.id === id);
    const act = btn.dataset.act;
    if (act === "use") {
      AI.AIStore.data.currentPersonaId = id;
      AI.AIStore.save();
      renderAIPersonas();
      UIAI.refreshPersonaOptions();
    } else if (act === "edit") openPersonaDialog(p);
    else if (act === "del") {
      if (!confirm(`删除角色 "${p.name}"？`)) return;
      AI.AIStore.data.personas = AI.AIStore.data.personas.filter((x) => x.id !== id);
      if (AI.AIStore.data.currentPersonaId === id) AI.AIStore.data.currentPersonaId = (AI.AIStore.data.personas[0] || {}).id || "";
      AI.AIStore.save();
      renderAIPersonas();
      UIAI.refreshPersonaOptions();
    }
  });

  $("#ai-add-persona").addEventListener("click", () => openPersonaDialog(null));

  function openPersonaDialog(existing) {
    const f = $("#form-persona");
    $("#persona-title").textContent = existing ? "🎭 编辑角色" : "🎭 添加角色";
    f.reset();
    if (existing) { f.name.value = existing.name; f.prompt.value = existing.prompt; f.dataset.editId = existing.id; }
    else f.dataset.editId = "";
    Dlg.open(dlgPersona);
  }

  $("#form-persona").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const editId = f.dataset.editId;
    if (editId) {
      const p = AI.AIStore.data.personas.find((x) => x.id === editId);
      if (p) Object.assign(p, data);
    } else {
      AI.AIStore.data.personas.push({ id: AI.uid(), name: data.name, prompt: data.prompt });
    }
    AI.AIStore.save();
    Dlg.close(dlgPersona);
    renderAIPersonas();
    UIAI.refreshPersonaOptions();
  });

    return { UIAI, UIArchive };
  };
})();
